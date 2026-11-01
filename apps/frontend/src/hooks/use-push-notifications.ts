"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";

// Browser push for @mentions: registers public/sw.js, subscribes with the backend's VAPID key and
// tells the backend about the subscription. `available` is false when the browser can't do push or
// the backend has no VAPID keys (GET /api/notifications/key returns null).

const supportsPush = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function usePushNotifications(token?: string) {
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || !supportsPush()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { vapid_public_key } = await api.notifications.pushKey(token);
        if (cancelled || !vapid_public_key) return;
        setVapidKey(vapid_public_key);
        const registration = await navigator.serviceWorker.register("/sw.js");
        const existing = await registration.pushManager.getSubscription();
        if (!cancelled) setSubscribed(!!existing && Notification.permission === "granted");
      } catch {
        // No key route on an older backend, or push blocked: the switch stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const subscribe = async () => {
    if (!token || !vapidKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Notifications are blocked", { description: "Allow them for this site in your browser settings." });
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));
      const json = subscription.toJSON();
      if (!json.keys?.p256dh || !json.keys.auth) throw new Error("The browser returned an incomplete subscription");
      await api.notifications.subscribe(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          user_agent: navigator.userAgent.slice(0, 256),
        },
        token,
      );
      setSubscribed(true);
      toast.success("Browser notifications on", { description: "You'll get one when someone mentions you." });
    } catch (err) {
      toast.error("Couldn't turn on browser notifications", {
        description: err instanceof ApiError || err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api.notifications.unsubscribe(subscription.endpoint, token);
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Browser notifications off");
    } catch (err) {
      toast.error("Couldn't turn off browser notifications", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return { available: !!vapidKey, subscribed, busy, subscribe, unsubscribe };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
