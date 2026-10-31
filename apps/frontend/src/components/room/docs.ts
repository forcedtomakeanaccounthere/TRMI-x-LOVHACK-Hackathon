import { Room, RoomStatus, RoomSummary } from "@linkroom/shared";
import { getSupabase } from "@/lib/supabase";
import type { Annotation, DocContent, DocRef } from "./types";

// Loads documents and their saved highlights from Supabase (public read for rooms that aren't deleted).

const COLUMNS = "id, kind, source_url, title, content_html, pdf_path, source_meta, created_by, created_at, status";

export async function loadDoc(id: string): Promise<DocContent | null> {
  const supabase = getSupabase();
  const [{ data, error }, ai] = await Promise.all([
    supabase.from("rooms").select(COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("room_ai").select("status, summary").eq("room_id", id).maybeSingle(),
  ]);
  if (error) throw error;
  if (!data) return null;
  return toContent(data, ai.data);
}

export function toContent(
  row: Record<string, unknown>,
  ai?: { status?: unknown; summary?: unknown } | null,
): DocContent {
  const room = Room.parse(row);
  const summary = RoomSummary.safeParse(ai?.summary);
  return {
    id: room.id,
    kind: room.kind,
    title: room.title?.trim() || room.source_meta?.file_name || "Untitled",
    source_url: room.source_url,
    content_html: room.content_html,
    pdf_url:
      room.kind === "pdf" && room.pdf_path
        ? getSupabase().storage.from("pdfs").getPublicUrl(room.pdf_path).data.publicUrl
        : null,
    status: RoomStatus.catch("running").parse(row.status),
    created_by: room.created_by,
    summary: summary.success ? summary.data : null,
    ai_status: typeof ai?.status === "string" ? ai.status : null,
  };
}

export function refOf(doc: DocContent): DocRef {
  return {
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    source_url: doc.source_url,
    format: null,
  };
}

// Highlights saved by the original highlight flow (or by another browser before the ledger existed),
// shown alongside the ledger's marks.
export async function loadSavedHighlights(docId: string): Promise<Annotation[]> {
  const { data, error } = await getSupabase()
    .from("highlights")
    .select("id, block_id, start_offset, end_offset, quote, author_name, author_color, created_at")
    .eq("room_id", docId);
  if (error || !data) return [];
  return data.map((h) => ({
    id: h.id as string,
    doc: docId,
    block: h.block_id as string,
    kind: "highlight" as const,
    start: h.start_offset as number,
    end: h.end_offset as number,
    quote: h.quote as string,
    color: h.author_color as string,
    author: {
      id: `name:${h.author_name}`,
      name: h.author_name as string,
      color: h.author_color as string,
    },
    at: h.created_at as string,
  }));
}

// Text highlights also go to the highlights table so the backend recap sees them. Best effort: the
// ledger already has the mark, and the insert is refused for rooms that aren't running.
export function saveHighlight(a: Extract<Annotation, { kind: "highlight" | "underline" }>) {
  void getSupabase()
    .from("highlights")
    .insert({
      id: a.id,
      room_id: a.doc,
      block_id: a.block,
      start_offset: a.start,
      end_offset: a.end,
      quote: a.quote,
      author_name: a.author.name,
      author_color: a.color,
    })
    .then(({ error }) => {
      if (error) console.warn("[room] highlight not saved to the database", error.message);
    });
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([\w-]{6,})/);
      return m?.[2] ?? null;
    }
  } catch {
    // not a URL
  }
  return null;
}

export async function youtubeTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { title?: string };
    return body.title ?? null;
  } catch {
    return null;
  }
}
