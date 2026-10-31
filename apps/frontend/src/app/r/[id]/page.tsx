import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DEMO_DOCS, DEMO_ROOM_ID } from "@/components/room/demo";
import { toContent } from "@/components/room/docs";
import { RoomWorkspace } from "@/components/room/room-workspace";
import { getSupabase } from "@/lib/supabase";

// A shared room. Anyone with the link can open it (rooms are public-read under RLS); guests join with
// a name. /r/demo needs no backend.
export default function RoomPage({ params }: PageProps<"/r/[id]">) {
  return (
    <Suspense fallback={<RoomSkeleton />}>
      {params.then(({ id }) => (
        <RoomContent id={id} />
      ))}
    </Suspense>
  );
}

export async function generateMetadata({ params }: PageProps<"/r/[id]">): Promise<Metadata> {
  const { id } = await params;
  const room = id === DEMO_ROOM_ID ? DEMO_DOCS[0] : await loadRoom(id).catch(() => null);
  return { title: room ? `${room.title} · LinkRoom` : "Room · LinkRoom" };
}

async function loadRoom(id: string) {
  const supabase = getSupabase();
  const [{ data, error }, ai] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, kind, source_url, title, content_html, pdf_path, source_meta, created_by, created_at, status")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("room_ai").select("status, summary").eq("room_id", id).maybeSingle(),
  ]);
  if (error) throw error;
  return data ? toContent(data, ai.data) : null;
}

async function RoomContent({ id }: { id: string }) {
  if (id === DEMO_ROOM_ID) return <RoomWorkspace primary={DEMO_DOCS[0]!} bundled={DEMO_DOCS} />;
  const room = await loadRoom(id);
  if (!room) notFound();
  return <RoomWorkspace primary={room} bundled={[]} />;
}

function RoomSkeleton() {
  return (
    <div className="flex h-dvh flex-col" aria-busy="true" aria-label="Loading room">
      <div className="h-16 border-b border-(--hairline)" />
      <div className="mx-auto w-full max-w-[68ch] animate-pulse px-5 pt-14">
        <div className="h-12 w-3/4 rounded-xl bg-foreground/8" />
        <div className="mt-10 space-y-4">
          {[100, 96, 92, 98, 70].map((w, i) => (
            <div key={i} className="h-4 rounded-full bg-foreground/6" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
