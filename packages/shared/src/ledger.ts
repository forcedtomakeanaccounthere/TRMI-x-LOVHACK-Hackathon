import { z } from "zod";
import { RoomKind } from "./schemas";

// The room workspace's ledger (apps/frontend/src/components/room/types.ts must match): every change
// to a room is one append-only event, and the room's state is the result of replaying them. The
// backend keeps them in room_events (supabase/migrations/0020_room_ledger.sql) and checks each one
// against the writer's role (apps/backend/src/lib/ledger.ts).

// Limits keep one event well under the request size limit; an AI lens snapshot is the big one.
export const MAX_LEDGER_EVENT_BYTES = 256 * 1024;
export const MAX_LEDGER_BATCH = 50;

const Id = z.string().regex(/^[A-Za-z0-9_:-]{1,64}$/);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Time = z.string().datetime({ offset: true });
const Fraction = z.number().min(-0.5).max(1.5); // a little past the block's edges is fine
const Text = (max: number) => z.string().max(max);

export const Role = z.enum(["owner", "admin", "editor", "viewer"]);
export type Role = z.infer<typeof Role>;

export const RoomSettings = z.object({
  allowGuests: z.boolean(),
  guestRole: z.enum(["viewer", "editor"]),
  memberRole: z.enum(["viewer", "editor"]), // signed-in people other than the owner
  viewersUseAi: z.boolean(),
});
export type RoomSettings = z.infer<typeof RoomSettings>;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  allowGuests: true,
  guestRole: "editor",
  memberRole: "editor",
  viewersUseAi: true,
};

export const Actor = z.object({ id: Id, name: z.string().trim().min(1).max(40), color: Color });
export type Actor = z.infer<typeof Actor>;

export const DocRef = z.object({
  id: Id, // a backend room id, or "yt:<videoId>" for a video not turned into a room yet
  kind: z.union([RoomKind, z.literal("video")]),
  title: Text(300),
  source_url: Text(2048).nullable(),
  format: Text(16).nullable(),
});
export type DocRef = z.infer<typeof DocRef>;

const AnnotationBase = { id: Id, doc: Id, block: Text(16), author: Actor, at: Time };
const Point = z.tuple([Fraction, Fraction]);

export const Annotation = z.discriminatedUnion("kind", [
  z.object({
    ...AnnotationBase,
    kind: z.enum(["highlight", "underline"]),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    quote: Text(1000),
    color: Color,
  }),
  z.object({
    ...AnnotationBase,
    kind: z.literal("region"),
    rect: z.object({ x: Fraction, y: Fraction, w: Fraction, h: Fraction }),
    color: Color,
  }),
  z.object({
    ...AnnotationBase,
    kind: z.literal("ink"),
    points: z.array(Point).min(1).max(5000),
    color: Color,
    width: z.number().positive().max(64),
  }),
  z.object({ ...AnnotationBase, kind: z.literal("note"), x: Fraction, y: Fraction, body: Text(2000), color: Color }),
  // An AI box beside a line (quote) or a lens snapshot (image, a JPEG data URL).
  z.object({
    ...AnnotationBase,
    kind: z.literal("ai"),
    x: Fraction,
    y: Fraction,
    quote: Text(1000).nullable(),
    image: z
      .string()
      .regex(/^data:image\/(jpeg|png|webp);base64,/)
      .nullable(),
  }),
]);
export type Annotation = z.infer<typeof Annotation>;

export const LedgerCitation = z.object({ doc: Id, block: Text(16), quote: Text(1000) });

const UserMessage = z.object({
  id: Id,
  role: z.literal("user"),
  text: Text(2000),
  author: Actor,
  at: Time,
  sources: z.array(Id).max(50),
});
const AiReply = z.object({
  id: Id,
  role: z.literal("ai"),
  text: Text(8000),
  at: Time,
  reply_to: z.string().max(64),
  citations: z.array(LedgerCitation).max(50),
  preview: z.boolean(),
  failed: z.boolean().optional(),
});
export const ThreadMessage = z.discriminatedUnion("role", [UserMessage, AiReply]);
export type ThreadMessage = z.infer<typeof ThreadMessage>;

export const ChatMessage = z.object({ id: Id, text: Text(2000).min(1), author: Actor, at: Time });
export type ChatMessage = z.infer<typeof ChatMessage>;

// --- Studio artifacts (POST /api/rooms/:id/artifacts answers with an ArtifactBody) ---

export const ArtifactKind = z.enum(["summary", "quiz", "flashcards", "mindmap", "infographic"]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export type MindNode = { label: string; children?: MindNode[] };
export const MindNode: z.ZodType<MindNode> = z.lazy(() =>
  z.object({ label: Text(300), children: z.array(MindNode).max(100).optional() }),
);

export const ArtifactBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("summary"),
    overview: z.string(),
    sections: z.array(z.object({ heading: z.string(), points: z.array(z.string()) })),
  }),
  z.object({
    kind: z.literal("quiz"),
    questions: z.array(
      z.object({ q: z.string(), options: z.array(z.string()), answer: z.number().int(), why: z.string() }),
    ),
  }),
  z.object({ kind: z.literal("flashcards"), cards: z.array(z.object({ front: z.string(), back: z.string() })) }),
  z.object({ kind: z.literal("mindmap"), root: MindNode }),
  z.object({
    kind: z.literal("infographic"),
    headline: z.string(),
    stats: z.array(z.object({ value: z.string(), label: z.string() })),
    steps: z.array(z.object({ title: z.string(), text: z.string() })),
  }),
]);
export type ArtifactBody = z.infer<typeof ArtifactBody>;

export const Artifact = z.object({
  id: Id,
  title: Text(200),
  sources: z.array(Id).max(50),
  author: Actor,
  at: Time,
  preview: z.boolean(),
  body: ArtifactBody,
});
export type Artifact = z.infer<typeof Artifact>;

// --- Events ---

const EventBase = { id: Id, at: Time, actor: Actor };

export const LedgerEvent = z.discriminatedUnion("type", [
  z.object({ ...EventBase, type: z.literal("doc.add"), doc: DocRef }),
  z.object({ ...EventBase, type: z.literal("doc.remove"), doc_id: Id }),
  z.object({ ...EventBase, type: z.literal("annot.add"), annotation: Annotation }),
  z.object({ ...EventBase, type: z.literal("annot.remove"), annotation_id: Id }),
  z.object({ ...EventBase, type: z.literal("note.edit"), annotation_id: Id, body: Text(2000) }),
  z.object({ ...EventBase, type: z.literal("thread.ask"), thread: Id, message: UserMessage }),
  z.object({ ...EventBase, type: z.literal("thread.answer"), thread: Id, message: AiReply }),
  z.object({ ...EventBase, type: z.literal("chat"), message: ChatMessage }),
  z.object({ ...EventBase, type: z.literal("artifact.add"), artifact: Artifact }),
  z.object({ ...EventBase, type: z.literal("artifact.remove"), artifact_id: Id }),
  z.object({ ...EventBase, type: z.literal("role.set"), member: Id, name: Text(40), role: Role }),
  z.object({ ...EventBase, type: z.literal("member.kick"), member: Id, name: Text(40) }),
  z.object({ ...EventBase, type: z.literal("settings.update"), patch: RoomSettings.partial() }),
]);
export type LedgerEvent = z.infer<typeof LedgerEvent>;
export type LedgerEventType = LedgerEvent["type"];

export const LEDGER_EVENT_TYPES = LedgerEvent.options.map((o) => o.shape.type.value) as LedgerEventType[];
// Events a closed or archived room still takes: its settings, roles and kicks (as in the frontend).
export const ADMIN_EVENT_TYPES: ReadonlySet<LedgerEventType> = new Set(["role.set", "member.kick", "settings.update"]);

// POST /api/rooms/:id/events. Each event is validated on its own, so one bad event doesn't sink the
// batch: the body only has to be a list.
export const PostEventsRequest = z.object({ events: z.array(z.unknown()).min(1).max(MAX_LEDGER_BATCH) });
export const PostEventsResponse = z.object({
  accepted: z.array(z.string()),
  rejected: z.array(z.object({ id: z.string().nullable(), reason: z.string() })),
});
export type PostEventsResponse = z.infer<typeof PostEventsResponse>;

export const ListEventsQuery = z.object({
  after: z.coerce.number().int().min(0).default(0), // the `seq` of the last event already held
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export const ListEventsResponse = z.object({
  events: z.array(LedgerEvent.and(z.object({ seq: z.number().int() }))),
  next: z.number().int().nullable(), // pass as `after` for the next page; null when there is none
});
export type ListEventsResponse = z.infer<typeof ListEventsResponse>;

export const RoomMember = z.object({
  member_id: z.string(),
  name: z.string(),
  role: Role.nullable(), // null: the room's default for guests or members applies
  kicked_at: z.string().nullable(),
});
export type RoomMember = z.infer<typeof RoomMember>;
export const RoomMembersResponse = z.object({ members: z.array(RoomMember), settings: RoomSettings });
export type RoomMembersResponse = z.infer<typeof RoomMembersResponse>;

// Guests prove who they are with a secret their browser keeps: the first write from a guest id
// stores its hash, and later requests must send the same key (headers X-Guest-Id, X-Guest-Key).
export const GUEST_ID_HEADER = "x-guest-id";
export const GUEST_KEY_HEADER = "x-guest-key";
export const GuestId = z.string().regex(/^guest-[A-Za-z0-9_-]{4,40}$/);
export const GuestKey = z.string().min(16).max(200);
