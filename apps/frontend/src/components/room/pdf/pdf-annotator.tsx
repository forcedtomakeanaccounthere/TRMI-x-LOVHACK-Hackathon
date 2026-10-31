"use client";

import { useEffect, useState, useTransition } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  Download,
  Highlighter,
  MessageSquare,
  PenTool,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { backendQuestion } from "@/components/room/ai";
import { getSupabase } from "@/lib/supabase";

// Configure pdfjs worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const DRAW_COLORS = ["#e11d48", "#2563eb", "#16a34a", "#ca8a04", "#9333ea", "#000000"];

export type DrawingStroke = {
  id: string;
  page_num: number;
  author_name: string;
  author_color: string;
  path_data: {
    points: { x: number; y: number }[];
    width: number;
    color?: string;
  };
};

export type HighlightItem = {
  id: string;
  room_id: string;
  block_id: string;
  quote: string;
  author_name: string;
  author_color: string;
  created_at: string;
};

export type CommentItem = {
  id: string;
  room_id: string;
  highlight_id: string;
  body: string;
  author_name: string;
  author_color: string;
  created_at: string;
};

function findQuoteRanges(root: HTMLElement, search: string): Range[] {
  const normSearch = search.replace(/\s+/g, " ").trim();
  if (!normSearch) return [];

  const textLayer = (root.querySelector(".react-pdf__Page__textContent") as HTMLElement) || root;
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  const indexMap: { node: Text; start: number; len: number }[] = [];
  let combined = "";

  let node: Text | null;
  while ((node = walker.nextNode() as Text)) {
    const text = node.textContent || "";
    if (text) {
      indexMap.push({ node, start: combined.length, len: text.length });
      combined += text;
    }
  }

  const ranges: Range[] = [];
  const lowerCombined = combined.toLowerCase();
  const lowerSearch = normSearch.toLowerCase();
  const pos = lowerCombined.indexOf(lowerSearch);

  if (pos !== -1) {
    const startIdx = pos;
    const endIdx = pos + normSearch.length;

    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;

    for (const item of indexMap) {
      if (!startNode && startIdx >= item.start && startIdx < item.start + item.len) {
        startNode = item.node;
        startOffset = startIdx - item.start;
      }
      if (endIdx > item.start && endIdx <= item.start + item.len) {
        endNode = item.node;
        endOffset = endIdx - item.start;
        break;
      }
    }

    if (startNode && endNode) {
      try {
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        ranges.push(range);
      } catch {
        // Fallback gracefully if DOM range creation fails
      }
    }
  }
  return ranges;
}

function PdfPageHighlights({
  pageNum,
  highlights,
  scale,
  onSelectHighlight,
}: {
  pageNum: number;
  highlights: HighlightItem[];
  scale: number;
  onSelectHighlight: (id: string) => void;
}) {
  const [highlightBoxes, setHighlightBoxes] = useState<
    { id: string; color: string; author: string; quote: string; boxes: { left: number; top: number; width: number; height: number }[] }[]
  >([]);

  useEffect(() => {
    const pageEl = document.getElementById(`pdf-page-${pageNum}`);
    if (!pageEl) return;

    const timer = setTimeout(() => {
      const pageRect = pageEl.getBoundingClientRect();
      if (!pageRect.width || !pageRect.height) return;

      const pageHighlights = highlights.filter((h) => h.block_id === `p${pageNum}`);
      const results = pageHighlights.map((h) => {
        const ranges = findQuoteRanges(pageEl, h.quote);
        const boxes: { left: number; top: number; width: number; height: number }[] = [];
        for (const range of ranges) {
          const clientRects = range.getClientRects();
          for (let i = 0; i < clientRects.length; i++) {
            const r = clientRects[i]!;
            boxes.push({
              left: ((r.left - pageRect.left) / pageRect.width) * 100,
              top: ((r.top - pageRect.top) / pageRect.height) * 100,
              width: (r.width / pageRect.width) * 100,
              height: (r.height / pageRect.height) * 100,
            });
          }
        }
        return { id: h.id, color: h.author_color, author: h.author_name, quote: h.quote, boxes };
      });

      setHighlightBoxes(results);
    }, 200);

    return () => clearTimeout(timer);
  }, [pageNum, highlights, scale]);

  return (
    <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
      {highlightBoxes.map((h) =>
        h.boxes.map((b, idx) => (
          <div
            key={`${h.id}_${idx}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectHighlight(h.id);
            }}
            title={`Highlighted by ${h.author}: "${h.quote}"`}
            className="absolute pointer-events-auto cursor-pointer rounded-xs transition-opacity hover:opacity-80"
            style={{
              left: `${b.left}%`,
              top: `${b.top}%`,
              width: `${b.width}%`,
              height: `${b.height}%`,
              backgroundColor: `${h.color}35`,
              borderBottom: `2px solid ${h.color}`,
            }}
          />
        )),
      )}
    </div>
  );
}

interface PdfAnnotatorProps {
  roomId: string;
  pdfUrl: string;
  title: string;
}

export function PdfAnnotator({ roomId, pdfUrl, title }: PdfAnnotatorProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.1);
  const [activeTool, setActiveTool] = useState<"select" | "pen">("select");
  const [penColor, setPenColor] = useState<string>("#e11d48");
  const [penWidth, setPenWidth] = useState<number>(3);

  // Annotations state
  const [drawings, setDrawings] = useState<DrawingStroke[]>([]);
  const [highlights, setHighlights] = useState<HighlightItem[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);

  // Selection & AI explanation
  const [selectionRange, setSelectionRange] = useState<{ text: string; x: number; y: number; page: number } | null>(null);
  const [aiExplanation, setAiExplanation] = useState<{ quote: string; text: string } | null>(null);
  const [isExplaining, startExplaining] = useTransition();

  // Active comment thread drawer
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState<string>("");

  // In-progress drawing path
  const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>([]);
  const [drawingPage, setDrawingPage] = useState<number | null>(null);

  // Author identity
  const [authorName] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("guest_name") || "Guest Reader";
    }
    return "Guest Reader";
  });

  // 1. Load initial drawings, highlights, and comments
  useEffect(() => {
    const supabase = getSupabase();

    async function loadData() {
      const [{ data: dList }, { data: hList }, { data: cList }] = await Promise.all([
        supabase.from("drawings").select("*").eq("room_id", roomId),
        supabase.from("highlights").select("*").eq("room_id", roomId),
        supabase.from("comments").select("*").eq("room_id", roomId),
      ]);

      if (dList) setDrawings(dList as DrawingStroke[]);
      if (hList) setHighlights(hList as HighlightItem[]);
      if (cList) setComments(cList as CommentItem[]);
    }

    loadData();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`pdf-annotations:${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "drawings", filter: `room_id=eq.${roomId}` }, (payload) => {
        setDrawings((prev) => [...prev, payload.new as DrawingStroke]);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "drawings", filter: `room_id=eq.${roomId}` }, (payload) => {
        setDrawings((prev) => prev.filter((d) => d.id !== payload.old.id));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "highlights", filter: `room_id=eq.${roomId}` }, (payload) => {
        setHighlights((prev) => [...prev, payload.new as HighlightItem]);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments", filter: `room_id=eq.${roomId}` }, (payload) => {
        setComments((prev) => [...prev, payload.new as CommentItem]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // Handle document text selection
  const handleMouseUp = (pageNum: number) => {
    if (activeTool !== "select") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setSelectionRange(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length > 0) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelectionRange({
        text,
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        page: pageNum,
      });
    } else {
      setSelectionRange(null);
    }
  };

  // Add highlight
  const createHighlight = async () => {
    if (!selectionRange) return;
    const quote = selectionRange.text;
    const pageNum = selectionRange.page;
    setSelectionRange(null);

    // Compute actual text position in page text
    const pageEl = document.getElementById(`pdf-page-${pageNum}`);
    const pageText = pageEl ? pageEl.textContent || "" : "";
    const cleanQuote = quote.replace(/\s+/g, " ").trim();
    const cleanText = pageText.replace(/\s+/g, " ");
    const foundIdx = cleanText.indexOf(cleanQuote);
    const start_offset = foundIdx >= 0 ? foundIdx : 0;
    const end_offset = start_offset + quote.length;

    const supabase = getSupabase();
    const { error } = await supabase.from("highlights").insert({
      room_id: roomId,
      block_id: `p${pageNum}`,
      start_offset,
      end_offset,
      quote,
      author_name: authorName,
      author_color: penColor,
    });

    if (error) {
      toast.error("Could not save highlight");
    } else {
      toast.success("Text highlighted!");
    }
  };

  // Trigger AI Query on selection
  const queryAiExplanation = () => {
    if (!selectionRange) return;
    const quote = selectionRange.text;
    setSelectionRange(null);

    startExplaining(async () => {
      try {
        // Enforce backend 500-char question budget using backendQuestion
        const question = backendQuestion({ question: "Explain this passage", quote });
        const data = await api.ask(roomId, { question, name: authorName.slice(0, 40) });
        setAiExplanation({ quote, text: data.answer || "No response generated." });
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Could not explain with AI at this time");
      }
    });
  };

  // Drawing mouse handlers (store coordinates in normalized 0..1000 page space)
  const handleCanvasMouseDown = (e: React.PointerEvent<SVGSVGElement>, pageNum: number) => {
    if (activeTool !== "pen") return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000);
    setDrawingPage(pageNum);
    setCurrentPath([{ x, y }]);
  };

  const handleCanvasMouseMove = (e: React.PointerEvent<SVGSVGElement>, pageNum: number) => {
    if (activeTool !== "pen" || drawingPage !== pageNum || !currentPath.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000);
    setCurrentPath((prev) => [...prev, { x, y }]);
  };

  const handleCanvasMouseUp = async (pageNum: number) => {
    if (activeTool !== "pen" || drawingPage !== pageNum || currentPath.length < 2) {
      setCurrentPath([]);
      setDrawingPage(null);
      return;
    }

    const pathData = {
      points: currentPath,
      width: penWidth,
      color: penColor,
    };

    setCurrentPath([]);
    setDrawingPage(null);

    const supabase = getSupabase();
    const { error } = await supabase.from("drawings").insert({
      room_id: roomId,
      page_num: pageNum,
      author_name: authorName,
      author_color: penColor,
      path_data: pathData,
    });

    if (error) {
      toast.error("Could not save drawing stroke");
    }
  };

  // Add Comment to active highlight
  const submitComment = async () => {
    if (!activeHighlightId || !commentInput.trim()) return;
    const body = commentInput.trim();
    setCommentInput("");

    const supabase = getSupabase();
    const { error } = await supabase.from("comments").insert({
      room_id: roomId,
      highlight_id: activeHighlightId,
      body,
      author_name: authorName,
      author_color: penColor,
    });

    if (error) {
      toast.error("Could not save comment");
    } else {
      toast.success("Comment added");
    }
  };

  // Export summary handler
  const downloadSummary = (format: "md" | "txt") => {
    window.open(api.summaryExportUrl(roomId, format), "_blank");
  };

  // Convert points array to SVG path string
  const pointsToSvgPath = (points: { x: number; y: number }[]) => {
    if (!points.length) return "";
    const first = points[0]!;
    let d = `M ${first.x} ${first.y}`;
    for (let i = 1; i < points.length; i++) {
      const p = points[i]!;
      d += ` L ${p.x} ${p.y}`;
    }
    return d;
  };

  return (
    <div className="relative flex flex-col items-center w-full">
      {/* Top Floating Control Bar */}
      <div className="sticky top-6 z-40 mb-8 flex flex-wrap items-center gap-2 rounded-2xl bg-card/90 px-4 py-2.5 shadow-xl backdrop-blur-xl ring-1 ring-foreground/10">
        {title && (
          <span className="hidden sm:inline-block max-w-[140px] truncate text-xs font-semibold text-muted-foreground mr-1" title={title}>
            {title}
          </span>
        )}
        {/* Tool selector */}
        <div className="flex items-center gap-1 border-r border-foreground/10 pr-3">
          <Button
            size="sm"
            variant={activeTool === "select" ? "default" : "ghost"}
            onClick={() => setActiveTool("select")}
            className="h-8 gap-1.5 px-3 text-xs"
          >
            <Highlighter className="size-3.5" />
            Highlight
          </Button>
          <Button
            size="sm"
            variant={activeTool === "pen" ? "default" : "ghost"}
            onClick={() => setActiveTool("pen")}
            className="h-8 gap-1.5 px-3 text-xs"
          >
            <PenTool className="size-3.5" />
            Draw
          </Button>
        </div>

        {/* Color Palette (When pen is active) */}
        {activeTool === "pen" && (
          <div className="flex items-center gap-1.5 border-r border-foreground/10 pr-3">
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setPenColor(c)}
                className={`size-5 rounded-full transition-transform ${penColor === c ? "scale-125 ring-2 ring-primary ring-offset-2" : "hover:scale-110"}`}
                style={{ backgroundColor: c }}
                title={`Color ${c}`}
              />
            ))}
            <input
              type="range"
              min="1"
              max="8"
              value={penWidth}
              onChange={(e) => setPenWidth(Number(e.target.value))}
              className="ml-2 w-16 accent-primary"
              title="Stroke width"
            />
          </div>
        )}

        {/* Zoom controls */}
        <div className="flex items-center gap-1 border-r border-foreground/10 pr-3">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setScale((s) => Math.max(0.7, s - 0.15))}
            className="size-8"
            title="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <span className="text-xs font-mono text-muted-foreground w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setScale((s) => Math.min(2.0, s + 0.15))}
            className="size-8"
            title="Zoom in"
          >
            <ZoomIn className="size-3.5" />
          </Button>
        </div>

        {/* Export Summary */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadSummary("md")}
            className="h-8 gap-1 px-2.5 text-xs"
            title="Export summary in Markdown format"
          >
            <Download className="size-3" />
            Summary (.md)
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadSummary("txt")}
            className="h-8 gap-1 px-2.5 text-xs"
            title="Export summary in Text format"
          >
            <Download className="size-3" />
            .txt
          </Button>
        </div>
      </div>

      {/* Floating Selection Action Popover */}
      {selectionRange && (
        <div
          className="fixed z-50 flex items-center gap-1.5 rounded-xl bg-popover px-2.5 py-1.5 shadow-2xl ring-1 ring-foreground/15 -translate-x-1/2 -translate-y-full animate-in fade-in zoom-in-95"
          style={{ left: selectionRange.x, top: selectionRange.y }}
        >
          <Button size="sm" variant="default" onClick={createHighlight} className="h-7 text-xs gap-1 px-2">
            <Highlighter className="size-3" />
            Highlight
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={queryAiExplanation}
            disabled={isExplaining}
            className="h-7 text-xs gap-1 px-2"
          >
            <Sparkles className="size-3" />
            {isExplaining ? "Explaining..." : "Ask AI"}
          </Button>
        </div>
      )}

      {/* AI Explanation Modal / Card */}
      {aiExplanation && (
        <div className="fixed bottom-8 right-8 z-50 max-w-md w-full rounded-2xl bg-card p-5 shadow-2xl ring-1 ring-foreground/15 border border-primary/20 backdrop-blur-2xl animate-in slide-in-from-bottom-5">
          <div className="flex items-center justify-between pb-3 border-b border-foreground/10">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" />
              AI Explanation
            </div>
            <button
              onClick={() => setAiExplanation(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          <p className="mt-3 text-xs italic text-muted-foreground line-clamp-2">
            &ldquo;{aiExplanation.quote}&rdquo;
          </p>
          <div className="mt-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
            {aiExplanation.text}
          </div>
        </div>
      )}

      {/* PDF Document Container */}
      <Document
        file={pdfUrl}
        onLoadSuccess={({ numPages: pages }) => setNumPages(pages)}
        loading={
          <div className="py-20 text-center text-sm text-muted-foreground animate-pulse">
            Loading interactive PDF pages...
          </div>
        }
        className="flex flex-col items-center gap-8 w-full"
      >
        {Array.from(new Array(numPages), (_, index) => {
          const pageNum = index + 1;
          const pageDrawings = drawings.filter((d) => d.page_num === pageNum);

          return (
            <div
              key={`page_${pageNum}`}
              id={`pdf-page-${pageNum}`}
              className="relative shadow-2xl rounded-xl overflow-hidden ring-1 ring-foreground/10 bg-white"
              onMouseUp={() => handleMouseUp(pageNum)}
            >
              {/* react-pdf Page */}
              <Page
                pageNumber={pageNum}
                scale={scale}
                renderAnnotationLayer={false}
                renderTextLayer={true}
                className="select-text"
              />

              {/* Render Saved Highlights on Page */}
              <PdfPageHighlights
                pageNum={pageNum}
                highlights={highlights}
                scale={scale}
                onSelectHighlight={(id) => setActiveHighlightId(id)}
              />

              {/* Drawing Layer Overlay (SVG) */}
              <svg
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                className={`absolute inset-0 size-full ${activeTool === "pen" ? "cursor-crosshair pointer-events-auto" : "pointer-events-none"}`}
                onPointerDown={(e) => handleCanvasMouseDown(e, pageNum)}
                onPointerMove={(e) => handleCanvasMouseMove(e, pageNum)}
                onPointerUp={() => handleCanvasMouseUp(pageNum)}
              >
                {/* Saved drawings */}
                {pageDrawings.map((d) => (
                  <path
                    key={d.id}
                    d={pointsToSvgPath(d.path_data.points)}
                    stroke={d.path_data.color || d.author_color}
                    strokeWidth={d.path_data.width || 2}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                ))}

                {/* In-progress drawing stroke */}
                {drawingPage === pageNum && currentPath.length > 1 && (
                  <path
                    d={pointsToSvgPath(currentPath)}
                    stroke={penColor}
                    strokeWidth={penWidth}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                )}
              </svg>
            </div>
          );
        })}
      </Document>

      {/* Highlights & Comments Thread Sidebar / Drawer */}
      {highlights.length > 0 && (
        <aside className="mt-12 w-full max-w-2xl rounded-2xl bg-card p-6 shadow-xl ring-1 ring-foreground/10">
          <h3 className="text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
            <MessageSquare className="size-4 text-primary" />
            Highlights & Discussion ({highlights.length})
          </h3>
          <div className="space-y-4">
            {highlights.map((h) => {
              const hComments = comments.filter((c) => c.highlight_id === h.id);
              const isSelected = activeHighlightId === h.id;

              return (
                <div
                  key={h.id}
                  className={`p-4 rounded-xl border transition-colors ${isSelected ? "border-primary bg-primary/5" : "border-foreground/10 bg-muted/30"}`}
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                    <span className="font-medium" style={{ color: h.author_color }}>
                      {h.author_name}
                    </span>
                    <span>{h.block_id.toUpperCase()}</span>
                  </div>
                  <blockquote className="border-l-2 pl-3 my-2 italic text-xs text-foreground/90" style={{ borderColor: h.author_color }}>
                    &ldquo;{h.quote}&rdquo;
                  </blockquote>

                  {/* Comments on this highlight */}
                  {hComments.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-foreground/5 pt-2 pl-3">
                      {hComments.map((c) => (
                        <div key={c.id} className="text-xs">
                          <span className="font-semibold" style={{ color: c.author_color }}>
                            {c.author_name}:{" "}
                          </span>
                          <span className="text-foreground">{c.body}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add comment input */}
                  {isSelected ? (
                    <div className="mt-3 flex items-center gap-2 pt-2 border-t border-foreground/10">
                      <input
                        type="text"
                        placeholder="Add your comment..."
                        value={commentInput}
                        onChange={(e) => setCommentInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && submitComment()}
                        className="flex-1 text-xs px-3 py-1.5 rounded-lg border bg-background"
                      />
                      <Button size="sm" onClick={submitComment} className="h-7 text-xs px-3">
                        Reply
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setActiveHighlightId(h.id)}
                      className="mt-2 text-[0.75rem] text-primary hover:underline"
                    >
                      Reply to thread ({hComments.length})
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      )}
    </div>
  );
}
