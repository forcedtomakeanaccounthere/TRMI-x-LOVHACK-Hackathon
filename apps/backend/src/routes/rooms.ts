import {
  CreateLinkRoomRequest,
  CreateTextRoomRequest,
  RecapData,
  type CreateRoomResponse,
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

// POST /api/rooms/:id/recap: gathers room data, asks the AI service, stores the recap.
// The insert reaches every client through Supabase Realtime.
roomsRouter.post("/:id/recap", async (req, res) => {
  const { id } = req.params;
  const db = supabaseAdmin();

  const [room, highlights, comments] = await Promise.all([
    db.from("rooms").select("title, content_html").eq("id", id).single(),
    db.from("highlights").select("author_name, block_id, quote").eq("room_id", id),
    db.from("comments").select("author_name, highlight_id, body").eq("room_id", id),
  ]);
  if (room.error) throw new HttpError(404, "Room not found");

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
