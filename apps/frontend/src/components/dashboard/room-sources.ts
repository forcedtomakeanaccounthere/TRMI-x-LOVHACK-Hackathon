import { reduceLedger } from "@/components/room/ledger";
import type { DocRef, LedgerEvent } from "@/components/room/types";
import type { RoomView } from "./types";

// A room holds several sources, but each upload or link is created as its own backend room (so
// extraction, highlights and indexing work unchanged). GET /api/me/rooms therefore lists every source
// as if it were a room. Until the backend records which room a source belongs to (rooms.parent_id,
// CHECKLIST.md), the room ledgers saved in this browser say so: each room's doc.add events name its
// sources. This folds those sources into their room and adds up what happened in them.

export type LedgerSummary = {
  sources: string[]; // attached sources now (not the room's own document)
  everAttached: string[]; // every source ever attached, removed ones too: those never show as rooms
  comments: number; // comment boxes in the room
  aiQueries: number; // questions asked in AI chat and AI boxes
};

const LEDGER_PREFIX = "linkroom-ledger:";

// What each room's ledger in localStorage says about it.
export function readRoomLedgers(): Map<string, LedgerSummary> {
  const out = new Map<string, LedgerSummary>();
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(LEDGER_PREFIX));
  } catch {
    return out; // storage blocked: nothing to fold
  }
  for (const key of keys) {
    const roomId = key.slice(LEDGER_PREFIX.length);
    try {
      const events = JSON.parse(localStorage.getItem(key) ?? "[]") as LedgerEvent[];
      if (Array.isArray(events) && events.length) out.set(roomId, summarise(roomId, events));
    } catch {
      // a damaged ledger is skipped, not fatal
    }
  }
  return out;
}

export function summarise(roomId: string, events: LedgerEvent[]): LedgerSummary {
  const primary: DocRef = { id: roomId, kind: "link", title: "", source_url: null, format: null };
  const state = reduceLedger(primary, events);
  return {
    sources: state.docs.filter((d) => d.id !== roomId).map((d) => d.id),
    everAttached: [...new Set(events.flatMap((e) => (e.type === "doc.add" && e.doc.id !== roomId ? [e.doc.id] : [])))],
    comments: state.annotations.filter((a) => a.kind === "note").length,
    aiQueries: Object.values(state.threads)
      .flat()
      .filter((m) => m.role === "user").length,
  };
}

// Hides rooms that are sources of another listed room, and gives each room the totals of its sources:
// highlights and comments from the API across all of them, plus comment boxes and AI questions from
// the ledger. attachments counts every document in the room, its own included.
export function foldSources(rooms: RoomView[], ledgers: Map<string, LedgerSummary>): RoomView[] {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const parentOf = new Map<string, string>();
  for (const [roomId, summary] of ledgers) {
    if (!byId.has(roomId)) continue;
    for (const source of summary.everAttached) {
      // Two rooms naming each other: leave both as rooms rather than hide either.
      if (source !== roomId && !ledgers.get(source)?.everAttached.includes(roomId)) parentOf.set(source, roomId);
    }
  }
  // A source of a source still belongs to the top room.
  const topOf = (id: string) => {
    let current = id;
    const seen = new Set<string>();
    while (parentOf.has(current) && !seen.has(current)) {
      seen.add(current);
      current = parentOf.get(current)!;
    }
    return current;
  };

  return rooms
    .filter((r) => topOf(r.id) === r.id)
    .map((room) => {
      const summary = ledgers.get(room.id);
      const children = rooms.filter((r) => r.id !== room.id && topOf(r.id) === room.id);
      const all = [room, ...children];
      return {
        ...room,
        // The latest activity anywhere in the room.
        last_activity_at: all.reduce(
          (latest, r) => (r.last_activity_at > latest ? r.last_activity_at : latest),
          room.last_activity_at,
        ),
        participants: dedupe(all.flatMap((r) => r.participants)),
        live_count: Math.max(...all.map((r) => r.live_count)),
        counts: {
          attachments: 1 + (summary?.sources.length ?? children.length),
          highlights: all.reduce((n, r) => n + r.counts.highlights, 0),
          comments: all.reduce((n, r) => n + r.counts.comments, 0) + (summary?.comments ?? 0),
          ai_queries: all.reduce((n, r) => n + r.counts.ai_queries, 0) + (summary?.aiQueries ?? 0),
        },
      };
    });
}

function dedupe<T extends { id: string }>(people: T[]): T[] {
  const seen = new Set<string>();
  return people.filter((p) => !seen.has(p.id) && seen.add(p.id));
}
