import {
  CreateStudyRequest,
  MAX_STUDY_DOCUMENTS,
  StudyData,
  StudySourcesQuery,
  type RoomKind,
  type StudySet,
  type StudySetsResponse,
  type StudySource,
  type StudySourcesResponse,
} from "@linkroom/shared";
import { Router } from "express";
import { z } from "zod";
import { callAi } from "../lib/ai";
import { htmlToText } from "../lib/extract";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { MAX_PARTICIPATION } from "./rooms";

// Study tools: a quiz, flashcards, a mind map or an infographic made by the AI from the documents
// (rooms) a user picks: all of them, all in one project, or a hand-picked list.
export const studyRouter = Router();

// apps/ai's request limit per document (MAX_TEXT_CHARS in apps/ai/app/schemas.py), shared across
// the documents so the request stays bounded. apps/ai cuts further to what the model reads.
const MAX_STUDY_TEXT_CHARS = 1_000_000;
// One study set per user at a time, and a short pause between them, so a burst of clicks costs one
// AI call. In-process like the recap lock: right for one backend instance.
const STUDY_COOLDOWN_MS = 10_000;
const studyInFlight = new Set<string>();

const SET_COLUMNS = "id, kind, title, room_ids, focus, created_at";
const studySetId = z.object({ id: z.string().uuid() });

type Db = ReturnType<typeof supabaseAdmin>;
type RoomRow = {
  id: string;
  kind: RoomKind;
  title: string | null;
  created_by: string | null;
  last_activity_at: string;
};
type RoomText = { id: string; title: string | null; content_html: string | null; content_text: string | null };

// Rooms the user created or joined, newest activity first. Deleted rooms are never offered.
// With a group, only that project's rooms, which are always the owner's own.
async function accessibleRooms(db: Db, userId: string, groupId?: string): Promise<StudySource[]> {
  let query;
  if (groupId) {
    const { data: group, error } = await db
      .from("room_groups")
      .select("id")
      .eq("id", groupId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!group) throw new HttpError(404, "Group not found");
    query = db
      .from("rooms")
      .select("id, kind, title, created_by, last_activity_at, room_group_items!inner(group_id)")
      .eq("room_group_items.group_id", groupId)
      .eq("created_by", userId);
  } else {
    const joined = await db
      .from("room_participants")
      .select("room_id")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false })
      .limit(MAX_PARTICIPATION);
    if (joined.error) throw joined.error;
    const ids = joined.data.map((row) => `"${row.room_id as string}"`);
    query = db.from("rooms").select("id, kind, title, created_by, last_activity_at");
    query = ids.length ? query.or(`created_by.eq.${userId},id.in.(${ids.join(",")})`) : query.eq("created_by", userId);
  }

  const { data, error } = await query.neq("status", "deleted").order("last_activity_at", { ascending: false }).order("id");
  if (error) throw error;
  return (data as unknown as RoomRow[]).map((room) => ({
    id: room.id,
    kind: room.kind,
    title: room.title,
    role: room.created_by === userId ? "owner" : "member",
    last_activity_at: room.last_activity_at,
  }));
}

// The hand-picked rooms, each checked: it exists, isn't deleted, and the user owns or joined it.
async function pickedRooms(db: Db, userId: string, roomIds: string[]) {
  const ids = [...new Set(roomIds)];
  const [rooms, joined] = await Promise.all([
    db.from("rooms").select("id, created_by, status").in("id", ids),
    db.from("room_participants").select("room_id").eq("user_id", userId).in("room_id", ids),
  ]);
  if (rooms.error) throw rooms.error;
  if (joined.error) throw joined.error;

  const member = new Set(joined.data.map((row) => row.room_id as string));
  const allowed = new Set(
    (rooms.data as { id: string; created_by: string | null; status: string }[])
      .filter((room) => room.status !== "deleted" && (room.created_by === userId || member.has(room.id)))
      .map((room) => room.id),
  );
  // Someone else's room looks the same as a missing one.
  if (ids.some((id) => !allowed.has(id))) throw new HttpError(404, "Some of the chosen documents weren't found");
  return ids;
}

// GET /api/study/sources?group_id=: the documents the user can build a study set from.
studyRouter.get("/sources", requireAuth, async (req, res) => {
  const { group_id } = StudySourcesQuery.parse(req.query);
  const sources = await accessibleRooms(supabaseAdmin(), req.user!.id, group_id);
  res.json({ sources } satisfies StudySourcesResponse);
});

// POST /api/study  { kind, all | room_ids, group_id?, count?, focus? }
studyRouter.post("/", requireAuth, async (req, res) => {
  const body = CreateStudyRequest.parse(req.body);
  const userId = req.user!.id;

  if (studyInFlight.has(userId)) throw new HttpError(409, "A study set is already being made. Give it a moment.");
  studyInFlight.add(userId);
  try {
    const db = supabaseAdmin();

    const last = await db
      .from("study_sets")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last.error) throw last.error;
    const waitMs = last.data ? STUDY_COOLDOWN_MS - (Date.now() - Date.parse(last.data.created_at as string)) : 0;
    if (waitMs > 0) {
      const seconds = Math.ceil(waitMs / 1000);
      res.set("Retry-After", String(seconds));
      throw new HttpError(429, `You just made a study set. Try again in ${seconds} s.`);
    }

    // "Select all" takes the most recently active documents, up to the limit.
    const roomIds = body.all
      ? (await accessibleRooms(db, userId, body.group_id)).slice(0, MAX_STUDY_DOCUMENTS).map((room) => room.id)
      : await pickedRooms(db, userId, body.room_ids!);
    if (!roomIds.length) throw new HttpError(422, "There are no documents to study yet. Create a room first.");

    const { data, error } = await db.from("rooms").select("id, title, content_html, content_text").in("id", roomIds);
    if (error) throw error;
    const byId = new Map((data as RoomText[]).map((room) => [room.id, room]));
    const perDocument = Math.floor(MAX_STUDY_TEXT_CHARS / roomIds.length);
    const documents = roomIds
      .map((id) => byId.get(id))
      .filter((room): room is RoomText => Boolean(room))
      .map((room) => ({
        id: room.id,
        title: (room.title ?? "Untitled").slice(0, 300),
        // PDF rooms have no HTML: their text was extracted on upload.
        text: (room.content_text ?? htmlToText(room.content_html ?? "")).trim().slice(0, perDocument),
      }))
      .filter((doc) => doc.text.length > 0);
    if (!documents.length) throw new HttpError(422, "The chosen documents have no text to study.");

    // apps/ai stops trying providers after 100 s, so it answers before this gives up.
    const study = await callAi(
      "/study",
      { kind: body.kind, documents, count: body.count ?? 10, focus: body.focus || null },
      StudyData,
      120_000,
    );
    if (study.kind !== body.kind) throw new HttpError(502, "The AI couldn't answer right now. Try again in a moment.");

    const usedIds = documents.map((doc) => doc.id);
    const { data: saved, error: saveError } = await db
      .from("study_sets")
      .insert({
        user_id: userId,
        kind: body.kind,
        title: study.title.slice(0, 200) || "Study set",
        room_ids: usedIds,
        focus: body.focus || null,
        data: study,
      })
      .select(SET_COLUMNS)
      .single();
    if (saveError) throw saveError;

    res.status(201).json({ ...(saved as Omit<StudySet, "data">), data: study } satisfies StudySet);
  } finally {
    studyInFlight.delete(userId);
  }
});

// GET /api/study: the user's study sets, newest first (without their content).
studyRouter.get("/", requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin()
    .from("study_sets")
    .select(SET_COLUMNS)
    .eq("user_id", req.user!.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  res.json({ sets: data } as StudySetsResponse);
});

// GET /api/study/:id
studyRouter.get("/:id", requireAuth, async (req, res) => {
  const { id } = studySetId.parse(req.params);
  const { data, error } = await supabaseAdmin()
    .from("study_sets")
    .select(`${SET_COLUMNS}, data`)
    .eq("id", id)
    .eq("user_id", req.user!.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Study set not found");
  res.json(data as StudySet);
});

// DELETE /api/study/:id
studyRouter.delete("/:id", requireAuth, async (req, res) => {
  const { id } = studySetId.parse(req.params);
  const { data, error } = await supabaseAdmin()
    .from("study_sets")
    .delete()
    .eq("id", id)
    .eq("user_id", req.user!.id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Study set not found");
  res.status(204).end();
});
