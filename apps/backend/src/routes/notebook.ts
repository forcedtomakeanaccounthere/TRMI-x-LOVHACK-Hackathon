import { NotebookUpdateRequest, type NotebookResponse } from "@linkroom/shared";
import type { Router } from "express";
import rateLimit from "express-rate-limit";
import * as Y from "yjs";
import { env } from "../env";
import { assertParticipant, assertReader, can, roomAccess } from "../lib/ledger";
import { supabaseAdmin } from "../lib/supabase";
import { optionalAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

// The shared notebook (supabase/migrations/0024_room_notebooks.sql). Browsers edit a Yjs document
// together over Realtime and send their edits here; this keeps the merged document, so the notebook
// survives when everyone leaves and a newcomer can load it. Registered on the rooms router.

// The whole document is capped by the column; one update by NotebookUpdateRequest.
const MAX_STATE_CHARS = 4_000_000;
const MERGE_ATTEMPTS = 5;

// The browser sends a batch every second or so while someone types, so this matches the ledger's limit.
const notebookPerIp = rateLimit({
  windowMs: 60_000,
  limit: env.LEDGER_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many notebook changes at once. Try again in a minute." },
});

const toBytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const toB64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** Throws 400 unless `bytes` is a Yjs update this server can read. */
function assertUpdate(bytes: Uint8Array) {
  try {
    Y.applyUpdate(new Y.Doc(), bytes);
  } catch {
    throw new HttpError(400, "That isn't a notebook change");
  }
}

export function notebookRoutes(router: Router) {
  // GET /api/rooms/:id/notebook → { state: base64 | null }: the whole notebook, or null when empty.
  router.get("/:id/notebook", optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    assertReader(await roomAccess(id, req));
    const { data, error } = await supabaseAdmin().from("room_notebooks").select("state").eq("room_id", id).maybeSingle();
    if (error) throw error;
    res.json({ state: (data?.state as string | undefined) ?? null } satisfies NotebookResponse);
  });

  // POST /api/rooms/:id/notebook  { update: base64 }: merges a Yjs update into the saved notebook.
  // Updates commute, so the order they arrive in doesn't matter and a repeated one changes nothing.
  router.post("/:id/notebook", notebookPerIp, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const { update } = NotebookUpdateRequest.parse(req.body ?? {});
    const access = await roomAccess(id, req);
    assertParticipant(access);
    if (access.status !== "running") throw new HttpError(409, "This room is read only");
    if (!can.annotate(access.role)) throw new HttpError(403, "Your role can't write in the notebook");
    const incoming = toBytes(update);
    assertUpdate(incoming);

    const db = supabaseAdmin();
    for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt++) {
      const { data: row, error } = await db.from("room_notebooks").select("state, version").eq("room_id", id).maybeSingle();
      if (error) throw error;
      const merged = toB64(row ? Y.mergeUpdates([toBytes(row.state as string), incoming]) : incoming);
      if (merged.length > MAX_STATE_CHARS) throw new HttpError(413, "The notebook is full");

      if (!row) {
        const { error: insertError } = await db.from("room_notebooks").insert({ room_id: id, state: merged });
        if (!insertError) return void res.status(204).end();
        if (insertError.code !== "23505") throw insertError; // someone else created it first: merge again
        continue;
      }
      const { data: written, error: updateError } = await db
        .from("room_notebooks")
        .update({ state: merged, version: (row.version as number) + 1, updated_at: new Date().toISOString() })
        .eq("room_id", id)
        .eq("version", row.version)
        .select("room_id");
      if (updateError) throw updateError;
      if (written?.length) return void res.status(204).end();
      // Another write landed since the read: merge with it and try again.
    }
    throw new HttpError(409, "The notebook is busy. Try again in a moment.");
  });
}
