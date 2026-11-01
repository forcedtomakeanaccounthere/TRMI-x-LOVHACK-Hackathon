import {
  EmbedResponse,
  RoomSummary,
  type RoomAiStatus,
} from "@linkroom/shared";
import { HttpError } from "../middleware/error";
import { callAi } from "./ai";
import { chunkRoom, embeddingText, type Chunk } from "./chunk";
import { supabaseAdmin } from "./supabase";
import { summaryToDocHtml } from "./youtube";

// The t{n} transcript paragraphs a YouTube room was made from (room_sources, 0013).
async function transcriptHtml(roomId: string) {
  const { data, error } = await supabaseAdmin()
    .from("room_sources")
    .select("data")
    .eq("room_id", roomId)
    .single();
  if (error) throw error;
  return ((data.data as { html?: string }).html ?? "") as string;
}

// Background AI work on a room, run after the room is created without making the creator wait.
// Progress is written to room_ai, which reaches the room's page over Realtime.

export const EMBED_BATCH = 64; // chunks per POST /embed
export const EMBED_CONCURRENCY = 4; // POST /embed requests in flight at once for one room
const EMBED_TIMEOUT_MS = 60_000; // per batch; apps/ai gives the provider 30 s
const INSERT_BATCH = 100; // chunks per insert, so one request stays well under PostgREST's limits
// apps/ai gives a summary 540 s in all (map calls, then the reduce call), so it answers first.
const SUMMARY_TIMEOUT_MS = 600_000;
// SummaryChunk.heading_path in apps/ai/app/schemas.py: at most 10 headings of 500 characters.
const MAX_SUMMARY_HEADINGS = 10;
const MAX_SUMMARY_HEADING_CHARS = 500;

// One indexing run per room at a time in this process.
const running = new Set<string>();

/** Starts indexing a new room in the background. Never throws: a failure is saved in room_ai. */
export function startIndexing(roomId: string) {
  void indexRoom(roomId).catch((err: unknown) => markFailed(roomId, err));
}

type IndexResult = { chunks: number; embedded: boolean; summarized: boolean };

/**
 * Splits the room into chunks, embeds them in batches of EMBED_BATCH and saves them, replacing any
 * chunks the room had, then writes the detailed summary from them. When embeddings are unavailable
 * the chunks are saved without them and the room is still searchable by keyword.
 * room_ai.status goes "indexing", then "summarizing", then "ready" with the summary.
 */
export async function indexRoom(roomId: string): Promise<IndexResult> {
  if (running.has(roomId))
    return { chunks: 0, embedded: false, summarized: false };
  running.add(roomId);
  try {
    const db = supabaseAdmin();
    await saveState(roomId, "indexing");

    const { data: room, error } = await db
      .from("rooms")
      .select("kind, title, content_html, content_text")
      .eq("id", roomId)
      .single();
    if (error) throw error;

    // A YouTube room is chunked from its transcript, which keeps the times, not from the doc it shows.
    const chunks = chunkRoom(
      room.kind === "youtube"
        ? { ...room, content_html: await transcriptHtml(roomId) }
        : room,
    );
    const embeddings = chunks.length ? await embedChunks(roomId, chunks) : null;

    const { error: deleteError } = await db
      .from("chunks")
      .delete()
      .eq("room_id", roomId);
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

    if (!chunks.length) {
      await saveState(roomId, "ready", { summary: null });
      return { chunks: 0, embedded: false, summarized: false };
    }

    await saveState(roomId, "summarizing");
    const summarized = await summarizeRoom(
      roomId,
      (room.title as string | null) ?? "",
      chunks,
      room.kind as string,
    );
    return { chunks: chunks.length, embedded: Boolean(embeddings), summarized };
  } finally {
    running.delete(roomId);
  }
}

/**
 * Asks apps/ai for the detailed summary and saves it with status "ready". The chunks are already
 * saved, so a summary that can't be made doesn't fail the room: it is "ready" (searchable, Q&A
 * works) with no summary and the reason in room_ai.error. Returns whether a summary was saved.
 */
export async function summarizeRoom(
  roomId: string,
  title: string,
  chunks: Chunk[],
  kind = "link",
) {
  let summary: RoomSummary;
  try {
    summary = await callAi(
      "/summary",
      {
        title: title.slice(0, 300),
        chunks: chunks.map(({ block_ids, content, heading_path, page }) => ({
          block_ids,
          content,
          // Headings are context for the model, so a very long one is cut to what apps/ai accepts.
          heading_path: heading_path
            .slice(0, MAX_SUMMARY_HEADINGS)
            .map((h) => h.slice(0, MAX_SUMMARY_HEADING_CHARS)),
          page,
        })),
      },
      RoomSummary,
      SUMMARY_TIMEOUT_MS,
    );
  } catch (err) {
    console.warn(`[ai-jobs] no summary for room ${roomId}:`, errorMessage(err));
    const reason =
      err instanceof HttpError ? err.message : "Something went wrong.";
    await saveState(roomId, "ready", {
      summary: null,
      error: `The summary couldn't be made. ${reason}`,
    });
    return false;
  }
  // A video room reads as the detailed doc written from its transcript. Saved before "ready", so the
  // page that reloads on that Realtime event gets the doc.
  if (kind === "youtube") {
    const { error } = await supabaseAdmin()
      .from("rooms")
      .update({ content_html: summaryToDocHtml(summary) })
      .eq("id", roomId);
    if (error) throw error;
  }
  await saveState(roomId, "ready", { summary });
  return true;
}

/**
 * Embeds every chunk with one model, or returns null when that can't be done: no fallback model,
 * since vectors from different models can't be compared, and keyword search still works.
 */
async function embedChunks(roomId: string, chunks: Chunk[]) {
  try {
    const batches: Chunk[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH)
      batches.push(chunks.slice(i, i + EMBED_BATCH));
    const results: { model: string; vectors: number[][] }[] = new Array(
      batches.length,
    );
    // A few batches in flight at once: a long document no longer waits on each batch in turn.
    let next = 0;
    let failed = false;
    const worker = async () => {
      while (!failed && next < batches.length) {
        const n = next++;
        const batch = batches[n]!;
        try {
          const res = await callAi(
            "/embed",
            { texts: batch.map(embeddingText), input_type: "passage" },
            EmbedResponse,
            EMBED_TIMEOUT_MS,
          );
          if (res.vectors.length !== batch.length)
            throw new Error(
              `got ${res.vectors.length} vectors for ${batch.length}`,
            );
          results[n] = res;
        } catch (err) {
          failed = true; // the other workers stop sending: these vectors would be thrown away
          throw err;
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(EMBED_CONCURRENCY, batches.length) },
        worker,
      ),
    );
    const model = results[0]!.model;
    const changed = results.find((r) => r.model !== model);
    if (changed)
      throw new Error(`model changed from ${model} to ${changed.model}`);
    return { model, vectors: results.flatMap((r) => r.vectors) };
  } catch (err) {
    console.warn(
      `[ai-jobs] no embeddings for room ${roomId}, keyword search only:`,
      errorMessage(err),
    );
    return null;
  }
}

// Waiting rooms read per query while resuming.
export const RESUME_BATCH = 100;

// A room left in any of these by a restart is indexed again from the start.
const WAITING: RoomAiStatus[] = ["pending", "indexing", "summarizing"];

/**
 * Indexes every room left "pending" or "indexing": rooms whose job was lost to a restart, and rooms
 * made before indexing existed. Call once at startup. Reads the waiting rooms a batch at a time
 * until none are left, and indexes them one at a time, so a backlog doesn't flood the embedding
 * provider. Deleted rooms are skipped: restoring one starts its indexing (startIndexingIfWaiting).
 * Assumes one backend instance: another one's running jobs would look interrupted here.
 */
export async function resumeIndexing(): Promise<number> {
  let resumed = 0;
  // Paged by room id: it never repeats or skips a room, even when a room's job leaves it waiting
  // (it was already running) or many rooms were queued at the same moment.
  let after = "";
  for (;;) {
    const { data, error } = await supabaseAdmin()
      .from("room_ai")
      .select("room_id, rooms!inner(status)")
      .in("status", WAITING)
      .neq("rooms.status", "deleted")
      .gt("room_id", after)
      .order("room_id")
      .limit(RESUME_BATCH);
    if (error) throw error;

    const rooms = (data as { room_id: string }[]).map((row) => row.room_id);
    if (!rooms.length) break;
    if (!resumed)
      console.log("[ai-jobs] resuming indexing for rooms left waiting");
    for (const roomId of rooms) {
      await indexRoom(roomId).catch((err: unknown) => markFailed(roomId, err));
    }
    resumed += rooms.length;
    after = rooms.at(-1)!;
  }
  if (resumed) console.log(`[ai-jobs] resumed indexing for ${resumed} room(s)`);
  return resumed;
}

// A waiting room whose row hasn't changed for this long has lost its job (a crash, a dropped
// promise) and is started again. "summarizing" gets longer: apps/ai may take 540 s on a summary.
export const STALE_WAITING_MS = 3 * 60_000;
export const STALE_SUMMARIZING_MS = 12 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Restarts rooms stuck "pending", "indexing" or "summarizing" with no job running here, so a lost
 * job doesn't leave a room waiting until the next restart. Returns how many were restarted.
 */
export async function restartStuckIndexing(now = Date.now()): Promise<number> {
  const waitingBefore = new Date(now - STALE_WAITING_MS).toISOString();
  const summarizingBefore = new Date(now - STALE_SUMMARIZING_MS).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("room_ai")
    .select("room_id, status, updated_at, rooms!inner(status)")
    .in("status", WAITING)
    .neq("rooms.status", "deleted")
    .lt("updated_at", waitingBefore)
    .limit(RESUME_BATCH);
  if (error) throw error;
  const stuck = (
    data as { room_id: string; status: string; updated_at: string }[]
  ).filter(
    (row) =>
      !running.has(row.room_id) &&
      (row.status !== "summarizing" || row.updated_at < summarizingBefore),
  );
  for (const { room_id } of stuck) {
    console.warn(
      `[ai-jobs] room ${room_id} was left waiting, indexing it again`,
    );
    await indexRoom(room_id).catch((err: unknown) => markFailed(room_id, err));
  }
  return stuck.length;
}

/** Checks for stuck rooms every minute. Call once at startup, after resumeIndexing. */
export function startIndexingSweep() {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    restartStuckIndexing()
      .catch((err: unknown) =>
        console.error("[ai-jobs] could not check for stuck rooms:", err),
      )
      .finally(() => {
        busy = false;
      });
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

/**
 * Starts indexing a room in the background if it is still waiting ("pending" or "indexing"), as a
 * restored room may be: startup skips deleted rooms. Never throws.
 */
export function startIndexingIfWaiting(roomId: string) {
  void (async () => {
    const { data, error } = await supabaseAdmin()
      .from("room_ai")
      .select("status")
      .eq("room_id", roomId)
      .maybeSingle();
    if (error) throw error;
    if (data && WAITING.includes(data.status as RoomAiStatus))
      await indexRoom(roomId);
  })().catch((err: unknown) => markFailed(roomId, err));
}

/** Records a failed run in room_ai. Never throws, since it runs where nobody is waiting. */
export async function markFailed(roomId: string, err: unknown) {
  console.error(`[ai-jobs] indexing room ${roomId} failed:`, err);
  try {
    // A short reason for the room's page; details stay in the log.
    await saveState(roomId, "failed", {
      error: err instanceof HttpError ? err.message : "Indexing failed",
    });
  } catch (saveError) {
    console.error(
      `[ai-jobs] could not record the failure for room ${roomId}:`,
      saveError,
    );
  }
}

// Writes the room's AI state. The error is cleared unless given; the summary changes only when given.
async function saveState(
  roomId: string,
  status: RoomAiStatus,
  {
    error = null,
    summary,
  }: { error?: string | null; summary?: RoomSummary | null } = {},
) {
  const row = {
    room_id: roomId,
    status,
    error: error?.slice(0, 500) ?? null,
    ...(summary !== undefined && { summary }),
  };
  const { error: dbError } = await supabaseAdmin()
    .from("room_ai")
    .upsert(row, { onConflict: "room_id" });
  if (dbError) throw dbError;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
