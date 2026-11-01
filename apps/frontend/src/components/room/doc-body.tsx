"use client";

import { FilmStripIcon, SparkleIcon } from "@phosphor-icons/react";
import { memo, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { getFreshSession } from "@/lib/session";
import { Spinner } from "./bits";
import { youtubeId } from "./docs";
import { useRoom } from "./store";
import type { DocContent, DocRef } from "./types";

// Extracted HTML, sanitized by the backend (DOMPurify) when the room was created; only the backend can
// write rooms. Memoised so React never rewrites the DOM that marks and anchors measure.
export const HtmlBody = memo(function HtmlBody({ html, onReady }: { html: string; onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [html, onReady]);
  return <div className="reader room-reader" dangerouslySetInnerHTML={{ __html: html }} />;
});

// An attached video that hasn't become a transcript yet: watch it here, then process it so the
// group can highlight and ask about what was said.
export function VideoBody({ doc }: { doc: DocRef }) {
  const { actions, perms } = useRoom();
  const [busy, setBusy] = useState(false);
  const id = doc.source_url ? youtubeId(doc.source_url) : null;

  const process = async () => {
    const session = await getFreshSession();
    if (!session) {
      toast.error("Sign in to process videos");
      return;
    }
    setBusy(true);
    try {
      const { id: roomId } = await api.createYoutubeRoom(doc.source_url!, session.access_token);
      actions.addDoc({
        id: roomId,
        kind: "youtube",
        title: doc.title,
        source_url: doc.source_url,
        format: null,
      });
      toast.success("Transcript ready");
    } catch (err) {
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
            onClick={process}
            disabled={busy}
            className="flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[0.8125rem] font-medium text-pearl active:scale-[0.98] disabled:opacity-60 dark:bg-azure"
          >
            {busy ? <Spinner /> : <SparkleIcon weight="fill" className="size-4" />}
            Process into document
          </button>
        </div>
      )}
    </div>
  );
}

export function isReadable(doc: DocContent) {
  return !!doc.content_html || !!doc.pdf_url;
}
