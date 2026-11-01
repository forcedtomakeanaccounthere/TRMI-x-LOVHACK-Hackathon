"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { getSupabase } from "@/lib/supabase";
import type { RoomNotification } from "@linkroom/shared";

// Listen for realtime mention notifications in the current room
export function useRoomNotifications(roomId: string, userId: string) {
  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch {
      return;
    }

    const channel = supabase.channel(`room:${roomId}:notifications`).on(
      "broadcast",
      { event: "mention" },
      (payload) => {
        const notif = payload.payload as RoomNotification;
        
        // Only show toast if it's for this user
        if (notif.user_id === userId) {
          toast(notif.title, {
            description: notif.body,
            action: {
              label: "View",
              onClick: () => {
                // Scroll to the relevant section if possible
                window.scrollTo({ top: 0, behavior: "smooth" });
              },
            },
          });
        }
      },
    );

    void channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, userId]);
}
