import { z } from "zod";

// Mirrors supabase/migrations/0001_init.sql.

export const RoomKind = z.enum(["link", "pdf"]);
export type RoomKind = z.infer<typeof RoomKind>;

// Mirrors the check constraint in supabase/migrations/0005_room_status_and_visits.sql.
export const RoomStatus = z.enum(["running", "closed", "archived", "deleted"]);
export type RoomStatus = z.infer<typeof RoomStatus>;

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

const notBlank = (s: string) => s.trim().length > 0;

export const Author = z.object({
  author_name: z.string().min(1).max(40).refine(notBlank, "Name can't be blank"),
  author_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

// Limits match the check constraints in supabase/migrations/0002_auth_and_phase1.sql and
// 0004_browser_write_checks.sql.
const HighlightFields = Author.extend({
  room_id: z.string(),
  block_id: z.string().regex(/^[bp][0-9]{1,6}$/), // link: "b12" | pdf: "p3"
  start_offset: z.number().int().nonnegative(),
  end_offset: z.number().int().nonnegative(),
  quote: z.string().min(1).max(1000),
});

export const NewHighlight = HighlightFields.refine((h) => h.end_offset >= h.start_offset, {
  message: "end_offset must not be before start_offset",
  path: ["end_offset"],
});
export type NewHighlight = z.infer<typeof NewHighlight>;

export const Highlight = HighlightFields.extend({
  id: z.string().uuid(),
  created_at: z.string(),
});
export type Highlight = z.infer<typeof Highlight>;

export const NewComment = Author.extend({
  room_id: z.string(),
  highlight_id: z.string().uuid(),
  body: z.string().min(1).max(2000).refine(notBlank, "Comment can't be blank"),
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

// --- Dashboard (apps/backend /api/rooms) ---

export const DashboardQuery = z.object({
  q: z.string().trim().max(200).optional(), // matches the room title
  status: RoomStatus.optional(), // left out: every room except deleted ones
  kind: RoomKind.optional(),
  role: z.enum(["owner", "member"]).optional(),
  sort: z.enum(["newest", "oldest", "title"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type DashboardQuery = z.infer<typeof DashboardQuery>;

export const DashboardRoom = z.object({
  id: z.string(),
  kind: RoomKind,
  source_url: z.string().nullable(),
  title: z.string().nullable(),
  status: RoomStatus,
  role: z.enum(["owner", "member"]),
  created_at: z.string(),
  last_opened_at: z.string().nullable(), // null until this user joins the room
  highlight_count: z.number().int(),
  comment_count: z.number().int(),
});
export type DashboardRoom = z.infer<typeof DashboardRoom>;

export const DashboardResponse = z.object({
  rooms: z.array(DashboardRoom),
  total: z.number().int(), // matching rooms across all pages
});
export type DashboardResponse = z.infer<typeof DashboardResponse>;

export const UpdateRoomStatusRequest = z.object({ status: RoomStatus });
export type UpdateRoomStatusRequest = z.infer<typeof UpdateRoomStatusRequest>;

export const RoomStatusResponse = z.object({ id: z.string(), status: RoomStatus });
export type RoomStatusResponse = z.infer<typeof RoomStatusResponse>;

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
