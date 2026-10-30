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
  created_by: z.string().uuid().nullable(), // auth.users id of the creator
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

// --- Auth (apps/backend /api/auth) ---

const Email = z.string().trim().toLowerCase().email().max(254);

export const SignupRequest = z.object({
  email: Email,
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  name: z.string().trim().min(1).max(40),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1).max(72),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const ResendVerificationRequest = z.object({ email: Email });
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequest>;

export const RefreshRequest = z.object({ refresh_token: z.string().min(1) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const AuthUser = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
});
export type AuthUser = z.infer<typeof AuthUser>;

export const AuthSession = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.number(), // unix seconds
  user: AuthUser,
});
export type AuthSession = z.infer<typeof AuthSession>;

export const MessageResponse = z.object({ message: z.string() });
export type MessageResponse = z.infer<typeof MessageResponse>;

export const ApiError = z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiError>;
