import { z } from "zod";

// Mirrors supabase/migrations/0001_init.sql.

export const RoomKind = z.enum(["link", "pdf"]);
export type RoomKind = z.infer<typeof RoomKind>;

export const Room = z.object({
  id: z.string(),
  kind: RoomKind,
  source_url: z.string().nullable(),
  title: z.string().nullable(),
  content_html: z.string().nullable(),
  pdf_path: z.string().nullable(),
  created_at: z.string(),
});
export type Room = z.infer<typeof Room>;

export const Author = z.object({
  author_name: z.string().min(1).max(40),
  author_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const NewHighlight = Author.extend({
  room_id: z.string(),
  block_id: z.string(), // link: "b12" | pdf: "p3"
  start_offset: z.number().int().nonnegative(),
  end_offset: z.number().int().nonnegative(),
  quote: z.string().min(1),
});
export type NewHighlight = z.infer<typeof NewHighlight>;

export const Highlight = NewHighlight.extend({
  id: z.string().uuid(),
  created_at: z.string(),
});
export type Highlight = z.infer<typeof Highlight>;

export const NewComment = Author.extend({
  room_id: z.string(),
  highlight_id: z.string().uuid(),
  body: z.string().min(1).max(2000),
});
export type NewComment = z.infer<typeof NewComment>;

export const Comment = NewComment.extend({
  id: z.string().uuid(),
  created_at: z.string(),
});
export type Comment = z.infer<typeof Comment>;

// Shape returned by the AI service (apps/ai/app/schemas.py must match).
export const RecapData = z.object({
  one_line_summary: z.string(),
  key_points: z.array(z.string()),
  what_the_group_cared_about: z.array(
    z.object({ quote: z.string(), who: z.array(z.string()), why: z.string() }),
  ),
  disagreements: z.array(z.string()),
  open_questions: z.array(z.string()),
  next_steps: z.array(z.string()),
});
export type RecapData = z.infer<typeof RecapData>;

export const Recap = z.object({
  id: z.string().uuid(),
  room_id: z.string(),
  data: RecapData,
  created_at: z.string(),
});
export type Recap = z.infer<typeof Recap>;

// --- API contracts (apps/backend) ---

export const CreateLinkRoomRequest = z.object({ url: z.string().url() });
export type CreateLinkRoomRequest = z.infer<typeof CreateLinkRoomRequest>;

export const CreateTextRoomRequest = z.object({
  title: z.string().max(200).optional(),
  text: z.string().min(1).max(200_000),
});
export type CreateTextRoomRequest = z.infer<typeof CreateTextRoomRequest>;

export const CreateRoomResponse = z.object({ id: z.string() });
export type CreateRoomResponse = z.infer<typeof CreateRoomResponse>;

export const ApiError = z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiError>;
