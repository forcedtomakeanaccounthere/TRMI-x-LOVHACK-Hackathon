import type { RoomKind, RoomStatus, RoomSummary, SourceMeta } from "@linkroom/shared";

// A room holds several documents. The first is the room itself; every other one is a backend room
// created by an upload or link (so extraction, highlights and indexing work unchanged), or a YouTube
// video that hasn't been turned into a transcript yet.
export type DocKind = RoomKind | "video";

export type DocRef = {
  id: string; // backend room id, or "yt:<videoId>" for an unprocessed video
  kind: DocKind;
  title: string;
  source_url: string | null;
  format: SourceMeta["format"] | null;
};

// What the viewer needs to render a document, loaded from Supabase (or bundled for the demo room).
export type DocContent = {
  id: string;
  kind: DocKind;
  title: string;
  source_url: string | null;
  content_html: string | null;
  pdf_url: string | null;
  status: RoomStatus;
  created_by: string | null;
  summary: RoomSummary | null;
  ai_status: string | null;
};

export type Actor = { id: string; name: string; color: string };

export type Role = "owner" | "admin" | "editor" | "viewer";

export type RoomSettings = {
  allowGuests: boolean;
  guestRole: "viewer" | "editor";
  memberRole: "viewer" | "editor"; // signed-in people other than the owner
  viewersUseAi: boolean;
};

export const DEFAULT_SETTINGS: RoomSettings = {
  allowGuests: true,
  guestRole: "editor",
  memberRole: "editor",
  viewersUseAi: true,
};

// Points and rectangles are fractions (0–1) of their block's box, so they land on the same words on a
// phone and on a wide monitor.
export type Point = [number, number];
export type Rect = { x: number; y: number; w: number; h: number };

type AnnotationBase = {
  id: string;
  doc: string;
  block: string;
  author: Actor;
  at: string;
};

export type Annotation = AnnotationBase &
  (
    | {
        kind: "highlight" | "underline";
        start: number;
        end: number;
        quote: string;
        color: string;
      }
    | { kind: "region"; rect: Rect; color: string }
    | { kind: "ink"; points: Point[]; color: string; width: number }
    // moved: dragged by someone, so x/y place it exactly instead of in the margin beside its line.
    // edited_by / moved_by: the last person to edit or move it (shown when that isn't the author).
    | {
        kind: "note";
        x: number;
        y: number;
        body: string;
        color: string;
        moved?: boolean;
        edited_by?: Actor;
        moved_by?: Actor;
      }
    // An AI box beside a line (quote) or a lens snapshot (image). Its conversation is threads[id].
    | {
        kind: "ai";
        x: number;
        y: number;
        quote: string | null;
        image: string | null;
        moved?: boolean;
        moved_by?: Actor;
      }
  );

export type AnnotationKind = Annotation["kind"];

export type Citation = { doc: string; block: string; quote: string };

export type ThreadMessage =
  | {
      id: string;
      role: "user";
      text: string;
      author: Actor;
      at: string;
      sources: string[];
    }
  | {
      id: string;
      role: "ai";
      text: string;
      at: string;
      reply_to: string;
      citations: Citation[];
      preview: boolean;
      failed?: boolean; // the AI refused or errored; the text says why
    };

export type ChatMessage = {
  id: string;
  text: string;
  author: Actor;
  at: string;
  reply_to?: string; // id of the message this answers
};

// Emoji reactions on discussion messages: message id → emoji → who reacted.
export type ChatReactions = Record<string, Record<string, Actor[]>>;

export type ArtifactKind = "summary" | "quiz" | "flashcards" | "mindmap" | "infographic";

export type MindNode = { label: string; children?: MindNode[] };

export type ArtifactBody =
  | {
      kind: "summary";
      overview: string;
      sections: { heading: string; points: string[] }[];
    }
  | {
      kind: "quiz";
      questions: {
        q: string;
        options: string[];
        answer: number;
        why: string;
      }[];
    }
  | { kind: "flashcards"; cards: { front: string; back: string }[] }
  | { kind: "mindmap"; root: MindNode }
  | {
      kind: "infographic";
      headline: string;
      stats: { value: string; label: string }[];
      steps: { title: string; text: string }[];
    };

export type Artifact = {
  id: string;
  title: string;
  sources: string[]; // doc ids
  author: Actor;
  at: string;
  preview: boolean; // built in the browser because the AI endpoint isn't available
  body: ArtifactBody;
};

// Every change to a room is one of these. They are never edited: the room's state is the result of
// replaying them, and the history panel lists them as they are.
export type LedgerPayload =
  | { type: "doc.add"; doc: DocRef }
  | { type: "doc.remove"; doc_id: string }
  | { type: "annot.add"; annotation: Annotation }
  | { type: "annot.remove"; annotation_id: string }
  | { type: "note.edit"; annotation_id: string; body: string }
  // A comment or AI box dragged to a new spot (fractions of its block, like where it was made).
  | { type: "annot.move"; annotation_id: string; x: number; y: number }
  | {
      type: "thread.ask";
      thread: string;
      message: Extract<ThreadMessage, { role: "user" }>;
    }
  | {
      type: "thread.answer";
      thread: string;
      message: Extract<ThreadMessage, { role: "ai" }>;
    }
  | { type: "chat"; message: ChatMessage }
  // Toggles the actor's reaction: the first one adds it, the next one takes it back.
  | { type: "chat.react"; message_id: string; emoji: string }
  | { type: "artifact.add"; artifact: Artifact }
  | { type: "artifact.remove"; artifact_id: string }
  | { type: "role.set"; member: string; name: string; role: Role }
  | { type: "member.kick"; member: string; name: string }
  | { type: "settings.update"; patch: Partial<RoomSettings> };

export type LedgerEvent = LedgerPayload & {
  id: string;
  at: string;
  actor: Actor;
};

export type Tool = "select" | "highlight" | "underline" | "pen" | "region" | "eraser" | "note";

export const INK_COLORS = ["#facc15", "#4ade80", "#38bdf8", "#f472b6", "#a78bfa", "#fb923c", "#ef4444"] as const;

// The thread the room-wide AI chat panel writes to; an AI box's thread is its annotation id.
export const ROOM_CHAT_THREAD = "room";
