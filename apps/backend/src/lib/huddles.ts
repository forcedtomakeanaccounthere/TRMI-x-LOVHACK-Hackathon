import { roomChannel, type LedgerEvent, type Role, type RoomSettings } from "@linkroom/shared";
import type { Request } from "express";
import { HttpError } from "../middleware/error";
import { assertParticipant, can, roomAccess, type Access } from "./ledger";
import { closeRoom, participantCount, removeFromRoom, setPublish } from "./livekit";
import { supabaseAdmin } from "./supabase";

// Access rules and side effects for voice huddles (supabase/migrations/0028_huddles.sql).
// Huddle content is private to huddle members and never written to room_events.

export type HuddleRow = {
  id: string;
  room_id: string;
  livekit_room: string;
  audience: "all" | "private";
  created_by: string;
  created_by_name: string;
  started_at: string;
  ended_at: string | null;
  notes_status: "none" | "generating" | "ready" | "failed";
  notes_error: string | null;
};

export type HuddleMemberRow = {
  huddle_id: string;
  member_id: string;
  name: string;
  invited_by: string | null;
  invited_at: string;
  joined_at: string | null;
  left_at: string | null;
};

export type HuddleAccess = {
  access: Access;
  huddle: HuddleRow;
  member: HuddleMemberRow | null;
};

export function livekitRoomName(roomId: string, huddleId: string): string {
  return `lr_${roomId}_${huddleId}`;
}

/**
 * Access to a specific huddle: verifies room participant status, then checks huddle existence
 * and invite membership for private huddles (404 if not found or non-invitee, owner included).
 */
export async function huddleAccess(roomId: string, huddleId: string, req: Request): Promise<HuddleAccess> {
  const access = await roomAccess(roomId, req);
  if (!access.identity) {
    throw new HttpError(401, "Sign in, or send your guest id and key (X-Guest-Id, X-Guest-Key).");
  }
  assertParticipant(access);

  const db = supabaseAdmin();
  const { data: huddle, error } = await db
    .from("huddles")
    .select("*")
    .eq("id", huddleId)
    .eq("room_id", roomId)
    .maybeSingle();
  if (error) throw error;
  if (!huddle) throw new HttpError(404, "Huddle not found");

  const { data: member, error: memberErr } = await db
    .from("huddle_members")
    .select("*")
    .eq("huddle_id", huddleId)
    .eq("member_id", access.identity.id)
    .maybeSingle();
  if (memberErr) throw memberErr;

  if (huddle.audience === "private" && !member) {
    // 404 for an unknown huddle or a private huddle the caller isn't invited to (owner included — private means private)
    throw new HttpError(404, "Huddle not found");
  }

  return {
    access,
    huddle: huddle as HuddleRow,
    member: (member as HuddleMemberRow) ?? null,
  };
}

// --- Pure access rules ---

/** Any participant can start a room-wide huddle; starting a private huddle requires editor+. */
export function canStartHuddle(role: Role, audience: "all" | "private"): boolean {
  if (audience === "all") return true;
  return can.annotate(role);
}

/** Only private huddles take invites, and only editors+ can invite. */
export function canInviteToHuddle(role: Role, audience: "all" | "private"): boolean {
  if (audience !== "private") return false;
  return can.annotate(role);
}

/** The huddle creator or an admin/owner can end the call. */
export function canEndHuddle(identityId: string, role: Role, createdBy: string): boolean {
  return identityId === createdBy || can.manage(role);
}

/** Huddle member with editor+ role; huddle must be open or ended < 60s ago for trailing sentences. */
export function canPostSegments(
  role: Role,
  isMember: boolean,
  endedAt: string | Date | null,
  now = Date.now(),
): boolean {
  if (!isMember || !can.annotate(role)) return false;
  if (!endedAt) return true;
  const endedMs = typeof endedAt === "string" ? new Date(endedAt).getTime() : endedAt.getTime();
  return now - endedMs < 60_000;
}

/** Private huddle requires membership; room-wide is visible to all room readers. */
export function canReadHuddle(audience: "all" | "private", isMember: boolean): boolean {
  if (audience === "private") return isMember;
  return true;
}

/** Notes refresh requires read permission plus AI permission under the room's settings. */
export function canRefreshHuddleNotes(
  role: Role,
  settings: RoomSettings,
  audience: "all" | "private",
  isMember: boolean,
): boolean {
  if (!canReadHuddle(audience, isMember)) return false;
  return can.useAi(role, settings);
}

// --- Side effects ---

/** Realtime broadcast `huddles.changed` (no payload) on roomChannel so clients refetch. */
export async function pingHuddles(roomId: string): Promise<void> {
  const db = supabaseAdmin();
  if (typeof db.channel !== "function") return;
  try {
    const channel = db.channel(roomChannel(roomId));
    await channel.send({
      type: "broadcast",
      event: "huddles.changed",
      payload: {},
    });
    if (typeof db.removeChannel === "function") {
      await db.removeChannel(channel);
    }
  } catch (err) {
    console.warn(`[huddles] Failed to broadcast huddles.changed for room ${roomId}:`, err);
  }
}

/** Lazy close: open huddle started > 2 min ago with participantCount === 0 ends it. */
export async function closeIfEmpty(huddle: HuddleRow): Promise<boolean> {
  if (huddle.ended_at) return false;
  const startedAtMs = new Date(huddle.started_at).getTime();
  if (Date.now() - startedAtMs < 2 * 60 * 1000) return false;

  const count = await participantCount(huddle.livekit_room);
  if (count === 0) {
    const db = supabaseAdmin();
    const endedAt = new Date().toISOString();
    const { error } = await db
      .from("huddles")
      .update({ ended_at: endedAt })
      .eq("id", huddle.id)
      .is("ended_at", null);
    if (error) {
      console.warn(`[huddles] Failed to mark huddle ${huddle.id} ended:`, error);
      return false;
    }
    await closeRoom(huddle.livekit_room);
    await pingHuddles(huddle.room_id);
    return true;
  }
  return false;
}

/**
 * Called after ledger accepts events: member.kick -> removeFromRoom in open huddles;
 * role.set -> setPublish(can.annotate(newRole)). Fire-and-forget.
 */
export async function onMembershipEvents(roomId: string, events: LedgerEvent[]): Promise<void> {
  try {
    const kicks: string[] = [];
    const roles: Array<{ member: string; role: Role }> = [];
    for (const e of events) {
      if (e.type === "member.kick") kicks.push(e.member);
      else if (e.type === "role.set") roles.push({ member: e.member, role: e.role });
    }
    if (!kicks.length && !roles.length) return;

    const db = supabaseAdmin();
    const { data: openHuddles, error } = await db
      .from("huddles")
      .select("id, livekit_room")
      .eq("room_id", roomId)
      .is("ended_at", null);
    if (error || !openHuddles || !openHuddles.length) return;

    await Promise.all([
      ...openHuddles.flatMap((h) => kicks.map((memberId) => removeFromRoom(h.livekit_room, memberId))),
      ...openHuddles.flatMap((h) => roles.map((r) => setPublish(h.livekit_room, r.member, can.annotate(r.role)))),
    ]);
  } catch (err) {
    console.warn(`[huddles] onMembershipEvents error for room ${roomId}:`, err);
  }
}
