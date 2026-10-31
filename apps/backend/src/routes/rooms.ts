import {
  CreateInviteRequest,
  CreateLinkRoomRequest,
  CreateTextRoomRequest,
  DashboardQuery,
  RecapData,
  RoomDetail,
  UpdateRoomRequest,
  type CreateRoomResponse,
  type DashboardResponse,
  type DashboardRoom,
  type RoomStatusResponse,
  type TopMember,
  type TopMembersResponse,
} from "@linkroom/shared";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { env } from "../env";
import { blockFor, inviteViews, likePattern, participantBlocks } from "../lib/dashboard";
import { extractArticle, textToHtml } from "../lib/extract";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

export const roomsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
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

  res.status(201).json({ id } satisfies CreateRoomResponse);
});

// POST /api/rooms/pdf  multipart field "file"
roomsRouter.post("/pdf", requireAuth, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file || file.mimetype !== "application/pdf") throw new HttpError(400, "A PDF file is required");

  const id = nanoid(8);
  const pdfPath = `${id}.pdf`;
  const db = supabaseAdmin();

  const { error: uploadError } = await db.storage
    .from("pdfs")
    .upload(pdfPath, file.buffer, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;

  const { error } = await db
    .from("rooms")
    .insert({ id, kind: "pdf", title: file.originalname, pdf_path: pdfPath, created_by: req.user!.id });
  if (error) throw error;

  res.status(201).json({ id } satisfies CreateRoomResponse);
});

// The most rooms a user's participation history contributes to their dashboard.
export const MAX_PARTICIPATION = 1000;
const DELETED_PDFS = "pdfs-deleted";

export const ROOM_DETAIL =
  "id, kind, source_url, title, status, group_id, created_at, last_activity_at, paused_at, closed_at, deleted_at";

// Kept for callers that only need the LIKE escaping.
export const titlePattern = likePattern;
type RoomRow = Omit<
  DashboardRoom,
  "role" | "last_opened_at" | "highlight_count" | "comment_count" | "participant_count" | "live_count" | "people"
> & {
  created_by: string | null;
  highlights: { count: number }[];
  comments: { count: number }[];
};

// GET /api/me/rooms: rooms the user created or joined. Deleted rooms show up for their owner only.
export const listRooms: RequestHandler = async (req, res) => {
  const { q, status, kind, role, group_id, sort, limit, offset } = DashboardQuery.parse(req.query);
  const userId = req.user!.id;
  const db = supabaseAdmin();

  const [owned, joined] = await Promise.all([
    db.from("rooms").select("id").eq("created_by", userId).limit(MAX_PARTICIPATION),
    db
      .from("room_participants")
      .select("room_id, last_seen_at")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false })
      .limit(MAX_PARTICIPATION),
  ]);
  if (owned.error) throw owned.error;
  if (joined.error) throw joined.error;

  const lastOpened = new Map(joined.data.map((v) => [v.room_id as string, v.last_seen_at as string]));
  const ownedIds = owned.data.map((room) => room.id as string);
  const ownedSet = new Set(ownedIds);
  // A room you own is yours even if you also opened it; it never counts as a membership.
  const memberIds = [...lastOpened.keys()].filter((id) => !ownedSet.has(id));

  // Deleted rooms are only ever part of the owner's half: a member who joined one loses sight of it.
  // Groups are private to their owner, so a group filter can only ever match rooms you own.
  const visibleIds =
    status === "deleted" || group_id
      ? role === "member"
        ? []
        : ownedIds
      : role === "owner"
        ? ownedIds
        : role === "member"
          ? memberIds
          : [...ownedIds, ...memberIds];

  if (!visibleIds.length) {
    res.json({ rooms: [], total: 0 } satisfies DashboardResponse);
    return;
  }

  let query = db
    .from("rooms")
    .select(
      "id, kind, source_url, title, status, group_id, created_at, last_activity_at, created_by, highlights(count), comments(count)",
      { count: "exact" },
    )
    .in("id", visibleIds);

  if (status) query = query.eq("status", status);
  else query = query.neq("status", "deleted");
  if (kind) query = query.eq("kind", kind);
  if (group_id) query = query.eq("group_id", group_id);
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

  const rooms = rows.map(({ created_by, highlights, comments, ...room }): DashboardRoom => {
    const block = blockFor(blocks, room.id);
    const isOwner = created_by === userId;
    return {
      ...room,
      group_id: isOwner ? room.group_id : null,
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

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) patch.status = body.status;
  if (body.group_id !== undefined) patch.group_id = body.group_id;

  // Re-checked in the write: a delete that landed after the read must not be undone here, or the
  // room would run again with its PDF still in the hidden bucket.
  const { data, error: updateError } = await db
    .from("rooms")
    .update(patch)
    .eq("id", req.params.id)
    .neq("status", "deleted")
    .select(ROOM_DETAIL)
    .maybeSingle();
  if (updateError) throw updateError;
  if (!data) throw new HttpError(409, "The room just changed. Try again.");

  res.json(data as RoomDetail);
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

  res.json(data as RoomDetail);
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

  res.json(data as RoomDetail);
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
  return data as RoomDetail;
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

// POST /api/rooms/:id/recap: gathers room data, asks the AI service, stores the recap.
// The insert reaches every client through Supabase Realtime.
roomsRouter.post("/:id/recap", async (req, res) => {
  const { id } = req.params;
  const db = supabaseAdmin();

  const [room, highlights, comments] = await Promise.all([
    db.from("rooms").select("title, content_html, status").eq("id", id).single(),
    db.from("highlights").select("author_name, block_id, quote").eq("room_id", id),
    db.from("comments").select("author_name, highlight_id, body").eq("room_id", id),
  ]);
  if (room.error || room.data.status === "deleted") throw new HttpError(404, "Room not found");
  if (room.data.status === "archived") throw new HttpError(409, "This room is archived");

  const aiRes = await fetch(`${env.AI_SERVICE_URL}/recap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: room.data.title ?? "",
      text: stripHtml(room.data.content_html ?? ""),
      highlights: highlights.data ?? [],
      comments: comments.data ?? [],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!aiRes.ok) throw new HttpError(502, "Recap failed");

  const data = RecapData.parse(await aiRes.json());
  const { error } = await db.from("recaps").insert({ room_id: id, data });
  if (error) throw error;

  // A history row is nice to have but never worth failing the recap for.
  const { error: historyError } = await db
    .from("ai_queries")
    .insert({ room_id: id, user_id: req.user?.id ?? null, kind: "recap", response: data });
  if (historyError) console.error("[rooms] could not record the recap query", historyError);

  res.json(data);
});

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
