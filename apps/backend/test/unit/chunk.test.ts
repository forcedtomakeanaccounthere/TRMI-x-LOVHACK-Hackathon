import { describe, expect, it } from "vitest";
import {
  chunkRoom,
  embeddingText,
  htmlBlocks,
  MAX_CHUNK_CHARS,
  MAX_CHUNKS,
  pdfBlocks,
  splitText,
  TARGET_CHUNK_CHARS,
} from "../../src/lib/chunk";
import { addBlockIds } from "../../src/lib/extract";

const words = (n: number, word = "word") => Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ");
const html = (body: string) => ({ kind: "link", content_html: addBlockIds(body), content_text: null });

describe("chunkRoom for HTML rooms", () => {
  it("keeps a short room in one chunk, with every block it covers", () => {
    const chunks = chunkRoom(html("<p>First paragraph.</p><p>Second paragraph.</p>"));
    expect(chunks).toEqual([
      {
        idx: 0,
        content: "First paragraph.\n\nSecond paragraph.",
        block_ids: ["b0", "b1"],
        page: null,
        heading_path: [],
      },
    ]);
  });

  it("ends every chunk on a block boundary, between the target and the maximum size", () => {
    // 40 paragraphs of ~300 characters.
    const body = Array.from({ length: 40 }, (_, i) => `<p>${words(40, `p${i}w`)}</p>`).join("");
    const chunks = chunkRoom(html(body));

    expect(chunks.length).toBeGreaterThan(4);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      // Each chunk is whole paragraphs: no paragraph is cut.
      for (const para of chunk.content.split("\n\n")) expect(para).toMatch(/^p\d+w0 .* p\d+w39$/);
    }
    for (const chunk of chunks.slice(0, -1)) expect(chunk.content.length).toBeGreaterThanOrEqual(TARGET_CHUNK_CHARS - 400);
    // Every block is in exactly one chunk, in order.
    expect(chunks.flatMap((c) => c.block_ids)).toEqual(Array.from({ length: 40 }, (_, i) => `b${i}`));
    expect(chunks.map((c) => c.idx)).toEqual(chunks.map((_, i) => i));
  });

  it("records the h1-h3 headings each chunk sits under", () => {
    const body =
      "<h1>Guide</h1><p>Intro.</p>" +
      `<h2>Setup</h2><p>${words(80)}</p>` +
      `<h3>Linux</h3><p>${words(80)}</p>` +
      `<h2>Usage</h2><p>${words(80)}</p>`;
    const chunks = chunkRoom(html(body));
    expect(chunks.map((c) => c.heading_path)).toEqual([
      ["Guide"],
      ["Guide", "Setup", "Linux"],
      ["Guide", "Usage"],
    ]);
    // A new section starts a new chunk once the current one has some text.
    expect(chunks[2]!.content.startsWith("Usage")).toBe(true);
  });

  it("reads a nested block once, as part of its outer block", () => {
    const chunks = chunkRoom(html("<blockquote><p>Quoted</p><p>text</p></blockquote><p>After</p>"));
    expect(chunks[0]!.content).toBe("Quoted text\n\nAfter");
    expect(chunks[0]!.block_ids).toEqual(["b0", "b1", "b2", "b3"]);
  });

  it("keeps words in separate elements apart and squeezes whitespace, as a browser shows them", () => {
    const blocks = htmlBlocks(
      '<p data-block="b0">one<br>two\n\n  three<em>four</em></p><figure data-block="b1"><div>a</div><div>b</div></figure>',
    );
    // <br> and block elements separate words; an inline element (<em>) doesn't.
    expect(blocks.map((b) => b.text)).toEqual(["one two threefour", "a b"]);
  });

  it("reads PPTX slides as p{n} blocks with their slide number as the page", () => {
    const pptx =
      '<section data-block="p1"><h2>Slide 1</h2><p>Intro</p></section>' +
      '<section data-block="p3"><h2>Slide 3</h2><p>Details</p></section>';
    const chunks = chunkRoom({ kind: "file", content_html: pptx, content_text: null });
    expect(chunks).toEqual([
      { idx: 0, content: "Slide 1 Intro\n\nSlide 3 Details", block_ids: ["p1", "p3"], page: 1, heading_path: [] },
    ]);
  });

  it("makes a table one block, so its text is found and cited", () => {
    const chunks = chunkRoom(html("<p>Prices:</p><table><tr><th>Plan</th><th>Cost</th></tr><tr><td>Pro</td><td>$9</td></tr></table>"));
    expect(chunks).toEqual([expect.objectContaining({ content: "Prices:\n\nPlan Cost Pro $9", block_ids: ["b0", "b1"] })]);
  });

  it("finds a table in an uploaded Markdown file", async () => {
    const { parseFile } = await import("../../src/lib/files");
    const parsed = await parseFile(Buffer.from("| Plan | Cost |\n| --- | --- |\n| Pro | $9 |\n"), "prices.md");
    if (parsed.format === "pdf") throw new Error("expected HTML");
    const chunks = chunkRoom({ kind: "file", content_html: parsed.html, content_text: null });
    expect(chunks).toEqual([expect.objectContaining({ content: "Plan Cost Pro $9", block_ids: ["b0"] })]);
  });

  it("keeps text outside every block, with the block before it (rooms made before tables were blocks)", () => {
    const old =
      'Lead text<p data-block="b0">First</p><table><tr><td>Cell</td></tr></table>' +
      '<div>Loose <span>words</span></div><p data-block="b1">Second</p>';
    const chunks = chunkRoom({ kind: "link", content_html: old, content_text: null });
    expect(chunks).toEqual([
      expect.objectContaining({ content: "Lead text First Cell Loose words\n\nSecond", block_ids: ["b0", "b1"] }),
    ]);
  });

  it("skips empty blocks and returns nothing for an empty room", () => {
    expect(chunkRoom(html("<p> </p><p></p>"))).toEqual([]);
    expect(chunkRoom({ kind: "link", content_html: null, content_text: null })).toEqual([]);
  });

  it(`stops at ${MAX_CHUNKS} chunks`, () => {
    const body = Array.from({ length: MAX_CHUNKS + 50 }, () => `<p>${"x".repeat(MAX_CHUNK_CHARS)}</p>`).join("");
    const chunks = chunkRoom(html(body));
    expect(chunks).toHaveLength(MAX_CHUNKS);
    expect(chunks.at(-1)!.idx).toBe(MAX_CHUNKS - 1);
  });
});

describe("chunkRoom for PDF rooms", () => {
  const pdfText = (pages: string[]) => pages.map((text, i) => `[Page ${i + 1}] ${text}`).join("\n\n");

  it("makes p{n} blocks from the extracted pages and records the first page", () => {
    const chunks = chunkRoom({ kind: "pdf", content_html: null, content_text: pdfText(["One.", "Two.", "Three."]) });
    expect(chunks).toEqual([
      { idx: 0, content: "One.\n\nTwo.\n\nThree.", block_ids: ["p1", "p2", "p3"], page: 1, heading_path: [] },
    ]);
  });

  it("splits a page longer than a chunk at sentence ends, every piece pointing at that page", () => {
    const sentence = "This sentence is about forty characters. ";
    const chunks = chunkRoom({
      kind: "pdf",
      content_html: null,
      content_text: pdfText(["Short page.", sentence.repeat(120), "Last page."]),
    });
    const long = chunks.filter((c) => c.block_ids.join() === "p2");
    expect(long.length).toBeGreaterThan(1);
    for (const chunk of long) {
      expect(chunk.page).toBe(2);
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(chunk.content.endsWith(".")).toBe(true);
    }
    expect(chunks[0]!.content).toBe("Short page.");
    expect(chunks.at(-1)!.content).toBe("Last page.");
  });

  it("handles text without page markers and pages with no text", () => {
    expect(pdfBlocks("no markers")).toEqual([]);
    expect(pdfBlocks("[Page 1] \n\n[Page 2] Text").map((b) => b.ids)).toEqual([["p2"]]);
  });
});

describe("splitText", () => {
  it("cuts at a space when there is no sentence end", () => {
    const pieces = splitText(words(400), 100);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(100);
      expect(piece).toMatch(/^word\d+( word\d+)*$/);
    }
    expect(pieces.join(" ")).toBe(words(400));
  });

  it("cuts anywhere in text without spaces, keeping emoji whole", () => {
    const pieces = splitText("😀".repeat(100), 51);
    expect(pieces.join("")).toBe("😀".repeat(100));
    for (const piece of pieces) expect(piece).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  });
});

describe("embeddingText", () => {
  it("puts the headings before the text", () => {
    const chunk = { idx: 0, content: "Body", block_ids: ["b1"], page: null, heading_path: ["Guide", "Setup"] };
    expect(embeddingText(chunk)).toBe("Guide > Setup\n\nBody");
    expect(embeddingText({ ...chunk, heading_path: [] })).toBe("Body");
  });
});
