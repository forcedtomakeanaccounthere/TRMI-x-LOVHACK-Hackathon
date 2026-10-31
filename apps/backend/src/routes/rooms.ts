import {
  CreateLinkRoomRequest,
  CreateTextRoomRequest,
  DashboardQuery,
  RecapData,
  UpdateRoomStatusRequest,
  type CreateRoomResponse,
  type DashboardResponse,
  type DashboardRoom,
  type RoomStatusResponse,
} from "@linkroom/shared";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { env } from "../env";
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

// The most rooms a user's visit history contributes to their dashboard.
const MAX_VISITS = 1000;

type RoomRow = Omit<DashboardRoom, "role" | "last_opened_at" | "highlight_count" | "comment_count"> & {
  created_by: string | null;
  highlights: { count: number }[];
  comments: { count: number }[];
};

// A % or _ in a search is the literal character, not a wildcard.
export const titlePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

// GET /api/rooms/mine: rooms the user created or joined. Deleted rooms show up for their owner only.
roomsRouter.get("/mine", requireAuth, async (req, res) => {
  const { q, status, kind, role, sort, limit, offset } = DashboardQuery.parse(req.query);
  const userId = req.user!.id;
  const db = supabaseAdmin();

  const visits = await db
    .from("room_visits")
    .select("room_id, last_opened_at")
    .eq("user_id", userId)
    .order("last_opened_at", { ascending: false })
    .limit(MAX_VISITS);
  if (visits.error) throw visits.error;
  const lastOpened = new Map(visits.data.map((v) => [v.room_id as string, v.last_opened_at as string]));

  // Room ids are nanoids and userId a uuid, so both are safe inside the filter string.
  const visited = `id.in.(${[...lastOpened.keys()].join(",")})`;
  const notMine = `or(created_by.is.null,created_by.neq.${userId})`;
  const membership = `and(${visited},${notMine},status.neq.deleted)`;

  let query = db
    .from("rooms")
    .select("id, kind, source_url, title, status, created_by, created_at, highlights(count), comments(count)", {
      count: "exact",
    });
  if (role === "owner") query = query.eq("created_by", userId);
  else if (role === "member") query = query.or(membership);
  else query = query.or(`created_by.eq.${userId},${membership}`);

  if (status) query = query.eq("status", status);
  else query = query.neq("status", "deleted");
  if (kind) query = query.eq("kind", kind);
  if (q) query = query.ilike("title", titlePattern(q));

  query =
    sort === "title"
      ? query.order("title", { ascending: true, nullsFirst: false })
      : query.order("created_at", { ascending: sort === "oldest" });

  // The id tiebreak keeps pages stable when rooms share a title or timestamp.
  const { data, count, error } = await query.order("id").range(offset, offset + limit - 1);
  if (error) throw error;

  const rooms = (data as unknown as RoomRow[]).map(
    ({ created_by, highlights, comments, ...room }): DashboardRoom => ({
      ...room,
      role: created_by === userId ? "owner" : "member",
      last_opened_at: lastOpened.get(room.id) ?? null,
      highlight_count: highlights[0]?.count ?? 0,
      comment_count: comments[0]?.count ?? 0,
    }),
  );
  res.json({ rooms, total: count ?? 0 } satisfies DashboardResponse);
});

// POST /api/rooms/:id/join: remembers the room for a logged-in user. Guests just open the link.
roomsRouter.post("/:id/join", requireAuth, async (req, res) => {
  const { id } = req.params;
  const db = supabaseAdmin();

  const { data: room, error } = await db.from("rooms").select("id, status").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!room || room.status === "deleted") throw new HttpError(404, "Room not found");

  const { error: visitError } = await db
    .from("room_visits")
    .upsert({ room_id: id, user_id: req.user!.id, last_opened_at: new Date().toISOString() });
  if (visitError) throw visitError;

  res.json(room as RoomStatusResponse);
});

// PATCH /api/rooms/:id/status  { status }: owner only. Someone else's room looks like it doesn't exist.
roomsRouter.patch("/:id/status", requireAuth, async (req, res) => {
  const { status } = UpdateRoomStatusRequest.parse(req.body);

  const { data, error } = await supabaseAdmin()
    .from("rooms")
    .update({ status })
    .eq("id", req.params.id)
    .eq("created_by", req.user!.id)
    .select("id, status")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Room not found");

  res.json(data as RoomStatusResponse);
});

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

  res.json(data);
});

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
