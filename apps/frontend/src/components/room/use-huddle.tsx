"use client";

import type { HuddleSegmentIn, HuddleSummary } from "@linkroom/shared";
import { type Participant, type RemoteTrack, Room, RoomEvent, Track } from "livekit-client";
import { createContext, type ReactNode, type RefObject, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { useRoom } from "./store";

// Voice huddles (apps/backend routes/huddles.ts): the room's running and recent huddles, and the
// call you're in. The call lives here, above the Sources rail, so collapsing the rail keeps it going.
// Audio goes through LiveKit; captions come from the browser's speech recognition (Chrome, Edge):
// interim words go to the others over the LiveKit data channel, finished sentences to the backend,
// which keeps the transcript and writes the AI notes from it.

export type CallPerson = { id: string; name: string; speaking: boolean; muted: boolean; me: boolean };
export type Caption = { id: string; who: string; name: string; text: string; final: boolean; at: number };

type Call = { huddle: HuddleSummary; room: Room };

// Web Speech API: not in TypeScript's DOM types yet.
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
const SpeechRecognition = (): (new () => Recognition) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
};

const CAPTION_TOPIC = "caption";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const segmentId = () => `s_${crypto.randomUUID().replace(/-/g, "")}`;

function people(room: Room): CallPerson[] {
  const of = (p: Participant, me: boolean): CallPerson => ({
    id: p.identity,
    name: p.name || "Someone",
    speaking: p.isSpeaking,
    muted: !p.isMicrophoneEnabled,
    me,
  });
  return [of(room.localParticipant, true), ...[...room.remoteParticipants.values()].map((p) => of(p, false))];
}

function useHuddleValue(audioBox: RefObject<HTMLDivElement | null>) {
  const { roomId, isDemo, me, role, huddleTick, roomAuth, currentView } = useRoom();
  const canSpeak = role !== "viewer"; // viewers get listen-only tokens
  const captionsSupported = SpeechRecognition() !== null;

  // --- The room's huddles ---
  const [huddles, setHuddles] = useState<HuddleSummary[]>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = async () => {
    const auth = await roomAuth();
    if (!auth) return;
    try {
      const r = await api.huddles.list(roomId, auth);
      setHuddles(r.huddles);
      setUnavailable(null);
    } catch (err) {
      // 503: LiveKit isn't configured on this server. 404: a backend without huddles. 500: usually its
      // database is missing the huddle tables (migration 0028). The next huddles.changed tries again.
      if (err instanceof ApiError && err.status === 503) setUnavailable(err.message);
      else if (err instanceof ApiError && err.status === 404)
        setUnavailable("Voice huddles aren't on this server yet.");
      else if (err instanceof ApiError && err.status >= 500)
        setUnavailable("Huddles aren't working on the server right now.");
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    if (isDemo) return;
    void refresh(); // eslint-disable-line react-hooks/set-state-in-effect -- the list comes from the backend
  }, [roomId, isDemo, huddleTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- The call ---
  const [call, setCall] = useState<Call | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "start" or a huddle id while connecting
  const [inCall, setInCall] = useState<CallPerson[]>([]);
  const [micOn, setMicOn] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [needsAudioClick, setNeedsAudioClick] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [ended, setEnded] = useState<HuddleSummary | null>(null); // the huddle that just ended for you
  const callRef = useRef<Call | null>(null);
  useEffect(() => {
    callRef.current = call;
  }, [call]);

  const putCaption = (c: Caption) => setCaptions((list) => [...list.filter((x) => x.id !== c.id), c].slice(-6));

  const connect = async (join: () => Promise<{ huddle: HuddleSummary; livekit: { url: string; token: string } }>) => {
    if (callRef.current) await leave();
    const res = await join();
    const room = new Room({ adaptiveStream: true, dynacast: true });
    const sync = () => setInCall(people(room));
    room
      .on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.ActiveSpeakersChanged, sync)
      .on(RoomEvent.TrackMuted, sync)
      .on(RoomEvent.TrackUnmuted, sync)
      .on(RoomEvent.LocalTrackPublished, sync)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        audioBox.current?.appendChild(el);
        sync();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
        sync();
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudioClick(!room.canPlaybackAudio))
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic !== CAPTION_TOPIC || !participant) return;
        try {
          const m = JSON.parse(decoder.decode(payload)) as { id: string; text: string; final: boolean };
          putCaption({
            id: m.id,
            who: participant.identity,
            name: participant.name || "Someone",
            text: m.text.slice(0, 400),
            final: m.final,
            at: Date.now(),
          });
        } catch {
          /* not a caption */
        }
      })
      .on(RoomEvent.Disconnected, () => {
        // Ended by the creator or an admin, removed, or the network dropped.
        if (callRef.current?.room !== room) return;
        setEnded(res.huddle);
        reset();
        void refresh();
      });
    await room.connect(res.livekit.url, res.livekit.token);
    await room.startAudio().catch(() => setNeedsAudioClick(true));
    setCall({ huddle: res.huddle, room });
    setEnded(null);
    sync();
    if (canSpeak) await setMic(true, room);
    void refresh();
  };

  const reset = () => {
    const c = callRef.current;
    callRef.current = null;
    setCall(null);
    setInCall([]);
    setMicOn(false);
    setCaptions([]);
    setNeedsAudioClick(false);
    audioBox.current?.replaceChildren();
    return c;
  };

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setUnavailable(err.message);
      // A backend from before huddles answers the generic "Not found".
      if (err instanceof ApiError && err.status === 404 && key === "start") {
        setUnavailable("Voice huddles aren't on this server yet.");
        toast.error("This server doesn't have voice huddles yet. Restart the backend on the latest code.");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Couldn't connect to the huddle");
    } finally {
      setBusy(null);
    }
  };
  const authOrThrow = async () => {
    const auth = await roomAuth();
    if (!auth) throw new Error("Sign in again to use huddles");
    return auth;
  };
  const name = me.name.trim().slice(0, 40) || undefined;

  const start = (members: string[] | "all") =>
    run("start", async () => {
      const auth = await authOrThrow();
      await connect(() =>
        api.huddles.start(
          roomId,
          members === "all" ? { audience: "all", name } : { audience: "private", members, name },
          auth,
        ),
      );
    });
  const join = (hid: string) =>
    run(hid, async () => {
      const auth = await authOrThrow();
      await connect(() => api.huddles.join(roomId, hid, auth, name));
    });

  async function leave() {
    const c = reset();
    if (!c) return;
    await flushSegments(c);
    await c.room.disconnect();
    const auth = await roomAuth();
    if (auth) await api.huddles.leave(roomId, c.huddle.id, auth).catch(() => {});
    void refresh();
  }
  const end = async () => {
    const c = callRef.current;
    if (!c) return;
    await flushSegments(c);
    const auth = await roomAuth();
    try {
      if (auth) await api.huddles.end(roomId, c.huddle.id, auth);
      reset();
      await c.room.disconnect();
      setEnded(c.huddle);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't end the huddle");
    }
  };
  const invite = async (members: string[]) => {
    const c = callRef.current;
    const auth = await roomAuth();
    if (!c || !auth || members.length === 0) return;
    try {
      await api.huddles.invite(roomId, c.huddle.id, members, auth);
      toast.success(members.length === 1 ? "Invited" : `Invited ${members.length} people`);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't invite them");
    }
  };

  async function setMic(on: boolean, room = callRef.current?.room) {
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(on);
      setMicOn(on);
    } catch {
      setMicOn(false);
      toast.error("Microphone blocked. Allow it in the address bar to talk; you can still listen.");
    }
    setInCall(people(room));
  }
  const enableAudio = () => {
    void callRef.current?.room.startAudio().then(() => setNeedsAudioClick(false));
  };

  // Leaving the room page hangs up.
  useEffect(
    () => () => {
      void leave();
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // --- Captions and the transcript ---
  // Finished sentences wait here and go to the backend in batches (at most 20 per call).
  const pending = useRef<HuddleSegmentIn[]>([]);
  async function flushSegments(c: Call | null = callRef.current) {
    if (!c || pending.current.length === 0) return;
    const batch = pending.current.splice(0, 20);
    const auth = await roomAuth();
    if (!auth) return;
    await api.huddles.segments(roomId, c.huddle.id, batch, auth).catch(() => {
      pending.current.unshift(...batch); // try again with the next batch
    });
    if (pending.current.length > 0) await flushSegments(c);
  }

  const transcribing = Boolean(call && canSpeak && micOn && captionsSupported);
  useEffect(() => {
    const Ctor = SpeechRecognition();
    const room = call?.room;
    if (!transcribing || !Ctor || !room) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    let alive = true;
    let utterance = { id: segmentId(), startedAt: 0 };
    const send = (text: string, final: boolean) => {
      putCaption({ id: utterance.id, who: me.id, name: "You", text, final, at: Date.now() });
      void room.localParticipant
        .publishData(encoder.encode(JSON.stringify({ id: utterance.id, text: text.slice(0, 400), final })), {
          reliable: final,
          topic: CAPTION_TOPIC,
        })
        .catch(() => {});
    };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (!utterance.startedAt) utterance.startedAt = Date.now();
        send(text, r.isFinal);
        if (r.isFinal) {
          const view = currentView();
          pending.current.push({
            id: utterance.id,
            text: text.slice(0, 1000),
            start_at: new Date(utterance.startedAt).toISOString(),
            end_at: new Date().toISOString(),
            focus: view ? { doc: view.doc, block: view.block.slice(0, 16) } : null,
          });
          if (pending.current.length >= 20) void flushSegments();
          utterance = { id: segmentId(), startedAt: 0 };
        }
      }
    };
    // Chrome stops listening after a pause or a minute; keep it going while the mic is on.
    rec.onend = () => {
      if (alive) setTimeout(() => alive && rec.start(), 250);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") alive = false;
    };
    rec.start();
    const flusher = setInterval(() => void flushSegments(), 4000);
    return () => {
      alive = false;
      clearInterval(flusher);
      rec.onend = null;
      rec.stop();
      void flushSegments();
    };
  }, [transcribing, call]); // eslint-disable-line react-hooks/exhaustive-deps

  // The paragraph you're reading, at most every 2 s while you're in a call, so the notes can tie
  // what was said to the text on screen.
  useEffect(() => {
    if (!call || !canSpeak) return;
    let last = "";
    const tick = setInterval(() => {
      const view = currentView();
      if (!view) return;
      const key = `${view.doc}#${view.block}`;
      if (key === last) return;
      last = key;
      void roomAuth().then(
        (auth) =>
          auth &&
          api.huddles
            .focus(roomId, call.huddle.id, { doc: view.doc, block: view.block.slice(0, 16) }, auth)
            .catch(() => {}),
      );
    }, 2000);
    return () => clearInterval(tick);
  }, [call, canSpeak]); // eslint-disable-line react-hooks/exhaustive-deps

  // Captions fade a few seconds after the last word.
  useEffect(() => {
    if (captions.length === 0) return;
    const t = setTimeout(() => setCaptions((list) => list.filter((c) => Date.now() - c.at < 5000)), 1000);
    return () => clearTimeout(t);
  }, [captions]);

  return {
    available: !isDemo && !unavailable,
    unavailable: isDemo ? "Huddles work in rooms you create." : unavailable,
    loaded,
    huddles,
    running: huddles.filter((h) => !h.ended_at),
    recent: huddles.filter((h) => h.ended_at),
    call: call?.huddle ?? null,
    ended,
    clearEnded: () => setEnded(null),
    busy,
    inCall,
    canSpeak,
    micOn,
    toggleMic: () => void setMic(!micOn),
    transcribing,
    captionsSupported,
    showCaptions,
    setShowCaptions,
    captions,
    needsAudioClick,
    enableAudio,
    start,
    join,
    leave: () => void leave(),
    end: () => void end(),
    invite,
    refresh,
  };
}

export type HuddleValue = ReturnType<typeof useHuddleValue>;
const HuddleContext = createContext<HuddleValue | null>(null);

export function HuddleProvider({ children }: { children: ReactNode }) {
  const audioBox = useRef<HTMLDivElement | null>(null);
  const value = useHuddleValue(audioBox);
  return (
    <HuddleContext.Provider value={value}>
      {children}
      {/* Remote voices play from here. */}
      <div ref={audioBox} hidden aria-hidden />
    </HuddleContext.Provider>
  );
}

export function useHuddle() {
  const v = useContext(HuddleContext);
  if (!v) throw new Error("useHuddle outside HuddleProvider");
  return v;
}
