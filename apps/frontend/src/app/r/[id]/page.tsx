import { Room } from "@linkroom/shared";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { RoomActivityTracker } from "@/components/room/room-activity-tracker";
import { getSupabase } from "@/lib/supabase";

// A shared room. Anyone with the link can open it without an account (rooms are public-read under RLS).
// Presence, cursors, highlights and comments build on this page in Phase 3.
export default function RoomPage({ params }: PageProps<"/r/[id]">) {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center px-5 py-5 md:px-8">
        <Logo />
      </header>
      <main className="mx-auto max-w-5xl px-5 pb-24 md:px-8">
        <Suspense fallback={<RoomSkeleton />}>{params.then(({ id }) => <RoomContent id={id} />)}</Suspense>
      </main>
    </div>
  );
}

async function loadRoom(id: string) {
  const { data, error } = await getSupabase()
    .from("rooms")
    .select("id, kind, source_url, title, content_html, pdf_path, created_by, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? Room.parse(data) : null;
}

async function RoomContent({ id }: { id: string }) {
  const room = await loadRoom(id);
  if (!room) notFound();

  const pdfUrl =
    room.kind === "pdf" && room.pdf_path
      ? getSupabase().storage.from("pdfs").getPublicUrl(room.pdf_path).data.publicUrl
      : null;

  return (
    <article className="mx-auto max-w-[68ch] pt-8 md:pt-14">
      <RoomActivityTracker roomId={id} />
      <h1 className="font-display text-[clamp(2.2rem,5vw,3.6rem)] font-normal">{room.title || "Untitled room"}</h1>
      {room.source_url && (
        <a
          href={room.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-[0.8125rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {new URL(room.source_url).hostname}
        </a>
      )}
      {pdfUrl ? (
        <iframe
          src={pdfUrl}
          title={room.title || "PDF"}
          className="mt-10 h-[80dvh] w-full rounded-2xl ring-1 ring-(--hairline)"
        />
      ) : (
        // content_html is sanitized by the backend (DOMPurify) when the room is created, and only the
        // backend can write rooms.
        <div className="reader mt-10" dangerouslySetInnerHTML={{ __html: room.content_html ?? "" }} />
      )}
    </article>
  );
}

function RoomSkeleton() {
  return (
    <div className="mx-auto max-w-[68ch] animate-pulse pt-8 md:pt-14" aria-busy="true" aria-label="Loading room">
      <div className="h-12 w-3/4 rounded-xl bg-foreground/8" />
      <div className="mt-10 space-y-4">
        {[100, 96, 92, 98, 70].map((w, i) => (
          <div key={i} className="h-4 rounded-full bg-foreground/6" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
