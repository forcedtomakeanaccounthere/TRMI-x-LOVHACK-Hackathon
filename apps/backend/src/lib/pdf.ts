import { getDocumentProxy } from "unpdf";
import { HttpError } from "../middleware/error";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
// Text kept for the AI recap. The AI service reads at most 60,000 characters anyway.
export const MAX_PDF_TEXT_CHARS = 60_000;
const MAX_PDF_TEXT_PAGES = 50;
// One deadline for opening the file and reading the text of every page.
const READ_TIMEOUT_MS = 10_000;

// Check the bytes, not the Content-Type: the client chooses that, and a renamed file still claims to be a PDF.
export function isPdf(buf: Buffer) {
  return buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

/**
 * Opens the PDF and returns the plain text of its first pages, one "[Page n]" section per page,
 * for the AI recap. Returns null when there is no text (a scanned PDF still gets a room).
 * Throws a 422 when the file can't be opened, so nobody gets a room that can't render.
 */
export async function extractPdfText(buf: Buffer): Promise<string | null> {
  const deadline = Date.now() + READ_TIMEOUT_MS;

  // pdf.js may take ownership of the bytes it is given, so hand it a copy.
  const opening = getDocumentProxy(new Uint8Array(buf), { isEvalSupported: false, verbosity: 0 });
  let doc: Awaited<typeof opening>;
  try {
    doc = await beforeDeadline(opening, deadline);
  } catch (err) {
    // A slow open finishes in the background; free it whenever it does.
    opening.then((d) => d.destroy()).catch(() => {});
    if (err instanceof Error && err.name === "PasswordException") {
      throw new HttpError(422, "This PDF is password-protected. Remove the password and try again.");
    }
    throw new HttpError(422, "We couldn't read this PDF. It may be damaged.");
  }

  const pages: string[] = [];
  let length = 0;
  try {
    const pageCount = Math.min(doc.numPages, MAX_PDF_TEXT_PAGES);
    for (let n = 1; n <= pageCount && length < MAX_PDF_TEXT_CHARS; n++) {
      const page = await beforeDeadline(doc.getPage(n), deadline);
      const content = await beforeDeadline(page.getTextContent(), deadline);
      const text = cleanText(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      if (!text) continue;
      const section = `[Page ${n}] ${text}`;
      pages.push(section);
      length += section.length + 2;
    }
  } catch (err) {
    // The file opened, so the browser can still render it: keep the pages read so far.
    console.warn("PDF text extraction stopped early:", err);
  } finally {
    await doc.destroy().catch(() => {});
  }

  const text = pages.join("\n\n").slice(0, MAX_PDF_TEXT_CHARS);
  return text || null;
}

// Postgres text can't hold NUL, and the recap only needs words, so drop control characters and squeeze spaces.
function cleanText(text: string) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("PDF read timed out")), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
