import type { Box } from "./overlay";

// The AI lens: a snapshot of any part of the document, so figures, scans and text that can't be
// selected can still go to the AI. PDF pages are cropped straight from their canvas; HTML documents
// are drawn with html-to-image (loaded only when the lens is used).

const MAX_SIDE = 1000;

function finish(source: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number) {
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.82);
}

export async function captureRegion(article: HTMLElement, rect: Box): Promise<string> {
  const a = article.getBoundingClientRect();
  const cx = a.left + rect.left + rect.width / 2;
  const cy = a.top + rect.top + rect.height / 2;

  // A PDF page: crop its canvas.
  for (const page of article.querySelectorAll<HTMLElement>("[data-page]")) {
    const p = page.getBoundingClientRect();
    if (cx < p.left || cx > p.right || cy < p.top || cy > p.bottom) continue;
    const canvas = page.querySelector("canvas");
    if (!canvas) break;
    const k = canvas.width / p.width;
    const left = Math.max(0, a.left + rect.left - p.left);
    const top = Math.max(0, a.top + rect.top - p.top);
    return finish(
      canvas,
      left * k,
      top * k,
      Math.min(rect.width, p.width - left) * k,
      Math.min(rect.height, p.height - top) * k,
    );
  }

  const { toCanvas } = await import("html-to-image");
  const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
  const canvas = await toCanvas(article, {
    pixelRatio: 1.5,
    backgroundColor: bg,
    filter: (node) => !(node instanceof HTMLElement && node.dataset.roomUi !== undefined),
  });
  const k = canvas.width / article.offsetWidth;
  return finish(canvas, rect.left * k, rect.top * k, rect.width * k, rect.height * k);
}
