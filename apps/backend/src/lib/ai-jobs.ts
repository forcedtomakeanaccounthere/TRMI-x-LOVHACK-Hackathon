import { EmbedResponse, type RoomAiStatus } from "@linkroom/shared";
import { HttpError } from "../middleware/error";
import { callAi } from "./ai";
import { chunkRoom, embeddingText, type Chunk } from "./chunk";
import { supabaseAdmin } from "./supabase";

// Background AI work on a room, run after the room is created without making the creator wait.
// Progress is written to room_ai, which reaches the room's page over Realtime.

export const EMBED_BATCH = 64; // chunks per POST /embed
const EMBED_TIMEOUT_MS = 60_000; // per batch; apps/ai gives the provider 30 s
const INSERT_BATCH = 100; // chunks per insert, so one request stays well under PostgREST's limits

// One indexing run per room at a time in this process.
const running = new Set<string>();

/** Starts indexing a new room in the background. Never throws: a failure is saved in room_ai. */
export function startIndexing(roomId: string) {
  void indexRoom(roomId).catch((err: unknown) => markFailed(roomId, err));
}

/**
 * Splits the room into chunks, embeds them in batches of EMBED_BATCH and saves them, replacing any
 * chunks the room had. When embeddings are unavailable the chunks are saved without them and the
 * room is still searchable by keyword. Sets room_ai.status to "indexing", then "ready".
 */
export async function indexRoom(roomId: string): Promise<{ chunks: number; embedded: boolean }> {
  if (running.has(roomId)) return { chunks: 0, embedded: false };
  running.add(roomId);
  try {
    const db = supabaseAdmin();
    await saveState(roomId, "indexing");

    const { data: room, error } = await db
      .from("rooms")
      .select("kind, content_html, content_text")
      .eq("id", roomId)
      .single();
    if (error) throw error;

    const chunks = chunkRoom(room);
    const embeddings = chunks.length ? await embedChunks(roomId, chunks) : null;

    const { error: deleteError } = await db.from("chunks").delete().eq("room_id", roomId);
    if (deleteError) throw deleteError;
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const rows = chunks.slice(i, i + INSERT_BATCH).map((chunk) => ({
        room_id: roomId,
        ...chunk,
        embedding: embeddings?.vectors[chunk.idx] ?? null,
        embedding_model: embeddings?.model ?? null,
      }));
      const { error: insertError } = await db.from("chunks").insert(rows);
      if (insertError) throw insertError;
    }

    // AI step 6 runs the detailed summary from here and sets "ready" when it is saved.
    await saveState(roomId, "ready");
    return { chunks: chunks.length, embedded: Boolean(embeddings) };
  } finally {
    running.delete(roomId);
  }
}

/**
 * Embeds every chunk with one model, or returns null when that can't be done: no fallback model,
 * since vectors from different models can't be compared, and keyword search still works.
 */
async function embedChunks(roomId: string, chunks: Chunk[]) {
  try {
    const vectors: number[][] = [];
    let model: string | null = null;
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const res = await callAi(
        "/embed",
        { texts: batch.map(embeddingText), input_type: "passage" },
        EmbedResponse,
        EMBED_TIMEOUT_MS,
      );
      if (res.vectors.length !== batch.length) throw new Error(`got ${res.vectors.length} vectors for ${batch.length}`);
      if (model && res.model !== model) throw new Error(`model changed from ${model} to ${res.model}`);
      model = res.model;
      vectors.push(...res.vectors);
    }
    return { model: model!, vectors };
  } catch (err) {
    console.warn(`[ai-jobs] no embeddings for room ${roomId}, keyword search only:`, errorMessage(err));
    return null;
  }
}

/** Records a failed run in room_ai. Never throws, since it runs where nobody is waiting. */
export async function markFailed(roomId: string, err: unknown) {
  console.error(`[ai-jobs] indexing room ${roomId} failed:`, err);
  try {
    // A short reason for the room's page; details stay in the log.
    await saveState(roomId, "failed", err instanceof HttpError ? err.message : "Indexing failed");
  } catch (saveError) {
    console.error(`[ai-jobs] could not record the failure for room ${roomId}:`, saveError);
  }
}

async function saveState(roomId: string, status: RoomAiStatus, error: string | null = null) {
  const { error: dbError } = await supabaseAdmin()
    .from("room_ai")
    .upsert({ room_id: roomId, status, error: error?.slice(0, 500) ?? null }, { onConflict: "room_id" });
  if (dbError) throw dbError;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
