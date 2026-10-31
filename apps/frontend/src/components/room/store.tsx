"use client";

import { nanoid } from "nanoid";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ask as askAi, generate } from "./ai";
import { DEMO_CREATED_AT, DEMO_ROOM_ID } from "./demo";
import { loadDoc, loadSavedHighlights, removeSavedHighlight, saveHighlight } from "./docs";
import type { Identity } from "./identity";
import { can, loadLedger, mergeEvents, reduceLedger, type RoomState, roleOf, saveLedger } from "./ledger";
import {
  type Annotation,
  type ArtifactKind,
  type DocContent,
  type Citation,
  type DocRef,
  INK_COLORS,
  type LedgerEvent,
  type LedgerPayload,
  type Role,
  type ThreadMessage,
  type Tool,
} from "./types";
import { type PresenceChange, useRoomChannel } from "./use-room-channel";

export type DocState = DocContent | "loading" | "missing";
// An annotation before it has an id, author and time (distributes over the union).
export type NewAnnotation = Annotation extends infer A
  ? A extends Annotation
    ? Omit<A, "id" | "author" | "at"> & { id?: string }
    : never
  : never;
export type PanelTab = "chat" | "discussion" | "studio" | "library" | "history";

type Props = {
  roomId: string;
  primary: DocContent;
  bundled: DocContent[]; // documents that need no fetch (the demo room's)
  me: Identity;
  children: React.ReactNode;
};

function useRoomValue({ roomId, primary, bundled, me }: Omit<Props, "children">) {
  const isDemo = roomId === DEMO_ROOM_ID;
  const primaryRef: DocRef = {
    id: primary.id,
    kind: primary.kind,
    title: primary.title,
    source_url: primary.source_url,
    format: null,
  };

  // --- Ledger ---
  const [events, setEvents] = useState<LedgerEvent[]>(() => loadLedger(roomId));
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
    saveLedger(roomId, events);
  }, [roomId, events]);

  // The demo room starts with its second document attached.
  const seed = useMemo<LedgerEvent[]>(
    () =>
      bundled
        .filter((d) => d.id !== primary.id)
        .map((d) => ({
          id: `seed-${d.id}`,
          at: DEMO_CREATED_AT,
          actor: { id: "linkroom", name: "LinkRoom", color: "#2f5bff" },
          type: "doc.add" as const,
          doc: {
            id: d.id,
            kind: d.kind,
            title: d.title,
            source_url: d.source_url,
            format: null,
          },
        })),
    [bundled, primary.id],
  );

  const [savedHighlights, setSavedHighlights] = useState<Annotation[]>([]);
  const state: RoomState = (() => {
    const s = reduceLedger(primaryRef, mergeEvents(seed, events));
    const removed = new Set(events.flatMap((e) => (e.type === "annot.remove" ? [e.annotation_id] : [])));
    const have = new Set(s.annotations.map((a) => a.id));
    const docIds = new Set(s.docs.map((d) => d.id));
    const extra = savedHighlights.filter((a) => !have.has(a.id) && !removed.has(a.id) && docIds.has(a.doc));
    return { ...s, annotations: [...s.annotations, ...extra] };
  })();

  // --- Presence feed (joins and leaves, for the discussion panel) ---
  const [presenceFeed, setPresenceFeed] = useState<PresenceChange[]>([]);
  const [kickedOut, setKickedOut] = useState(false);

  // --- View ---
  const [activeDoc, setActiveDoc] = useState(primary.id);
  const [following, setFollowing] = useState<string | null>(null);

  const receive = (incoming: LedgerEvent[]) => setEvents((prev) => mergeEvents(prev, incoming));

  const channel = useRoomChannel(
    roomId,
    me,
    { doc: activeDoc, following },
    {
      onEvents: receive,
      allEvents: () => eventsRef.current,
      onKicked: () => setKickedOut(true),
      onPresenceChange: (change) => setPresenceFeed((prev) => [...prev.slice(-80), change]),
    },
  );

  // A kick also lands in the ledger, so it holds after a reload or a missed broadcast.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from the synced ledger
    if (state.kicked[me.id]) setKickedOut(true);
  }, [state.kicked, me.id]);

  // --- Documents ---
  const [contents, setContents] = useState<Record<string, DocState>>(() =>
    Object.fromEntries([primary, ...bundled].map((d) => [d.id, d])),
  );
  // A document missing from contents is loading; requested remembers which loads have started.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const doc of state.docs) {
      if (contents[doc.id] || doc.kind === "video" || requested.current.has(doc.id)) continue;
      requested.current.add(doc.id);
      loadDoc(doc.id)
        .then((c) => setContents((prev) => ({ ...prev, [doc.id]: c ?? "missing" })))
        .catch(() => setContents((prev) => ({ ...prev, [doc.id]: "missing" })));
    }
  }, [state.docs, contents]);

  // Reload saved highlights only when the set of documents changes.
  const docKey = state.docs
    .filter((d) => d.kind !== "video")
    .map((d) => d.id)
    .join(" ");
  useEffect(() => {
    if (isDemo || !docKey) return;
    let cancelled = false;
    Promise.all(docKey.split(" ").map(loadSavedHighlights)).then((lists) => {
      if (!cancelled) setSavedHighlights(lists.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [isDemo, docKey]);

  const loaded = Object.values(contents).filter((c): c is DocContent => typeof c === "object");

  // A removed document can't stay open.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- falls back when the open doc disappears
    if (!state.docs.some((d) => d.id === activeDoc)) setActiveDoc(primary.id);
  }, [state.docs, activeDoc, primary.id]);

  // Sources included in AI answers and artifacts (everything unless unticked).
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const included = state.docs.filter((d) => !excluded.has(d.id) && d.kind !== "video").map((d) => d.id);
  const toggleSource = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // --- Permissions ---
  const ownerId = primary.created_by;
  const role: Role =
    isDemo && !ownerId ? (state.roles[me.id] ?? "owner") : roleOf({ id: me.id, signedIn: me.signedIn }, ownerId, state);
  const readOnly = primary.status !== "running";
  const perms = {
    annotate: can.annotate(role) && !readOnly,
    addSources: can.addSources(role) && !readOnly,
    generate: can.generate(role) && !readOnly,
    manage: can.manage(role),
    useAi: can.useAi(role, state.settings) && !readOnly,
  };

  // --- Tools ---
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<string>(INK_COLORS[0]);
  const [width, setWidth] = useState(3);
  const [lens, setLens] = useState(false);
  const [tab, setTab] = useState<PanelTab>("chat");
  const [panelOpen, setPanelOpen] = useState(true);
  const [focusAnnotation, setFocusAnnotation] = useState<string | null>(null);
  // A request to show a block (from a citation, the history or a comment list); n makes repeats count.
  const [jump, setJump] = useState<{
    doc: string;
    block: string;
    n: number;
  } | null>(null);
  const jumpTo = (doc: string, block: string) => {
    setActiveDoc(doc);
    setFollowing(null);
    setJump((prev) => ({ doc, block, n: (prev?.n ?? 0) + 1 }));
  };

  // --- Writing to the ledger ---
  // A closed or archived room is read only: its documents, marks, notes, threads and artifacts stay as
  // they are. Only the room's settings, roles and kicks still change.
  const ADMIN_EVENTS = new Set<LedgerPayload["type"]>(["role.set", "member.kick", "settings.update"]);
  const emit = (...payloads: LedgerPayload[]) => {
    if (readOnly) payloads = payloads.filter((p) => ADMIN_EVENTS.has(p.type));
    if (payloads.length === 0) return [];
    const now = Date.now();
    const made = payloads.map((p, i) => ({
      ...p,
      id: nanoid(12),
      at: new Date(now + i).toISOString(),
      actor: { id: me.id, name: me.name, color: me.color },
    })) as LedgerEvent[];
    setEvents((prev) => mergeEvents(prev, made));
    channel.send.events(made);
    return made;
  };

  const actor = { id: me.id, name: me.name, color: me.color };
  // Who may delete a mark, note, AI box or artifact: its author or a manager, while the room is open.
  const canRemove = (authorId: string) => !readOnly && (authorId === me.id || perms.manage);
  const realDoc = (id: string) => !isDemo && !id.startsWith("yt:") && !bundled.some((d) => d.id === id);

  const actions = {
    addDoc(doc: DocRef) {
      if (state.docs.some((d) => d.id === doc.id)) {
        setActiveDoc(doc.id);
        return;
      }
      emit({ type: "doc.add", doc });
      setActiveDoc(doc.id);
    },
    removeDoc(id: string) {
      emit({ type: "doc.remove", doc_id: id });
    },
    annotate(a: NewAnnotation) {
      const annotation = {
        ...a,
        id: a.id ?? crypto.randomUUID(),
        author: actor,
        at: new Date().toISOString(),
      } as Annotation;
      if (!emit({ type: "annot.add", annotation }).length) return annotation;
      if ((annotation.kind === "highlight" || annotation.kind === "underline") && realDoc(annotation.doc)) {
        void saveHighlight(annotation);
      }
      return annotation;
    },
    removeAnnotation(id: string) {
      const target = state.annotations.find((a) => a.id === id);
      if (!emit({ type: "annot.remove", annotation_id: id }).length) return;
      // Text marks are also rows in highlights (for recaps and new browsers): the browser that saved
      // one removes its row too.
      if (target && (target.kind === "highlight" || target.kind === "underline") && realDoc(target.doc)) {
        void removeSavedHighlight(target.id, target.doc);
      }
    },
    editNote(id: string, body: string) {
      emit({ type: "note.edit", annotation_id: id, body });
    },
    chat(text: string) {
      emit({
        type: "chat",
        message: {
          id: nanoid(10),
          text,
          author: actor,
          at: new Date().toISOString(),
        },
      });
    },
    async ask(
      thread: string,
      question: string,
      opts: { sources: string[]; quote?: string | null; image?: string | null },
    ) {
      const [askEvent] = emit({
        type: "thread.ask",
        thread,
        message: {
          id: nanoid(10),
          role: "user",
          text: question,
          author: actor,
          at: new Date().toISOString(),
          sources: opts.sources,
        },
      });
      if (!askEvent) return;
      const history = (state.threads[thread] ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text }));
      const docs = loaded.filter((d) => opts.sources.includes(d.id));
      const answer = (reply: { text: string; citations: Citation[]; preview: boolean; failed?: boolean }) =>
        emit({
          type: "thread.answer",
          thread,
          message: {
            id: nanoid(10),
            role: "ai",
            ...reply,
            reply_to: askEvent!.type === "thread.ask" ? askEvent!.message.id : "",
            at: new Date().toISOString(),
          },
        });
      try {
        answer(
          await askAi(
            { question, sources: opts.sources, quote: opts.quote, image: opts.image, history, name: me.name },
            docs,
            opts.sources.filter(realDoc),
          ),
        );
      } catch (err) {
        // A refusal (still indexing, rate limited, …) is answered too, so the thread isn't left waiting
        // for everyone and anyone can ask again.
        const reason = err instanceof Error ? err.message : "The AI couldn't answer";
        toast.error(reason);
        answer({ text: `Couldn't answer: ${reason}`, citations: [], preview: false, failed: true });
      }
    },
    async generate(kind: ArtifactKind, sources: string[], title: string) {
      if (readOnly) return null;
      const docs = loaded.filter((d) => sources.includes(d.id));
      if (docs.length === 0) {
        toast.error("Pick at least one source that has loaded");
        return null;
      }
      const { body, preview } = await generate(roomId, kind, docs);
      const artifact = {
        id: nanoid(10),
        title,
        sources,
        author: actor,
        at: new Date().toISOString(),
        preview,
        body,
      };
      emit({ type: "artifact.add", artifact });
      return artifact;
    },
    removeArtifact(id: string) {
      emit({ type: "artifact.remove", artifact_id: id });
    },
    setRole(member: string, name: string, next: Role) {
      emit({ type: "role.set", member, name, role: next });
    },
    kick(member: string, name: string) {
      emit({ type: "member.kick", member, name });
      channel.send.kick(member);
    },
    updateSettings(patch: Partial<RoomState["settings"]>) {
      emit({ type: "settings.update", patch });
    },
  };

  return {
    roomId,
    isDemo,
    me,
    primary,
    ownerId,
    events,
    state,
    contents,
    loaded,
    activeDoc,
    setActiveDoc,
    following,
    setFollowing,
    included,
    excluded,
    toggleSource,
    role,
    perms,
    readOnly,
    canRemove,
    tool,
    setTool,
    color,
    setColor,
    width,
    setWidth,
    lens,
    setLens,
    tab,
    setTab,
    panelOpen,
    setPanelOpen,
    focusAnnotation,
    setFocusAnnotation,
    jump,
    jumpTo,
    channel,
    presenceFeed,
    kickedOut,
    actions,
  };
}

export type RoomContextValue = ReturnType<typeof useRoomValue>;
const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({ children, ...props }: Props) {
  const value = useRoomValue(props);
  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

// A thread waits for an answer while its last message is a question asked in the last two minutes.
// Failed questions get an answer saying so, and a question whose asker left mid-request stops
// blocking the thread after that.
const ANSWER_TIMEOUT_MS = 2 * 60_000;
export function useAwaitingAnswer(thread: ThreadMessage[]) {
  const last = thread.at(-1);
  const askedAt = last?.role === "user" ? Date.parse(last.at) : null;
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (askedAt === null) return;
    const timer = setTimeout(() => setExpired(askedAt), Math.max(0, askedAt + ANSWER_TIMEOUT_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [askedAt]);
  return askedAt !== null && expired !== askedAt;
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom must be used inside RoomProvider");
  return ctx;
}

// A display name for a member id, from presence, the ledger or the marks they left.
export function useNameOf() {
  const { channel, events, me } = useRoom();
  return (id: string) => {
    if (id === me.id) return me.name;
    const peer = channel.peers.find((p) => p.id === id);
    if (peer) return peer.name;
    for (let i = events.length - 1; i >= 0; i--) if (events[i]!.actor.id === id) return events[i]!.actor.name;
    return "Someone";
  };
}
