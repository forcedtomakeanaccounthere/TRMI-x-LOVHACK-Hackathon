"use client";

import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  FileDocIcon,
  FilePdfIcon,
  FileTextIcon,
  GlobeIcon,
  type Icon,
  PresentationChartIcon,
  YoutubeLogoIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { downloadText, fileSafe } from "./ai";
import { ByLine } from "./bits";
import { useRoom } from "./store";
import { ArtifactList } from "./studio";
import type { DocContent, DocRef } from "./types";

export function docIcon(doc: Pick<DocRef, "kind" | "format">): Icon {
  if (doc.kind === "video" || doc.kind === "youtube") return YoutubeLogoIcon;
  if (doc.format === "pptx" || doc.format === "ppt") return PresentationChartIcon;
  if (doc.format === "docx") return FileDocIcon;
  if (doc.kind === "pdf" || doc.format === "pdf") return FilePdfIcon;
  if (doc.kind === "file") return FileTextIcon;
  return GlobeIcon;
}

async function download(doc: DocRef, content: DocContent | null) {
  if (content?.pdf_url) {
    try {
      const blob = await (await fetch(content.pdf_url)).blob();
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), {
        href: url,
        download: `${fileSafe(doc.title.replace(/\.pdf$/i, ""))}.pdf`,
      }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      window.open(content.pdf_url, "_blank", "noopener");
    }
    return;
  }
  if (content?.content_html) {
    // The original DOCX/PPTX sits in a private bucket until the backend can sign a download link, so
    // this saves the readable version.
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>body{font:18px/1.7 Georgia,serif;max-width:68ch;margin:3rem auto;padding:0 1rem;color:#111}</style></head><body><h1>${escapeHtml(doc.title)}</h1>${content.content_html}</body></html>`;
    downloadText(`${fileSafe(doc.title)}.html`, page, "text/html");
    return;
  }
  if (doc.source_url) window.open(doc.source_url, "_blank", "noopener");
  else toast.error("Nothing to download yet");
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Every source and artifact in the room, still available when the room is archived.
export function Library() {
  const { state, events, contents, setActiveDoc, primary, setOpenArtifact } = useRoom();
  const [tab, setTab] = useState<"sources" | "artifacts">("sources");

  const addedBy = (id: string) => {
    const e = events.find((ev) => ev.type === "doc.add" && ev.doc.id === id);
    return e ? { actor: e.actor, at: e.at } : null;
  };

  return (
    <div data-lenis-prevent className="h-full overflow-y-auto overscroll-contain px-4 py-4">
      <div className="relative grid grid-cols-2 rounded-full bg-foreground/5 p-1 text-[0.75rem] font-medium">
        <span
          className={cn(
            "absolute inset-y-1 w-[calc(50%-4px)] rounded-full bg-card shadow-sm ring-1 ring-(--hairline) transition-transform duration-300 ease-fluid",
            tab === "artifacts" ? "translate-x-[calc(100%+4px)]" : "translate-x-1",
          )}
        />
        {(["sources", "artifacts"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "relative h-8 rounded-full capitalize",
              tab === t ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {t === "sources" ? `Attachments · ${state.docs.length}` : `Artifacts · ${state.artifacts.length}`}
          </button>
        ))}
      </div>

      {tab === "sources" ? (
        <ul className="mt-4 space-y-2">
          {state.docs.map((d) => {
            const Icon = docIcon(d);
            const c = contents[d.id];
            const content = typeof c === "object" ? c : null;
            const by = addedBy(d.id);
            return (
              <li key={d.id} className="flex items-center gap-3 rounded-2xl bg-card/70 p-2.5 ring-1 ring-(--hairline)">
                <button
                  type="button"
                  onClick={() => setActiveDoc(d.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground/5">
                    <Icon weight="duotone" className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] font-medium">{d.title}</span>
                    {by ? (
                      <ByLine actor={by.actor} at={by.at} />
                    ) : (
                      <span className="text-[0.6875rem] text-muted-foreground">
                        {d.id === primary.id ? "Room source" : "Attached"}
                      </span>
                    )}
                  </span>
                </button>
                {d.source_url && (
                  <a
                    href={d.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open original"
                    className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
                  >
                    <ArrowSquareOutIcon className="size-4" />
                  </a>
                )}
                {d.kind !== "video" && (
                  <button
                    type="button"
                    onClick={() => void download(d, content)}
                    aria-label={`Download ${d.title}`}
                    className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
                  >
                    <DownloadSimpleIcon className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <ArtifactList artifacts={state.artifacts} onOpen={(a) => setOpenArtifact(a.id)} />
      )}
    </div>
  );
}
