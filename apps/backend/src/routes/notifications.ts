import {
  MarkReadRequest,
  type MentionAck,
  MentionNotifyRequest,
  type NotificationItem,
  type NotificationsResponse,
  type PushKeyResponse,
  PushSubscribeRequest,
  type MentionablesResponse,
} from "@linkroom/shared";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { env } from "../env";
import { fanOutMentions, roomMembers } from "../lib/notifier";
import { supabaseAdmin } from "../lib/supabase";
import { pushAvailable } from "../lib/webpush";
import { optionalAuth, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

// Mentions and notifications. POST .../mentions announces the @mentions in a chat message or note
// the browser just wrote to the ledger; the rest serves the dashboard bell and push subscriptions.
// Whether someone is online comes from room_participants.last_seen_at (the rooms heartbeat route),
// so the backend never trusts the browser's word for it.

// Announcements per minute per IP: real mentions are rarer than this; it stops a loop or a script
// from turning the endpoint into a mail relay.
const NOTIFY_RATE_LIMIT = rateLimit({ windowMs: 60_000, limit: 30, validate: { trustProxy: false } });

export const notificationsRouter = Router();

async function liveRoom(roomId: string) {
  const { data: room, error } = await supabaseAdmin()
    .from("rooms")
    .select("id, title, status, created_by")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw error;
  if (!room || room.status === "deleted") throw new HttpError(404, "Room not found");
  return room as { id: string; title: string | null; status: string; created_by: string | null };
}

// GET /api/notifications/rooms/:roomId/people — who the composer can offer after "@", including
// members who are not in the room right now. Anyone with the room link can open the room, so
// anyone with it can see these names.
notificationsRouter.get("/rooms/:roomId/people", optionalAuth, async (req, res) => {
  const room = await liveRoom(String(req.params.roomId));
  const members = await roomMembers(supabaseAdmin(), room.id, room.created_by);
  res.json({
    people: members.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  } satisfies MentionablesResponse);
});

// POST /api/notifications/rooms/:roomId/mentions — fan out one message's mentions. Guests may
// announce (they can chat too); a signed-in caller must be the author they name.
notificationsRouter.post("/rooms/:roomId/mentions", NOTIFY_RATE_LIMIT, optionalAuth, async (req, res) => {
  const input = MentionNotifyRequest.parse(req.body);
  if (req.user) {
    if (input.author.id !== req.user.id) throw new HttpError(403, "Author must be the signed-in user");
  } else if (!input.author.id.startsWith("guest-")) {
    throw new HttpError(401, "Sign in to announce mentions, or send a guest author");
  }

  const room = await liveRoom(String(req.params.roomId));
  if (room.status !== "running") throw new HttpError(409, `Room is ${room.status}`);

  const members = await roomMembers(supabaseAdmin(), room.id, room.created_by);
  const outcomes = await fanOutMentions(
    {
      roomId: room.id,
      eventId: input.event_id,
      kind: input.kind,
      body: input.body,
      roomTitle: room.title,
      actor: { id: input.author.id, name: req.user?.name ?? input.author.name },
      mentions: input.mentions,
    },
    members,
  );
  res.json({ notified: outcomes.filter((o) => o.notified).length } satisfies MentionAck);
});

// GET /api/notifications — my inbox, newest first, with the unread count for the bell.
notificationsRouter.get("/", requireAuth, async (req, res) => {
  const db = supabaseAdmin();
  const userId = req.user!.id;
  const [list, unread] = await Promise.all([
    db
      .from("notifications")
      .select("id, kind, room_id, body, payload, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null),
  ]);
  if (list.error) throw list.error;
  if (unread.error) throw unread.error;

  // Titles and names come from the payload written at fan-out time, so a notification about a room
  // deleted since still reads well.
  const notifications: NotificationItem[] = (list.data ?? []).map((row) => {
    const payload = (row.payload ?? {}) as { room_title?: string; actor_name?: string };
    return {
      id: row.id as string,
      kind: "mention",
      room_id: (row.room_id as string | null) ?? null,
      room_title: payload.room_title ?? null,
      actor_name: payload.actor_name ?? "Someone",
      body: row.body as string,
      created_at: row.created_at as string,
      read_at: (row.read_at as string | null) ?? null,
    };
  });
  res.json({ notifications, unread: unread.count ?? 0 } satisfies NotificationsResponse);
});

// POST /api/notifications/read { ids? } — no ids marks everything read.
notificationsRouter.post("/read", requireAuth, async (req, res) => {
  const { ids } = MarkReadRequest.parse(req.body ?? {});
  const query = supabaseAdmin()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", req.user!.id)
    .is("read_at", null);
  const { error } = ids?.length ? await query.in("id", ids) : await query;
  if (error) throw error;
  res.json({ message: "Marked read" });
});

// GET /api/notifications/key — the VAPID public key a browser needs to subscribe; null = push off.
notificationsRouter.get("/key", requireAuth, (_req, res) => {
  res.json({ vapid_public_key: pushAvailable() ? env.VAPID_PUBLIC_KEY! : null } satisfies PushKeyResponse);
});

// POST /api/notifications/subscribe — remember this browser's push subscription. An endpoint is
// one browser, so subscribing it again (another account on the same browser) moves it.
notificationsRouter.post("/subscribe", requireAuth, async (req, res) => {
  const sub = PushSubscribeRequest.parse(req.body);
  const { error } = await supabaseAdmin()
    .from("push_subscriptions")
    .upsert(
      {
        endpoint: sub.endpoint,
        user_id: req.user!.id,
        keys: sub.keys,
        user_agent: sub.user_agent ?? req.get("user-agent")?.slice(0, 256) ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
  if (error) throw error;
  res.json({ message: "Subscribed" });
});

// POST /api/notifications/unsubscribe { endpoint } — this browser no longer wants pushes.
notificationsRouter.post("/unsubscribe", requireAuth, async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().url().max(2048) }).parse(req.body ?? {});
  const { data, error } = await supabaseAdmin()
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", req.user!.id)
    .select("endpoint");
  if (error) throw error;
  if (!data?.length) throw new HttpError(404, "Not subscribed");
  res.json({ message: "Unsubscribed" });
});
