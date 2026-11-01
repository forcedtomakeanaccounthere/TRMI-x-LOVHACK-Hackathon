import { roomChannel, type RoomNotification } from "@linkroom/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { webOrigin } from "../env";
import { isLive } from "./dashboard";
import { sendMentionEmail } from "./mailer";
import { supabaseAdmin } from "./supabase";
import { pushAvailable, pushToUser } from "./webpush";

// Fan-out for @mentions: one notification row per mentioned member, plus whatever gets them back
// into the room fastest — a realtime toast when their tab is open, and email plus a web push when
// it isn't. Online means a heartbeat within LIVE_WINDOW_MS: the room page sends one every 60 s
// (components/room/room-activity-tracker.tsx), so a closed tab counts as offline within two minutes.

export type MentionInput = {
  roomId: string;
  eventId: string;
  kind: "chat" | "note";
  body: string;
  roomTitle: string | null;
  actor: { id: string; name: string };
  mentions: { id: string; name: string }[];
};

export type MentionOutcome = {
  userId: string;
  online: boolean;
  notified: boolean; // false when this event already notified them (a retry or a second browser)
  emailed: boolean;
  pushed: number;
};

export type RoomMember = { id: string; name: string; lastSeenAt: string | null };

const MAX_ROOM_TITLE = 120;
const excerpt = (body: string, max = 200) => (body.length > max ? `${body.slice(0, max)}…` : body);
export const roomTitleFor = (title: string | null) => (title ?? "").trim().slice(0, MAX_ROOM_TITLE) || "a room";

// The signed-in people a room can mention: its owner and everyone who has opened it, minus anyone
// an admin removed. Only these can be notified, so a client can't use the endpoint to mail
// arbitrary accounts.
export async function roomMembers(db: SupabaseClient, roomId: string, ownerId: string | null): Promise<RoomMember[]> {
  const [participants, kicked] = await Promise.all([
    db.from("room_participants").select("user_id, last_seen_at").eq("room_id", roomId),
    db.from("room_members").select("member_id").eq("room_id", roomId).not("kicked_at", "is", null),
  ]);
  if (participants.error) throw participants.error;
  if (kicked.error) throw kicked.error;
  const lastSeen = new Map<string, string | null>(
    (participants.data ?? []).map((p) => [p.user_id as string, p.last_seen_at as string]),
  );
  if (ownerId && !lastSeen.has(ownerId)) lastSeen.set(ownerId, null);
  for (const { member_id } of kicked.data ?? []) lastSeen.delete(member_id as string);
  if (!lastSeen.size) return [];

  const { data: profiles, error: profilesError } = await db
    .from("profiles")
    .select("id, display_name")
    .in("id", [...lastSeen.keys()]);
  if (profilesError) throw profilesError;
  return (profiles ?? []).map((p) => ({
    id: p.id as string,
    name: p.display_name as string,
    lastSeenAt: lastSeen.get(p.id as string) ?? null,
  }));
}

// Broadcasts one `notify` message into the room's channel, like the backend's lifecycle `status`
// messages. httpSend goes over Realtime's REST endpoint, so there is no socket to join and leave.
// Best effort: the bell still has the notification if the toast is lost.
async function broadcastNotify(db: SupabaseClient, roomId: string, payload: RoomNotification) {
  const channel = db.channel(roomChannel(roomId));
  try {
    await channel.httpSend("notify", payload);
  } catch (err) {
    console.warn(`[notifications] toast for room ${roomId} not sent:`, err);
  } finally {
    void db.removeChannel(channel);
  }
}

// Email and web push for one offline member. A missing address or an SMTP outage only skips that
// channel; the notification row already records the mention.
async function chaseOffline(
  db: SupabaseClient,
  userId: string,
  message: { link: string; title: string; actorName: string; body: string; roomId: string },
): Promise<{ emailed: boolean; pushed: number }> {
  let pushed = 0;
  if (pushAvailable()) {
    pushed = await pushToUser(userId, {
      title: `${message.actorName} mentioned you`,
      body: message.body,
      room_id: message.roomId,
      url: message.link,
    }).catch(() => 0);
  }

  const { data: found } = await db.auth.admin.getUserById(userId);
  const email = found?.user?.email_confirmed_at ? found.user.email : null;
  if (!email) return { emailed: false, pushed };
  try {
    await sendMentionEmail(email, {
      link: message.link,
      roomTitle: message.title,
      actorName: message.actorName,
      body: message.body,
    });
    return { emailed: true, pushed };
  } catch {
    return { emailed: false, pushed };
  }
}

export async function fanOutMentions(input: MentionInput, members: RoomMember[]): Promise<MentionOutcome[]> {
  const db = supabaseAdmin();
  const byId = new Map(members.map((m) => [m.id, m]));

  // Distinct members, never the author: you can't summon yourself.
  const targets = [...new Set(input.mentions.map((m) => m.id))]
    .filter((id) => id !== input.actor.id)
    .flatMap((id) => byId.get(id) ?? []);
  if (!targets.length) return [];

  const title = roomTitleFor(input.roomTitle);
  const body = excerpt(input.body);
  const actorName = input.actor.name || "Someone";
  const link = `${webOrigin}/r/${encodeURIComponent(input.roomId)}`;

  return Promise.all(
    targets.map(async (target): Promise<MentionOutcome> => {
      const online = target.lastSeenAt ? isLive(target.lastSeenAt) : false;

      // dedupe_key is unique and duplicates are ignored, so a retry (or two browsers announcing the
      // same event) returns no row and notifies nobody twice.
      const { data: row, error } = await db
        .from("notifications")
        .upsert(
          {
            user_id: target.id,
            room_id: input.roomId,
            kind: "mention",
            body,
            payload: { room_title: title, actor_name: actorName, source: input.kind },
            dedupe_key: `${input.eventId}::${target.id}`,
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!row) return { userId: target.id, online, notified: false, emailed: false, pushed: 0 };

      if (online) {
        await broadcastNotify(db, input.roomId, {
          user_id: target.id,
          room_id: input.roomId,
          title,
          body,
          actor_name: actorName,
        });
        return { userId: target.id, online, notified: true, emailed: false, pushed: 0 };
      }
      const { emailed, pushed } = await chaseOffline(db, target.id, { link, title, actorName, body, roomId: input.roomId });
      return { userId: target.id, online, notified: true, emailed, pushed };
    }),
  );
}
