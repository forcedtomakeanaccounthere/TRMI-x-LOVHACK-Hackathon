import { createHash } from "node:crypto";
import {
  ADMIN_EVENT_TYPES,
  DEFAULT_ROOM_SETTINGS,
  GUEST_ID_HEADER,
  GUEST_KEY_HEADER,
  GuestId,
  GuestKey,
  type LedgerEvent,
  type Role,
  type RoomSettings,
} from "@linkroom/shared";
import type { Request } from "express";
import { HttpError } from "../middleware/error";
import { supabaseAdmin } from "./supabase";

// Who may change what in a room workspace. The rules are the frontend's
// (apps/frontend/src/components/room/ledger.ts `roleOf` and `can`), enforced here on every event
// written to room_events and on the room's AI and sources endpoints.

export const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export const can = {
  annotate: (role: Role) => RANK[role] >= RANK.editor,
  addSources: (role: Role) => RANK[role] >= RANK.editor,
  generate: (role: Role) => RANK[role] >= RANK.editor,
  manage: (role: Role) => RANK[role] >= RANK.admin,
  useAi: (role: Role, settings: RoomSettings) => RANK[role] >= RANK.editor || settings.viewersUseAi,
  // Admins manage editors and viewers; only the owner changes an admin.
  changeRole: (mine: Role, theirs: Role) => theirs !== "owner" && RANK[mine] > RANK[theirs] && RANK[mine] >= RANK.admin,
};

export type Identity = { id: string; signedIn: boolean; keyHash: string | null };

export function roleOf(
  identity: Pick<Identity, "id" | "signedIn"> | null,
  ownerId: string | null,
  setRole: Role | null | undefined,
  settings: RoomSettings,
): Role {
  if (identity && ownerId && identity.id === ownerId) return "owner";
  if (setRole && setRole !== "owner") return setRole;
  return identity?.signedIn ? settings.memberRole : settings.guestRole;
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/**
 * Who is calling: a signed-in account, a guest proving its id with its key (headers X-Guest-Id and
 * X-Guest-Key), or nobody in particular (null). A guest id without a valid key is refused, so one
 * guest can't speak for another.
 */
export function identify(req: Request): Identity | null {
  if (req.user) return { id: req.user.id, signedIn: true, keyHash: null };
  const id = req.header(GUEST_ID_HEADER);
  const key = req.header(GUEST_KEY_HEADER);
  if (!id && !key) return null;
  if (!GuestId.safeParse(id).success || !GuestKey.safeParse(key).success) {
    throw new HttpError(401, "Send a guest id and key together (X-Guest-Id, X-Guest-Key).");
  }
  return { id: id!, signedIn: false, keyHash: hashKey(key!) };
}

export type MemberRow = { member_id: string; name: string; role: Role | null; kicked_at: string | null; key_hash: string | null };
type SettingsRow = {
  allow_guests: boolean;
  guest_role: RoomSettings["guestRole"];
  member_role: RoomSettings["memberRole"];
  viewers_use_ai: boolean;
};

export const settingsFromRow = (row: SettingsRow | null): RoomSettings =>
  row
    ? {
        allowGuests: row.allow_guests,
        guestRole: row.guest_role,
        memberRole: row.member_role,
        viewersUseAi: row.viewers_use_ai,
      }
    : DEFAULT_ROOM_SETTINGS;

export const settingsToRow = (roomId: string, s: RoomSettings) => ({
  room_id: roomId,
  allow_guests: s.allowGuests,
  guest_role: s.guestRole,
  member_role: s.memberRole,
  viewers_use_ai: s.viewersUseAi,
  updated_at: new Date().toISOString(),
});

export type Access = {
  roomId: string;
  status: string;
  ownerId: string | null;
  identity: Identity | null;
  member: MemberRow | null;
  role: Role;
  kicked: boolean;
  settings: RoomSettings;
};

/**
 * The caller's place in a room: its role, whether it was removed, and the room's settings. Throws 404
 * for an unknown or deleted room, and 403 for a guest whose key doesn't match the one its id was
 * first used with.
 */
export async function roomAccess(roomId: string, req: Request): Promise<Access> {
  const identity = identify(req);
  const db = supabaseAdmin();
  const [room, settings, member] = await Promise.all([
    db.from("rooms").select("status, created_by").eq("id", roomId).maybeSingle(),
    db.from("room_settings").select("allow_guests, guest_role, member_role, viewers_use_ai").eq("room_id", roomId).maybeSingle(),
    identity
      ? db
          .from("room_members")
          .select("member_id, name, role, kicked_at, key_hash")
          .eq("room_id", roomId)
          .eq("member_id", identity.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (room.error) throw room.error;
  if (settings.error) throw settings.error;
  if (member.error) throw member.error;
  if (!room.data || room.data.status === "deleted") throw new HttpError(404, "Room not found");

  const row = member.data as MemberRow | null;
  if (identity && !identity.signedIn && row?.key_hash && row.key_hash !== identity.keyHash) {
    throw new HttpError(403, "That guest id belongs to someone else.");
  }
  const roomSettings = settingsFromRow(settings.data as SettingsRow | null);
  const ownerId = (room.data.created_by as string | null) ?? null;
  return {
    roomId,
    status: room.data.status as string,
    ownerId,
    identity,
    member: row,
    role: roleOf(identity, ownerId, row?.role, roomSettings),
    kicked: Boolean(row?.kicked_at) && identity?.id !== ownerId,
    settings: roomSettings,
  };
}

/** Throws unless the caller may take part at all: not removed, and not a guest where guests aren't allowed. */
export function assertParticipant(access: Access) {
  if (access.kicked) throw new HttpError(403, "You were removed from this room.");
  if (!access.identity?.signedIn && !access.settings.allowGuests && access.identity?.id !== access.ownerId) {
    throw new HttpError(403, "This room is for signed-in members only.");
  }
}

// --- Checking events ---

type Authored = "annotation" | "artifact" | "doc";

export type RuleContext = {
  roomId: string;
  status: string;
  ownerId: string | null;
  me: Identity;
  settings: RoomSettings;
  members: Map<string, MemberRow>;
  // Who added an annotation, artifact or document (the actor of its add event), if it was added.
  authorOf: (kind: Authored, id: string) => string | undefined;
};

export const myRole = (ctx: RuleContext) => roleOf(ctx.me, ctx.ownerId, ctx.members.get(ctx.me.id)?.role, ctx.settings);
const theirRole = (ctx: RuleContext, id: string) =>
  roleOf({ id, signedIn: !id.startsWith("guest-") }, ctx.ownerId, ctx.members.get(id)?.role, ctx.settings);

/** Why `event` can't be written by ctx.me, or null when it can. Pure: everything it needs is in ctx. */
export function checkEvent(event: LedgerEvent, ctx: RuleContext): string | null {
  if (event.actor.id !== ctx.me.id) return "The event's actor isn't you";
  const me = ctx.members.get(ctx.me.id);
  if (me?.kicked_at && ctx.me.id !== ctx.ownerId) return "You were removed from this room";
  if (!ctx.me.signedIn && !ctx.settings.allowGuests) return "This room is for signed-in members only";
  if (ctx.status !== "running" && !ADMIN_EVENT_TYPES.has(event.type)) return "This room is read only";

  const role = myRole(ctx);
  // The author of something, or someone who manages the room. Something added before the ledger
  // was kept (a saved highlight) has no add event: any editor may remove it.
  const authorOrManager = (kind: Authored, id: string) => {
    const author = ctx.authorOf(kind, id);
    if (author === undefined) return can.annotate(role);
    return author === ctx.me.id || can.manage(role);
  };

  switch (event.type) {
    case "annot.add":
      if (!can.annotate(role)) return "Your role can't annotate";
      if (event.annotation.author.id !== ctx.me.id) return "An annotation's author must be you";
      if (event.annotation.kind === "ai" && !can.useAi(role, ctx.settings)) return "Your role can't use the AI";
      return null;
    case "note.edit":
      // Only a note's author edits it (apps/frontend boxes.tsx).
      return can.annotate(role) && ctx.authorOf("annotation", event.annotation_id) === ctx.me.id
        ? null
        : "Only the note's author can edit it";
    case "annot.remove":
      return authorOrManager("annotation", event.annotation_id) ? null : "Only its author or an admin can remove this";
    case "doc.add":
      return can.addSources(role) ? null : "Your role can't add sources";
    case "doc.remove":
      if (event.doc_id === ctx.roomId) return "The room's own document can't be removed";
      return can.addSources(role) && authorOrManager("doc", event.doc_id) ? null : "Only who added it or an admin can remove this source";
    case "thread.ask":
      if (event.message.author.id !== ctx.me.id) return "A question's author must be you";
      return can.useAi(role, ctx.settings) ? null : "Your role can't use the AI";
    case "thread.answer":
      // The asker's browser records the answer it got back.
      return can.useAi(role, ctx.settings) ? null : "Your role can't use the AI";
    case "chat":
      return event.message.author.id === ctx.me.id ? null : "A message's author must be you";
    case "artifact.add":
      if (event.artifact.author.id !== ctx.me.id) return "An artifact's author must be you";
      return can.generate(role) ? null : "Your role can't make artifacts";
    case "artifact.remove":
      return authorOrManager("artifact", event.artifact_id) ? null : "Only its author or an admin can remove this";
    case "role.set": {
      if (event.member === ctx.ownerId || event.role === "owner") return "The owner's role can't change";
      if (!can.changeRole(role, theirRole(ctx, event.member))) return "You can't change this person's role";
      // Nobody hands out a role as high as their own, except the owner making admins.
      if (RANK[event.role] >= RANK[role] && role !== "owner") return "You can't give a role as high as yours";
      return null;
    }
    case "member.kick":
      if (event.member === ctx.ownerId || event.member === ctx.me.id) return "That person can't be removed";
      return can.changeRole(role, theirRole(ctx, event.member)) ? null : "You can't remove this person";
    case "settings.update":
      return can.manage(role) ? null : "Only admins can change the room's settings";
  }
}

/** Applies an accepted event to the members and settings it changes (in place). */
export function project(event: LedgerEvent, ctx: RuleContext, now = new Date().toISOString()) {
  const upsert = (id: string, name: string, patch: Partial<MemberRow>) => {
    const row = ctx.members.get(id) ?? { member_id: id, name, role: null, kicked_at: null, key_hash: null };
    ctx.members.set(id, { ...row, ...patch });
  };
  switch (event.type) {
    case "role.set":
      upsert(event.member, event.name || "Someone", { role: event.role });
      break;
    case "member.kick":
      upsert(event.member, event.name || "Someone", { kicked_at: now });
      break;
    case "settings.update":
      ctx.settings = { ...ctx.settings, ...event.patch };
      break;
  }
}

/** The id an add event introduces, or that a remove/edit event points at. */
export function authoredRef(event: LedgerEvent): { kind: Authored; id: string } | null {
  switch (event.type) {
    case "annot.add":
      return { kind: "annotation", id: event.annotation.id };
    case "artifact.add":
      return { kind: "artifact", id: event.artifact.id };
    case "doc.add":
      return { kind: "doc", id: event.doc.id };
    case "annot.remove":
    case "note.edit":
      return { kind: "annotation", id: event.annotation_id };
    case "artifact.remove":
      return { kind: "artifact", id: event.artifact_id };
    case "doc.remove":
      return { kind: "doc", id: event.doc_id };
    default:
      return null;
  }
}

export const ADD_TYPE: Record<Authored, LedgerEvent["type"]> = {
  annotation: "annot.add",
  artifact: "artifact.add",
  doc: "doc.add",
};
