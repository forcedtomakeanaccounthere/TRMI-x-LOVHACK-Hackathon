"use client";

import { ArrowSquareOutIcon, DownloadSimpleIcon, EyeIcon, LockSimpleIcon, XIcon } from "@phosphor-icons/react";
import { ReactLenis, type LenisRef } from "lenis/react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { blockOf, findBlock, readSelection, type TextSelection, toAnchor, topBlock } from "./anchors";
import { Spinner, timeAgo } from "./bits";
import { HtmlBody, PdfBody, VideoBody } from "./doc-body";
import { captureRegion } from "./lens";
import { type Box, type Geometry, blockBox, hitTest, Overlay } from "./overlay";
import { SelectionToolbar } from "./selection-toolbar";
import { useRoom } from "./store";
import { TOOL_KEYS, ToolDock } from "./tool-dock";
import type { Annotation, DocRef, Point } from "./types";

type Draft =
  | { kind: "ink"; points: Point[]; color: string; width: number; box: Box }
  | { kind: "rect"; rect: Box; color: string }
  | null;

const KIND_LABEL: Record<Annotation["kind"], string> = {
  highlight: "Highlighted",
  underline: "Underlined",
  region: "Highlighted",
  ink: "Drawn",
  note: "Comment",
  ai: "AI box",
};

export function DocViewer() {
  const room = useRoom();
  const { state, activeDoc, contents } = room;
  const ref = state.docs.find((d) => d.id === activeDoc) ?? state.docs[0]!;
  const content = contents[ref.id];

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={ref.id}
          className="min-h-0 flex-1"
          initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
          transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
        >
          {ref.kind === "video" ? (
            <Scroller docRef={ref}>{() => <VideoBody doc={ref} />}</Scroller>
          ) : content === "loading" || content === undefined ? (
            <div className="grid h-full place-items-center text-muted-foreground">
              <Spinner className="size-6" />
            </div>
          ) : content === "missing" ? (
            <div className="grid h-full place-items-center px-6 text-center text-muted-foreground">
              This source was deleted or can&apos;t be opened.
            </div>
          ) : (
            <Scroller docRef={ref} interactive>
              {({ onLayout, scroller }) =>
                content.pdf_url ? (
                  <PdfBody url={content.pdf_url} scroller={scroller} onLayout={onLayout} />
                ) : (
                  <HtmlBody
                    html={content.content_html ?? '<p data-block="b0">This document has no text.</p>'}
                    onReady={onLayout}
                  />
                )
              }
            </Scroller>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Below lg the room's bottom bar (Sources / Room) sits at the bottom, so the dock goes above it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:bottom-5">
        <ToolDock />
      </div>
      <FollowBanner />
    </div>
  );
}

function FollowBanner() {
  const { following, setFollowing, channel } = useRoom();
  const leader = channel.peers.find((p) => p.id === following);
  return (
    <AnimatePresence>
      {leader && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="absolute inset-x-0 top-3 z-40 flex justify-center"
        >
          <div
            className="liquid-glass liquid-glass-strong flex items-center gap-2 rounded-full py-1 pr-1 pl-3 text-[0.8125rem]"
            style={{ boxShadow: `0 0 0 2px ${leader.color}` }}
          >
            <EyeIcon weight="fill" style={{ color: leader.color }} className="size-4" />
            Following <strong>{leader.name}</strong>
            <button
              type="button"
              onClick={() => setFollowing(null)}
              className="flex h-7 items-center gap-1 rounded-full bg-foreground/8 px-2.5 text-[0.75rem] font-medium hover:bg-foreground/12"
            >
              <XIcon className="size-3" /> Stop
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type RenderArgs = { onLayout: () => void; scroller: HTMLElement | null };

function Scroller({
  docRef,
  interactive,
  children,
}: {
  docRef: DocRef;
  interactive?: boolean;
  children: (args: RenderArgs) => React.ReactNode;
}) {
  const room = useRoom();
  const {
    me,
    state,
    tool,
    setTool,
    color,
    width,
    lens,
    setLens,
    perms,
    actions,
    channel,
    following,
    setFollowing,
    jump,
    readOnly,
    canRemove,
  } = room;
  const lenisRef = useRef<LenisRef>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [article, setArticle] = useState<HTMLElement | null>(null);
  const [version, setVersion] = useState(0);
  const geomRef = useRef<Geometry>(new Map());
  const [selection, setSelection] = useState<{
    sel: TextSelection;
    at: { x: number; y: number };
  } | null>(null);
  const [hover, setHover] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const gesture = useRef<{
    start: { x: number; y: number; block: HTMLElement };
    points: Point[];
    moved: boolean;
  } | null>(null);
  const [capturing, setCapturing] = useState(false);

  const docId = docRef.id;
  const annotations = useMemo(() => state.annotations.filter((a) => a.doc === docId), [state.annotations, docId]);
  const onLayout = useCallback(() => setVersion((v) => v + 1), []);
  const onGeometry = useCallback((g: Geometry) => (geomRef.current = g), []);

  useEffect(() => {
    setScroller(lenisRef.current?.wrapper ?? null);
  }, []);

  // Re-measure marks when the page reflows (resize, fonts, images).
  useEffect(() => {
    if (!article) return;
    const ro = new ResizeObserver(onLayout);
    ro.observe(article);
    const imgs = article.querySelectorAll("img");
    imgs.forEach((img) => img.addEventListener("load", onLayout));
    void document.fonts?.ready.then(onLayout);
    return () => {
      ro.disconnect();
      imgs.forEach((img) => img.removeEventListener("load", onLayout));
    };
  }, [article, onLayout, version === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const local = (clientX: number, clientY: number) => {
    const a = article!.getBoundingClientRect();
    return { x: clientX - a.left, y: clientY - a.top };
  };

  const scrollToBlock = useCallback(
    (block: string, ratio = 0) => {
      const el = findBlock(article, block);
      const lenis = lenisRef.current?.lenis;
      if (!el || !lenis || !scroller) return;
      const target =
        el.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop +
        ratio * el.offsetHeight -
        96;
      lenis.scrollTo(Math.max(0, target), { duration: 0.9 });
    },
    [article, scroller],
  );

  // Jumps from citations, history and comment lists.
  useEffect(() => {
    if (jump && jump.doc === docId) {
      const t = setTimeout(() => scrollToBlock(jump.block), 120);
      return () => clearTimeout(t);
    }
  }, [jump, docId, scrollToBlock, version > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow mode: go where the leader is reading.
  const leaderScroll = following ? channel.scrolls[following] : undefined;
  useEffect(() => {
    if (!leaderScroll) return;
    if (leaderScroll.doc !== docId) {
      room.setActiveDoc(leaderScroll.doc);
      return;
    }
    scrollToBlock(leaderScroll.block, leaderScroll.ratio);
  }, [leaderScroll, docId, scrollToBlock]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the room where you're reading.
  useEffect(() => {
    const lenis = lenisRef.current?.lenis;
    if (!lenis || !scroller) return;
    const onScroll = () => {
      const top = topBlock(scroller);
      if (top) channel.send.scroll(docId, top.block, top.ratio);
    };
    lenis.on("scroll", onScroll);
    return () => lenis.off("scroll", onScroll);
  }, [scroller, docId, channel.send]);

  // Keyboard: tool shortcuts, Escape to put tools down.
  useEffect(() => {
    if (!interactive) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        setLens(false);
        setTool("select");
        setSelection(null);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "l" && perms.useAi) setLens(!lens);
      else if (TOOL_KEYS[k] && perms.annotate) {
        setLens(false);
        setTool(TOOL_KEYS[k]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactive, lens, perms.annotate, perms.useAi, setLens, setTool]);

  const canErase = (a: Annotation) => canRemove(a.author.id);

  // --- Making marks from a text selection ---
  const markSelection = (sel: TextSelection, kind: "highlight" | "underline", c = color) => {
    actions.annotate({
      kind,
      doc: docId,
      block: sel.block,
      start: sel.start,
      end: sel.end,
      quote: sel.quote,
      color: c,
    });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const openAiBox = (sel: TextSelection) => {
    const el = findBlock(article, sel.block);
    const y = el ? Math.max(0, (sel.rect.top - el.getBoundingClientRect().top) / el.offsetHeight) : 0;
    const a = actions.annotate({
      kind: "ai",
      doc: docId,
      block: sel.block,
      x: 1,
      y,
      quote: sel.quote,
      image: null,
    });
    setFresh(a.id);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const commentOn = (sel: TextSelection) => {
    const el = findBlock(article, sel.block);
    const box = el?.getBoundingClientRect();
    const x = box ? (sel.rect.right - box.left) / box.width : 1;
    const y = box ? (sel.rect.top - box.top) / box.height : 0;
    actions.annotate({
      kind: "highlight",
      doc: docId,
      block: sel.block,
      start: sel.start,
      end: sel.end,
      quote: sel.quote,
      color,
    });
    const note = actions.annotate({
      kind: "note",
      doc: docId,
      block: sel.block,
      x: Math.min(x, 0.98),
      y,
      body: "",
      color,
    });
    setFresh(note.id);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const onPointerUpText = (e: React.PointerEvent) => {
    if (!article || lens) return;
    const sel = readSelection(article);
    const g = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (sel && (tool === "highlight" || tool === "underline") && perms.annotate) {
      markSelection(sel, tool);
      return;
    }
    // Highlighter dragged over something with no text (a figure, a scanned page): highlight the area.
    if (!sel && tool === "highlight" && g?.moved && perms.annotate) {
      const end = local(e.clientX, e.clientY);
      const box = blockBox(article, g.start.block);
      const x0 = Math.min(g.start.x, end.x);
      const y0 = Math.min(g.start.y, end.y);
      const rect = {
        x: (x0 - box.left) / box.width,
        y: (y0 - box.top) / box.height,
        w: Math.abs(end.x - g.start.x) / box.width,
        h: Math.abs(end.y - g.start.y) / box.height,
      };
      if (rect.w * box.width > 6 && rect.h * box.height > 6) {
        actions.annotate({
          kind: "region",
          doc: docId,
          block: g.start.block.dataset.block!,
          rect,
          color,
        });
      }
      return;
    }
    if (sel && tool === "select") {
      const at = local(sel.rect.left + sel.rect.width / 2, sel.rect.top);
      setSelection({ sel, at });
    } else setSelection(null);
  };

  // --- Pen, eraser and comment pins (a capture layer over the page) ---
  const capture = interactive && perms.annotate && (tool === "pen" || tool === "eraser" || tool === "note") && !lens;

  const eraseAt = (x: number, y: number) => {
    const hit = hitTest(
      geomRef.current,
      annotations.filter((a) => a.kind !== "note" && a.kind !== "ai" && canErase(a)),
      x,
      y,
      6,
    );
    if (hit) actions.removeAnnotation(hit.id);
  };

  const onCaptureDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!article || e.button !== 0) return;
    const anchor = toAnchorThrough(e);
    if (!anchor) return;
    const p = local(e.clientX, e.clientY);
    if (tool === "note") {
      const note = actions.annotate({
        kind: "note",
        doc: docId,
        block: anchor.block,
        x: anchor.x,
        y: anchor.y,
        body: "",
        color,
      });
      setFresh(note.id);
      setTool("select");
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      start: { ...p, block: anchor.el },
      points: [[anchor.x, anchor.y]],
      moved: false,
    };
    if (tool === "eraser") eraseAt(p.x, p.y);
    else
      setDraft({
        kind: "ink",
        points: [[anchor.x, anchor.y]],
        color,
        width,
        box: blockBox(article, anchor.el),
      });
  };

  const onCaptureMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !article) return;
    const p = local(e.clientX, e.clientY);
    if (tool === "eraser") return eraseAt(p.x, p.y);
    const box = blockBox(article, g.start.block);
    const pt: Point = [(p.x - box.left) / box.width, (p.y - box.top) / box.height];
    const last = g.points.at(-1)!;
    // Skip points under 1.5 px apart: smaller strokes, same shape.
    if (Math.hypot((pt[0] - last[0]) * box.width, (pt[1] - last[1]) * box.height) < 1.5) return;
    g.points.push(pt);
    g.moved = true;
    setDraft({ kind: "ink", points: [...g.points], color, width, box });
  };

  const onCaptureUp = () => {
    const g = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (!g || tool !== "pen") return;
    const round = (n: number) => Math.round(n * 10000) / 10000;
    actions.annotate({
      kind: "ink",
      doc: docId,
      block: g.start.block.dataset.block!,
      points: g.points.map(([x, y]) => [round(x), round(y)]),
      color,
      width,
    });
  };

  // The capture layer covers the page, so find the block under it.
  const toAnchorThrough = (e: React.PointerEvent<HTMLElement>) => {
    const layer = e.currentTarget;
    layer.style.pointerEvents = "none";
    const anchor = article ? toAnchor(article, e.clientX, e.clientY) : null;
    layer.style.pointerEvents = "";
    return anchor;
  };

  // --- AI lens ---
  const onLensDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!article || e.button !== 0) return;
    const anchor = toAnchorThrough(e);
    if (!anchor) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      start: { ...local(e.clientX, e.clientY), block: anchor.el },
      points: [],
      moved: false,
    };
  };
  const onLensMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const p = local(e.clientX, e.clientY);
    g.moved = true;
    setDraft({
      kind: "rect",
      rect: {
        left: Math.min(g.start.x, p.x),
        top: Math.min(g.start.y, p.y),
        width: Math.abs(p.x - g.start.x),
        height: Math.abs(p.y - g.start.y),
      },
      color: "#2f5bff",
    });
  };
  const onLensUp = async () => {
    const g = gesture.current;
    const rect = draft?.kind === "rect" ? draft.rect : null;
    gesture.current = null;
    setDraft(null);
    if (!g || !rect || !article || rect.width < 12 || rect.height < 12) return;
    setCapturing(true);
    try {
      const image = await captureRegion(article, rect);
      const box = blockBox(article, g.start.block);
      const a = actions.annotate({
        kind: "ai",
        doc: docId,
        block: g.start.block.dataset.block!,
        x: 1,
        y: Math.max(0, (rect.top - box.top) / box.height),
        quote: null,
        image,
      });
      setFresh(a.id);
      setLens(false);
    } catch {
      toast.error("Couldn't take that snapshot");
    } finally {
      setCapturing(false);
    }
  };

  // --- Hover labels and your own cursor ---
  const frame = useRef(0);
  const onMove = (e: React.PointerEvent) => {
    if (!article) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const anchor = toAnchor(article, clientX, clientY);
      channel.send.cursor(docId, anchor ? { block: anchor.block, x: anchor.x, y: anchor.y } : null);
      if (gesture.current) return;
      const p = local(clientX, clientY);
      const hit = hitTest(geomRef.current, annotations, p.x, p.y);
      setHover(hit ? { id: hit.id, x: p.x, y: p.y } : null);
    });
  };

  const hovered = hover ? annotations.find((a) => a.id === hover.id) : null;
  const meta = room.contents[docId];
  const content = typeof meta === "object" ? meta : null;
  const cursors = Object.values(channel.cursors).filter((c) => c.doc === docId);

  return (
    <ReactLenis
      ref={lenisRef}
      className="room-scroll h-full overflow-y-auto overscroll-contain"
      options={{ lerp: 0.1, smoothWheel: true, wheelMultiplier: 0.9 }}
      onWheel={() => following && setFollowing(null)}
      onTouchMove={() => following && setFollowing(null)}
    >
      <div className="mx-auto w-full max-w-[min(100%,62rem)] px-5 pt-10 pb-40 md:px-10 xl:pr-[21rem]">
        <header className="mb-10 max-w-[68ch]">
          <div className="eyebrow flex items-center gap-2 text-[0.625rem] text-muted-foreground">
            <span>{labelFor(docRef)}</span>
            {readOnly && (
              <span className="flex items-center gap-1 rounded-full bg-foreground/6 px-2 py-0.5 normal-case">
                <LockSimpleIcon className="size-3" /> Read only · {room.primary.status}
              </span>
            )}
            {content?.ai_status && content.ai_status !== "ready" && (
              <span className="rounded-full bg-azure/10 px-2 py-0.5 text-azure normal-case">
                AI {content.ai_status}…
              </span>
            )}
          </div>
          <h1 className="mt-3 font-display text-[clamp(2.1rem,4.4vw,3.4rem)] font-normal text-balance">
            {docRef.title}
          </h1>
          {docRef.source_url && (
            <a
              href={docRef.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-[0.8125rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {hostOf(docRef.source_url)} <ArrowSquareOutIcon className="size-3.5" />
            </a>
          )}
          {content?.summary && room.realDoc(docId) && (
            <div className="mt-3 flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
              <DownloadSimpleIcon className="size-3.5" />
              <span>Summary</span>
              {(["md", "txt"] as const).map((format) => (
                <a
                  key={format}
                  href={api.summaryExportUrl(docId, format)}
                  download
                  className="rounded-full px-2 py-0.5 ring-1 ring-(--hairline) hover:bg-foreground/5 hover:text-foreground"
                >
                  .{format}
                </a>
              ))}
            </div>
          )}
        </header>

        <article
          ref={setArticle}
          data-doc={docId}
          className={cn(
            "relative",
            tool === "highlight" && !lens && "cursor-text [&_.textLayer]:cursor-text",
            interactive && !perms.annotate && "select-text",
          )}
          onPointerDown={(e) => {
            if (!article || lens || capture) return;
            if ((e.target as HTMLElement).closest("[data-room-ui]")) return;
            const block = blockOf(e.target as Node);
            if (tool === "highlight" && block)
              gesture.current = {
                start: { ...local(e.clientX, e.clientY), block },
                points: [],
                moved: false,
              };
            setSelection(null);
          }}
          onPointerMove={(e) => {
            onMove(e);
            const g = gesture.current;
            if (g && tool === "highlight" && !capture && !lens && article) {
              const p = local(e.clientX, e.clientY);
              if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > 8) g.moved = true;
              if (g.moved && window.getSelection()?.isCollapsed !== false) {
                setDraft({
                  kind: "rect",
                  rect: {
                    left: Math.min(g.start.x, p.x),
                    top: Math.min(g.start.y, p.y),
                    width: Math.abs(p.x - g.start.x),
                    height: Math.abs(p.y - g.start.y),
                  },
                  color,
                });
              } else setDraft(null);
            }
          }}
          onPointerLeave={() => {
            channel.send.cursor(docId, null);
            setHover(null);
          }}
          onPointerUp={onPointerUpText}
          onKeyUp={(e) => onPointerUpText(e as unknown as React.PointerEvent)}
        >
          {children({ onLayout, scroller })}

          {interactive && (
            <Overlay
              article={article}
              docId={docId}
              annotations={annotations}
              version={version}
              fresh={fresh}
              hovered={hover?.id ?? null}
              draft={draft}
              cursors={cursors}
              peers={channel.peers}
              onGeometry={onGeometry}
            />
          )}

          {capture && (
            <div
              data-room-ui
              className={cn(
                "absolute inset-0 z-20 touch-none",
                tool === "pen" ? "cursor-crosshair" : tool === "eraser" ? "cursor-cell" : "cursor-copy",
              )}
              onPointerDown={onCaptureDown}
              onPointerMove={(e) => {
                onCaptureMove(e);
                onMove(e);
              }}
              onPointerUp={onCaptureUp}
              onPointerCancel={onCaptureUp}
            />
          )}

          {interactive && lens && (
            <div
              data-room-ui
              className="absolute inset-0 z-20 cursor-crosshair touch-none bg-azure/[0.04] ring-2 ring-azure/30 ring-inset"
              onPointerDown={onLensDown}
              onPointerMove={onLensMove}
              onPointerUp={onLensUp}
            >
              {capturing && (
                <div className="sticky top-1/2 mx-auto flex w-max items-center gap-2 rounded-full bg-ink px-4 py-2 text-[0.8125rem] text-pearl">
                  <Spinner /> Taking a snapshot…
                </div>
              )}
            </div>
          )}

          {selection && (
            <SelectionToolbar
              selection={selection.sel}
              at={selection.at}
              onHighlight={(c) => markSelection(selection.sel, "highlight", c)}
              onUnderline={() => markSelection(selection.sel, "underline")}
              onComment={() => commentOn(selection.sel)}
              onAsk={() => openAiBox(selection.sel)}
            />
          )}

          {hovered && hovered.kind !== "note" && hovered.kind !== "ai" && hover && (
            <div
              data-room-ui
              className="pointer-events-none absolute z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink/90 py-1 pr-2.5 pl-1 text-[0.6875rem] whitespace-nowrap text-pearl shadow-lg backdrop-blur"
              style={{ left: hover.x, top: hover.y + 18 }}
            >
              <span
                className="grid size-4 place-items-center rounded-full text-[0.5rem] font-bold"
                style={{ backgroundColor: hovered.author.color }}
              >
                {hovered.author.name[0]?.toUpperCase()}
              </span>
              {KIND_LABEL[hovered.kind]} by <strong>{hovered.author.id === me.id ? "you" : hovered.author.name}</strong>
              <span className="text-pearl/50">· {timeAgo(hovered.at)}</span>
            </div>
          )}
        </article>
      </div>
    </ReactLenis>
  );
}

function labelFor(doc: DocRef) {
  if (doc.kind === "video") return "Video";
  if (doc.kind === "youtube") return "Video transcript";
  if (doc.kind === "pdf") return "PDF";
  if (doc.kind === "file") return doc.format ? doc.format.toUpperCase() : "Document";
  return doc.source_url ? "Web page" : "Text";
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
