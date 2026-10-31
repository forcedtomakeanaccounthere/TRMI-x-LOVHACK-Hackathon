"use client";

import { roomChannel, THROTTLE_MS } from "@linkroom/shared";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { Identity } from "./identity";
import { chunkEvents } from "./ledger";
import type { LedgerEvent } from "./types";

// One realtime channel per room (CHECKLIST Phase 3): presence for who's here, broadcast for cursors,
// follow-mode scrolling, kicks and the ledger. Without Supabase env vars the room works solo.

export type Peer = {
  id: string;
  name: string;
  color: string;
  signedIn: boolean;
  following: string | null;
  doc: string | null;
};

export type CursorAnchor = { block: string; x: number; y: number };
export type RemoteCursor = {
  id: string;
  doc: string;
  anchor: CursorAnchor;
  at: number;
};
export type RemoteScroll = {
  id: string;
  doc: string;
  block: string;
  ratio: number;
};
export type PresenceChange = {
  kind: "joined" | "left";
  peer: Peer;
  at: string;
};

type Handlers = {
  onEvents: (events: LedgerEvent[]) => void;
  allEvents: () => LedgerEvent[];
  onKicked: () => void;
  onPresenceChange: (change: PresenceChange) => void;
};

export type ChannelStatus = "solo" | "connecting" | "live";

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  return (...args: A) => {
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      last = Date.now();
      fn(...args);
      return;
    }
    // Keep the latest call, so the final position always goes out.
    pending = args;
    timer ??= setTimeout(() => {
      timer = null;
      last = Date.now();
      if (pending) fn(...pending);
      pending = null;
    }, wait);
  };
}

// Outgoing messages. Created once per hook, so the functions stay stable; the live channel and your id
// are attached once subscribed.
function createSender() {
  let channel: RealtimeChannel | null = null;
  let id: string | null = null;
  const broadcast = (event: string, payload: unknown) => {
    void channel?.send({ type: "broadcast", event, payload });
  };
  return {
    attach(next: RealtimeChannel | null, me: string | null) {
      channel = next;
      id = me;
    },
    cursor: throttle((doc: string, anchor: CursorAnchor | null) => {
      if (id) broadcast("cursor", { id, doc, anchor });
    }, THROTTLE_MS.cursor),
    scroll: throttle((doc: string, block: string, ratio: number) => {
      if (id) broadcast("scroll", { id, doc, block, ratio });
    }, THROTTLE_MS.scroll),
    events: (events: LedgerEvent[]) => {
      for (const batch of chunkEvents(events)) broadcast("ledger", { events: batch });
    },
    kick: (member: string) => broadcast("kick", { member }),
  };
}

export function useRoomChannel(
  roomId: string,
  me: Identity | null,
  view: { doc: string; following: string | null },
  handlers: Handlers,
) {
  const [status, setStatus] = useState<ChannelStatus>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({});
  const [scrolls, setScrolls] = useState<Record<string, RemoteScroll>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const handlersRef = useRef(handlers);
  const viewRef = useRef(view);

  useEffect(() => {
    handlersRef.current = handlers;
    viewRef.current = view;
  });

  const meId = me?.id ?? null;
  const meName = me?.name ?? "";
  const meColor = me?.color ?? "";
  const meSignedIn = me?.signedIn ?? false;

  useEffect(() => {
    if (!meId) return;
    let supabase;
    try {
      supabase = getSupabase();
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no env: nothing to subscribe to
      setStatus("solo");
      return;
    }

    const channel = supabase.channel(roomChannel(roomId), {
      config: { presence: { key: meId }, broadcast: { self: false } },
    });
    channelRef.current = channel;
    let known = new Map<string, Peer>();

    const sendEvents = (events: LedgerEvent[], to?: string) => {
      for (const batch of chunkEvents(events)) {
        void channel.send({
          type: "broadcast",
          event: to ? "sync" : "ledger",
          payload: { to, events: batch },
        });
      }
    };

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Peer>();
        const next = new Map<string, Peer>();
        for (const [key, metas] of Object.entries(state)) {
          const meta = metas.at(-1);
          if (meta && key !== meId) next.set(key, { ...meta, id: key });
        }
        const at = new Date().toISOString();
        for (const [id, peer] of next)
          if (!known.has(id)) handlersRef.current.onPresenceChange({ kind: "joined", peer, at });
        for (const [id, peer] of known) {
          if (!next.has(id)) {
            handlersRef.current.onPresenceChange({ kind: "left", peer, at });
            setCursors((prev) => omit(prev, id));
          }
        }
        known = next;
        setPeers([...next.values()]);
      })
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        const p = payload as {
          id: string;
          doc: string;
          anchor: CursorAnchor | null;
        };
        setCursors((prev) => {
          if (!p.anchor) return omit(prev, p.id);
          return {
            ...prev,
            [p.id]: { id: p.id, doc: p.doc, anchor: p.anchor, at: Date.now() },
          };
        });
      })
      .on("broadcast", { event: "scroll" }, ({ payload }) => {
        const p = payload as RemoteScroll;
        setScrolls((prev) => ({ ...prev, [p.id]: p }));
      })
      .on("broadcast", { event: "ledger" }, ({ payload }) => {
        handlersRef.current.onEvents((payload as { events: LedgerEvent[] }).events);
      })
      .on("broadcast", { event: "sync" }, ({ payload }) => {
        const p = payload as { to?: string; events: LedgerEvent[] };
        if (!p.to || p.to === meId) handlersRef.current.onEvents(p.events);
      })
      .on("broadcast", { event: "sync-req" }, ({ payload }) => {
        // A newcomer says how many events it has; anyone holding more sends theirs, and anyone holding
        // fewer asks back, so both sides end up with the union.
        const p = payload as { from: string; count: number };
        const mine = handlersRef.current.allEvents();
        if (mine.length > p.count) sendEvents(mine, p.from);
        else if (mine.length < p.count)
          void channel.send({
            type: "broadcast",
            event: "sync-req",
            payload: { from: meId, count: mine.length },
          });
      })
      .on("broadcast", { event: "kick" }, ({ payload }) => {
        if ((payload as { member: string }).member === meId) handlersRef.current.onKicked();
      })
      .subscribe(async (s) => {
        if (s === "SUBSCRIBED") {
          setStatus("live");
          await channel.track({
            id: meId,
            name: meName,
            color: meColor,
            signedIn: meSignedIn,
            following: viewRef.current.following,
            doc: viewRef.current.doc,
          } satisfies Peer);
          void channel.send({
            type: "broadcast",
            event: "sync-req",
            payload: {
              from: meId,
              count: handlersRef.current.allEvents().length,
            },
          });
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
          setStatus("solo");
        }
      });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [roomId, meId, meName, meColor, meSignedIn]);

  // Keep presence current when you switch documents or start following someone.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || status !== "live" || !meId) return;
    void channel.track({
      id: meId,
      name: meName,
      color: meColor,
      signedIn: meSignedIn,
      following: view.following,
      doc: view.doc,
    } satisfies Peer);
  }, [status, meId, meName, meColor, meSignedIn, view.doc, view.following]);

  // Cursors that haven't moved for 5 s fade out.
  useEffect(() => {
    const timer = setInterval(() => {
      setCursors((prev) => {
        const cutoff = Date.now() - 5000;
        const stale = Object.values(prev).some((c) => c.at < cutoff);
        return stale ? Object.fromEntries(Object.entries(prev).filter(([, c]) => c.at >= cutoff)) : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [send] = useState(createSender);
  useEffect(() => {
    send.attach(status === "live" ? channelRef.current : null, meId);
  }, [send, status, meId]);

  return { status, peers, cursors, scrolls, send };
}
