"use client";

import { motion } from "motion/react";
import { useLayoutEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { findBlock, textRects } from "./anchors";
import { AiBox, NoteBox } from "./boxes";
import type { Peer, RemoteCursor } from "./use-room-channel";
import type { Annotation, Point, Rect } from "./types";

// Everything drawn over a document: highlight and underline bars, highlighted areas, ink, comment
// pins, AI boxes and other people's cursors. Positions are measured from the live DOM (block boxes
// relative to the document) and re-measured whenever the layout changes.

export type Box = { left: number; top: number; width: number; height: number };
export type Geometry = Map<string, { box: Box; rects: Box[] }>;

export function blockBox(article: HTMLElement, block: HTMLElement): Box {
  const a = article.getBoundingClientRect();
  const b = block.getBoundingClientRect();
  return {
    left: b.left - a.left,
    top: b.top - a.top,
    width: b.width,
    height: b.height,
  };
}

const toPx = (box: Box, r: Rect): Box => ({
  left: box.left + r.x * box.width,
  top: box.top + r.y * box.height,
  width: r.w * box.width,
  height: r.h * box.height,
});

export function measure(article: HTMLElement, annotations: Annotation[]): Geometry {
  const geom: Geometry = new Map();
  const boxes = new Map<string, { el: HTMLElement; box: Box }>();
  for (const a of annotations) {
    let entry = boxes.get(a.block);
    if (!entry) {
      const el = findBlock(article, a.block);
      if (!el) continue;
      entry = { el, box: blockBox(article, el) };
      boxes.set(a.block, entry);
    }
    const { el, box } = entry;
    if (!box.width) continue;
    let rects: Box[] = [];
    if (a.kind === "highlight" || a.kind === "underline")
      rects = textRects(el, a.start, a.end).map((r) => toPx(box, r));
    else if (a.kind === "region") rects = [toPx(box, a.rect)];
    geom.set(a.id, { box, rects });
  }
  return geom;
}

function distToSegment(p: Point, a: Point, b: Point) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// The topmost mark under a point (document px), for hover labels and the eraser.
export function hitTest(geom: Geometry, annotations: Annotation[], x: number, y: number, slop = 4): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]!;
    const g = geom.get(a.id);
    if (!g) continue;
    if (a.kind === "ink") {
      const pts = a.points.map(([px, py]) => [g.box.left + px * g.box.width, g.box.top + py * g.box.height] as Point);
      for (let j = 1; j < pts.length; j++)
        if (distToSegment([x, y], pts[j - 1]!, pts[j]!) <= Math.max(slop + 2, a.width + 2)) return a;
      if (pts.length === 1 && Math.hypot(x - pts[0]![0], y - pts[0]![1]) <= slop + a.width) return a;
    } else if (
      g.rects.some(
        (r) => x >= r.left - slop && x <= r.left + r.width + slop && y >= r.top - slop && y <= r.top + r.height + slop,
      )
    ) {
      return a;
    }
  }
  return null;
}

export function strokePath(points: Point[], box: Box) {
  const pts = points.map(([x, y]) => [box.left + x * box.width, box.top + y * box.height] as Point);
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0]![0]} ${pts[0]![1]} l0.01 0`;
  // Quadratic curves through the midpoints: smooth without overshooting.
  let d = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = pts.at(-1)!;
  return `${d} L${last[0]} ${last[1]}`;
}

type Props = {
  article: HTMLElement | null;
  docId: string;
  annotations: Annotation[];
  version: number;
  fresh: string | null; // the annotation just created here, which opens ready to type
  hovered: string | null;
  draft:
    | { kind: "ink"; points: Point[]; color: string; width: number; box: Box }
    | { kind: "rect"; rect: Box; color: string }
    | null;
  cursors: RemoteCursor[];
  peers: Peer[];
  following: string | null; // whose cursor to ring, while you follow them
  // The document is white pages (PDF, slides): marks multiply into the paper in both themes, since a
  // screen blend over white would wash them out in dark mode.
  paper: boolean;
  onGeometry: (g: Geometry) => void;
  onMove: (annotation: Annotation, x: number, y: number) => void;
};

const GUTTER_GAP = 20;
const BOX_WIDTH = 288;

export function Overlay({
  article,
  docId,
  annotations,
  version,
  fresh,
  hovered,
  draft,
  cursors,
  peers,
  following,
  paper,
  onGeometry,
  onMove,
}: Props) {
  const [geom, setGeom] = useState<Geometry>(new Map());
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!article) return;
    const g = measure(article, annotations);
    // Measuring the DOM has to happen after layout, so this effect is the right place to set state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGeom(g);
    setWidth(article.clientWidth);
    onGeometry(g);
  }, [article, annotations, version, onGeometry]);

  const inks = annotations.filter((a) => a.kind === "ink");

  // An AI box or note placed past the block's right edge sits in the margin when there's room,
  // otherwise just inside the right edge of the page.
  const place = (box: Box, x: number, y: number, moved?: boolean): React.CSSProperties => {
    // Dragged boxes sit exactly where they were dropped, kept on the page.
    if (moved) {
      const left = Math.min(Math.max(0, box.left + x * box.width), Math.max(0, width - 40));
      return { left, top: box.top + y * box.height };
    }
    if (x >= 1) {
      const gutter = box.left + box.width + GUTTER_GAP;
      const left = gutter + BOX_WIDTH <= width ? gutter : Math.max(8, width - BOX_WIDTH - 8);
      return { left, top: box.top + y * box.height };
    }
    return { left: box.left + x * box.width, top: box.top + y * box.height };
  };

  // A drag moved a box by (dx, dy) px from where it was drawn: store it as fractions of its block.
  const dropped = (a: Annotation, style: React.CSSProperties, dx: number, dy: number) => {
    const g = geom.get(a.id);
    if (!g || !g.box.width || !g.box.height) return;
    const left = Number(style.left ?? 0) + dx;
    const top = Number(style.top ?? 0) + dy;
    onMove(a, (left - g.box.left) / g.box.width, (top - g.box.top) / g.box.height);
  };

  return (
    <div data-room-ui className="pointer-events-none absolute inset-0" key={docId}>
      {/* Text marks and highlighted areas */}
      {annotations.map((a) => {
        const g = geom.get(a.id);
        if (!g) return null;
        if (a.kind === "highlight" || a.kind === "region") {
          const lit = hovered === a.id;
          return g.rects.map((r, i) => (
            <div
              key={`${a.id}-${i}`}
              className={cn(
                "absolute rounded-[3px] mix-blend-multiply transition-opacity",
                !paper && "dark:mix-blend-screen",
              )}
              style={{
                left: r.left - 1,
                top: r.top,
                width: r.width + 2,
                height: r.height,
                backgroundColor: a.color,
                opacity: lit ? 0.7 : a.kind === "region" ? (paper ? 0.38 : 0.28) : paper ? 0.55 : 0.42,
                outline: a.kind === "region" ? `1.5px dashed ${a.color}` : undefined,
                outlineOffset: 1,
              }}
            />
          ));
        }
        if (a.kind === "underline") {
          return g.rects.map((r, i) => (
            <div
              key={`${a.id}-${i}`}
              className="absolute rounded-full"
              style={{
                left: r.left,
                top: r.top + r.height - 2,
                width: r.width,
                height: hovered === a.id ? 3.5 : paper ? 3 : 2.5,
                backgroundColor: a.color,
              }}
            />
          ));
        }
        return null;
      })}

      {/* Ink */}
      <svg className="absolute inset-0 size-full overflow-visible" aria-hidden>
        {inks.map((a) => {
          const g = geom.get(a.id);
          if (!g || a.kind !== "ink") return null;
          return (
            <path
              key={a.id}
              d={strokePath(a.points, g.box)}
              fill="none"
              stroke={a.color}
              strokeWidth={hovered === a.id ? a.width + 1.5 : a.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.92}
            />
          );
        })}
        {draft?.kind === "ink" && (
          <path
            d={strokePath(draft.points, draft.box)}
            fill="none"
            stroke={draft.color}
            strokeWidth={draft.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {draft?.kind === "rect" && (
        <div
          className="absolute rounded-[3px]"
          style={{
            ...draft.rect,
            backgroundColor: `${draft.color}40`,
            outline: `1.5px dashed ${draft.color}`,
          }}
        />
      )}

      {/* Comments and AI boxes */}
      {annotations.map((a) => {
        const g = geom.get(a.id);
        if (!g) return null;
        if (a.kind === "note") {
          const style = place(g.box, a.x, a.y, a.moved);
          return (
            <NoteBox
              key={a.id}
              note={a}
              style={style}
              autoEdit={fresh === a.id}
              onDrop={(dx, dy) => dropped(a, style, dx, dy)}
            />
          );
        }
        if (a.kind === "ai") {
          const style = place(g.box, a.x, a.y, a.moved);
          return (
            <AiBox
              key={a.id}
              box={a}
              style={{ ...style, width: BOX_WIDTH }}
              autoFocus={fresh === a.id}
              onDrop={(dx, dy) => dropped(a, style, dx, dy)}
            />
          );
        }
        return null;
      })}

      {/* Other people's cursors */}
      {article &&
        cursors.map((c) => {
          const el = findBlock(article, c.anchor.block);
          const peer = peers.find((p) => p.id === c.id);
          if (!el || !peer) return null;
          const box = blockBox(article, el);
          return (
            <motion.div
              key={c.id}
              className="absolute top-0 left-0 z-50"
              title={following === c.id ? `Following ${peer.name}` : undefined}
              initial={false}
              animate={{
                x: box.left + c.anchor.x * box.width,
                y: box.top + c.anchor.y * box.height,
              }}
              transition={{
                type: "spring",
                stiffness: 520,
                damping: 42,
                mass: 0.6,
              }}
            >
              <svg
                width="18"
                height="20"
                viewBox="0 0 18 20"
                className="drop-shadow-[0_2px_4px_rgb(0_0_0/0.25)]"
                aria-hidden
              >
                <path
                  d="M1 1l6.5 17 2.6-7.1L17 8.3z"
                  fill={peer.color}
                  stroke="white"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                className="absolute top-4 left-3.5 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap text-white shadow-md"
                style={{
                  backgroundColor: peer.color,
                  boxShadow: following === c.id ? `0 0 0 2px var(--background), 0 0 0 4px ${peer.color}` : undefined,
                }}
              >
                {following === c.id ? `Following ${peer.name}` : peer.name}
              </span>
            </motion.div>
          );
        })}
    </div>
  );
}
