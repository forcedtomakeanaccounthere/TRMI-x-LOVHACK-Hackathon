import { ArtifactRequest, RoomSummary, StudyData, type ArtifactBody } from "@linkroom/shared";
import type { RequestHandler, Router } from "express";
import { callAi } from "../lib/ai";
import { studyToArtifact, summariesToArtifact } from "../lib/artifacts";
import { assertParticipant, can, roomAccess } from "../lib/ledger";
import { roomScope } from "../lib/sources";
import { loadStudyDocuments } from "../lib/study-docs";
import { supabaseAdmin } from "../lib/supabase";
import { optionalAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

// Studio: a summary, quiz, flashcards, mind map or infographic from a room's documents. Registered on
// the rooms router, behind the same rate limits as Ask since most cost an AI call.

const ARTIFACT_ITEMS = 8; // questions, cards, ... asked of apps/ai
const STUDY_TIMEOUT_MS = 120_000; // apps/ai stops trying providers after 100 s

// One artifact per room at a time: a burst of clicks costs one AI call. In-process, like the recap lock.
const inFlight = new Set<string>();

export function artifactsRoutes(router: Router, limits: RequestHandler[]) {
  // POST /api/rooms/:id/artifacts  { kind, sources } → ArtifactBody. The room workspace keeps the
  // result as an artifact.add ledger event.
  router.post("/:id/artifacts", ...limits, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const { kind, sources } = ArtifactRequest.parse(req.body ?? {});
    const access = await roomAccess(id, req);
    assertParticipant(access);
    if (access.status !== "running") throw new HttpError(409, "This room is read only");
    if (!can.generate(access.role)) throw new HttpError(403, "Your role can't make artifacts");

    const scope = new Set(await roomScope(id));
    const roomIds = [...new Set(sources)];
    if (roomIds.some((source) => !scope.has(source))) throw new HttpError(404, "Some of the chosen sources aren't in this room");

    if (inFlight.has(id)) throw new HttpError(409, "Something is already being made in this room. Give it a moment.");
    inFlight.add(id);
    try {
      const db = supabaseAdmin();
      let body: ArtifactBody;
      if (kind === "summary") {
        // Made from the summaries written when each room was indexed: no AI call.
        const [rooms, ai] = await Promise.all([
          db.from("rooms").select("id, title").in("id", roomIds),
          db.from("room_ai").select("room_id, summary").in("room_id", roomIds),
        ]);
        if (rooms.error) throw rooms.error;
        if (ai.error) throw ai.error;
        const titles = new Map((rooms.data as { id: string; title: string | null }[]).map((r) => [r.id, r.title ?? "Untitled"]));
        const summaries = new Map(
          (ai.data as { room_id: string; summary: unknown }[]).flatMap((row) => {
            const parsed = RoomSummary.safeParse(row.summary);
            return parsed.success ? [[row.room_id, parsed.data] as const] : [];
          }),
        );
        const ready = roomIds.flatMap((rid) => (summaries.has(rid) ? [{ title: titles.get(rid) ?? "Untitled", summary: summaries.get(rid)! }] : []));
        if (!ready.length) throw new HttpError(409, "The AI is still reading these sources. Try the summary again in a moment.");
        body = summariesToArtifact(ready);
      } else {
        const documents = await loadStudyDocuments(db, roomIds);
        if (!documents.length) throw new HttpError(422, "The chosen sources have no text yet.");
        const study = await callAi("/study", { kind, documents, count: ARTIFACT_ITEMS, focus: null }, StudyData, STUDY_TIMEOUT_MS);
        if (study.kind !== kind) throw new HttpError(502, "The AI couldn't answer right now. Try again in a moment.");
        body = studyToArtifact(study);
      }

      // A history row is nice to have but never worth failing the artifact for.
      const { error: historyError } = await db
        .from("ai_queries")
        .insert({ room_id: id, user_id: req.user?.id ?? null, kind: "artifact", prompt: kind, response: body });
      if (historyError) console.error("[rooms] could not record the artifact", historyError);

      res.json(body);
    } finally {
      inFlight.delete(id);
    }
  });
}
