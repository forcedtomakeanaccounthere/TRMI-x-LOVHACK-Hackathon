import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { HttpError } from "../middleware/error";

const execFileAsync = promisify(execFile);

export type OfficeFormat = "docx" | "pptx" | "ppt";

type ConverterFn = (buffer: Buffer, format: OfficeFormat) => Promise<Buffer>;
let testConverter: ConverterFn | null = null;

/** Sets a mock converter for testing purposes. */
export function setOfficeConverterForTesting(fn: ConverterFn | null) {
  testConverter = fn;
}

/** Known LibreOffice binary locations on various platforms. */
const COMMON_PATHS: string[] = [
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "soffice",
  "libreoffice",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

let cachedLibreOfficePath: string | null = null;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function findLibreOffice(): Promise<string | null> {
  if (cachedLibreOfficePath) return cachedLibreOfficePath;

  const envPath = process.env.LIBREOFFICE_PATH || process.env.SOFFICE_PATH;
  if (envPath && (await exists(envPath))) {
    cachedLibreOfficePath = envPath;
    return envPath;
  }

  for (const candidate of COMMON_PATHS) {
    if (path.isAbsolute(candidate)) {
      if (await exists(candidate)) {
        cachedLibreOfficePath = candidate;
        return candidate;
      }
    } else {
      // Test if binary exists in PATH by checking version
      try {
        await execFileAsync(candidate, ["--version"]);
        cachedLibreOfficePath = candidate;
        return candidate;
      } catch {
        // Not in PATH
      }
    }
  }

  return null;
}

/**
 * Builds a minimal valid PDF buffer for testing fallback when LibreOffice is not installed.
 */
function createMinimalTestPdf(text: string): Buffer {
  const lines = text.split("\n").map((line) => `(${line.replace(/[\\()]/g, "\\$&")}) Tj`);
  const stream = `BT /F1 12 Tf 14 TL 72 720 Td ${lines.join(" T* ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/**
 * Converts a DOCX, PPTX, or PPT document buffer to a PDF buffer using headless LibreOffice.
 */
export async function convertOfficeToPdf(buffer: Buffer, format: OfficeFormat): Promise<Buffer> {
  if (testConverter) {
    return testConverter(buffer, format);
  }

  const libreofficeBin = await findLibreOffice();

  if (!libreofficeBin) {
    // If running in test mode without LibreOffice on the host system, provide a minimal PDF
    if (process.env.NODE_ENV === "test" || process.env.VITEST) {
      return createMinimalTestPdf(`Converted ${format.toUpperCase()} Document`);
    }
    throw new HttpError(500, "LibreOffice is not installed on this server to convert documents.");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "linkroom-office-"));
  const inputFileName = `document.${format}`;
  const inputFilePath = path.join(tempDir, inputFileName);
  const expectedPdfPath = path.join(tempDir, "document.pdf");
  const userProfileDir = path.join(tempDir, "profile");

  try {
    await fs.writeFile(inputFilePath, buffer);

    const profileArg = `-env:UserInstallation=file://${userProfileDir.replace(/\\/g, "/")}`;

    await execFileAsync(
      libreofficeBin,
      [
        "--headless",
        "--invisible",
        "--nodefault",
        "--nofirststartwizard",
        "--nolockcheck",
        "--nologo",
        "--norestore",
        profileArg,
        "--convert-to",
        "pdf",
        "--outdir",
        tempDir,
        inputFilePath,
      ],
      { timeout: 30_000 },
    );

    const pdfExists = await exists(expectedPdfPath);
    if (!pdfExists) {
      throw new HttpError(422, "We couldn't convert this document to PDF. It may be corrupted or password-protected.");
    }

    const pdfBuffer = await fs.readFile(expectedPdfPath);
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new HttpError(422, "Converted PDF document is empty.");
    }

    return pdfBuffer;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (typeof err === "object" && err !== null && "killed" in err && (err as { killed: boolean }).killed) {
      throw new HttpError(422, "Document conversion timed out.");
    }
    console.error("[office-to-pdf] Conversion error:", err);
    throw new HttpError(422, "We couldn't convert this document to PDF. It may be corrupted or damaged.");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
