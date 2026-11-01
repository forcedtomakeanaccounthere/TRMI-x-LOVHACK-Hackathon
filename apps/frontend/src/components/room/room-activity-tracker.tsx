"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { getFreshSession } from "@/lib/session";
import { ROOM_STATUS_EVENT, type RoomStatusDetail } from "./use-room-channel";

const ACTIVITY_THROTTLE_MS = 30_000;
const PRESENCE_HEARTBEAT_MS = 60_000;

export function RoomActivityTracker({ roomId }: { roomId: string }) {
  const lastActivitySent = useRef<number>(0);
  const isPausedRef = useRef<boolean>(false);

  useEffect(() => {
    // 1. Presence heartbeat every 60s so active tab keeps presence current
    // Uses the heartbeat endpoint which tracks reader presence without resetting the 2-hour idle activity timer.
    async function sendPresence() {
      try {
        const session = await getFreshSession();
        const token = session?.access_token;
        const res = await api.heartbeat(roomId, token);
        if (res.status === "running" && isPausedRef.current) {
          isPausedRef.current = false;
          toast.success("Room resumed.");
        } else if (res.status === "paused" && !isPausedRef.current) {
          isPausedRef.current = true;
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          isPausedRef.current = true;
        }
      }
    }

    sendPresence();
    const presenceTimer = setInterval(sendPresence, PRESENCE_HEARTBEAT_MS);

    // 2. Throttled activity reporting on real user interactions (keystrokes, mouse events, scroll)
    async function sendActivity() {
      const now = Date.now();
      if (now - lastActivitySent.current < ACTIVITY_THROTTLE_MS) return;

      lastActivitySent.current = now;
      try {
        const session = await getFreshSession();
        const token = session?.access_token;
        await api.recordActivity(roomId, token);
        if (isPausedRef.current) {
          isPausedRef.current = false;
          toast.success("Room resumed.");
          sendPresence();
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          isPausedRef.current = true;
        }
      }
    }

    sendActivity();

    // Parent window event listeners
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchmove", "scroll"] as const;
    const handleInteraction = () => {
      sendActivity();
    };

    for (const ev of events) {
      window.addEventListener(ev, handleInteraction, { passive: true, capture: true });
    }

    // PDF reader / iframe interaction detection:
    // When a user clicks or scrolls into a PDF iframe, the parent window blurs to that iframe.
    const handleBlur = () => {
      setTimeout(() => {
        if (document.activeElement?.tagName === "IFRAME") {
          sendActivity();
        }
      }, 0);
    };
    window.addEventListener("blur", handleBlur);

    // Message listener for cross-frame viewer events
    const handleMessage = () => {
      sendActivity();
    };
    window.addEventListener("message", handleMessage);

    // 3. Realtime status updates (auto-pause / auto-archive / owner resume). They arrive on the room's
    // channel, which useRoomChannel owns (one channel per topic), and reach us as a window event.
    const handleStatus = (event: Event) => {
      const { status, reason } = (event as CustomEvent<RoomStatusDetail>).detail;
      if (status === "paused") {
        isPausedRef.current = true;
        const msg =
          reason === "idle_2h" ? "Room paused due to 2 hours of inactivity." : "Room paused because participants left.";
        toast.warning(msg);
      } else if (status === "running") {
        isPausedRef.current = false;
        toast.success("Room resumed.");
        sendPresence();
      }
    };
    window.addEventListener(ROOM_STATUS_EVENT, handleStatus);

    // 4. Tab visibility change: re-check presence and activity when tab becomes active
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        sendPresence();
        sendActivity();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(presenceTimer);
      for (const ev of events) {
        window.removeEventListener(ev, handleInteraction, { capture: true });
      }
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(ROOM_STATUS_EVENT, handleStatus);
    };
  }, [roomId]);

  return null;
}
