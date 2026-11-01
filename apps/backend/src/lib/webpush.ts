import webpush from "web-push";
import { env } from "../env";
import { supabaseAdmin } from "./supabase";

// Web Push for @mentions: a notification even when the room tab is closed. Needs the VAPID key
// pair in the environment; without it push is off and email is the only offline channel.

export function pushAvailable() {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

let configured = false;
function sender() {
  if (!configured) {
    webpush.setVapidDetails(env.VAPID_SUBJECT ?? "mailto:no-reply@linkroom.local", env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  return webpush;
}

type PushKeys = { p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; room_id: string; url: string };

// Sends to every browser the user subscribed and deletes the subscriptions the push service says
// are gone (404/410). Returns how many pushes were accepted.
export async function pushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushAvailable()) return 0;
  const db = supabaseAdmin();
  const { data, error } = await db.from("push_subscriptions").select("endpoint, keys").eq("user_id", userId);
  if (error || !data?.length) return 0;

  const gone: string[] = [];
  const results = await Promise.all(
    data.map(async ({ endpoint, keys }) => {
      try {
        await sender().sendNotification({ endpoint: endpoint as string, keys: keys as PushKeys }, JSON.stringify(payload), {
          TTL: 60 * 60,
        });
        return true;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(endpoint as string);
        return false;
      }
    }),
  );
  if (gone.length) await db.from("push_subscriptions").delete().in("endpoint", gone);
  return results.filter(Boolean).length;
}
