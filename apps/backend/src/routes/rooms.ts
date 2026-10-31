import {
  AnswerResponse,
  AskRequest,
  CreateInviteRequest,
  EmbedResponse,
  NOT_IN_DOCUMENT,
  type AiCitation,
  type AiMessage,
  CreateLinkRoomRequest,
  CreateTextRoomRequest,
  DashboardQuery,
  RecapData,
  RecapRequest,
  RoomDetail,
  UpdateRoomRequest,
  type SourceMeta,
  type CreateRoomResponse,
  type DashboardResponse,
  type DashboardRoom,
  type RoomStatusResponse,
  type TopMember,
  type TopMembersResponse,
} from "@linkroom/shared";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { nanoid } from "nanoid";
import { callAi } from "../lib/ai";
import { startIndexing, startIndexingIfWaiting } from "../lib/ai-jobs";
import { blockFor, inviteViews, likePattern, participantBlocks } from "../lib/dashboard";
import { extractArticle, htmlToText, textToHtml } from "../lib/extract";
import { CONTENT_TYPES, parseFile } from "../lib/files";
import { extractPdfText, isPdf, MAX_PDF_BYTES } from "../lib/pdf";
import { supabaseAdmin } from "../lib/supabase";
import { optionalAuth, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { env } from "../env";

export const roomsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
  // Browsers send file names as raw UTF-8; multer's latin1 default garbles names like "résumé.pdf".
  defParamCharset: "utf8",
});

// Creating a room needs a verified account; joining and reading a room stays open to guests.

// POST /api/rooms/link  { url }
roomsRouter.post("/link", requireAuth, async (req, res) => {
  const { url } = CreateLinkRoomRequest.parse(req.body);
  // source_url is where redirects ended up, so "open original" lands on the real page.
  const article = await extractArticle(url);
  const id = nanoid(8);

  const { error } = await supabaseAdmin().from("rooms").insert({
    id,
    kind: "link",
    source_url: article.url,
    title: article.title,
    content_html: article.html,
    created_by: req.user!.id,
  });
  if (error) throw error;

  startIndexing(id); // chunks and embeddings, in the background
  res.status(201).json({ id } satisfies CreateRoomResponse);
});

// POST /api/rooms/text  { title?, text }: fallback when a site can't be read
roomsRouter.post("/text", requireAuth, async (req, res) => {
  const { title, text } = CreateTextRoomRequest.parse(req.body);
  if (!text.trim()) throw new HttpError(400, "Paste some text first");
  const id = nanoid(8);

  const { error } = await supabaseAdmin()
    .from("rooms")
    .insert({
      id,
      kind: "link",
      title: title?.trim() || "Pasted text",
      content_html: textToHtml(text),
      created_by: req.user!.id,
    });
  if (error) throw error;

  startIndexing(id); // chunks and embeddings, in the background
  res.status(201).json({ id } satisfies CreateRoomResponse);
});

// POST /api/rooms/pdf  multipart field "file" (over 20 MB is a 413, see middleware/error.ts)
roomsRouter.post("/pdf", requireAuth, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, "A PDF file is required");
  if (!isPdf(file.buffer)) throw new HttpError(400, "That file is not a PDF");
  const id = await createPdfRoom(file, req.user!.id);
  res.status(201).json({ id } satisfies CreateRoomResponse);
});

// POST /api/rooms/file  multipart field "file": a PDF, DOCX, PPTX, Markdown or text file. The format
// comes from the bytes (see lib/files.ts). PDFs become PDF rooms; the rest become file rooms with the
// same block HTML as a link room, and the original is kept in the private "files" bucket.
roomsRouter.post("/file", requireAuth, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, "A file is required");
  const parsed = await parseFile(file.buffer, file.originalname);
  if (parsed.format === "pdf") {
    const id = await createPdfRoom(file, req.user!.id);
    res.status(201).json({ id } satisfies CreateRoomResponse);
    return;
  }

  const id = nanoid(8);
  const path = `${id}.${parsed.format}`;
  const db = supabaseAdmin();

  const { error: uploadError } = await db.storage
    .from(FILES_BUCKET)
    .upload(path, file.buffer, { contentType: CONTENT_TYPES[parsed.format] });
  if (uploadError) throw uploadError;

  const { error } = await db.from("rooms").insert({
    id,
    kind: "file",
    title: file.originalname.trim().slice(0, 200) || "Untitled file",
    content_html: parsed.html,
    source_meta: { format: parsed.format, file_name: file.originalname } satisfies SourceMeta,
    created_by: req.user!.id,
  });
  if (error) {
    const { error: cleanupError } = await db.storage.from(FILES_BUCKET).remove([path]);
    if (cleanupError) console.error(`Could not remove orphaned file ${path}:`, cleanupError);
    throw error;
  }

  startIndexing(id); // chunks and embeddings, in the background
  res.status(201).json({ id } satisfies CreateRoomResponse);
});

const FILES_BUCKET = "files";

// Stores a PDF in the public bucket and creates its room. Returns the room id.
async function createPdfRoom(file: Express.Multer.File, userId: string) {
  // Before the upload, so a file pdf.js can't open never gets a room. Also the text for the recap.
  const contentText = await extractPdfText(file.buffer);

  const id = nanoid(8);
  const pdfPath = `${id}.pdf`;
  const db = supabaseAdmin();

  const { error: uploadError } = await db.storage
    .from("pdfs")
    .upload(pdfPath, file.buffer, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;

  const { error } = await db.from("rooms").insert({
    id,
    kind: "pdf",
    title: file.originalname.trim().slice(0, 200) || "Untitled PDF",
    pdf_path: pdfPath,
    content_text: contentText,
    source_meta: { format: "pdf", file_name: file.originalname } satisfies SourceMeta,
    created_by: userId,
  });
  if (error) {
    // No room points at the file, so don't leave it in the public bucket.
    const { error: cleanupError } = await db.storage.from("pdfs").remove([pdfPath]);
    // Logged with the path so the orphaned file can be found and removed by hand.
    if (cleanupError) console.error(`Could not remove orphaned PDF ${pdfPath}:`, cleanupError);
    throw error;
  }
  startIndexing(id); // chunks and embeddings, in the background
  return id;
}

// The most rooms a user's participation history contributes to their dashboard.
export const MAX_PARTICIPATION = 1000;
const DELETED_PDFS = "pdfs-deleted";

export const ROOM_DETAIL =
  "id, kind, source_url, title, status, created_at, last_activity_at, paused_at, closed_at, deleted_at, room_group_items(group_id)";

// The filing lives in its own private table; callers see it as the room's group_id.
type Filed = { room_group_items?: { group_id: string } | null };
const withGroup = (row: unknown) => {
  const { room_group_items, ...room } = row as Filed;
  return { ...room, group_id: room_group_items?.group_id ?? null } as RoomDetail;
};

// Kept for callers that only need the LIKE escaping.
export const titlePattern = likePattern;
type RoomRow = Omit<
  DashboardRoom,
  | "group_id"
  | "role"
  | "last_opened_at"
  | "highlight_count"
  | "comment_count"
  | "participant_count"
  | "live_count"
  | "people"
> &
  Filed & {
    created_by: string | null;
    highlights: { count: number }[];
    comments: { count: number }[];
  };

// GET /api/me/rooms: rooms the user created or joined. Deleted rooms show up for their owner only.
export const listRooms: RequestHandler = async (req, res) => {
  const { q, status, kind, role, group_id, sort, limit, offset } = DashboardQuery.parse(req.query);
  const userId = req.user!.id;
  const db = supabaseAdmin();

  // Memberships are capped at the most recent ones. Owned rooms are matched by created_by in the
  // query itself, so none of them can fall outside a search, a filter or the total.
  const joined = await db
    .from("room_participants")
    .select("room_id, last_seen_at")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false })
    .limit(MAX_PARTICIPATION);
  if (joined.error) throw joined.error;

  const lastOpened = new Map(joined.data.map((v) => [v.room_id as string, v.last_seen_at as string]));
  const joinedIds = [...lastOpened.keys()];

  // Deleted rooms and projects belong to the owner alone: a member sees neither.
  const ownerOnly = role === "owner" || status === "deleted" || Boolean(group_id);
  if (role === "member" && (ownerOnly || !joinedIds.length)) {
    res.json({ rooms: [], total: 0 } satisfies DashboardResponse);
    return;
  }

  const filing = group_id ? "room_group_items!inner(group_id)" : "room_group_items(group_id)";
  let query = db
    .from("rooms")
    .select(
      `id, kind, source_url, title, status, created_at, last_activity_at, created_by, highlights(count), comments(count), ${filing}`,
      { count: "exact" },
    );

  const joinedList = joinedIds.map((id) => `"${id}"`).join(",");
  if (ownerOnly || !joinedIds.length) query = query.eq("created_by", userId);
  // A room you own never counts as a membership, and a room can outlive its owner's account.
  else if (role === "member") query = query.in("id", joinedIds).or(`created_by.neq.${userId},created_by.is.null`);
  else query = query.or(`created_by.eq.${userId},id.in.(${joinedList})`);

  if (status) query = query.eq("status", status);
  else query = query.neq("status", "deleted");
  if (kind) query = query.eq("kind", kind);
  if (group_id) query = query.eq("room_group_items.group_id", group_id);
  if (q) query = query.ilike("title", titlePattern(q));

  query =
    sort === "title"
      ? query.order("title", { ascending: true, nullsFirst: false })
      : sort === "active"
        ? query.order("last_activity_at", { ascending: false })
        : query.order("created_at", { ascending: sort === "oldest" });

  // The id tiebreak keeps pages stable when rooms share a title or timestamp.
  const { data, count, error } = await query.order("id").range(offset, offset + limit - 1);
  if (error) throw error;

  const rows = data as unknown as RoomRow[];
  const blocks = await participantBlocks(
    db,
    rows.map((room) => room.id),
  );

  const rooms = rows.map(({ created_by, highlights, comments, room_group_items, ...room }): DashboardRoom => {
    const block = blockFor(blocks, room.id);
    const isOwner = created_by === userId;
    return {
      ...room,
      group_id: isOwner ? (room_group_items?.group_id ?? null) : null,
      role: isOwner ? "owner" : "member",
      last_opened_at: lastOpened.get(room.id) ?? null,
      highlight_count: highlights[0]?.count ?? 0,
      comment_count: comments[0]?.count ?? 0,
      participant_count: block.participant_count,
      live_count: block.live_count,
      people: block.people,
    };
  });
  res.json({ rooms, total: count ?? 0 } satisfies DashboardResponse);
};

// POST /api/rooms/:id/join: remembers the room for a logged-in user and doubles as the heartbeat
// that drives "live now". Guests just open the link.
roomsRouter.post("/:id/join", requireAuth, async (req, res) => {
  const { id } = req.params;
  const db = supabaseAdmin();

  const { data: room, error } = await db.from("rooms").select("id, status").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!room || room.status === "deleted") throw new HttpError(404, "Room not found");

  const { error: joinError } = await db
    .from("room_participants")
    .upsert(
      { room_id: id, user_id: req.user!.id, last_seen_at: new Date().toISOString() },
      { onConflict: "room_id,user_id" },
    );
  if (joinError) throw joinError;

  res.json(room as RoomStatusResponse);
});

// PATCH /api/rooms/:id  { status?, group_id? }: owner only. Someone else's room looks like it
// doesn't exist. Deleting has its own endpoints so a PDF is never left public by accident.
roomsRouter.patch("/:id", requireAuth, async (req, res) => {
  const body = UpdateRoomRequest.parse(req.body);
  const db = supabaseAdmin();

  const { data: room, error } = await db
    .from("rooms")
    .select("status")
    .eq("id", req.params.id)
    .eq("created_by", req.user!.id)
    .maybeSingle();
  if (error) throw error;
  if (!room) throw new HttpError(404, "Room not found");
  if (room.status === "deleted") throw new HttpError(409, "Restore the room before changing it");

  if (body.group_id !== undefined && body.group_id !== null) {
    const { data: group, error: groupError } = await db
      .from("room_groups")
      .select("id")
      .eq("id", body.group_id)
      .eq("owner_id", req.user!.id)
      .maybeSingle();
    if (groupError) throw groupError;
    if (!group) throw new HttpError(404, "Group not found");
  }

  // Both changes save together or not at all. The status is re-checked in the write: a delete that
  // landed after the read must not be undone here, or the room would run again with its PDF still
  // in the hidden bucket.
  const id = req.params.id as string;
  const { data: saved, error: updateError } = await db.rpc("update_room", {
    target_room: id,
    new_status: body.status ?? null,
    change_group: body.group_id !== undefined,
    new_group: body.group_id ?? null,
  });
  if (updateError) {
    if (updateError.code === "23503") throw new HttpError(404, "Group not found");
    throw updateError;
  }
  if (!saved) throw new HttpError(409, "The room just changed. Try again.");

  res.json(await roomDetail(db, id));
});

// DELETE /api/rooms/:id: soft delete. The room disappears for everyone but its owner, who can
// restore it. A PDF also leaves the public bucket, because public URLs skip RLS.
roomsRouter.delete("/:id", requireAuth, async (req, res) => {
  const db = supabaseAdmin();
  const id = req.params.id as string;

  const { data: room, error } = await db
    .from("rooms")
    .select("status, pdf_path")
    .eq("id", id)
    .eq("created_by", req.user!.id)
    .maybeSingle();
  if (error) throw error;
  if (!room) throw new HttpError(404, "Room not found");
  if (room.status === "deleted") return res.json(await roomDetail(db, id));

  // Saves only if the status is still the one read above: the PDF move was decided from it, so a
  // request that lost a race must undo its move, or a deleted room's PDF could stay public.
  const { data, error: updateError } = await saveStatus(db, id, room.status, "deleted", room.pdf_path, true);
  if (updateError || !data) {
    if (updateError) throw updateError;
    throw new HttpError(409, "The room just changed. Try again.");
  }

  res.json(withGroup(data));
});

// POST /api/rooms/:id/restore: brings a soft-deleted room back, readable and running again.
roomsRouter.post("/:id/restore", requireAuth, async (req, res) => {
  const db = supabaseAdmin();
  const id = req.params.id as string;

  const { data: room, error } = await db
    .from("rooms")
    .select("status, pdf_path")
    .eq("id", id)
    .eq("created_by", req.user!.id)
    .maybeSingle();
  if (error) throw error;
  if (!room) throw new HttpError(404, "Room not found");
  if (room.status !== "deleted") throw new HttpError(409, "The room is not deleted");

  const { data, error: updateError } = await saveStatus(db, id, "deleted", "running", room.pdf_path, false);
  if (updateError || !data) {
    if (updateError) throw updateError;
    throw new HttpError(409, "The room just changed. Try again.");
  }

  // Indexing skips deleted rooms, so a room deleted before its chunks were made gets them now.
  startIndexingIfWaiting(id);
  res.json(withGroup(data));
});

// POST /api/rooms/:id/invites  { user_id }: owner only.
roomsRouter.post("/:id/invites", requireAuth, async (req, res) => {
  const { user_id } = CreateInviteRequest.parse(req.body);
  const db = supabaseAdmin();

  const { data: room, error } = await db
    .from("rooms")
    .select("id, title, status")
    .eq("id", req.params.id)
    .eq("created_by", req.user!.id)
    .maybeSingle();
  if (error) throw error;
  if (!room || room.status === "deleted") throw new HttpError(404, "Room not found");
  if (user_id === req.user!.id) throw new HttpError(400, "You are already in this room");

  const { data: invitee, error: inviteeError } = await db
    .from("profiles")
    .select("id")
    .eq("id", user_id)
    .maybeSingle();
  if (inviteeError) throw inviteeError;
  if (!invitee) throw new HttpError(404, "User not found");

  const { data: participant, error: participantError } = await db
    .from("room_participants")
    .select("user_id")
    .eq("room_id", req.params.id)
    .eq("user_id", user_id)
    .maybeSingle();
  if (participantError) throw participantError;
  if (participant) throw new HttpError(409, "They are already in this room");

  const { data, error: insertError } = await db
    .from("room_invites")
    .insert({ room_id: req.params.id, inviter_id: req.user!.id, invitee_id: user_id })
    .select("id, room_id, inviter_id, invitee_id, status, created_at, responded_at")
    .single();
  if (insertError) {
    if (insertError.code === "23505") throw new HttpError(409, "There is already a pending invite");
    throw insertError;
  }

  const [invite] = await inviteViews(db, [data], new Map([[room.id, room.title]]), req.user!.id);
  res.status(201).json(invite);
});

// GET /api/rooms/:id/top-members: the three most active people, by highlights plus comments.
roomsRouter.get("/:id/top-members", requireAuth, async (req, res) => {
  const db = supabaseAdmin();

  const { data: room, error } = await db.from("rooms").select("status").eq("id", req.params.id).maybeSingle();
  if (error) throw error;
  if (!room || room.status === "deleted") throw new HttpError(404, "Room not found");

  const { data, error: rankError } = await db.rpc("room_top_members", { target_room: req.params.id });
  if (rankError) throw rankError;

  const members = (data as Omit<TopMember, "activity">[]).map(
    (member): TopMember => ({ ...member, activity: member.highlight_count + member.comment_count }),
  );
  res.json({ members } satisfies TopMembersResponse);
});

// Reads the room's current shape after an idempotent delete.
async function roomDetail(db: ReturnType<typeof supabaseAdmin>, id: string) {
  const { data, error } = await db.from("rooms").select(ROOM_DETAIL).eq("id", id).single();
  if (error) throw error;
  return withGroup(data);
}

// Moves the PDF (if any) and saves the status only if it is still the one that was read.
async function saveStatus(
  db: ReturnType<typeof supabaseAdmin>,
  id: string,
  from: string,
  to: string,
  pdfPath: string | null,
  hidePdf: boolean,
) {
  if (pdfPath) await movePdf(pdfPath, hidePdf);

  const result = await db
    .from("rooms")
    .update({ status: to })
    .eq("id", id)
    .eq("status", from)
    .select(ROOM_DETAIL)
    .maybeSingle();

  if (result.error || !result.data) {
    // Undo the move: the database still says `from`, so the PDF belongs on that side.
    if (pdfPath) await movePdf(pdfPath, !hidePdf).catch(console.error);
  }
  return result;
}

// Public bucket URLs skip RLS, so a deleted room's PDF has to leave the public bucket.
async function movePdf(path: string, hide: boolean) {
  const [from, to] = hide ? ["pdfs", DELETED_PDFS] : [DELETED_PDFS, "pdfs"];
  const { error } = await supabaseAdmin().storage.from(from!).move(path, path, { destinationBucket: to! });
  if (error) throw error;
}

// One recap per room at a time, and a pause between recaps, so a burst of clicks costs one AI call.
// The lock lives in this process: right for one backend instance; several would need a database lock.
const RECAP_COOLDOWN_MS = 30_000;
// apps/ai's request limit (MAX_TEXT_CHARS in apps/ai/app/schemas.py). How much of it the model
// reads is its own max_document_chars setting, so the backend cuts only to keep the request bounded.
const MAX_RECAP_TEXT_CHARS = 1_000_000;
const recapsInFlight = new Set<string>();

// POST /api/rooms/:id/recap  { name? }: gathers room data, asks the AI service, stores the recap.
// Guests can ask too; a signed-in caller is recorded as the author in the history.
// The insert reaches every client through Supabase Realtime.
roomsRouter.post("/:id/recap", optionalAuth, async (req, res) => {
  const id = req.params.id as string;
  const { name } = RecapRequest.parse(req.body ?? {});
  const requestedBy = name ?? (req.user?.name.trim().slice(0, 40) || null);

  // Taken before any read: a second click can't pass the cooldown on a read made before the
  // first recap was saved.
  if (recapsInFlight.has(id)) throw new HttpError(409, "A recap for this room is already on its way.");
  recapsInFlight.add(id);
  try {
    const db = supabaseAdmin();
    const [room, highlights, comments, lastRecap] = await Promise.all([
      db.from("rooms").select("title, content_html, content_text, status").eq("id", id).single(),
      db.from("highlights").select("author_name, block_id, quote").eq("room_id", id),
      db.from("comments").select("author_name, highlight_id, body").eq("room_id", id),
      db
        .from("recaps")
        .select("created_at")
        .eq("room_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (room.error || room.data.status === "deleted") throw new HttpError(404, "Room not found");
    if (room.data.status === "archived") throw new HttpError(409, "This room is archived");
    if (highlights.error) throw highlights.error;
    if (comments.error) throw comments.error;
    if (lastRecap.error) throw lastRecap.error;

    // The recap is about what the group picked out, so there is nothing to recap yet.
    if (!highlights.data.length) {
      throw new HttpError(422, "Highlight a few things first, then ask for a recap.");
    }

    const waitMs = lastRecap.data
      ? RECAP_COOLDOWN_MS - (Date.now() - Date.parse(lastRecap.data.created_at as string))
      : 0;
    if (waitMs > 0) {
      const seconds = Math.ceil(waitMs / 1000);
      res.set("Retry-After", String(seconds));
      throw new HttpError(429, `A recap was made moments ago. Try again in ${seconds} s.`);
    }

    // apps/ai stops trying providers after 100 s, so it answers before this gives up.
    const data = await callAi(
      "/recap",
      {
        title: room.data.title ?? "",
        // PDF rooms have no HTML: their text was extracted on upload.
        text: (room.data.content_text ?? htmlToText(room.data.content_html ?? "")).slice(0, MAX_RECAP_TEXT_CHARS),
        highlights: highlights.data,
        comments: comments.data,
      },
      RecapData,
      120_000,
    );
    const { error } = await db.from("recaps").insert({ room_id: id, data, requested_by: requestedBy });
    if (error) throw error;

    // A history row is nice to have but never worth failing the recap for.
    const { error: historyError } = await db
      .from("ai_queries")
      .insert({ room_id: id, user_id: req.user?.id ?? null, kind: "recap", response: data });
    if (historyError) console.error("[rooms] could not record the recap query", historyError);

    res.json(data);
  } finally {
    recapsInFlight.delete(id);
  }
});

// --- Ask the room ---

// Chunks a question is answered from (match_chunks p_k).
const ASK_CHUNKS = 8;
// apps/ai answers within 25 s; embedding the question is quick or not worth waiting for.
const ANSWER_TIMEOUT_MS = 30_000;
const QUESTION_EMBED_TIMEOUT_MS = 10_000;

const tooManyQuestions = (scope: string) => ({ error: `Too many questions ${scope}. Try again in a minute.` });
// Per person (IP), and per room across everyone, since every answer costs an AI call.
const askPerIp = rateLimit({
  windowMs: 60_000,
  limit: env.ASK_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: tooManyQuestions("from you"),
});
const askPerRoom = rateLimit({
  windowMs: 60_000,
  limit: env.ASK_ROOM_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `room:${req.params.id}`,
  message: tooManyQuestions("in this room"),
});

type MatchedChunk = { content: string; block_ids: string[]; page: number | null; start_sec: number | null; end_sec: number | null };

// POST /api/rooms/:id/ask  { question, name? }: answers a question from the room's document, with
// citations checked against it. Guests can ask. The answer is saved in ai_messages, which reaches
// everyone in the room over Realtime, and returned.
roomsRouter.post("/:id/ask", askPerIp, askPerRoom, optionalAuth, async (req, res) => {
  const id = req.params.id as string;
  const { question, name } = AskRequest.parse(req.body ?? {});
  const askedBy = name ?? (req.user?.name.trim().slice(0, 40) || null);
  const db = supabaseAdmin();

  const [room, ai] = await Promise.all([
    db.from("rooms").select("status").eq("id", id).maybeSingle(),
    db.from("room_ai").select("status").eq("room_id", id).maybeSingle(),
  ]);
  if (room.error) throw room.error;
  if (ai.error) throw ai.error;
  if (!room.data || room.data.status === "deleted") throw new HttpError(404, "Room not found");
  if (room.data.status === "archived") throw new HttpError(409, "This room is archived");
  // Until the chunks are saved there is nothing to search; once they are ("summarizing" onwards)
  // questions work, with or without the summary.
  if (!ai.data || ai.data.status === "pending" || ai.data.status === "indexing") {
    throw new HttpError(409, "The AI is still reading this room. Try again in a moment.");
  }
  // A failed indexing run may have left no chunks or only some: an empty search there would say
  // "not in this document" about a document nobody searched.
  if (ai.data.status === "failed") {
    throw new HttpError(409, "The AI couldn't read this room, so it can't answer questions about it yet.");
  }

  // Without an embedding the search is by keyword only.
  let embedding: number[] | null = null;
  try {
    const embedded = await callAi("/embed", { texts: [question], input_type: "query" }, EmbedResponse, QUESTION_EMBED_TIMEOUT_MS);
    embedding = embedded.vectors[0] ?? null;
  } catch {
    console.warn(`[rooms] no embedding for a question in room ${id}, searching by keyword`);
  }

  const { data: found, error: matchError } = await db.rpc("match_chunks", {
    p_room: id,
    p_embedding: embedding,
    p_query: question,
    p_k: ASK_CHUNKS,
  });
  if (matchError) throw matchError;
  const chunks = (found ?? []) as MatchedChunk[];

  // Nothing matched: the document can't answer, and there is nothing to send the AI.
  const answer: AnswerResponse = chunks.length
    ? await callAi("/answer", { question, chunks: chunks.map((c) => ({ content: c.content })) }, AnswerResponse, ANSWER_TIMEOUT_MS)
    : { answer: NOT_IN_DOCUMENT, found_in_document: false, citations: [] };

  // Where each quote is comes from its chunk; a citation of a chunk that wasn't sent is dropped.
  const citations = answer.citations.flatMap((citation): AiCitation[] => {
    const chunk = chunks[citation.chunk - 1];
    if (!chunk) return [];
    return [{ quote: citation.quote, block_ids: chunk.block_ids, page: chunk.page, start_sec: chunk.start_sec, end_sec: chunk.end_sec }];
  });
  const inDocument = answer.found_in_document && citations.length > 0;

  const { data: message, error } = await db
    .from("ai_messages")
    .insert({
      room_id: id,
      kind: "ask",
      asked_by: askedBy,
      question,
      answer: inDocument ? answer.answer.slice(0, 4000) : NOT_IN_DOCUMENT,
      found_in_document: inDocument,
      citations: inDocument ? citations : [],
    })
    .select()
    .single();
  if (error) throw error;

  // A history row is nice to have but never worth failing the answer for.
  const { error: historyError } = await db
    .from("ai_queries")
    .insert({ room_id: id, user_id: req.user?.id ?? null, kind: "ask", prompt: question, response: message });
  if (historyError) console.error("[rooms] could not record the question", historyError);

  res.status(201).json(message as AiMessage);
});
