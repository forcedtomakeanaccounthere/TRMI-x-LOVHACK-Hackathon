import type { FileFormat } from "@linkroom/shared";
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import mammoth from "mammoth";
import { Marked } from "marked";
import yauzl from "yauzl";
import { HttpError } from "../middleware/error";
import { cleanArticle, htmlToText, textToHtml } from "./extract";
import { pptToHtml } from "./ppt";
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
  ppt: "application/vnd.ms-powerpoint",
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

  if (buf.subarray(0, 8).equals(OLE_MAGIC) || ["ppt", "pps"].includes(ext)) {
    if (buf.subarray(0, 8).equals(OLE_MAGIC)) {
      try {
        const html = pptToHtml(buf);
        return { format: "ppt", html: checkHtml(html) };
      } catch (err) {
        if (["ppt", "pps"].includes(ext)) throw err;
        throw new HttpError(400, LEGACY_OFFICE);
      }
    }
    if (["ppt", "pps"].includes(ext)) {
      throw new HttpError(400, `That file isn't a valid .${ext} file.`);
    }
  }

  if (["doc", "pot", "dot"].includes(ext)) {
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
  if (["pdf", "docx", "pptx", "ppt"].includes(ext)) throw new HttpError(400, `That file isn't a valid .${ext} file.`);
  throw new HttpError(400, UNSUPPORTED);
}

/**
 * Zip bomb guard, run before any parser sees the file. Refuses more than MAX_ZIP_ENTRIES files or
 * more than MAX_UNZIPPED_BYTES unpacked, and returns the file names.
 *
 * The sizes in a ZIP's directory are whatever the uploader wrote, so they are only a quick first
 * check. Every entry is then really unpacked and its bytes counted against the same limit; an
 * entry that unpacks to more than it claims is refused too (validateEntrySizes). The parsers then
 * read the same bytes, so they never unpack more than was counted here.
 */
export async function inspectZip(buf: Buffer): Promise<Set<string>> {
  const damaged = () => new HttpError(400, "That file is damaged or isn't a valid .docx/.pptx file.");
  const tooBig = () => new HttpError(400, "That file unpacks to more than 50 MB. Try a smaller file.");

  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (err, file) => {
      if (err || !file) reject(damaged());
      else resolve(file);
    });
  });

  try {
    if (zip.entryCount > MAX_ZIP_ENTRIES) throw tooBig();

    // 1. The directory: names, count and claimed sizes, before anything is unpacked.
    const entries = await new Promise<yauzl.Entry[]>((resolve, reject) => {
      const list: yauzl.Entry[] = [];
      let declared = 0;
      zip.on("entry", (entry: yauzl.Entry) => {
        declared += entry.uncompressedSize;
        if (declared > MAX_UNZIPPED_BYTES || list.length >= MAX_ZIP_ENTRIES) return reject(tooBig());
        list.push(entry);
        zip.readEntry();
      });
      zip.on("end", () => resolve(list));
      zip.on("error", () => reject(damaged()));
      zip.readEntry();
    });

    // 2. The data: every entry really unpacked, its bytes counted against the same limit.
    let unpacked = 0;
    for (const entry of entries) {
      if (entry.fileName.endsWith("/")) continue; // folders have no data
      await new Promise<void>((resolve, reject) => {
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(damaged()); // encrypted, unknown compression, ...
          stream.on("data", (chunk: Buffer) => {
            unpacked += chunk.length;
            if (unpacked > MAX_UNZIPPED_BYTES) {
              stream.destroy();
              reject(tooBig());
            }
          });
          stream.on("error", () => reject(damaged())); // includes more or fewer bytes than declared
          stream.on("end", () => resolve());
        });
      });
    }

    return new Set(entries.map((entry) => entry.fileName));
  } finally {
    zip.close();
  }
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

  // Every slide is read before anything is shown: a deck with a slide we can't read is refused
  // rather than turned into a room with slides missing.
  let slides: string[][];
  try {
    const names = await slideOrder(zip);
    slides = [];
    for (const name of names) slides.push(slideParagraphs(await zip.file(name)!.async("string")));
  } catch {
    throw damaged();
  }

  const { document } = new JSDOM("<body></body>").window;
  for (const [i, paragraphs] of slides.entries()) {
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

// Office files are XML, read with a real parser so any valid spelling of an attribute (single
// quotes, spaces around "=") is understood. It never loads external entities.
const xmlParser = new new JSDOM("").window.DOMParser();

function parseXml(xml: string) {
  const doc = xmlParser.parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid XML");
  return doc;
}

// Elements by local name, whatever prefix the file gives their namespace.
const elements = (root: Document | Element, localName: string) => [...root.getElementsByTagNameNS("*", localName)];

/**
 * The slide files in the order the deck shows them. That order is the slide list (p:sldIdLst) in
 * ppt/presentation.xml, whose relationship ids point at the files; the numbers in the file names
 * keep the order slides were created in, not where they were moved. Files the list doesn't name
 * are hidden from the show too. Without a list, falls back to the file numbers.
 * Throws when the list names a slide that can't be found, so no deck loses slides silently.
 */
export async function slideOrder(zip: JSZip): Promise<string[]> {
  const isSlide = (name: string) => /^ppt\/slides\/slide\d+\.xml$/.test(name) && Boolean(zip.file(name));

  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
  if (!presentationXml) throw new Error("No ppt/presentation.xml");
  const listedIds = elements(parseXml(presentationXml), "sldId").map(
    // r:id: the attribute named "id" in a namespace (the plain "id" is the slide's number).
    (el) => [...el.attributes].find((a) => a.localName === "id" && a.namespaceURI)?.value,
  );

  if (!listedIds.length) {
    return Object.keys(zip.files)
      .filter(isSlide)
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  }

  const relsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (!relsXml) throw new Error("No ppt/_rels/presentation.xml.rels");
  const targets = new Map<string, string>();
  for (const rel of elements(parseXml(relsXml), "Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) targets.set(id, resolvePart("ppt/", target));
  }

  const listed: string[] = [];
  for (const id of listedIds) {
    const name = id ? targets.get(id) : undefined;
    if (!name || !isSlide(name)) throw new Error(`Slide ${id ?? "without an id"} can't be found`);
    if (!listed.includes(name)) listed.push(name);
  }
  return listed;
}

// A relationship target is relative to the folder of the part that names it, or absolute from the
// package root when it starts with "/".
function resolvePart(folder: string, target: string) {
  const parts = (target.startsWith("/") ? target.slice(1) : folder + target).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

const isDrawingMl = (el: Element) => el.namespaceURI?.includes("drawingml") ?? false;

/**
 * The text of each DrawingML paragraph (a:p) in a slide's XML: its text runs (a:t) in order, with
 * line breaks (a:br) as spaces. Throws on XML that doesn't parse.
 */
export function slideParagraphs(xml: string) {
  const paragraphs: string[] = [];
  for (const p of elements(parseXml(xml), "p").filter(isDrawingMl)) {
    const text = elements(p, "*")
      .filter(isDrawingMl)
      .map((el) => (el.localName === "t" ? (el.textContent ?? "") : el.localName === "br" ? " " : ""))
      .join("");
    // eslint-disable-next-line no-control-regex
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (clean) paragraphs.push(clean);
  }
  return paragraphs;
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
