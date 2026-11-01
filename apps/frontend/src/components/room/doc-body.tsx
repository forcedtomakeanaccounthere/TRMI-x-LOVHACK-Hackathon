"use client";

import { FilmStripIcon, SparkleIcon } from "@phosphor-icons/react";
import { memo, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { getFreshSession } from "@/lib/session";
import { Spinner } from "./bits";
import { youtubeId } from "./docs";
import { useRoom } from "./store";
import type { DocContent, DocRef } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// Extracted HTML, sanitized by the backend (DOMPurify) when the room was created; only the backend can
// write rooms. Memoised so React never rewrites the DOM that marks and anchors measure.
export const HtmlBody = memo(function HtmlBody({ html, onReady }: { html: string; onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [html, onReady]);
  return <div className="reader room-reader" dangerouslySetInnerHTML={{ __html: html }} />;
});

// One p{n} block per page. Pages render only near the viewport and fit the reading column.
export function PdfBody({
  url,
  scroller,
  onLayout,
}: {
  url: string;
  scroller: HTMLElement | null;
  onLayout: () => void;
}) {
  const [pages, setPages] = useState(0);
  const [ratio, setRatio] = useState(1.294); // A4 until the first page says otherwise
  // Each page's own height / width once it has loaded, so mixed portrait and landscape pages fit.
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState<Set<number>>(new Set([1, 2]));
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !pages) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) if (e.isIntersecting) next.add(Number((e.target as HTMLElement).dataset.page));
          return next.size === prev.size ? prev : next;
        });
      },
      { root: scroller, rootMargin: "1200px 0px" },
    );
    el.querySelectorAll("[data-page]").forEach((p) => io.observe(p));
    return () => io.disconnect();
  }, [pages, scroller]);

  useEffect(onLayout, [width, pages, ratios, onLayout]);

  return (
    <div ref={host} className="w-full">
      <Document
        file={url}
        loading={<PageSkeleton />}
        error={<p className="py-20 text-center text-muted-foreground">This PDF couldn&apos;t be opened.</p>}
        onLoadSuccess={async (pdf) => {
          setPages(pdf.numPages);
          const first = await pdf.getPage(1);
          const vp = first.getViewport({ scale: 1 });
          setRatio(vp.height / vp.width);
        }}
      >
        <div className="space-y-6">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              data-block={`p${n}`}
              data-page={n}
              className="relative overflow-hidden rounded-xl bg-white shadow-[0_20px_50px_-30px_rgb(14_30_90/0.5)] ring-1 ring-(--hairline)"
              style={{
                height: width ? Math.round(width * (ratios[n] ?? ratio)) : undefined,
                aspectRatio: width ? undefined : `1 / ${ratios[n] ?? ratio}`,
              }}
            >
              {width > 0 && visible.has(n) ? (
                <Page
                  pageNumber={n}
                  width={width}
                  renderAnnotationLayer={false}
                  renderTextLayer
                  loading={<PageSkeleton />}
                  onLoadSuccess={(page) => {
                    const vp = page.getViewport({ scale: 1 });
                    const r = vp.height / vp.width;
                    setRatios((prev) => (prev[n] === r ? prev : { ...prev, [n]: r }));
                  }}
                  onRenderSuccess={onLayout}
                  onRenderTextLayerSuccess={onLayout}
                />
              ) : (
                <PageSkeleton />
              )}
              <span data-room-ui className="absolute right-3 bottom-2 text-[0.625rem] text-neutral-400 tabular-nums">
                {n} / {pages}
              </span>
            </div>
          ))}
        </div>
      </Document>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="absolute inset-0 animate-pulse p-10" aria-busy="true">
      {[70, 92, 88, 95, 60, 90, 84].map((w, i) => (
        <div key={i} className="mb-4 h-3 rounded-full bg-neutral-200" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

// An attached video that hasn't become a transcript yet: watch it here, then process it so the
// group can highlight and ask about what was said.
export function VideoBody({ doc }: { doc: DocRef }) {
  const { actions, perms } = useRoom();
  const [busy, setBusy] = useState(false);
  // Shown when the captions can't be fetched: the transcript can be pasted from YouTube instead.
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const id = doc.source_url ? youtubeId(doc.source_url) : null;

  const process = async (transcript?: string) => {
    const session = await getFreshSession();
    if (!session) {
      toast.error("Sign in to process videos");
      return;
    }
    setBusy(true);
    try {
      const { id: roomId } = await api.createYoutubeRoom(doc.source_url!, session.access_token, transcript);
      actions.addDoc({
        id: roomId,
        kind: "youtube",
        title: doc.title,
        source_url: doc.source_url,
        format: null,
      });
      toast.success("Transcript ready");
      setPasting(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && !transcript) setPasting(true);
      toast.error(
        err instanceof ApiError && err.status === 404
          ? "Video transcripts aren't on the backend yet (POST /api/rooms/youtube). The video stays attached."
          : err instanceof Error
            ? err.message
            : "Couldn't process the video",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bezel">
        <div className="bezel-core overflow-hidden">
          {id ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${id}?rel=0`}
              title={doc.title}
              className="aspect-video w-full"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
            />
          ) : (
            <div className="grid aspect-video place-items-center text-muted-foreground">
              <FilmStripIcon className="size-10" />
            </div>
          )}
        </div>
      </div>
      {perms.addSources && (
        <div className="liquid-glass flex flex-col items-start gap-3 rounded-2xl p-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <div className="font-display text-[1.4rem] leading-tight">Turn it into a document</div>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">
              The transcript becomes a page the room can highlight, comment on and ask the AI about.
            </p>
          </div>
          <button
            type="button"
            onClick={() => process()}
            disabled={busy}
            className="flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[0.8125rem] font-medium text-pearl active:scale-[0.98] disabled:opacity-60 dark:bg-azure"
          >
            {busy ? <Spinner /> : <SparkleIcon weight="fill" className="size-4" />}
            Process into document
          </button>
        </div>
      )}
      {perms.addSources && pasting && (
        <div className="liquid-glass space-y-3 rounded-2xl p-5">
          <div className="text-[0.8125rem] text-muted-foreground">
            Paste the transcript instead. On YouTube: ⋯ under the video → Show transcript, then copy it.
          </div>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder={"0:00\nFirst line…\n0:07\nNext line…"}
            className="w-full resize-y rounded-xl border border-border bg-transparent p-3 text-[0.8125rem] outline-none focus:border-azure"
          />
          <button
            type="button"
            onClick={() => process(pasted)}
            disabled={busy || !pasted.trim()}
            className="flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[0.8125rem] font-medium text-pearl active:scale-[0.98] disabled:opacity-60 dark:bg-azure"
          >
            {busy ? <Spinner /> : <SparkleIcon weight="fill" className="size-4" />}
            Use pasted transcript
          </button>
        </div>
      )}
    </div>
  );
}

export function isReadable(doc: DocContent) {
  return !!doc.content_html || !!doc.pdf_url;
}
