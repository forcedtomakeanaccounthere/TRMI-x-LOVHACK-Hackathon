import { JSDOM } from "jsdom";

// Splits a room's text into chunks for search, Q&A and summaries (supabase/migrations/0011_chunks.sql).
//
// A chunk is about 400 tokens: blocks are joined until it reaches TARGET_CHUNK_CHARS, never past
// MAX_CHUNK_CHARS, and it always ends where a block ends, so every chunk can say exactly which
// blocks (b{n} paragraphs, p{n} pages or slides) it came from. The one exception is a single block
// longer than MAX_CHUNK_CHARS (a dense PDF page, a huge paragraph): it is split at sentence ends
// into several chunks that all point at that block.

export const TARGET_CHUNK_CHARS = 1500;
export const MAX_CHUNK_CHARS = 2000;
// A new section (h1-h3) starts a new chunk once the current one has this much text.
const MIN_CHUNK_CHARS = 400;
// About 800,000 characters. Longer rooms are indexed up to here.
export const MAX_CHUNKS = 400;

export type Chunk = {
  idx: number;
  content: string;
  block_ids: string[];
  page: number | null; // PDF page or slide of the first block
  heading_path: string[]; // the h1-h3 headings the chunk sits under
};

type Block = {
  ids: string[]; // the block and any blocks nested in it
  text: string;
  page: number | null;
  headingPath: string[];
  isHeading: boolean;
};

export type RoomText = { kind: string; content_html: string | null; content_text: string | null };

/** The chunks of a room: PDF rooms from their extracted text, everything else from its HTML. */
export function chunkRoom(room: RoomText): Chunk[] {
  const blocks = room.kind === "pdf" ? pdfBlocks(room.content_text ?? "") : htmlBlocks(room.content_html ?? "");
  return chunkBlocks(blocks);
}

// Elements that separate words: their text must not run into the text next to them.
const SEPARATE = "address, article, aside, blockquote, dd, div, dl, dt, figcaption, figure, footer, h1, h2, h3, h4, h5, h6, header, li, ol, p, pre, section, td, th, tr, ul";

/** The top-level blocks of a room's HTML, with the headings above each. */
export function htmlBlocks(html: string): Block[] {
  const { document } = new JSDOM(`<body>${html}</body>`).window;
  for (const br of document.body.querySelectorAll("br")) br.replaceWith(" ");
  for (const el of document.body.querySelectorAll(SEPARATE)) {
    el.prepend(" ");
    el.append(" ");
  }

  const headings: (string | null)[] = [null, null, null]; // h1, h2, h3
  const blocks: Block[] = [];
  for (const el of document.body.querySelectorAll("[data-block]")) {
    // A block inside another block is read as part of the outer one.
    if (el.parentElement?.closest("[data-block]")) continue;

    const text = clean(el.textContent ?? "");
    const level = /^H([1-3])$/.exec(el.tagName)?.[1];
    if (level) {
      const n = Number(level);
      headings[n - 1] = text || null;
      for (let i = n; i < headings.length; i++) headings[i] = null;
    }
    if (!text) continue;

    const ids = [el, ...el.querySelectorAll("[data-block]")].map((b) => b.getAttribute("data-block")!);
    blocks.push({
      ids,
      text,
      page: pageOf(ids[0]!),
      headingPath: headings.filter((h): h is string => Boolean(h)),
      isHeading: Boolean(level),
    });
  }
  return blocks;
}

/** One p{n} block per page of a PDF room's text, which lib/pdf.ts writes as "[Page n] text" sections. */
export function pdfBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const [, page, body] of text.matchAll(/\[Page (\d+)\] ([\s\S]*?)(?=\n\n\[Page \d+\] |$)/g)) {
    const pageText = clean(body ?? "");
    if (pageText) {
      blocks.push({ ids: [`p${page}`], text: pageText, page: Number(page), headingPath: [], isHeading: false });
    }
  }
  return blocks;
}

export function chunkBlocks(blocks: Block[]): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Block[] = [];
  let length = 0;

  const push = (parts: Block[], content: string) => {
    if (chunks.length >= MAX_CHUNKS) return;
    chunks.push({
      idx: chunks.length,
      content,
      block_ids: [...new Set(parts.flatMap((b) => b.ids))],
      page: parts.find((b) => b.page !== null)?.page ?? null,
      heading_path: parts[0]!.headingPath,
    });
  };
  const flush = () => {
    if (current.length) push(current, current.map((b) => b.text).join("\n\n"));
    current = [];
    length = 0;
  };

  for (const block of blocks) {
    if (block.text.length > MAX_CHUNK_CHARS) {
      flush();
      for (const piece of splitText(block.text, MAX_CHUNK_CHARS)) push([block], piece);
      continue;
    }
    const joined = length ? length + 2 + block.text.length : block.text.length;
    const newSection = block.isHeading && length >= MIN_CHUNK_CHARS;
    if (current.length && (joined > MAX_CHUNK_CHARS || length >= TARGET_CHUNK_CHARS || newSection)) flush();
    length = length ? length + 2 + block.text.length : block.text.length;
    current.push(block);
  }
  flush();
  return chunks;
}

/**
 * Splits text longer than `max` into pieces of at most `max` characters, at a sentence end when
 * there is one in the second half of the piece, else at a space, else anywhere.
 */
export function splitText(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(...[". ", "? ", "! ", "। ", "\n"].map((end) => window.lastIndexOf(end)));
    if (cut < max / 2) cut = window.lastIndexOf(" ");
    if (cut < max / 2) {
      cut = max - 1;
      // Don't cut an emoji or other character in half.
      if (/[\uD800-\uDBFF]/.test(rest[cut]!)) cut--;
    }
    pieces.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.filter(Boolean);
}

/** The text sent to the embedding model: the chunk with its headings, which say what it is about. */
export function embeddingText(chunk: Chunk) {
  return chunk.heading_path.length ? `${chunk.heading_path.join(" > ")}\n\n${chunk.content}` : chunk.content;
}

// p{n} is a PDF page or a slide; b{n} and t{n} have no page.
function pageOf(blockId: string) {
  const match = /^p(\d+)$/.exec(blockId);
  return match ? Number(match[1]) : null;
}

function clean(text: string) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}
