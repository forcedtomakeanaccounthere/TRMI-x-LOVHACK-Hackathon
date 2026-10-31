import type { Rect } from "./types";

// Converts between screen positions and block anchors (CHECKLIST Phase 3, lib/anchors.ts). A block is
// a paragraph (b12), a PDF page or slide (p3) or a transcript segment (t7); positions inside it are
// fractions of its box, and text positions are character offsets into its text.

const SKIP = "[data-room-ui]"; // overlays drawn inside a block don't count as its text

export function blockOf(node: Node | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement;
  return el?.closest<HTMLElement>("[data-block]") ?? null;
}

function textNodes(block: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

function offsetOf(block: HTMLElement, node: Node, offset: number): number {
  let total = 0;
  for (const t of textNodes(block)) {
    if (t === node) return total + offset;
    total += t.data.length;
  }
  // The boundary is an element: count the text before its offset-th child.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const range = document.createRange();
    range.setStart(block, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  }
  return total;
}

export type TextSelection = {
  block: string;
  start: number;
  end: number;
  quote: string;
  rect: DOMRect;
};

// The current selection as a block range, or null when it's empty or crosses blocks.
export function readSelection(root: HTMLElement): TextSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const startBlock = blockOf(range.startContainer);
  const endBlock = blockOf(range.endContainer);
  if (!startBlock || startBlock !== endBlock) return null;
  const quote = range.toString().replace(/\s+/g, " ").trim();
  if (!quote) return null;
  const start = offsetOf(startBlock, range.startContainer, range.startOffset);
  const end = offsetOf(startBlock, range.endContainer, range.endOffset);
  return {
    block: startBlock.dataset.block!,
    start,
    end,
    quote: quote.slice(0, 1000),
    rect: range.getBoundingClientRect(),
  };
}

export function rangeAt(block: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  let pos = 0;
  let started = false;
  for (const t of textNodes(block)) {
    const next = pos + t.data.length;
    if (!started && start <= next) {
      range.setStart(t, Math.max(0, start - pos));
      started = true;
    }
    if (started && end <= next) {
      range.setEnd(t, Math.max(0, end - pos));
      return range;
    }
    pos = next;
  }
  return null;
}

// Line boxes of a text range, as fractions of the block (one rect per line).
export function textRects(block: HTMLElement, start: number, end: number): Rect[] {
  const range = rangeAt(block, start, end);
  if (!range) return [];
  const box = block.getBoundingClientRect();
  if (!box.width || !box.height) return [];
  const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
  // Merge rects on the same line (text layers split words into many spans).
  const lines: DOMRect[] = [];
  for (const r of rects) {
    const line = lines.find((l) => Math.abs(l.top - r.top) < r.height * 0.5 && r.left <= l.right + 4);
    if (line) {
      const left = Math.min(line.left, r.left);
      const right = Math.max(line.right, r.right);
      lines[lines.indexOf(line)] = new DOMRect(
        left,
        Math.min(line.top, r.top),
        right - left,
        Math.max(line.height, r.height),
      );
    } else lines.push(r);
  }
  return lines.map((r) => ({
    x: (r.left - box.left) / box.width,
    y: (r.top - box.top) / box.height,
    w: r.width / box.width,
    h: r.height / box.height,
  }));
}

// A pointer position as the block under it plus a fraction of that block.
export function toAnchor(container: HTMLElement, clientX: number, clientY: number) {
  const el = document.elementFromPoint(clientX, clientY);
  const block = el && container.contains(el) ? blockOf(el) : null;
  if (!block) return null;
  const box = block.getBoundingClientRect();
  return {
    block: block.dataset.block!,
    x: (clientX - box.left) / box.width,
    y: (clientY - box.top) / box.height,
    el: block,
  };
}

export function findBlock(container: HTMLElement | null, block: string) {
  return container?.querySelector<HTMLElement>(`[data-block="${CSS.escape(block)}"]`) ?? null;
}

// The block nearest the top of a scroll container, with how far through it the top edge is.
export function topBlock(scroller: HTMLElement) {
  const top = scroller.getBoundingClientRect().top + 80;
  const blocks = scroller.querySelectorAll<HTMLElement>("[data-block]");
  for (const b of blocks) {
    const r = b.getBoundingClientRect();
    if (r.bottom > top)
      return {
        block: b.dataset.block!,
        ratio: Math.min(1, Math.max(0, (top - r.top) / (r.height || 1))),
      };
  }
  return null;
}
