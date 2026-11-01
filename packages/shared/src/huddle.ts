import { z } from "zod";

// Shared schemas for voice huddles (room-wide and private calls) and AI meeting notes.
// Huddle content is private to huddle members and never written to room_events.

const Id = z.string().regex(/^[A-Za-z0-9_:-]{1,64}$/);
const Text = (max: number) => z.string().max(max);
const Name = z.string().trim().min(1).max(40);

export const HuddleAudience = z.enum(["all", "private"]);
export type HuddleAudience = z.infer<typeof HuddleAudience>;

export const HuddleNotesStatus = z.enum(["none", "generating", "ready", "failed"]);
export type HuddleNotesStatus = z.infer<typeof HuddleNotesStatus>;

export const CreateHuddleRequest = z.discriminatedUnion("audience", [
  z.object({
    audience: z.literal("all"),
    name: Name.optional(),
  }),
  z.object({
    audience: z.literal("private"),
    members: z.array(Id).min(1).max(20),
    name: Name.optional(),
  }),
]);
export type CreateHuddleRequest = z.infer<typeof CreateHuddleRequest>;

export const JoinHuddleRequest = z.object({
  name: Name.optional(),
});
export type JoinHuddleRequest = z.infer<typeof JoinHuddleRequest>;

export const HuddleMemberSummary = z.object({
  member_id: z.string(),
  name: z.string(),
  invited_by: z.string().nullable().optional(),
  invited_at: z.string().optional(),
  joined_at: z.string().nullable().optional(),
  left_at: z.string().nullable().optional(),
});
export type HuddleMemberSummary = z.infer<typeof HuddleMemberSummary>;

export const HuddleSummary = z.object({
  id: Id,
  room_id: Id,
  livekit_room: z.string(),
  audience: HuddleAudience,
  created_by: Id,
  created_by_name: Text(40),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  notes_status: HuddleNotesStatus,
  notes_error: z.string().nullable(),
  members: z.array(HuddleMemberSummary).optional(),
});
export type HuddleSummary = z.infer<typeof HuddleSummary>;

export const ListHuddlesResponse = z.object({
  huddles: z.array(HuddleSummary),
});
export type ListHuddlesResponse = z.infer<typeof ListHuddlesResponse>;

export const HuddleLiveKitCredentials = z.object({
  url: z.string(),
  token: z.string(),
});
export type HuddleLiveKitCredentials = z.infer<typeof HuddleLiveKitCredentials>;

export const HuddleJoinResponse = z.object({
  huddle: HuddleSummary,
  livekit: HuddleLiveKitCredentials,
});
export type HuddleJoinResponse = z.infer<typeof HuddleJoinResponse>;

export const InviteHuddleRequest = z.object({
  members: z.array(Id).min(1).max(20),
});
export type InviteHuddleRequest = z.infer<typeof InviteHuddleRequest>;

export const HuddleFocus = z.object({
  doc: Id,
  block: Text(16),
});
export type HuddleFocus = z.infer<typeof HuddleFocus>;

export const HuddleSegmentIn = z.object({
  id: Id,
  text: Text(1000),
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
  focus: HuddleFocus.nullable(),
});
export type HuddleSegmentIn = z.infer<typeof HuddleSegmentIn>;

export const PostSegmentsRequest = z.object({
  segments: z.array(HuddleSegmentIn).min(1).max(20),
});
export type PostSegmentsRequest = z.infer<typeof PostSegmentsRequest>;

export const HuddleFocusRequest = z.object({
  doc: Id,
  block: Text(16),
});
export type HuddleFocusRequest = z.infer<typeof HuddleFocusRequest>;

export const HuddleTranscriptQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type HuddleTranscriptQuery = z.infer<typeof HuddleTranscriptQuery>;

export const HuddleTranscriptSegment = z.object({
  seq: z.number().int(),
  id: Id,
  speaker_id: Id,
  speaker_name: Text(40),
  text: Text(1000),
  start_at: z.string(),
  end_at: z.string(),
  doc: Id.nullable(),
  block: Text(16).nullable(),
});
export type HuddleTranscriptSegment = z.infer<typeof HuddleTranscriptSegment>;

export const HuddleTranscriptResponse = z.object({
  segments: z.array(HuddleTranscriptSegment),
  next: z.number().int().nullable(),
});
export type HuddleTranscriptResponse = z.infer<typeof HuddleTranscriptResponse>;

export const HuddleNotePoint = z.object({
  text: Text(1000),
  owner: Text(40).nullable().optional(),
  segment_ids: z.array(Id),
  anchor: HuddleFocus.nullable(),
  at: z.string(),
});
export type HuddleNotePoint = z.infer<typeof HuddleNotePoint>;

export const HuddleNotes = z.object({
  summary: z.string(),
  decisions: z.array(HuddleNotePoint),
  action_items: z.array(HuddleNotePoint),
  open_questions: z.array(HuddleNotePoint),
  key_points: z.array(HuddleNotePoint),
});
export type HuddleNotes = z.infer<typeof HuddleNotes>;

export const HuddleNotePointData = z.object({
  text: Text(1000),
  owner: Text(40).nullable().optional(),
  segment_ids: z.array(Id).default([]),
});
export type HuddleNotePointData = z.infer<typeof HuddleNotePointData>;

export const HuddleNotesData = z.object({
  summary: z.string(),
  decisions: z.array(HuddleNotePointData).default([]),
  action_items: z.array(HuddleNotePointData).default([]),
  open_questions: z.array(HuddleNotePointData).default([]),
  key_points: z.array(HuddleNotePointData).default([]),
});
export type HuddleNotesData = z.infer<typeof HuddleNotesData>;

export const HuddleNotesResponse = z.object({
  status: HuddleNotesStatus,
  version: z.number().int().nullable(),
  notes: HuddleNotes.nullable(),
});
export type HuddleNotesResponse = z.infer<typeof HuddleNotesResponse>;
