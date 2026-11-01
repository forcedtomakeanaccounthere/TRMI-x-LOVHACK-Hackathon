import JSZip from "jszip";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import {
  decodeUtf8,
  docxToHtml,
  inspectZip,
  LEGACY_OFFICE,
  MAX_FILE_HTML_CHARS,
  MAX_UNZIPPED_BYTES,
  MAX_ZIP_ENTRIES,
  parseFile,
  pptxToHtml,
  slideOrder,
  slideParagraphs,
  UNSUPPORTED,
} from "../../src/lib/files";
import { forgeSizes, makeClaimedSizeZip, makeDocx, makePptx, makeZip } from "../support/files";
import { makePdf } from "../support/pdf";

const html = async (buf: Buffer, name: string): Promise<{ format: string; html: string }> => {
  const parsed = await parseFile(buf, name);
  if (parsed.format === "docx") return { format: "docx", html: await docxToHtml(buf) };
  if (parsed.format === "pptx") return { format: "pptx", html: await pptxToHtml(buf) };
  if (!("html" in parsed)) throw new Error("expected HTML");
  return parsed;
};

describe("parseFile: format from the bytes", () => {
  it("detects a PDF by its %PDF- header, whatever the name", async () => {
    expect(await parseFile(makePdf(["hello"]), "paper.pdf")).toEqual({ format: "pdf" });
    expect(await parseFile(makePdf(["hello"]), "renamed.txt")).toEqual({ format: "pdf" });
  });

  it("tells DOCX from PPTX by what is inside the ZIP, not the name", async () => {
    expect((await html(await makeDocx(["Hello"]), "slides.pptx")).format).toBe("docx");
    expect((await html(await makePptx([["Hello"]]), "notes.docx")).format).toBe("pptx");
  });

  it("refuses a ZIP that is neither", async () => {
    await expect(parseFile(await makeZip({ "a.txt": "hi" }), "archive.zip")).rejects.toMatchObject({
      status: 400,
      message: UNSUPPORTED,
    });
  });

  it.each(["report.doc", "template.dot"])("asks for the new format for %s", async (name) => {
    await expect(parseFile(Buffer.from("anything"), name)).rejects.toMatchObject({ status: 400, message: LEGACY_OFFICE });
  });

  it.each(["deck.ppt", "DECK.PPT"])("validates bytes for %s and rejects invalid bytes", async (name) => {
    await expect(parseFile(Buffer.from("anything"), name)).rejects.toMatchObject({
      status: 400,
      message: "That file isn't a valid .ppt file.",
    });
  });

  it("recognises an old Office file by its bytes, even when renamed", async () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(parseFile(ole, "report.docx")).rejects.toMatchObject({ status: 400, message: LEGACY_OFFICE });
  });

  it("refuses a file named like a format we read whose bytes don't match", async () => {
    await expect(parseFile(Buffer.from("just text"), "notes.docx")).rejects.toMatchObject({
      status: 400,
      message: "That file isn't a valid .docx file.",
    });
    await expect(parseFile(Buffer.from("just text"), "paper.pdf")).rejects.toMatchObject({ status: 400 });
  });

  it.each(["image.png", "sheet.xlsx", "noextension", "script.js"])("refuses %s", async (name) => {
    await expect(parseFile(Buffer.from("text"), name)).rejects.toMatchObject({ status: 400, message: UNSUPPORTED });
  });
});

describe("parseFile: DOCX", () => {
  it("becomes numbered blocks, with headings kept", async () => {
    const { html: out } = await html(await makeDocx([{ heading: "Title" }, "First para", "Second <b>para</b>"]), "a.docx");
    expect(out).toBe(
      '<h1 data-block="b0">Title</h1><p data-block="b1">First para</p><p data-block="b2">Second &lt;b&gt;para&lt;/b&gt;</p>',
    );
  });

  it("drops images instead of inlining them as base64", async () => {
    const buf = await makeDocx(["Before", { image: true }, "After"]);
    // The fixture really has an image: mammoth's default would inline it.
    expect((await mammoth.convertToHtml({ buffer: buf })).value).toContain("data:image/png;base64");

    const { html: out } = await html(buf, "a.docx");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("base64");
    expect(out).toContain("Before");
    expect(out).toContain("After");
  });

  it("keeps web links, opening in a new tab, and drops other links", async () => {
    const buf = await makeDocx([
      { link: "https://example.com/page", text: "web" },
      { link: "javascript:alert(1)", text: "script" },
      { link: "other.docx", text: "relative" },
    ]);
    const { html: out } = await html(buf, "a.docx");
    expect(out).toContain('href="https://example.com/page" target="_blank" rel="noopener noreferrer nofollow"');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("other.docx");
  });

  it("answers 422 for a DOCX whose document can't be parsed", async () => {
    const broken = await makeZip({ "word/document.xml": "<w:document><not xml" });
    await expect(parseFile(broken, "a.docx")).rejects.toMatchObject({ status: 422 });
  });

  it("answers 422 for a DOCX with no text", async () => {
    await expect(parseFile(await makeDocx([]), "a.docx")).rejects.toMatchObject({
      status: 422,
      message: "This file has no text to read.",
    });
  });
});

describe("parseFile: PPTX", () => {
  it("gives each slide a p{n} block, in the order the deck shows them", async () => {
    // Slides were moved around: the deck shows slide3.xml first and slide1.xml last.
    const buf = await makePptx([["Made first"], ["Made second"], ["Made third"]], { order: [3, 2, 1] });
    const { html: out } = await html(buf, "deck.pptx");
    expect(out).toBe(
      '<section data-block="p1"><h2>Slide 1</h2><p>Made third</p></section>' +
        '<section data-block="p2"><h2>Slide 2</h2><p>Made second</p></section>' +
        '<section data-block="p3"><h2>Slide 3</h2><p>Made first</p></section>',
    );
  });

  it("leaves out slide files the deck doesn't list", async () => {
    const buf = await makePptx([["Shown"], ["Not in the deck"]], { order: [1] });
    const { html: out } = await html(buf, "deck.pptx");
    expect(out).toBe('<section data-block="p1"><h2>Slide 1</h2><p>Shown</p></section>');
  });

  it("falls back to the file numbers when the deck has no slide list", async () => {
    // slide10.xml sorts before slide2.xml as text; it must still come last.
    const buf = await makePptx([["One"], ["Two"], ["Ten"]], { numbers: [1, 2, 10], list: false });
    const { html: out } = await html(buf, "deck.pptx");
    expect(out).toBe(
      '<section data-block="p1"><h2>Slide 1</h2><p>One</p></section>' +
        '<section data-block="p2"><h2>Slide 2</h2><p>Two</p></section>' +
        '<section data-block="p3"><h2>Slide 3</h2><p>Ten</p></section>',
    );
  });

  // Valid XML can quote attributes with ' and put spaces around "=". None of these slides may be lost.
  it("reads relationships written with single quotes and spaces", async () => {
    const zip = await JSZip.loadAsync(await makePptx([["A"], ["B"], ["C"]], { order: [3, 1, 2] }));
    const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      rels
        .replace('Target="slides/slide1.xml"', "Target = 'slides/slide1.xml'")
        .replace(/Id="(rId\d+)"/, "Id='$1'")
        .replace('Target="slides/slide3.xml"', 'Target\n= "slides/slide3.xml"'),
    );
    const presentation = await zip.file("ppt/presentation.xml")!.async("string");
    zip.file("ppt/presentation.xml", presentation.replace(/r:id="(rId\d+)"/, "r:id = '$1'"));

    expect(await slideOrder(zip)).toEqual(["ppt/slides/slide3.xml", "ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]);
    const { html: out } = await html(await zip.generateAsync({ type: "nodebuffer" }), "deck.pptx");
    expect(out).toContain("<p>C</p></section><section");
    expect(out.match(/<section/g)).toHaveLength(3);
  });

  it("refuses a deck that lists a slide it doesn't contain, instead of dropping it", async () => {
    const missingRel = await JSZip.loadAsync(await makePptx([["A"], ["B"]]));
    const rels = await missingRel.file("ppt/_rels/presentation.xml.rels")!.async("string");
    missingRel.file("ppt/_rels/presentation.xml.rels", rels.replace(/<Relationship Target="slides\/slide2\.xml"[^>]*\/>/, ""));
    await expect(parseFile(await missingRel.generateAsync({ type: "nodebuffer" }), "deck.pptx")).rejects.toMatchObject({
      status: 422,
    });

    const missingFile = await JSZip.loadAsync(await makePptx([["A"], ["B"]]));
    missingFile.remove("ppt/slides/slide2.xml");
    await expect(parseFile(await missingFile.generateAsync({ type: "nodebuffer" }), "deck.pptx")).rejects.toMatchObject({
      status: 422,
    });
  });

  it("refuses a deck with a slide whose XML is broken", async () => {
    const zip = await JSZip.loadAsync(await makePptx([["A"], ["B"]]));
    zip.file("ppt/slides/slide2.xml", "<p:sld><a:p>broken");
    await expect(parseFile(await zip.generateAsync({ type: "nodebuffer" }), "deck.pptx")).rejects.toMatchObject({
      status: 422,
    });
  });

  it("resolves absolute and ../ relationship targets", async () => {
    const zip = await JSZip.loadAsync(await makePptx([["A"], ["B"]], { order: [2, 1] }));
    const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      rels.replace("slides/slide2.xml", "/ppt/slides/slide2.xml").replace("slides/slide1.xml", "../ppt/slides/slide1.xml"),
    );
    expect(await slideOrder(zip)).toEqual(["ppt/slides/slide2.xml", "ppt/slides/slide1.xml"]);
  });

  it("skips slides without text but keeps the others' numbers", async () => {
    const { html: out } = await html(await makePptx([["One"], [], ["Three"]]), "deck.pptx");
    expect(out).toContain('data-block="p1"');
    expect(out).not.toContain('data-block="p2"');
    expect(out).toContain('<section data-block="p3"><h2>Slide 3</h2><p>Three</p></section>');
  });

  it("shows slide text as text, never as markup", async () => {
    const { html: out } = await html(await makePptx([['<script>alert("x")</script> & <b>bold</b>']]), "deck.pptx");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&amp; &lt;b&gt;bold&lt;/b&gt;");
  });

  it("answers 422 for a deck with no text", async () => {
    await expect(parseFile(await makePptx([[], []]), "deck.pptx")).rejects.toMatchObject({ status: 422 });
  });
});

describe("slideParagraphs", () => {
  const slide = (body: string, prefix = "a") =>
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:${prefix}="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>` +
    `${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

  it("joins runs, turns line breaks into spaces and decodes entities", () => {
    const xml = slide(
      '<a:p><a:pPr lvl="1"/><a:r><a:t>Fish &amp; chips</a:t></a:r><a:br/><a:r><a:t>&#x2014;&#8212;&lt;ok&gt;</a:t></a:r></a:p>' +
        "<a:p/><a:p><a:r><a:t>   </a:t></a:r></a:p><a:p><a:fld id='x'><a:t>Second</a:t></a:fld></a:p>",
    );
    expect(slideParagraphs(xml)).toEqual(["Fish & chips ——<ok>", "Second"]);
  });

  it("reads the DrawingML namespace whatever its prefix", () => {
    expect(slideParagraphs(slide("<d:p><d:r><d:t>Other prefix</d:t></d:r></d:p>", "d"))).toEqual(["Other prefix"]);
  });

  it("throws on XML that doesn't parse", () => {
    expect(() => slideParagraphs("<a:p><a:t>no namespace</a:t></a:p>")).toThrow();
    expect(() => slideParagraphs(slide("<a:p><a:t>&#0;</a:t></a:p>"))).toThrow();
  });
});

describe("parseFile: Markdown and text", () => {
  it("renders Markdown into numbered blocks", async () => {
    const md = "# Title\n\nSome *text* and a [link](https://example.com).\n\n- one\n- two\n";
    const { format, html: out } = await html(Buffer.from(md), "README.md");
    expect(format).toBe("md");
    expect(out).toContain('<h1 data-block="b0">Title</h1>');
    expect(out).toContain('<p data-block="b1">Some <em>text</em> and a <a href="https://example.com/" target="_blank"');
    expect(out).toContain('<li data-block="b2">one</li>');
  });

  it("sanitizes raw HTML in Markdown", async () => {
    const md = 'Hi <script>alert(1)</script><img src="x" onerror="alert(1)"><iframe src="https://evil"></iframe>';
    const { html: out } = await html(Buffer.from(md), "notes.markdown");
    expect(out).not.toMatch(/<script|onerror|<iframe/);
  });

  it("turns plain text into paragraphs, as text", async () => {
    const { format, html: out } = await html(Buffer.from("First line\n\n<b>Second</b>\n"), "notes.txt");
    expect(format).toBe("txt");
    expect(out).toBe('<p data-block="b0">First line</p><p data-block="b1">&lt;b&gt;Second&lt;/b&gt;</p>');
  });

  it("strips a UTF-8 byte order mark", async () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("héllo")]);
    expect((await html(buf, "a.txt")).html).toBe('<p data-block="b0">héllo</p>');
  });

  it("answers 400 for text that isn't UTF-8", async () => {
    const latin1 = Buffer.from("caf\xe9", "latin1");
    await expect(parseFile(latin1, "a.txt")).rejects.toMatchObject({ status: 400 });
    await expect(parseFile(latin1, "a.md")).rejects.toMatchObject({ status: 400 });
  });

  it("answers 422 for an empty or blank file", async () => {
    await expect(parseFile(Buffer.from(" \n\n\t"), "a.txt")).rejects.toMatchObject({ status: 422 });
    await expect(parseFile(Buffer.from(""), "a.md")).rejects.toMatchObject({ status: 422 });
  });

  it("answers 422 for too much text, before parsing it", async () => {
    const big = Buffer.from("x".repeat(MAX_FILE_HTML_CHARS + 1));
    await expect(parseFile(big, "a.txt")).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/too much text/) });
    await expect(parseFile(big, "a.md")).rejects.toMatchObject({ status: 422 });
  });

  it("answers 422 when the HTML would be too large, even if the text fits", async () => {
    // Every "<" becomes "&lt;": 4 characters of HTML for each one of text.
    const big = Buffer.from("<".repeat(Math.ceil(MAX_FILE_HTML_CHARS / 4) + 10));
    await expect(parseFile(big, "a.txt")).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/too much text/) });
    // Builds and sanitizes several MB of HTML: about 1 s alone, past the 5 s default when the
    // whole suite runs in parallel.
  }, 30_000);
});

describe("decodeUtf8", () => {
  it("keeps multi-byte characters", () => {
    expect(decodeUtf8(Buffer.from("नमस्ते 👋"))).toBe("नमस्ते 👋");
  });

  it("refuses invalid sequences and NUL bytes", () => {
    expect(() => decodeUtf8(Buffer.from([0x61, 0xc3, 0x28]))).toThrow(/UTF-8/);
    expect(() => decodeUtf8(Buffer.from("a\u0000b"))).toThrow(/text file/);
  });
});

describe("inspectZip (zip bomb guard)", () => {
  it("lists the files of a normal ZIP", async () => {
    const names = await inspectZip(await makeZip({ "a.txt": "a", "dir/b.txt": "b" }));
    expect([...names].sort()).toEqual(["a.txt", "dir/", "dir/b.txt"]);
  });

  it("refuses a ZIP that claims to unpack to more than 50 MB, before unpacking anything", async () => {
    const half = Math.floor(MAX_UNZIPPED_BYTES / 2) + 1;
    const bomb = await makeClaimedSizeZip({ "word/document.xml": "x", "b.xml": "y" }, half);
    await expect(inspectZip(bomb)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("50 MB") });
    await expect(parseFile(bomb, "a.docx")).rejects.toMatchObject({ status: 400 });
  });

  it("unpacks every entry and refuses one that is bigger than the ZIP says", async () => {
    // A real document whose directory claims each part unpacks to 1 byte: the claimed total passes,
    // so only counting the bytes as they unpack catches it, before mammoth reads the file.
    const docx = await makeDocx(["Hello ".repeat(2000)]);
    const forged = forgeSizes(docx, 1);
    await expect(inspectZip(forged)).rejects.toMatchObject({ status: 400 });
    await expect(parseFile(forged, "a.docx")).rejects.toMatchObject({ status: 400 });
    // The same file with honest sizes is fine.
    expect((await inspectZip(docx)).has("word/document.xml")).toBe(true);
  });

  it("refuses a ZIP with too many files", async () => {
    const files = Object.fromEntries(Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => [`f${i}.txt`, ""]));
    await expect(inspectZip(await makeZip(files))).rejects.toMatchObject({ status: 400 });
  });

  it("accepts exactly the most files allowed", async () => {
    const files = Object.fromEntries(Array.from({ length: MAX_ZIP_ENTRIES }, (_, i) => [`f${i}.txt`, ""]));
    expect((await inspectZip(await makeZip(files))).size).toBe(MAX_ZIP_ENTRIES);
  });

  it("answers 400 for a damaged ZIP", async () => {
    const zip = await makeDocx(["Hello"]);
    await expect(parseFile(zip.subarray(0, zip.length - 30), "a.docx")).rejects.toMatchObject({ status: 400 });
  });
});
