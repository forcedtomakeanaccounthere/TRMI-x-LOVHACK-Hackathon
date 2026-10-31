import { z } from "zod";

// Mirrors supabase/migrations/0001_init.sql and 0010_ai_foundation.sql.

// link: web page or pasted text | pdf: PDF upload | file: DOCX, PPTX, Markdown or text upload | youtube: video
export const RoomKind = z.enum(["link", "pdf", "file", "youtube"]);
export type RoomKind = z.infer<typeof RoomKind>;

// Uploaded formats, as stored in rooms.source_meta.format.
export const FileFormat = z.enum(["pdf", "docx", "pptx", "md", "txt"]);
export type FileFormat = z.infer<typeof FileFormat>;

// rooms.source_meta for uploaded rooms (0010_ai_foundation.sql).
export const SourceMeta = z.object({ format: FileFormat, file_name: z.string() });
export type SourceMeta = z.infer<typeof SourceMeta>;

// Block anchors: "b12" paragraph | "p3" PDF page or slide | "t7" transcript segment.
// Matches highlights_block_id_format in 0010_ai_foundation.sql.
export const BlockId = z.string().regex(/^[bpt][0-9]{1,6}$/);

// Mirrors the check constraint in supabase/migrations/0007_dashboard.sql.
// A room is readable unless deleted; only running rooms take new highlights and comments.
export const RoomStatus = z.enum(["running", "paused", "closed", "archived", "deleted"]);
export type RoomStatus = z.infer<typeof RoomStatus>;

export const Room = z.object({
  id: z.string(),
  kind: RoomKind,
  source_url: z.string().nullable(),
  title: z.string().nullable(),
  content_html: z.string().nullable(),
  pdf_path: z.string().nullable(),
  // pdf rooms: text of the first pages, for the AI recap. Optional so pages can leave it out of the select.
  content_text: z.string().nullable().optional(),
  // Uploaded rooms: the format and file name. Optional so pages can leave it out of the select.
  source_meta: SourceMeta.nullable().optional(),
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
  block_id: BlockId,
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
  requested_by: z.string().nullable(), // "Recapped by …"; see 0009_recap_requested_by.sql
  created_at: z.string(),
});
export type Recap = z.infer<typeof Recap>;

// POST /api/rooms/:id/recap. The name shown as "Recapped by …". Optional, since guests may not have
// typed one yet; a blank name counts as none.
export const RecapRequest = z.object({
  name: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((name) => name || undefined),
});
export type RecapRequest = z.infer<typeof RecapRequest>;

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

// --- Dashboard (apps/backend /api/me, /api/groups, /api/users and /api/rooms) ---

export const DashboardQuery = z.object({
  q: z.string().trim().max(200).optional(), // matches the room title
  status: RoomStatus.optional(), // left out: every room except deleted ones
  kind: RoomKind.optional(),
  role: z.enum(["owner", "member"]).optional(),
  group_id: z.string().uuid().optional(),
  sort: z.enum(["newest", "oldest", "title", "active"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type DashboardQuery = z.infer<typeof DashboardQuery>;

// Someone who has opened a room. `live` means their last heartbeat is recent.
export const RoomParticipant = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  avatar_color: z.string().nullable(),
  joined_at: z.string(),
  last_seen_at: z.string(),
  live: z.boolean(),
});
export type RoomParticipant = z.infer<typeof RoomParticipant>;

export const DashboardRoom = z.object({
  id: z.string(),
  kind: RoomKind,
  source_url: z.string().nullable(),
  title: z.string().nullable(),
  status: RoomStatus,
  role: z.enum(["owner", "member"]),
  group_id: z.string().uuid().nullable(),
  created_at: z.string(),
  last_activity_at: z.string(),
  last_opened_at: z.string().nullable(), // null until this user joins the room
  highlight_count: z.number().int(),
  comment_count: z.number().int(),
  participant_count: z.number().int(),
  live_count: z.number().int(),
  people: z.array(RoomParticipant), // the five most recently seen people
});
export type DashboardRoom = z.infer<typeof DashboardRoom>;

export const DashboardResponse = z.object({
  rooms: z.array(DashboardRoom),
  total: z.number().int(), // matching rooms across all pages
});
export type DashboardResponse = z.infer<typeof DashboardResponse>;

export const UpdateRoomRequest = z
  .object({
    // "deleted" is deliberately absent: use DELETE and POST .../restore.
    status: z.enum(["running", "paused", "closed", "archived"]).optional(),
    group_id: z.string().uuid().nullable().optional(), // null moves the room out of its group
  })
  .refine((body) => body.status !== undefined || body.group_id !== undefined, {
    message: "Provide a status or a group_id",
  });
export type UpdateRoomRequest = z.infer<typeof UpdateRoomRequest>;

export const RoomDetail = z.object({
  id: z.string(),
  kind: RoomKind,
  source_url: z.string().nullable(),
  title: z.string().nullable(),
  status: RoomStatus,
  group_id: z.string().uuid().nullable(),
  created_at: z.string(),
  last_activity_at: z.string(),
  paused_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
});
export type RoomDetail = z.infer<typeof RoomDetail>;

export const RoomStatusResponse = z.object({ id: z.string(), status: RoomStatus });
export type RoomStatusResponse = z.infer<typeof RoomStatusResponse>;

export const GroupName = z.string().trim().min(1).max(60);
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const RoomGroup = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string().nullable(),
  position: z.number().int(),
  room_count: z.number().int(),
  created_at: z.string(),
});
export type RoomGroup = z.infer<typeof RoomGroup>;

export const GroupsResponse = z.object({ groups: z.array(RoomGroup) });
export type GroupsResponse = z.infer<typeof GroupsResponse>;

export const CreateGroupRequest = z.object({
  name: GroupName,
  color: HexColor.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});
export type CreateGroupRequest = z.infer<typeof CreateGroupRequest>;

export const UpdateGroupRequest = z
  .object({
    name: GroupName.optional(),
    color: HexColor.nullable().optional(),
    position: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide a name, colour or position",
  });
export type UpdateGroupRequest = z.infer<typeof UpdateGroupRequest>;

export const Profile = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  bio: z.string().nullable(),
  avatar_color: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Profile = z.infer<typeof Profile>;

export const UpdateProfileRequest = z
  .object({
    display_name: z.string().trim().min(1).max(40).optional(),
    bio: z.string().trim().max(280).nullable().optional(),
    avatar_color: HexColor.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide a display name, bio or avatar colour",
  });
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

// A person as the dashboard shows them. is_following is from the requesting user's side.
export const UserSummary = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  avatar_color: z.string().nullable(),
  is_following: z.boolean(),
});
export type UserSummary = z.infer<typeof UserSummary>;

export const UsersResponse = z.object({ users: z.array(UserSummary) });
export type UsersResponse = z.infer<typeof UsersResponse>;

export const UsersQuery = z.object({
  q: z.string().trim().min(1).max(40),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type UsersQuery = z.infer<typeof UsersQuery>;

export const FollowStateResponse = z.object({ id: z.string().uuid(), following: z.boolean() });
export type FollowStateResponse = z.infer<typeof FollowStateResponse>;

export const MeParticipant = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  avatar_color: z.string().nullable(),
  last_seen_at: z.string(),
  live: z.boolean(),
  shared_rooms: z.number().int(),
});
export type MeParticipant = z.infer<typeof MeParticipant>;

export const ParticipantsResponse = z.object({ participants: z.array(MeParticipant) });
export type ParticipantsResponse = z.infer<typeof ParticipantsResponse>;

export const InviteStatus = z.enum(["pending", "accepted", "declined", "revoked"]);
export type InviteStatus = z.infer<typeof InviteStatus>;

export const RoomInvite = z.object({
  id: z.string().uuid(),
  room_id: z.string(),
  room_title: z.string().nullable(),
  from: UserSummary,
  to: UserSummary,
  status: InviteStatus,
  created_at: z.string(),
  responded_at: z.string().nullable(),
});
export type RoomInvite = z.infer<typeof RoomInvite>;

export const CreateInviteRequest = z.object({ user_id: z.string().uuid() });
export type CreateInviteRequest = z.infer<typeof CreateInviteRequest>;

export const InvitesResponse = z.object({
  received: z.array(RoomInvite),
  sent: z.array(RoomInvite),
});
export type InvitesResponse = z.infer<typeof InvitesResponse>;

// The most active people in a room. Activity is keyed on the typed author name, so guests count.
export const TopMember = z.object({
  name: z.string(),
  color: z.string(),
  highlight_count: z.number().int(),
  comment_count: z.number().int(),
  activity: z.number().int(), // highlights plus comments
});
export type TopMember = z.infer<typeof TopMember>;

export const TopMembersResponse = z.object({ members: z.array(TopMember) });
export type TopMembersResponse = z.infer<typeof TopMembersResponse>;

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
