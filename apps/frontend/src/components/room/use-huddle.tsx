"use client";

import type { HuddleFocus, HuddleSegmentIn, HuddleSummary } from "@linkroom/shared";
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
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  abort: () => void;
  // Chrome 135+ takes the audio track to listen to; older browsers ignore it and use the default mic.
  start: (track?: MediaStreamTrack) => void;
  stop: () => void;
};
const SpeechRecognition = (): (new () => Recognition) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
};

const CAPTION_TOPIC = "caption";

// The language captions listen for. Recognising Indian English or Hindi as US English gets little back.
export const CAPTION_LANGS = [
  { id: "en-US", label: "English (US)" },
  { id: "en-IN", label: "English (India)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "hi-IN", label: "Hindi" },
];
const CAPTION_LANG_KEY = "linkroom-caption-lang";
function defaultCaptionLang() {
  try {
    const saved = localStorage.getItem(CAPTION_LANG_KEY);
    if (saved && CAPTION_LANGS.some((l) => l.id === saved)) return saved;
  } catch {
    /* private window */
  }
  const nav = typeof navigator === "undefined" ? "en-US" : navigator.language;
  // Chrome in India usually says en-US, so the time zone decides between the Englishes.
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (nav.startsWith("en") && (zone === "Asia/Calcutta" || zone === "Asia/Kolkata")) return "en-IN";
  if (CAPTION_LANGS.some((l) => l.id === nav)) return nav;
  if (nav.startsWith("hi")) return "hi-IN";
  return "en-US";
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
// The backend only links talk to text for its own ids: a room or link id and a block like "p12".
const focusOf = (view: { doc: string; block: string } | null): HuddleFocus | null =>
  view && /^[A-Za-z0-9_:-]{1,64}$/.test(view.doc) && /^[a-z]d{1,6}$/.test(view.block)
    ? { doc: view.doc, block: view.block }
    : null;
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

  // Everything said in this call, for the live transcript until the server has saved it (captions fade).
  const [captionLog, setCaptionLog] = useState<Caption[]>([]);
  const putCaption = (c: Caption) => {
    setCaptions((list) => [...list.filter((x) => x.id !== c.id), c].slice(-6));
    setCaptionLog((list) => [...list.filter((x) => x.id !== c.id), c].slice(-60));
  };

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
    setCaptionLog([]);
    setCaptionIssue(null);
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
  // What's wrong with your captions, shown in the call card (null when they're fine).
  const [captionIssue, setCaptionIssue] = useState<string | null>(null);
  const [listening, setListening] = useState(false); // speech recognition is running
  const [hearing, setHearing] = useState(false); // and hears speech right now
  const [heard, setHeard] = useState(""); // the last words it made out
  const [captionLang, setCaptionLangState] = useState(defaultCaptionLang);
  const setCaptionLang = (lang: string) => {
    setCaptionLangState(lang);
    try {
      localStorage.setItem(CAPTION_LANG_KEY, lang);
    } catch {
      /* private window */
    }
  };

  // Finished sentences wait here and go to the backend in batches (at most 20 per call).
  const pending = useRef<HuddleSegmentIn[]>([]);
  async function flushSegments(c: Call | null = callRef.current) {
    if (!c || pending.current.length === 0) return;
    const batch = pending.current.splice(0, 20);
    const auth = await roomAuth();
    if (!auth) {
      pending.current.unshift(...batch);
      return;
    }
    try {
      await api.huddles.segments(roomId, c.huddle.id, batch, auth);
    } catch (err) {
      // Refused (bad input, no permission): retrying won't help, so say why. Otherwise try again later.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        setCaptionIssue(`Your words weren't saved to the transcript: ${err.message}`);
        return;
      }
      pending.current.unshift(...batch);
      return;
    }
    setCaptionIssue(null);
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
    rec.lang = captionLang;
    let alive = true;
    let networkFails = 0;
    let utterance = { id: segmentId(), startedAt: 0 };
    let latest = ""; // the words of the utterance in progress, not yet saved
    let saved = ""; // the start of the current result, already saved while Chrome sat on it
    // The words of a result after the ones already saved. By whole words, since Chrome may revise the
    // earlier ones as it goes.
    const unsaved = (text: string) => (saved ? text.split(/\s+/).slice(saved.split(/\s+/).length).join(" ") : text);
    let stall: ReturnType<typeof setTimeout> | undefined;
    // Listen to the very track LiveKit sends (echo-cancelled, the same mic the others hear) rather
    // than letting the browser open the default microphone a second time.
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    const listen = () => {
      if (!alive) return;
      try {
        if (track && track.readyState === "live") rec.start(track);
        else rec.start();
      } catch {
        /* already listening */
      }
    };
    const send = (text: string, final: boolean) => {
      putCaption({ id: utterance.id, who: me.id, name: "You", text, final, at: Date.now() });
      void room.localParticipant
        .publishData(encoder.encode(JSON.stringify({ id: utterance.id, text: text.slice(0, 400), final })), {
          reliable: final,
          topic: CAPTION_TOPIC,
        })
        .catch(() => {});
    };
    // Saves the utterance in progress as a transcript line.
    const commit = (text: string) => {
      clearTimeout(stall);
      latest = "";
      if (!text) return;
      pending.current.push({
        id: utterance.id,
        text: text.slice(0, 1000),
        start_at: new Date(utterance.startedAt || Date.now()).toISOString(),
        end_at: new Date().toISOString(),
        focus: focusOf(currentView()),
      });
      if (pending.current.length >= 20) void flushSegments();
      utterance = { id: segmentId(), startedAt: 0 };
    };
    rec.onstart = () => setListening(true);
    rec.onspeechstart = () => setHearing(true);
    rec.onspeechend = () => setHearing(false);
    rec.onresult = (e) => {
      networkFails = 0;
      setCaptionIssue(null);
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (!utterance.startedAt) utterance.startedAt = Date.now();
        // Only the words not saved yet: the rest is already a transcript line.
        const fresh = unsaved(text);
        if (fresh) send(fresh, r.isFinal);
        setHeard(fresh || text);
        if (r.isFinal) {
          commit(fresh);
          saved = "";
          continue;
        }
        // Chrome can sit on an interim result for a long time in a noisy room, or keep one going
        // through nonstop talk. Words that stop changing for a few seconds, or a long run of them, are
        // saved anyway; when the result is finished, only the words after them are added.
        latest = text;
        clearTimeout(stall);
        const saveSoFar = () => {
          const words = unsaved(latest);
          saved = latest;
          commit(words);
        };
        if (fresh.split(/\s+/).length >= 20 || Date.now() - utterance.startedAt > 10_000) saveSoFar();
        else stall = setTimeout(saveSoFar, 4000);
      }
    };
    // Chrome stops listening after a pause or a minute; keep it going while the mic is on.
    rec.onend = () => {
      commit(unsaved(latest)); // words it hadn't finished with
      saved = "";
      setListening(false);
      setHearing(false);
      if (alive) setTimeout(listen, 250);
    };
    rec.onerror = (e) => {
      switch (e.error) {
        case "no-speech":
        case "aborted":
          return; // a quiet moment; onend starts it again
        case "network":
          // The browser's speech service (Google's, in Chrome) couldn't be reached.
          if (++networkFails < 3) return;
          setCaptionIssue("Captions can't reach your browser's speech service. Use Chrome or Edge (Brave blocks it).");
          break;
        case "not-allowed":
        case "service-not-allowed":
          setCaptionIssue("Captions are blocked. Allow the microphone for this site, then turn your mic off and on.");
          break;
        case "audio-capture":
          setCaptionIssue("Captions can't hear a microphone. Check your input device.");
          break;
        case "language-not-supported":
          setCaptionIssue("Your browser can't caption this language. Pick another one.");
          break;
        default:
          return;
      }
      alive = false;
    };
    listen();
    const flusher = setInterval(() => void flushSegments(), 3000);
    return () => {
      alive = false;
      clearInterval(flusher);
      rec.onend = null;
      rec.onstart = null;
      rec.onspeechstart = null;
      rec.onspeechend = null;
      commit(unsaved(latest));
      try {
        rec.abort();
      } catch {
        /* never started */
      }
      setListening(false);
      setHearing(false);
      setHeard("");
      void flushSegments();
    };
  }, [transcribing, call, captionLang]); // eslint-disable-line react-hooks/exhaustive-deps

  // How loud your microphone is, from the very track LiveKit sends, so you can see it's picking you up.
  const [micLevel, setMicLevel] = useState(0);
  useEffect(() => {
    const track = call?.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    if (!micOn || !track) return;
    const ctx = new AudioContext();
    void ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let last = 0;
    const tick = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
      if (Math.abs(level - last) > 0.04) setMicLevel((last = level));
    }, 100);
    return () => {
      clearInterval(tick);
      void ctx.close();
      setMicLevel(0);
    };
  }, [call, micOn]);

  // The paragraph you're reading, at most every 2 s while you're in a call, so the notes can tie
  // what was said to the text on screen.
  useEffect(() => {
    if (!call || !canSpeak) return;
    let last = "";
    const tick = setInterval(() => {
      const view = focusOf(currentView());
      if (!view) return;
      const key = `${view.doc}#${view.block}`;
      if (key === last) return;
      last = key;
      void roomAuth().then((auth) => auth && api.huddles.focus(roomId, call.huddle.id, view, auth).catch(() => {}));
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
    transcribing: transcribing && listening,
    hearing,
    heard,
    micLevel,
    captionLang,
    setCaptionLang,
    captionIssue,
    captionsSupported,
    showCaptions,
    setShowCaptions,
    captions,
    captionLog,
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
