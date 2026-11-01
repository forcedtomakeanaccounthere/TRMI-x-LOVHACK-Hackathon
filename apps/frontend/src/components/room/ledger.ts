import {
  type Annotation,
  type Artifact,
  type ChatMessage,
  type ChatReactions,
  DEFAULT_SETTINGS,
  type DocRef,
  type LedgerEvent,
  type Role,
  type RoomSettings,
  type ThreadMessage,
} from "./types";

// The room's shared state, rebuilt from its ledger. Until the backend has tables for these
// (CHECKLIST.md "Link rooms workspace"), the ledger lives in each browser and peers swap it over
// the realtime channel, so everyone in the room converges on the same events.

export type RoomState = {
  docs: DocRef[];
  annotations: Annotation[];
  threads: Record<string, ThreadMessage[]>;
  chat: ChatMessage[];
  reactions: ChatReactions;
  artifacts: Artifact[];
  roles: Record<string, Role>;
  kicked: Record<string, string>; // member id → name
  settings: RoomSettings;
};

export const byTime = (a: { at: string; id: string }, b: { at: string; id: string }) =>
  a.at === b.at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.at < b.at ? -1 : 1;

// Adds events not seen before, keeping the ledger in time order. Returns the same array when nothing
// is new, so callers can skip a re-render.
export function mergeEvents(current: LedgerEvent[], incoming: LedgerEvent[]): LedgerEvent[] {
  const seen = new Set(current.map((e) => e.id));
  const fresh = incoming.filter((e) => e && typeof e.id === "string" && !seen.has(e.id) && seen.add(e.id));
  if (fresh.length === 0) return current;
  return [...current, ...fresh].sort(byTime);
}

export function reduceLedger(primary: DocRef, events: LedgerEvent[]): RoomState {
  const docs = new Map<string, DocRef>([[primary.id, primary]]);
  const annotations = new Map<string, Annotation>();
  const threads: Record<string, ThreadMessage[]> = {};
  const chat: ChatMessage[] = [];
  const reactions: ChatReactions = {};
  const artifacts = new Map<string, Artifact>();
  const roles: Record<string, Role> = {};
  const kicked: Record<string, string> = {};
  let settings = DEFAULT_SETTINGS;

  for (const e of events) {
    switch (e.type) {
      case "doc.add":
        if (!docs.has(e.doc.id)) docs.set(e.doc.id, e.doc);
        break;
      case "doc.remove":
        if (e.doc_id !== primary.id) docs.delete(e.doc_id);
        break;
      case "annot.add":
        annotations.set(e.annotation.id, e.annotation);
        break;
      case "annot.remove":
        annotations.delete(e.annotation_id);
        break;
      case "note.edit": {
        const note = annotations.get(e.annotation_id);
        if (note?.kind === "note") annotations.set(note.id, { ...note, body: e.body, edited_by: e.actor });
        break;
      }
      case "annot.move": {
        const box = annotations.get(e.annotation_id);
        if (box?.kind === "note" || box?.kind === "ai")
          annotations.set(box.id, { ...box, x: e.x, y: e.y, moved: true, moved_by: e.actor });
        break;
      }
      case "thread.ask":
      case "thread.answer":
        (threads[e.thread] ??= []).push(e.message);
        break;
      case "chat":
        chat.push(e.message);
        break;
      case "chat.react": {
        const byEmoji = (reactions[e.message_id] ??= {});
        const who = byEmoji[e.emoji] ?? [];
        byEmoji[e.emoji] = who.some((a) => a.id === e.actor.id)
          ? who.filter((a) => a.id !== e.actor.id)
          : [...who, e.actor];
        if (byEmoji[e.emoji]!.length === 0) delete byEmoji[e.emoji];
        break;
      }
      case "artifact.add":
        artifacts.set(e.artifact.id, e.artifact);
        break;
      case "artifact.remove":
        artifacts.delete(e.artifact_id);
        break;
      case "role.set":
        roles[e.member] = e.role;
        break;
      case "member.kick":
        kicked[e.member] = e.name;
        break;
      case "settings.update":
        settings = { ...settings, ...e.patch };
        break;
    }
  }

  const docIds = new Set(docs.keys());
  return {
    docs: [...docs.values()],
    // Marks on a removed document go with it.
    annotations: [...annotations.values()].filter((a) => docIds.has(a.doc)),
    threads,
    chat,
    reactions,
    artifacts: [...artifacts.values()].sort(byTime).reverse(),
    roles,
    kicked,
    settings,
  };
}

// --- Permissions ---

export type Member = { id: string; signedIn: boolean };

export function roleOf(member: Member, ownerId: string | null, state: Pick<RoomState, "roles" | "settings">): Role {
  if (ownerId && member.id === ownerId) return "owner";
  const set = state.roles[member.id];
  if (set && set !== "owner") return set;
  return member.signedIn ? state.settings.memberRole : state.settings.guestRole;
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export const can = {
  annotate: (role: Role) => RANK[role] >= RANK.editor,
  addSources: (role: Role) => RANK[role] >= RANK.editor,
  generate: (role: Role) => RANK[role] >= RANK.editor,
  manage: (role: Role) => RANK[role] >= RANK.admin, // roles, settings, removing people and sources
  useAi: (role: Role, settings: RoomSettings) => RANK[role] >= RANK.editor || settings.viewersUseAi,
  // Admins manage editors and viewers; only the owner changes an admin.
  changeRole: (mine: Role, theirs: Role) => theirs !== "owner" && RANK[mine] > RANK[theirs] && RANK[mine] >= RANK.admin,
};

export const ROLE_RANK = RANK;

// --- Persistence ---

const ledgerKey = (roomId: string) => `linkroom-ledger:${roomId}`;

export function loadLedger(roomId: string): LedgerEvent[] {
  try {
    const raw = localStorage.getItem(ledgerKey(roomId));
    const parsed = raw ? (JSON.parse(raw) as LedgerEvent[]) : [];
    return Array.isArray(parsed) ? parsed.sort(byTime) : [];
  } catch {
    return [];
  }
}

export function saveLedger(roomId: string, events: LedgerEvent[]) {
  try {
    localStorage.setItem(ledgerKey(roomId), JSON.stringify(events));
  } catch {
    // Full or blocked storage: the peers still hold the ledger, so this browser re-syncs on its next visit.
  }
}

// Splits events into batches under the realtime message size limit (256 KB; kept well below).
export function chunkEvents(events: LedgerEvent[], maxBytes = 120_000): LedgerEvent[][] {
  const batches: LedgerEvent[][] = [];
  let batch: LedgerEvent[] = [];
  let size = 0;
  for (const e of events) {
    const bytes = JSON.stringify(e).length;
    if (batch.length && size + bytes > maxBytes) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(e);
    size += bytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
