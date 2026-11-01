import { htmlToText } from "./extract";
import type { supabaseAdmin } from "./supabase";

// The text of the rooms a study set or a Studio artifact is made from, as apps/ai /study takes it.

// apps/ai's request limit per document (MAX_TEXT_CHARS in apps/ai/app/schemas.py), shared across
// the documents so the request stays bounded. apps/ai cuts further to what the model reads.
export const MAX_STUDY_TEXT_CHARS = 1_000_000;

type Db = ReturnType<typeof supabaseAdmin>;
type RoomText = { id: string; title: string | null; content_html: string | null; content_text: string | null };
export type StudyDocument = { id: string; title: string; text: string };

/**
 * Cuts texts to `total` characters in all, fairly: short texts keep everything and what they don't
 * use goes to the longer ones, so one long PDF isn't cut while there is room. Same rule as
 * share_budget in apps/ai/app/services/study.py.
 */
export function shareBudget(texts: string[], total: number): string[] {
  const budget = texts.map(() => 0);
  let remaining = total;
  const order = texts.map((_, i) => i).sort((a, b) => texts[a]!.length - texts[b]!.length);
  order.forEach((i, n) => {
    budget[i] = Math.min(texts[i]!.length, Math.floor(remaining / (order.length - n)));
    remaining -= budget[i]!;
  });
  return texts.map((text, i) => text.slice(0, budget[i]));
}

/**
 * The rooms' titles and text, in the order of `roomIds`, cut to share MAX_STUDY_TEXT_CHARS fairly.
 * Rooms with no text (or missing) are left out.
 */
export async function loadStudyDocuments(db: Db, roomIds: string[]): Promise<StudyDocument[]> {
  const { data, error } = await db.from("rooms").select("id, title, content_html, content_text").in("id", roomIds);
  if (error) throw error;
  const byId = new Map((data as RoomText[]).map((room) => [room.id, room]));
  const rooms = roomIds
    .map((id) => byId.get(id))
    .filter((room): room is RoomText => Boolean(room))
    .map((room) => ({
      id: room.id,
      title: (room.title ?? "Untitled").slice(0, 300),
      // PDF rooms have no HTML: their text was extracted on upload.
      text: (room.content_text ?? htmlToText(room.content_html ?? "")).trim(),
    }))
    .filter((doc) => doc.text.length > 0);
  const texts = shareBudget(
    rooms.map((doc) => doc.text),
    MAX_STUDY_TEXT_CHARS,
  );
  return rooms.map((doc, i) => ({ ...doc, text: texts[i]! }));
}
