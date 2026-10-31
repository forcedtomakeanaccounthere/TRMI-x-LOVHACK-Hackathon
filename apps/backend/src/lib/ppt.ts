import CFB from "cfb";
import { JSDOM } from "jsdom";
import { HttpError } from "../middleware/error";

/**
 * Binary PowerPoint 97-2004 (.ppt) parser.
 * A .ppt file is an OLE Compound Document (MS-CFB) containing a "PowerPoint Document" stream.
 *
 * Inside the stream, MS-PPT records start with an 8-byte header:
 *   - bytes 0-1: recVer (4 bits) | recInstance (12 bits)
 *   - bytes 2-3: recType (uint16 LE)
 *   - bytes 4-7: recLen (uint32 LE)
 *
 * Slide markers and text atoms:
 *   - 0x03EE (1006): RT_Slide container
 *   - 0x03F3 (1011): RT_SlidePersistAtom (marks a slide in SlideListWithText)
 *   - 0x0FA0 (4000): RT_TextCharsAtom (UTF-16LE text)
 *   - 0x0FA8 (4008): RT_TextBytesAtom (ANSI/ASCII text)
 *   - 0x0FBA (4026): RT_CString (UTF-16LE string)
 */

const RT_SLIDE = 1006;
const RT_SLIDE_PERSIST_ATOM = 1011;
const RT_TEXT_CHARS_ATOM = 4000;
const RT_TEXT_BYTES_ATOM = 4008;
const RT_CSTRING = 4026;

function cleanString(str: string): string[] {
  return str
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

/**
 * Extracts slides text from a "PowerPoint Document" stream buffer.
 * Recursively walks PPT container records (recVer === 0x0F) to find nested
 * text atoms (RT_TextCharsAtom, RT_TextBytesAtom, RT_CString) within slide containers.
 * Groups paragraphs into slide arrays: slide[0] = paragraphs of Slide 1, etc.
 */
export function extractPptSlides(streamBuf: Buffer): string[][] {
  const slides: string[][] = [];
  let currentSlide: string[] = [];

  const startNewSlide = () => {
    if (currentSlide.length > 0) {
      slides.push(currentSlide);
      currentSlide = [];
    }
  };

  const walkRecords = (start: number, end: number, depth = 0) => {
    if (depth > 32) return;

    let offset = start;
    while (offset + 8 <= end) {
      const recVerInstance = streamBuf.readUInt16LE(offset);
      const recVer = recVerInstance & 0x0f;
      const recType = streamBuf.readUInt16LE(offset + 2);
      const recLen = streamBuf.readUInt32LE(offset + 4);

      if (offset + 8 + recLen > end) {
        break;
      }

      const payloadOffset = offset + 8;
      const isContainer = recVer === 0x0f;

      if (recType === RT_SLIDE_PERSIST_ATOM || recType === RT_SLIDE) {
        startNewSlide();
      }

      if (isContainer) {
        walkRecords(payloadOffset, payloadOffset + recLen, depth + 1);
      } else {
        if (recType === RT_TEXT_CHARS_ATOM || recType === RT_CSTRING) {
          if (recLen > 0) {
            const text = streamBuf.toString("utf16le", payloadOffset, payloadOffset + recLen);
            const lines = cleanString(text);
            if (lines.length > 0) currentSlide.push(...lines);
          }
        } else if (recType === RT_TEXT_BYTES_ATOM) {
          if (recLen > 0) {
            const text = streamBuf.toString("latin1", payloadOffset, payloadOffset + recLen);
            const lines = cleanString(text);
            if (lines.length > 0) currentSlide.push(...lines);
          }
        }
      }

      offset += 8 + recLen;
    }
  };

  walkRecords(0, streamBuf.length, 0);

  if (currentSlide.length > 0) {
    slides.push(currentSlide);
  }

  // If no slide delimiters were hit but we found text, treat as a single slide
  return slides.filter((s) => s.length > 0);
}

/**
 * Parses binary PowerPoint (.ppt) bytes and converts them to block HTML
 * matching the slide structure of .pptx files:
 * <section data-block="p1"><h2>Slide 1</h2><p>...</p></section>
 */
export function pptToHtml(buf: Buffer): string {
  let cfb: CFB.CFB$Container;
  try {
    cfb = CFB.read(buf, { type: "buffer" });
  } catch {
    throw new HttpError(400, "That file is damaged or isn't a valid .ppt file.");
  }

  let streamBuf: Buffer | null = null;
  // Look for the "PowerPoint Document" stream (case-insensitive search)
  for (const name of cfb.FullPaths) {
    const base = name.split("/").pop() || "";
    if (base.toLowerCase() === "powerpoint document") {
      const entry = CFB.find(cfb, name);
      if (entry && entry.content) {
        streamBuf = Buffer.from(entry.content as Uint8Array);
        break;
      }
    }
  }

  if (!streamBuf || streamBuf.length === 0) {
    throw new HttpError(400, "That file is damaged or isn't a valid .ppt file.");
  }

  const slides = extractPptSlides(streamBuf);
  if (!slides.length) {
    throw new HttpError(422, "That presentation has no text we can read.");
  }

  const { document } = new JSDOM("<body></body>").window;
  for (const [i, paragraphs] of slides.entries()) {
    const section = document.createElement("section");
    section.setAttribute("data-block", `p${i + 1}`);
    const heading = document.createElement("h2");
    heading.textContent = `Slide ${i + 1}`;
    section.append(heading);

    for (const text of paragraphs) {
      const p = document.createElement("p");
      p.textContent = text;
      section.append(p);
    }
    document.body.append(section);
  }

  return document.body.innerHTML;
}
