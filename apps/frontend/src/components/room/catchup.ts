import { type MentionPerson, parseMentions } from "@linkroom/shared";
import type { Actor, Annotation, ChatMessage, LedgerEvent, NotebookEntry } from "./types";

// "While you were away": what others did in a room between your last visit and this one, from the
// room's ledger. Built in the browser, so it covers everything the workspace records (marks,
// comments, discussion, room notes) and costs no AI call.

type Mark = Extract<Annotation, { kind: "highlight" | "underline" }>;
type Note = Extract<Annotation, { kind: "note" }>;

export type Catchup = {
  since: string;
  highlights: Mark[];
  comments: Note[]; // comments left or edited, with their latest text
  messages: ChatMessage[]; // the discussion
  waiting: ChatMessage[]; // messages that @mention you or answer you, not yet replied to
  roomNotes: NotebookEntry[];
  people: Actor[]; // who was active, most active first
};

/**
 * What changed in the room after `since` and up to `until` (when this visit began, so what happens
 * while you're here isn't "while you were away"), by people other than `me`. Null when nothing did.
 */
export function buildCatchup(
  events: LedgerEvent[],
  me: { id: string; name: string },
  since: string,
  until: string,
): Catchup | null {
  // Things removed later (at any time) aren't worth catching up on.
  const removed = new Set<string>();
  const people = new Map<string, MentionPerson>([[me.id, { id: me.id, name: me.name }]]);
  const mine = new Set<string>(); // ids of my messages
  const repliedTo = new Set<string>(); // messages I answered
  for (const e of events) {
    people.set(e.actor.id, { id: e.actor.id, name: e.actor.name });
    if (e.type === "annot.remove") removed.add(e.annotation_id);
    if (e.type === "notebook.remove") removed.add(e.entry_id);
    if (e.type === "chat" && e.actor.id === me.id) {
      mine.add(e.message.id);
      if (e.message.reply_to) repliedTo.add(e.message.reply_to);
    }
  }
  const mentionable = [...people.values()];

  const highlights: Mark[] = [];
  const comments = new Map<string, Note>();
  const notes = new Map<string, Annotation>();
  const messages: ChatMessage[] = [];
  const waiting: ChatMessage[] = [];
  const roomNotes: NotebookEntry[] = [];
  const active = new Map<string, { actor: Actor; count: number }>();

  for (const e of events) {
    if (e.type === "annot.add" && e.annotation.kind === "note") notes.set(e.annotation.id, e.annotation);
    if (e.at <= since || e.at > until || e.actor.id === me.id) continue;
    let counted = true;
    switch (e.type) {
      case "annot.add": {
        const a = e.annotation;
        if (removed.has(a.id)) counted = false;
        else if (a.kind === "highlight" || a.kind === "underline") highlights.push(a);
        else if (a.kind === "note" && a.body.trim()) comments.set(a.id, a);
        break;
      }
      case "note.edit": {
        const note = notes.get(e.annotation_id);
        if (note?.kind === "note" && !removed.has(note.id) && e.body.trim()) comments.set(note.id, { ...note, body: e.body });
        break;
      }
      case "chat": {
        messages.push(e.message);
        const toMe =
          parseMentions(e.message.text, mentionable).some((p) => p.id === me.id) ||
          (e.message.reply_to !== undefined && mine.has(e.message.reply_to));
        if (toMe && !repliedTo.has(e.message.id)) waiting.push(e.message);
        break;
      }
      case "notebook.add":
        if (!removed.has(e.entry.id)) roomNotes.push(e.entry);
        break;
      default:
        counted = false;
    }
    if (counted) {
      const seen = active.get(e.actor.id) ?? { actor: e.actor, count: 0 };
      active.set(e.actor.id, { actor: e.actor, count: seen.count + 1 });
    }
  }

  const result: Catchup = {
    since,
    highlights,
    comments: [...comments.values()],
    messages,
    waiting,
    roomNotes,
    people: [...active.values()].sort((a, b) => b.count - a.count).map((p) => p.actor),
  };
  const empty = !highlights.length && !comments.size && !messages.length && !roomNotes.length;
  return empty ? null : result;
}

// When this browser last had the room open, per person (a guest and an account can share it).
const visitKey = (roomId: string, meId: string) => `linkroom-visit:${roomId}:${meId}`;

export function lastVisit(roomId: string, meId: string): string | null {
  try {
    return localStorage.getItem(visitKey(roomId, meId));
  } catch {
    return null;
  }
}

export function markVisit(roomId: string, meId: string, at = new Date().toISOString()) {
  try {
    localStorage.setItem(visitKey(roomId, meId), at);
  } catch {
    // Blocked storage: no catch-up next time.
  }
}
