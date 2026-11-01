import type { AttachedSource, RoomKind } from "@linkroom/shared";
import { supabaseAdmin } from "./supabase";

// A room workspace's documents: the room itself, then the rooms attached to it (room_attachments,
// supabase/migrations/0021_room_attachments.sql) in their order. Deleted rooms drop out.

type Row = {
  source_room_id: string;
  position: number;
  added_by: string | null;
  added_by_name: string | null;
  rooms: { kind: RoomKind; title: string | null; source_url: string | null; status: string; source_meta: { format?: string } | null } | null;
};

export async function attachedSources(roomId: string): Promise<AttachedSource[]> {
  const { data, error } = await supabaseAdmin()
    .from("room_attachments")
    .select("source_room_id, position, added_by, added_by_name, rooms!room_attachments_source_fkey(kind, title, source_url, status, source_meta)")
    .eq("room_id", roomId)
    .order("position");
  if (error) throw error;
  return (data as unknown as Row[])
    .filter((row) => row.rooms && row.rooms.status !== "deleted")
    .map((row) => ({
      id: row.source_room_id,
      kind: row.rooms!.kind,
      title: row.rooms!.title ?? "Untitled",
      source_url: row.rooms!.source_url,
      format: row.rooms!.source_meta?.format ?? null,
      status: row.rooms!.status,
      position: row.position,
      added_by: row.added_by,
      added_by_name: row.added_by_name,
    }));
}

/** The room ids an AI request on `roomId` may draw on: the room and its attached sources. */
export async function roomScope(roomId: string): Promise<string[]> {
  return [roomId, ...(await attachedSources(roomId)).map((source) => source.id)];
}
