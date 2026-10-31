import CFB from "cfb";
import { describe, expect, it } from "vitest";
import { extractPptSlides, pptToHtml } from "../../src/lib/ppt";
import { parseFile } from "../../src/lib/files";
import { HttpError } from "../../src/middleware/error";

/** Helper to create an in-memory .ppt file (OLE compound file) */
function createMockPptBuffer(streamBytes: Buffer): Buffer {
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "PowerPoint Document", streamBytes);
  return Buffer.from(CFB.write(cfb, { type: "buffer" }) as Uint8Array);
}

/** Helper to build MS-PPT record header */
function makeRecord(recType: number, payload: Buffer, recVer = 0, recInstance = 0): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt16LE((recInstance << 4) | (recVer & 0x0f), 0);
  header.writeUInt16LE(recType, 2);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe("PPT parser (lib/ppt.ts)", () => {
  it("extracts slides and text from TextCharsAtom (UTF-16LE) and TextBytesAtom", () => {
    // Slide 1
    const slide1Marker = makeRecord(1006, Buffer.alloc(0)); // RT_Slide
    const textCharsPayload = Buffer.from("Welcome to LinkRoom\r\nMultiplayer everything", "utf16le");
    const textCharsRecord = makeRecord(4000, textCharsPayload); // RT_TextCharsAtom

    // Slide 2
    const slide2Marker = makeRecord(1006, Buffer.alloc(0)); // RT_Slide
    const textBytesPayload = Buffer.from("Second Slide Content\r\nAll notes here", "latin1");
    const textBytesRecord = makeRecord(4008, textBytesPayload); // RT_TextBytesAtom

    const stream = Buffer.concat([slide1Marker, textCharsRecord, slide2Marker, textBytesRecord]);
    const slides = extractPptSlides(stream);

    expect(slides.length).toBe(2);
    expect(slides[0]).toEqual(["Welcome to LinkRoom", "Multiplayer everything"]);
    expect(slides[1]).toEqual(["Second Slide Content", "All notes here"]);
  });

  it("converts PPT buffer to block HTML with p{n} anchors", () => {
    const slide1Marker = makeRecord(1006, Buffer.alloc(0));
    const titlePayload = Buffer.from("Intro Slide", "latin1");
    const titleRecord = makeRecord(4008, titlePayload);

    const stream = Buffer.concat([slide1Marker, titleRecord]);
    const pptBuffer = createMockPptBuffer(stream);

    const html = pptToHtml(pptBuffer);
    expect(html).toContain('data-block="p1"');
    expect(html).toContain("Slide 1");
    expect(html).toContain("Intro Slide");
  });

  it("parseFile parses .ppt files into { format: 'ppt', html }", async () => {
    const slideMarker = makeRecord(1006, Buffer.alloc(0));
    const payload = Buffer.from("Lecture Deck Slide", "latin1");
    const textRecord = makeRecord(4008, payload);

    const pptBuffer = createMockPptBuffer(Buffer.concat([slideMarker, textRecord]));
    const result = await parseFile(pptBuffer, "presentation.ppt");

    expect(result.format).toBe("ppt");
    if (result.format === "ppt") {
      expect(result.html).toContain('data-block="p1"');
      expect(result.html).toContain("Lecture Deck Slide");
    }
  });

  it("throws 422 if PPT file has no extractable text", () => {
    const slideMarker = makeRecord(1006, Buffer.alloc(0));
    const pptBuffer = createMockPptBuffer(slideMarker);

    expect(() => pptToHtml(pptBuffer)).toThrow(HttpError);
    try {
      pptToHtml(pptBuffer);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(422);
    }
  });

  it("recursively extracts text from nested container records (recVer === 0x0f)", () => {
    // A slide container (recType = 1006, recVer = 0x0f)
    // Containing a nested TextHeader container or shape container
    // Containing RT_TextCharsAtom (recType = 4000)
    const innerTextPayload = Buffer.from("Nested Slide Title\r\nBullet Point Content", "utf16le");
    const innerTextAtom = makeRecord(4000, innerTextPayload, 0); // atom (recVer = 0)

    // Inner shape container (recType = 1009, recVer = 0x0f) wrapping the text atom
    const shapeContainer = makeRecord(1009, innerTextAtom, 0x0f);

    // Slide container (recType = 1006, recVer = 0x0f) wrapping the shape container
    const slideContainer = makeRecord(1006, shapeContainer, 0x0f);

    const pptBuffer = createMockPptBuffer(slideContainer);
    const html = pptToHtml(pptBuffer);

    expect(html).toContain('data-block="p1"');
    expect(html).toContain("Slide 1");
    expect(html).toContain("Nested Slide Title");
    expect(html).toContain("Bullet Point Content");
  });

  it("throws 400 if PPT file is corrupted or not a valid CFB", () => {
    const badBuffer = Buffer.from("Not an OLE file at all");
    expect(() => pptToHtml(badBuffer)).toThrow(HttpError);
    try {
      pptToHtml(badBuffer);
    } catch (err) {
      expect((err as HttpError).status).toBe(400);
    }
  });
});
