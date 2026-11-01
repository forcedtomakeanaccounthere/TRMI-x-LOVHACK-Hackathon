import { afterEach, describe, expect, it } from "vitest";
import { convertOfficeToPdf, setOfficeConverterForTesting } from "../../src/lib/office-to-pdf";
import { isPdf } from "../../src/lib/pdf";
import { makeDocx, makePptx } from "../support/files";

describe("convertOfficeToPdf (lib/office-to-pdf.ts)", () => {
  afterEach(() => {
    setOfficeConverterForTesting(null);
  });

  it("converts DOCX to a valid PDF buffer", async () => {
    const docxBuf = await makeDocx(["Chapter 1: The Beginning", { heading: "Introduction" }, "Content with text"]);
    const pdfBuf = await convertOfficeToPdf(docxBuf, "docx");

    expect(Buffer.isBuffer(pdfBuf)).toBe(true);
    expect(pdfBuf.length).toBeGreaterThan(0);
    expect(isPdf(pdfBuf)).toBe(true);
  }, 20_000);

  it("converts PPTX to a valid PDF buffer", async () => {
    const pptxBuf = await makePptx([["Slide 1 Title", "Subtitle"], ["Slide 2 Content"]]);
    const pdfBuf = await convertOfficeToPdf(pptxBuf, "pptx");

    expect(Buffer.isBuffer(pdfBuf)).toBe(true);
    expect(pdfBuf.length).toBeGreaterThan(0);
    expect(isPdf(pdfBuf)).toBe(true);
  }, 20_000);

  it("converts PPT to a valid PDF buffer", async () => {
    const fakePptBuf = Buffer.from("fake-ppt-content");
    const pdfBuf = await convertOfficeToPdf(fakePptBuf, "ppt");

    expect(Buffer.isBuffer(pdfBuf)).toBe(true);
    expect(pdfBuf.length).toBeGreaterThan(0);
    expect(isPdf(pdfBuf)).toBe(true);
  }, 20_000);

  it("allows setting a custom test converter", async () => {
    const mockPdf = Buffer.from("%PDF-1.4 mock pdf data");
    setOfficeConverterForTesting(async () => mockPdf);

    const result = await convertOfficeToPdf(Buffer.from("test"), "docx");
    expect(result).toBe(mockPdf);
  });

  it("propagates error when conversion fails", async () => {
    setOfficeConverterForTesting(async () => {
      throw new Error("LibreOffice crashed");
    });

    await expect(convertOfficeToPdf(Buffer.from("bad"), "docx")).rejects.toThrow("LibreOffice crashed");
  });
});
