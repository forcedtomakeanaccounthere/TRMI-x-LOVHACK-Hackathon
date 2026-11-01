"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";

// pdf.js needs browser APIs (DOMMatrix, canvas), so this file is only ever loaded in the browser:
// doc-viewer.tsx imports it with next/dynamic and ssr: false.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// One p{n} block per page. Pages render only near the viewport and fit the reading column.
export default function PdfBody({
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
