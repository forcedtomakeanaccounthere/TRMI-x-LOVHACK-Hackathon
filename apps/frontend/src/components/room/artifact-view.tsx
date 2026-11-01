"use client";

import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, DownloadSimpleIcon, XCircleIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { artifactToMarkdown, downloadText, fileSafe } from "./ai";
import { ByLine, PreviewTag } from "./bits";
import type { Artifact, ArtifactBody, MindNode } from "./types";

export function ArtifactView({ artifact }: { artifact: Artifact }) {
  const sheet = useRef<HTMLDivElement>(null);
  const { body } = artifact;

  const png = async () => {
    if (!sheet.current) return;
    try {
      const { toPng } = await import("html-to-image");
      const bg = getComputedStyle(document.body).backgroundColor;
      const url = await toPng(sheet.current, {
        pixelRatio: 2,
        backgroundColor: bg,
      });
      Object.assign(document.createElement("a"), {
        href: url,
        download: `${fileSafe(artifact.title)}.png`,
      }).click();
    } catch {
      toast.error("Couldn't draw the image");
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-[2rem] leading-none">{artifact.title}</h2>
            {artifact.preview && <PreviewTag />}
          </div>
          <ByLine actor={artifact.author} at={artifact.at} className="mt-2" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-9 items-center gap-1.5 rounded-full bg-foreground/6 px-3.5 text-[0.8125rem] font-medium hover:bg-foreground/10">
            <DownloadSimpleIcon className="size-4" /> Download
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => downloadText(`${fileSafe(artifact.title)}.md`, artifactToMarkdown(artifact.title, body))}
            >
              Markdown (.md)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                downloadText(`${fileSafe(artifact.title)}.json`, JSON.stringify(artifact, null, 2), "application/json")
              }
            >
              Data (.json)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={png}>Image (.png)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div ref={sheet} className="mt-6 rounded-2xl">
        <Body body={body} />
      </div>
    </div>
  );
}

function Body({ body }: { body: ArtifactBody }) {
  switch (body.kind) {
    case "summary":
      return (
        <div className="space-y-6">
          <p className="font-display text-[1.35rem] leading-snug text-foreground/90">{body.overview}</p>
          {body.sections.map((s, i) => (
            <section key={i}>
              <h3 className="eyebrow text-[0.625rem] text-azure">{s.heading}</h3>
              <ul className="mt-2 space-y-1.5">
                {s.points.map((p, j) => (
                  <li key={j} className="flex gap-2 text-[0.875rem] leading-relaxed">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      );
    case "quiz":
      return <Quiz questions={body.questions} />;
    case "flashcards":
      return <Flashcards cards={body.cards} />;
    case "mindmap":
      return <MindMap root={body.root} />;
    case "infographic":
      return (
        <div className="overflow-hidden rounded-3xl p-7 text-pearl" style={{ background: "var(--ink-tile)" }}>
          <div className="eyebrow text-[0.625rem] text-pearl/60">At a glance</div>
          <p className="mt-3 font-display text-[1.9rem] leading-[1.05]">{body.headline}</p>
          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {body.stats.map((s, i) => (
              <div key={i} className="rounded-2xl bg-white/6 p-4 ring-1 ring-white/10">
                <div className="font-display text-[2.2rem] leading-none">{s.value}</div>
                <div className="mt-1 text-[0.6875rem] text-pearl/60">{s.label}</div>
              </div>
            ))}
          </div>
          <ol className="mt-7 space-y-3">
            {body.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#2f5bff,#8b5cf6)] text-[0.75rem] font-bold">
                  {i + 1}
                </span>
                <div>
                  <div className="text-[0.875rem] font-semibold">{s.title}</div>
                  <p className="text-[0.8125rem] text-pearl/70">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      );
  }
}

function Quiz({ questions }: { questions: Extract<ArtifactBody, { kind: "quiz" }>["questions"] }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const answered = Object.keys(picked).length;
  const score = questions.filter((q, i) => picked[i] === q.answer).length;
  if (questions.length === 0) return <p className="text-muted-foreground">Not enough material for a quiz yet.</p>;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between text-[0.75rem] text-muted-foreground">
        <span>
          {answered} of {questions.length} answered
        </span>
        {answered === questions.length && (
          <span className="font-semibold text-foreground">
            Score {score}/{questions.length}
          </span>
        )}
      </div>
      {questions.map((q, i) => (
        <div key={i} className="rounded-2xl bg-card p-4 ring-1 ring-(--hairline)">
          <p className="text-[0.875rem] font-semibold">
            {i + 1}. {q.q}
          </p>
          <div className="mt-3 space-y-1.5">
            {q.options.map((o, j) => {
              const chosen = picked[i] === j;
              const done = picked[i] !== undefined;
              const right = j === q.answer;
              return (
                <button
                  key={j}
                  type="button"
                  disabled={done}
                  onClick={() => setPicked((p) => ({ ...p, [i]: j }))}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-[0.8125rem] ring-1 transition",
                    !done && "ring-(--hairline) hover:bg-foreground/4",
                    done && right && "bg-emerald-500/10 ring-emerald-500/40",
                    done && chosen && !right && "bg-red-500/10 ring-red-500/40",
                    done && !chosen && !right && "opacity-55 ring-transparent",
                  )}
                >
                  <span className="font-semibold text-muted-foreground">{"ABCD"[j]}</span>
                  <span className="flex-1">{o}</span>
                  {done && right && <CheckCircleIcon weight="fill" className="size-4 text-emerald-500" />}
                  {done && chosen && !right && <XCircleIcon weight="fill" className="size-4 text-red-500" />}
                </button>
              );
            })}
          </div>
          {picked[i] !== undefined && <p className="mt-2 text-[0.75rem] text-muted-foreground">{q.why}</p>}
        </div>
      ))}
    </div>
  );
}

function Flashcards({ cards }: { cards: { front: string; back: string }[] }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  if (cards.length === 0) return <p className="text-muted-foreground">No terms found yet.</p>;
  const card = cards[i]!;
  const go = (d: number) => {
    setFlipped(false);
    setI((n) => (n + d + cards.length) % cards.length);
  };
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="relative h-64 w-full max-w-md [perspective:1200px]"
        aria-label="Flip card"
      >
        <motion.div
          className="relative size-full [transform-style:preserve-3d]"
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 180, damping: 20 }}
        >
          <div className="liquid-glass absolute inset-0 flex flex-col items-center justify-center rounded-3xl p-8 text-center [backface-visibility:hidden]">
            <div className="eyebrow text-[0.5625rem] text-muted-foreground">Term</div>
            <div className="mt-3 font-display text-[2rem] leading-tight">{card.front}</div>
            <div className="mt-6 text-[0.6875rem] text-muted-foreground">Tap to reveal</div>
          </div>
          <div
            className="absolute inset-0 flex items-center justify-center rounded-3xl p-8 text-center text-[0.9375rem] leading-relaxed text-pearl [backface-visibility:hidden] [transform:rotateY(180deg)]"
            style={{ background: "var(--ink-tile)" }}
          >
            {card.back}
          </div>
        </motion.div>
      </button>
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous"
          className="grid size-9 place-items-center rounded-full bg-foreground/6 hover:bg-foreground/10"
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <span className="text-[0.75rem] text-muted-foreground tabular-nums">
          {i + 1} / {cards.length}
        </span>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next"
          className="grid size-9 place-items-center rounded-full bg-foreground/6 hover:bg-foreground/10"
        >
          <ArrowRightIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

// A left-to-right tree drawn as SVG curves between HTML nodes.
type Laid = { node: MindNode; depth: number; y: number; parent: Laid | null };

function layout(root: MindNode) {
  const out: Laid[] = [];
  let leaf = 0;
  const walk = (node: MindNode, depth: number, parent: Laid | null): Laid => {
    const item: Laid = { node, depth, y: 0, parent };
    out.push(item);
    const kids = (node.children ?? []).map((c) => walk(c, depth + 1, item));
    item.y = kids.length ? (kids[0]!.y + kids.at(-1)!.y) / 2 : leaf++;
    return item;
  };
  walk(root, 0, null);
  return { items: out, rows: Math.max(1, leaf) };
}

const COL = 210;
const ROW = 44;
const PALETTE = ["#2f5bff", "#8b5cf6", "#14b8a6", "#f97316", "#ec4899", "#eab308"];

// The map pans by dragging it with the mouse (grab cursor), and a plain vertical wheel scrolls it
// sideways while there's more to see that way, so nobody has to aim for the scrollbar.
function MindMap({ root }: { root: MindNode }) {
  const [panEl, setPanEl] = useState<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; left: number; top: number } | null>(null);

  useEffect(() => {
    if (!panEl) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // pinch, or already sideways
      const max = panEl.scrollWidth - panEl.clientWidth;
      if (max <= 0) return;
      const atEdge = (e.deltaY < 0 && panEl.scrollLeft <= 0) || (e.deltaY > 0 && panEl.scrollLeft >= max - 1);
      if (atEdge) return; // let the dialog scroll on
      e.preventDefault();
      panEl.scrollLeft += e.deltaY;
    };
    panEl.addEventListener("wheel", onWheel, { passive: false });
    return () => panEl.removeEventListener("wheel", onWheel);
  }, [panEl]);

  const { items, rows } = layout(root);
  const depth = Math.max(...items.map((i) => i.depth));
  const width = (depth + 1) * COL + 40;
  const height = rows * ROW + 20;
  const branchColor = (item: Laid): string => {
    let top = item;
    while (top.parent && top.parent.parent) top = top.parent;
    const siblings = items.filter((i) => i.depth === 1);
    return item.depth === 0 ? "#05070d" : PALETTE[siblings.indexOf(top) % PALETTE.length]!;
  };
  return (
    <div
      ref={setPanEl}
      data-lenis-prevent
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse" || e.button !== 0) return; // touch already pans natively
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        e.currentTarget.scrollLeft = drag.left - (e.clientX - drag.x);
        e.currentTarget.scrollTop = drag.top - (e.clientY - drag.y);
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      title="Drag to move around"
      className={cn(
        "max-h-[60dvh] overflow-auto overscroll-contain rounded-2xl bg-card/60 ring-1 ring-(--hairline) select-none",
        drag ? "cursor-grabbing" : "cursor-grab",
      )}
    >
      <div className="relative" style={{ width, height }}>
        <svg className="absolute inset-0" width={width} height={height} aria-hidden>
          {items
            .filter((i) => i.parent)
            .map((i, k) => {
              const p = i.parent!;
              const x1 = 20 + p.depth * COL + 170;
              const y1 = 10 + p.y * ROW + ROW / 2;
              const x2 = 20 + i.depth * COL;
              const y2 = 10 + i.y * ROW + ROW / 2;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={k}
                  d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
                  fill="none"
                  stroke={branchColor(i)}
                  strokeOpacity={0.45}
                  strokeWidth={1.5}
                />
              );
            })}
        </svg>
        {items.map((i, k) => (
          <motion.div
            key={k}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i.depth * 0.08 + k * 0.01 }}
            className={cn(
              "absolute flex h-8 w-[170px] items-center rounded-full px-3 text-[0.75rem]",
              i.depth === 0
                ? "bg-ink font-semibold text-pearl dark:bg-azure"
                : i.depth === 1
                  ? "font-semibold text-white"
                  : "bg-card ring-1 ring-(--hairline)",
            )}
            style={{
              left: 20 + i.depth * COL,
              top: 10 + i.y * ROW + (ROW - 32) / 2,
              backgroundColor: i.depth === 1 ? branchColor(i) : undefined,
            }}
            title={i.node.label}
          >
            <span className="truncate">{i.node.label}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
