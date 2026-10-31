import { describe, expect, it } from "vitest";
import { extractPdfText, isPdf, MAX_PDF_TEXT_CHARS } from "../../src/lib/pdf";
import { HttpError } from "../../src/middleware/error";
import { makePdf } from "../support/pdf";

describe("isPdf", () => {
  it("accepts files that start with %PDF-", () => {
    expect(isPdf(makePdf(["hi"]))).toBe(true);
  });

  it.each([["empty", ""], ["text", "hello"], ["html", "<html>"], ["header later", " %PDF-1.4"], ["short", "%PDF"]])(
    "rejects %s",
    (_, content) => {
      expect(isPdf(Buffer.from(content))).toBe(false);
    },
  );
});

describe("extractPdfText", () => {
  it("returns the text of each page, labelled by page number", async () => {
    const text = await extractPdfText(makePdf(["Attention is all you need", "Results (and more)"]));
    expect(text).toBe("[Page 1] Attention is all you need\n\n[Page 2] Results (and more)");
  });

  it("skips pages without text and returns null when there is none", async () => {
    expect(await extractPdfText(makePdf(["", "Second"]))).toBe("[Page 2] Second");
    expect(await extractPdfText(makePdf(["", ""]))).toBeNull();
  });

  it("leaves the caller's buffer intact", async () => {
    const file = makePdf(["keep me"]);
    const copy = Buffer.from(file);
    await extractPdfText(file);
    expect(file.equals(copy)).toBe(true);
  });

  it("stops at the character limit", async () => {
    // About 2,400 characters a page, so 30 pages go past the limit.
    const page = Array.from({ length: 40 }, () => "word ".repeat(12).trim()).join("\n");
    const text = await extractPdfText(makePdf(Array.from({ length: 30 }, () => page)));
    expect(text!.length).toBe(MAX_PDF_TEXT_CHARS);
    expect(text).toMatch(/^\[Page 1\] word/);
  });

  it("reads at most 50 pages", async () => {
    const text = await extractPdfText(makePdf(Array.from({ length: 55 }, (_, i) => `page ${i + 1}`)));
    expect(text).toContain("[Page 50] page 50");
    expect(text).not.toContain("[Page 51]");
  });

  it("refuses a damaged PDF with a 422", async () => {
    const err = await extractPdfText(Buffer.from("%PDF-1.4 but nothing else")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 422, message: "We couldn't read this PDF. It may be damaged." });
  });
});
