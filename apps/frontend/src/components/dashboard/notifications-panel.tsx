"use client";

import type { NotificationItem } from "@linkroom/shared";
import { AtIcon, BellIcon, BellSlashIcon, CheckIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { api, ApiError } from "@/lib/api";
import { getFreshSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { timeAgo } from "./primitives";

// The dashboard's notifications: every time someone @mentioned you in a room (GET /api/notifications),
// newest first, with an unread count. Refreshed every 30 s and when the tab comes back into view.

type Inbox = { notifications: NotificationItem[]; unread: number };
type Load = { status: "loading" | "ready" | "unavailable" | "error"; inbox: Inbox };

const POLL_MS = 30_000;

export function NotificationsPanel({ roomHref, token }: { roomHref: (roomId: string) => string; token?: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading", inbox: { notifications: [], unread: 0 } });
  const push = usePushNotifications(token);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const session = await getFreshSession();
        if (!session) return;
        const inbox = await api.notifications.list(session.access_token);
        if (!cancelled) setLoad({ status: "ready", inbox });
      } catch (err) {
        if (cancelled) return;
        // 404: the backend predates the notifications routes (restart it after pulling).
        const status = err instanceof ApiError && err.status === 404 ? "unavailable" : "error";
        setLoad((prev) => (prev.status === "ready" ? prev : { ...prev, status }));
      }
    };
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    const onFocus = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [token]);

  const markRead = async (ids?: string[]) => {
    const session = await getFreshSession();
    if (!session) return;
    // Show it read straight away; the next refresh brings the server's word.
    setLoad((prev) => {
      const read = (n: NotificationItem) =>
        !ids || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n;
      const notifications = prev.inbox.notifications.map(read);
      return { ...prev, inbox: { notifications, unread: notifications.filter((n) => !n.read_at).length } };
    });
    try {
      await api.notifications.markRead(session.access_token, ids);
    } catch {
      toast.error("Couldn't mark that as read");
    }
  };

  if (!token) return null;
  const { notifications, unread } = load.inbox;

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="relative grid size-9 place-items-center rounded-full bg-foreground/5">
          <BellIcon className="size-[18px]" weight={unread ? "fill" : "regular"} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-azure px-1 text-[0.5625rem] font-bold text-white ring-2 ring-background">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="eyebrow text-[0.5625rem] text-muted-foreground">Mentions</div>
          <h3 className="font-display text-[1.45rem] leading-none">
            Notifications {unread > 0 && <span className="text-[0.95rem] text-azure italic">· {unread} new</span>}
          </h3>
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markRead()}
            className="flex h-8 items-center gap-1 rounded-full px-3 text-[0.75rem] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            <CheckIcon className="size-3.5" /> Mark all read
          </button>
        )}
      </div>

      {push.available && (
        <button
          type="button"
          disabled={push.busy}
          onClick={() => void (push.subscribed ? push.unsubscribe() : push.subscribe())}
          className="mt-3 flex w-full items-center gap-2 rounded-xl bg-foreground/[0.04] px-3 py-2 text-left text-[0.75rem] transition hover:bg-foreground/[0.07] disabled:opacity-60"
        >
          {push.subscribed ? (
            <BellIcon weight="fill" className="size-4 text-azure" />
          ) : (
            <BellSlashIcon className="size-4" />
          )}
          <span className="flex-1">
            {push.subscribed ? "Browser notifications are on" : "Get a browser notification when someone mentions you"}
          </span>
          <span className={cn("font-medium", push.subscribed ? "text-muted-foreground" : "text-azure")}>
            {push.subscribed ? "Turn off" : "Turn on"}
          </span>
        </button>
      )}

      <div className="mt-3">
        {load.status === "loading" ? (
          <ul className="space-y-2" aria-busy="true">
            {[0, 1].map((i) => (
              <li key={i} className="h-16 animate-pulse rounded-2xl bg-foreground/[0.04]" />
            ))}
          </ul>
        ) : load.status === "unavailable" || load.status === "error" ? (
          <p className="rounded-2xl border border-dashed border-(--hairline) p-5 text-center text-[0.75rem] text-muted-foreground">
            {load.status === "unavailable"
              ? "Notifications aren't available on this backend yet."
              : "Couldn't load notifications. They'll appear when the connection is back."}
          </p>
        ) : notifications.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-(--hairline) p-6 text-center">
            <AtIcon className="mx-auto size-7 text-muted-foreground/50" />
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">No mentions yet.</p>
            <p className="mt-1 text-[0.6875rem] text-muted-foreground">
              When someone writes @your name in a room, it shows up here.
            </p>
          </div>
        ) : (
          <ul data-lenis-prevent className="max-h-[22rem] space-y-2 overflow-y-auto overscroll-contain">
            <AnimatePresence initial={false}>
              {notifications.map((n) => (
                <motion.li
                  key={n.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <Link
                    href={n.room_id ? roomHref(n.room_id) : "#"}
                    onClick={() => !n.read_at && void markRead([n.id])}
                    className={cn(
                      "relative block rounded-2xl p-3 pl-7 ring-1 transition",
                      n.read_at
                        ? "ring-(--hairline) hover:bg-foreground/[0.03]"
                        : "bg-azure/[0.06] ring-azure/20 hover:bg-azure/[0.09]",
                    )}
                  >
                    {!n.read_at && (
                      <span className="absolute top-4 left-3 size-2 rounded-full bg-azure" aria-label="Unread" />
                    )}
                    <p className="text-[0.8125rem] leading-snug">
                      <span className="font-semibold">{n.actor_name}</span> mentioned you
                      {n.room_title && (
                        <>
                          {" "}
                          in <span className="font-display text-[0.95rem] italic">{n.room_title}</span>
                        </>
                      )}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[0.75rem] text-muted-foreground">{n.body}</p>
                    <time dateTime={n.created_at} className="mt-1 block text-[0.6875rem] text-muted-foreground">
                      {timeAgo(n.created_at)}
                    </time>
                  </Link>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}
