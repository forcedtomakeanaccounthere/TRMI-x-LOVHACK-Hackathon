import type { FileFormat } from "@linkroom/shared";
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import mammoth from "mammoth";
import { Marked } from "marked";
import yauzl from "yauzl";
import { HttpError } from "../middleware/error";
import { cleanArticle, htmlToText, textToHtml } from "./extract";
import { isPdf } from "./pdf";

// Uploaded documents (POST /api/rooms/file) turned into the same block HTML as a link room:
//
//   format  bytes check                          parsed with                         blocks
//   pdf     %PDF-                                lib/pdf.ts (the PDF viewer)          p{n}
//   docx    ZIP with word/document.xml           mammoth → cleanArticle               b{n}
//   pptx    ZIP with ppt/presentation.xml        JSZip, <a:t> text of each slide      p{n}, one per slide
//   md      valid UTF-8, .md / .markdown         marked → cleanArticle (DOMPurify)    b{n}
//   txt     valid UTF-8, .txt                    textToHtml                           b{n}

// A ZIP's unpacked size and file count, read from its central directory before anything unpacks it.
export const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 2000;
// The HTML a room keeps. A link room's page is at most 5 MB, so a file room gets the same.
export const MAX_FILE_HTML_CHARS = 5 * 1024 * 1024;

export const LEGACY_OFFICE = "Save as .docx/.pptx and upload again.";
export const UNSUPPORTED = "We can read PDF, Word (.docx), PowerPoint (.pptx), Markdown (.md) and text (.txt) files.";

// Uploaded files have no page to resolve against: relative links and images are dropped.
const NO_BASE_URL = "about:blank";

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
// Old binary .doc / .ppt / .xls files (OLE compound documents).
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export const CONTENT_TYPES: Record<FileFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  md: "text/markdown",
  txt: "text/plain",
};

const TEXT_EXTENSIONS: Record<string, "md" | "txt"> = { md: "md", markdown: "md", txt: "txt", text: "txt" };

export type ParsedFile = { format: "pdf" } | { format: Exclude<FileFormat, "pdf">; html: string };

function extension(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1]!.toLowerCase() : "";
}

/**
 * Works out the format from the bytes (the extension only tells Markdown from plain text) and turns
 * the file into block HTML. PDFs are only detected: the caller stores them for the PDF viewer.
 * Throws a 400 for a format we don't read and a 422 for a file of the right format that won't parse.
 */
export async function parseFile(buf: Buffer, fileName: string): Promise<ParsedFile> {
  const ext = extension(fileName);

  if (["doc", "ppt", "pps", "pot", "dot"].includes(ext) || buf.subarray(0, 8).equals(OLE_MAGIC)) {
    throw new HttpError(400, LEGACY_OFFICE);
  }
  if (isPdf(buf)) return { format: "pdf" };

  if (buf.subarray(0, 4).equals(ZIP_MAGIC)) {
    const names = await inspectZip(buf);
    if (names.has("word/document.xml")) return { format: "docx", html: checkHtml(await docxToHtml(buf)) };
    if (names.has("ppt/presentation.xml")) return { format: "pptx", html: checkHtml(await pptxToHtml(buf)) };
    throw new HttpError(400, UNSUPPORTED);
  }

  const textFormat = TEXT_EXTENSIONS[ext];
  if (textFormat) {
    const text = decodeUtf8(buf);
    // The HTML is never shorter than the text, so a text this long is refused before it is parsed.
    if (text.length > MAX_FILE_HTML_CHARS) throw tooMuchText();
    const html = textFormat === "md" ? markdownToHtml(text) : textToHtml(text);
    return { format: textFormat, html: checkHtml(html) };
  }

  // Named like a format we read, but the bytes say otherwise.
  if (["pdf", "docx", "pptx"].includes(ext)) throw new HttpError(400, `That file isn't a valid .${ext} file.`);
  throw new HttpError(400, UNSUPPORTED);
}

/**
 * Zip bomb guard. Reads only the central directory, so nothing is unpacked: refuses more than
 * MAX_ZIP_ENTRIES files or more than MAX_UNZIPPED_BYTES unpacked, and returns the file names.
 */
export function inspectZip(buf: Buffer): Promise<Set<string>> {
  const damaged = () => new HttpError(400, "That file is damaged or isn't a valid .docx/.pptx file.");
  const tooBig = () => new HttpError(400, "That file unpacks to more than 50 MB. Try a smaller file.");

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(damaged());
      if (zip.entryCount > MAX_ZIP_ENTRIES) {
        zip.close();
        return reject(tooBig());
      }

      const names = new Set<string>();
      let total = 0;
      let done = false;
      const finish = (error: HttpError | null) => {
        if (done) return;
        done = true;
        zip.close();
        if (error) reject(error);
        else resolve(names);
      };

      zip.on("entry", (entry: yauzl.Entry) => {
        total += entry.uncompressedSize;
        if (total > MAX_UNZIPPED_BYTES || names.size >= MAX_ZIP_ENTRIES) return finish(tooBig());
        names.add(entry.fileName);
        zip.readEntry();
      });
      zip.on("end", () => finish(null));
      zip.on("error", () => finish(damaged()));
      zip.readEntry();
    });
  });
}

/** Strict UTF-8: a file in another encoding is refused rather than shown garbled. */
export function decodeUtf8(buf: Buffer) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new HttpError(400, "That file isn't UTF-8 text. Save it with UTF-8 encoding and upload again.");
  }
  // Postgres text can't hold NUL, and no real text file has one.
  if (text.includes("\u0000")) throw new HttpError(400, "That file isn't a text file.");
  return text;
}

async function docxToHtml(buf: Buffer) {
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: buf },
      {
        // Embedded images would become base64 data in content_html; they are dropped below.
        convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
        // Never follow links to files outside the upload.
        externalFileAccess: false,
      },
    );
    html = result.value;
  } catch {
    throw new HttpError(422, "We couldn't read this Word file. It may be damaged.");
  }
  return cleanArticle(html, NO_BASE_URL, { images: false });
}

/** One <section data-block="p{n}"> per slide, in slide order, with each text paragraph inside. */
async function pptxToHtml(buf: Buffer) {
  const damaged = () => new HttpError(422, "We couldn't read this PowerPoint file. It may be damaged.");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw damaged();
  }

  const slides = Object.keys(zip.files)
    .map((name) => ({ name, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1]) }))
    .filter((slide) => Number.isInteger(slide.n))
    .sort((a, b) => a.n - b.n);

  const { document } = new JSDOM("<body></body>").window;
  for (const [i, slide] of slides.entries()) {
    let xml: string;
    try {
      xml = await zip.file(slide.name)!.async("string");
    } catch {
      throw damaged();
    }
    const paragraphs = slideParagraphs(xml);
    if (!paragraphs.length) continue;

    // Numbered by position, so the blocks match the slide numbers people see.
    const section = document.createElement("section");
    section.setAttribute("data-block", `p${i + 1}`);
    const heading = document.createElement("h2");
    heading.textContent = `Slide ${i + 1}`;
    section.append(heading);
    for (const text of paragraphs) {
      const p = document.createElement("p");
      p.textContent = text; // text, never markup: a slide can't inject HTML
      section.append(p);
    }
    document.body.append(section);
  }
  return document.body.innerHTML;
}

/** The text of each <a:p> paragraph in a slide's XML, with line breaks as spaces. */
export function slideParagraphs(xml: string) {
  const paragraphs: string[] = [];
  for (const [, body] of xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)) {
    const text = [...body!.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br\b[^>]*\/>/g)]
      .map(([tag, run]) => (tag.startsWith("<a:br") ? " " : decodeXml(run ?? "")))
      .join("");
    // eslint-disable-next-line no-control-regex
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (clean) paragraphs.push(clean);
  }
  return paragraphs;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (whole, name: string) => {
    if (name[0] !== "#") return XML_ENTITIES[name.toLowerCase()] ?? whole;
    const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// GitHub-flavoured Markdown. Raw HTML in the file is allowed through marked and sanitized by
// cleanArticle (DOMPurify), like a web page.
const markdown = new Marked({ gfm: true });

function markdownToHtml(text: string) {
  return cleanArticle(markdown.parse(text, { async: false }), NO_BASE_URL);
}

const tooMuchText = () => new HttpError(422, "This file has too much text for one room. Split it into smaller files.");

function checkHtml(html: string) {
  if (html.length > MAX_FILE_HTML_CHARS) throw tooMuchText();
  if (!htmlToText(html).trim()) throw new HttpError(422, "This file has no text to read.");
  return html;
}
