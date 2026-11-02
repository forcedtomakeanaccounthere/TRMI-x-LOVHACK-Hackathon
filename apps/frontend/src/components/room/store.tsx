"use client";

import { nanoid } from "nanoid";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type MentionPerson, parseMentions } from "@linkroom/shared";
import { api, ApiError } from "@/lib/api";
import { getFreshSession } from "@/lib/session";
import { ask as askAi, generate } from "./ai";
import { DEMO_CREATED_AT, DEMO_ROOM_ID } from "./demo";
import {
  AI_POLL_MS,
  AI_WAITING,
  loadAiStatuses,
  loadDoc,
  loadSavedHighlights,
  removeSavedHighlight,
  saveHighlight,
} from "./docs";
import { buildCatchup, lastVisit, markVisit } from "./catchup";
import { onRoomStatus } from "./room-status-bus";
import { guestKey, type Identity } from "./identity";
import { authFor, LedgerSync } from "./ledger-sync";
import { can, loadLedger, mergeEvents, reduceLedger, type RoomState, roleOf, saveLedger } from "./ledger";
import {
  type Annotation,
  type ArtifactKind,
  type DocContent,
  type Citation,
  type DocRef,
  INK_COLORS,
  type LedgerEvent,
  type NotebookEntry,
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
  // The artifact open in the viewer dialog. Shared through presence, so followers see it too.
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  // Other people's cursors can be hidden when they distract; remembered in this browser.
  const [showCursors, setShowCursorsState] = useState(() => {
    try {
      return localStorage.getItem(CURSORS_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const setShowCursors = (on: boolean) => {
    setShowCursorsState(on);
    try {
      localStorage.setItem(CURSORS_KEY, on ? "on" : "off");
    } catch {
      // the choice lasts for this page only
    }
  };
  // Bumped when the backend says the room's huddles changed, so the huddle list refetches.
  const [huddleTick, setHuddleTick] = useState(0);
  // Laser focus: leading one pulls everyone to where you are until you stop.
  const [focusing, setFocusing] = useState(false);

  const receive = (incoming: LedgerEvent[]) => setEvents((prev) => mergeEvents(prev, incoming));

  // --- The ledger on the server ---
  // Loaded when the room opens (so changes made while you were away arrive even when nobody else is
  // online), and every event made here is saved there too.
  const syncRef = useRef<LedgerSync | null>(null);
  const [serverLoaded, setServerLoaded] = useState(isDemo);
  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    let warned = false;
    const auth = async () => authFor(me, (await getFreshSession().catch(() => null))?.access_token ?? null, guestKey);
    const sync = new LedgerSync({
      list: async (after) => {
        const a = await auth();
        if (!a) throw new ApiError("Sign in again to load the room's changes", 401);
        return api.listEvents(roomId, after, a);
      },
      post: async (batch) => {
        const a = await auth();
        if (!a) throw new ApiError("Sign in again to save your changes", 401);
        return api.postEvents(roomId, batch, a);
      },
      onRejected: (rejected) => {
        console.warn("[room] changes the server refused:", rejected);
        // They never reached anyone else and never will: drop them here too, so they aren't sent
        // (and refused) again every time the room opens.
        // Only events refused as malformed: a whole batch refused (signed out, say) is kept.
        const refused = new Set(
          rejected.filter((r) => /^(Invalid event|The event is too large)/.test(r.reason)).map((r) => r.id),
        );
        if (refused.size) setEvents((list) => list.filter((e) => !refused.has(e.id)));
        if (!warned && rejected[0]) {
          warned = true;
          toast.error(`Some changes weren't saved for others: ${rejected[0].reason}`);
        }
      },
    });
    syncRef.current = sync;
    sync
      .load()
      .then((saved) => {
        if (cancelled) return;
        receive(saved);
        sync.backfill(eventsRef.current, saved, me.id);
      })
      .catch((err: unknown) => console.warn("[room] couldn't load the room's saved changes:", err))
      .finally(() => {
        if (!cancelled) setServerLoaded(true);
      });
    return () => {
      cancelled = true;
      sync.stop();
      syncRef.current = null;
    };
  }, [roomId, isDemo, me.id, me.signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- While you were away ---
  // The last time this browser had the room open (kept up to date while it's open), and when this
  // visit began: the catch-up covers what others did in between.
  const [visit] = useState(() => ({
    since: isDemo ? null : lastVisit(roomId, me.id),
    start: new Date().toISOString(),
  }));
  useEffect(() => {
    if (isDemo) return;
    const mark = () => markVisit(roomId, me.id);
    mark();
    const timer = setInterval(mark, 60_000);
    const onHide = () => document.visibilityState === "hidden" && mark();
    window.addEventListener("pagehide", mark);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      mark();
      clearInterval(timer);
      window.removeEventListener("pagehide", mark);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [roomId, isDemo, me.id]);
  const catchup = useMemo(
    () => (visit.since && serverLoaded ? buildCatchup(events, me, visit.since, visit.start) : null),
    [events, me, visit, serverLoaded],
  );
  const [catchupDismissed, setCatchupDismissed] = useState(false);

  const channel = useRoomChannel(
    roomId,
    me,
    { doc: activeDoc, following, focusing, artifact: openArtifact },
    {
      onEvents: receive,
      allEvents: () => eventsRef.current,
      onKicked: () => setKickedOut(true),
      onPresenceChange: (change) => setPresenceFeed((prev) => [...prev.slice(-80), change]),
      onHuddlesChanged: () => setHuddleTick((t) => t + 1),
      onNotify: (n) =>
        toast(`${n.actor_name} mentioned you`, {
          description: n.body.length > 140 ? `${n.body.slice(0, 140)}…` : n.body,
          action: { label: "Discussion", onClick: () => setTab("discussion") },
        }),
      position: () => viewPos.current,
    },
  );

  // A "go to reader" waiting for that reader to say where they are (see actions.goToReader).
  const [pendingReader, setPendingReader] = useState<{ id: string; asked: number } | null>(null);
  const answer = pendingReader ? channel.scrolls[pendingReader.id] : undefined;
  useEffect(() => {
    if (!pendingReader || !answer) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one jump per request
    setPendingReader(null);
    jumpTo(answer.doc, answer.block, answer.ratio);
    // Only when their answer arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer]);
  useEffect(() => {
    if (!pendingReader) return;
    const timer = setTimeout(() => setPendingReader(null), 3000); // no answer: the document is open at least
    return () => clearTimeout(timer);
  }, [pendingReader]);

  // --- Mentions ---
  // Who can be @mentioned: people who have joined this room at some point (the backend's list),
  // people you follow, and signed-in readers here now. Guests can't receive notifications, and you
  // can't mention yourself.
  const [roomPeople, setRoomPeople] = useState<MentionPerson[]>([]);
  const [followed, setFollowed] = useState<MentionPerson[]>([]);
  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    void api.notifications
      .people(roomId)
      .then((r) => !cancelled && setRoomPeople(r.people))
      .catch(() => {}); // an older backend without the route: present readers still work
    if (me.signedIn) {
      void getFreshSession().then((session) => {
        if (!session || cancelled) return;
        void api.me
          .following(session.access_token)
          .then((r) => !cancelled && setFollowed(r.users.map((u) => ({ id: u.id, name: u.display_name }))))
          .catch(() => {});
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isDemo, roomId, me.signedIn]);
  const mentionables: MentionPerson[] = [
    ...new Map(
      [...roomPeople, ...followed, ...channel.peers.filter((p) => p.signedIn).map((p) => ({ id: p.id, name: p.name }))]
        .filter((p) => p.id !== me.id && p.name.trim())
        .map((p) => [p.id, p]),
    ).values(),
  ];

  // Tells the backend about new mentions in a message or comment; it notifies those people.
  // Best effort: the message is already in the room either way.
  const announce = (kind: "chat" | "note", eventId: string, body: string, people: MentionPerson[]) => {
    if (isDemo || people.length === 0) return;
    void getFreshSession().then((session) =>
      api.notifications
        .announce(
          roomId,
          {
            event_id: eventId.slice(0, 64),
            kind,
            body: body.slice(0, 2000),
            author: { id: me.id, name: me.name.slice(0, 40) },
            mentions: people.slice(0, 20).map((p) => ({ id: p.id, name: p.name.slice(0, 40) })),
          },
          session?.access_token,
        )
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) {
            console.warn("[room] mention notifications need the backend's /api/notifications routes");
          } else {
            toast.error("Couldn't notify the people you mentioned", {
              description: err instanceof Error ? err.message : undefined,
            });
          }
        }),
    );
  };

  // Follow mode: open the document the leader has open (from presence, so it works before they
  // scroll) and the artifact they're viewing, and stop following someone who left.
  const leader = following ? channel.peers.find((p) => p.id === following) : undefined;
  const leaderDoc = leader?.doc ?? null;
  const leaderArtifact = leader?.artifact ?? null;
  const leaderGone = !!following && channel.status === "live" && !leader;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the leader's presence
    if (leaderGone) setFollowing(null);
    else if (leaderDoc) setActiveDoc(leaderDoc);
  }, [leaderGone, leaderDoc]);
  useEffect(() => {
    if (!following) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the leader's presence
    setOpenArtifact(leaderArtifact);
  }, [following, leaderArtifact]);

  // --- Laser focus ---
  // Someone leading a focus takes everyone else to their document and scroll position (follow mode,
  // locked) and shows their pointer as a laser. Each person's own place is remembered and they go
  // back to it when the focus ends or they leave it. One leader at a time: the earliest id wins.
  const viewPos = useRef<{ doc: string; block: string; ratio: number } | null>(null);
  const reportView = (doc: string, block: string, ratio: number) => {
    viewPos.current = { doc, block, ratio };
  };
  const focusLeader = focusing
    ? undefined
    : channel.peers.filter((p) => p.focusing).sort((a, b) => a.id.localeCompare(b.id))[0];
  const [leftFocus, setLeftFocus] = useState<string | null>(null); // the leader whose focus you left
  const activeFocus = focusLeader && focusLeader.id !== leftFocus ? focusLeader : undefined;
  const returnTo = useRef<{ doc: string; block: string | null; ratio: number } | null>(null);
  const focusedOn = useRef<string | null>(null);
  const activeDocRef = useRef(activeDoc);
  useEffect(() => {
    activeDocRef.current = activeDoc;
  });
  const focusId = activeFocus?.id ?? null;
  useEffect(() => {
    const before = focusedOn.current;
    if (focusId === before) return;
    focusedOn.current = focusId;
    if (focusId) {
      if (!before) {
        const doc = activeDocRef.current;
        const pos = viewPos.current?.doc === doc ? viewPos.current : null;
        returnTo.current = { doc, block: pos?.block ?? null, ratio: pos?.ratio ?? 0 };
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the focus leader's presence
      setFollowing(focusId);
      return;
    }
    // The focus ended (or you left it): back to where you were.
    const back = returnTo.current;
    returnTo.current = null;
    setFollowing(null);
    if (back?.block) jumpTo(back.doc, back.block, back.ratio);
    else if (back) setActiveDoc(back.doc);
  }, [focusId]);
  // A new focus by the same person can be joined again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset once that focus is over
    if (leftFocus && !focusLeader) setLeftFocus(null);
  }, [leftFocus, focusLeader]);

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

  // A document still being indexed shows "AI pending…" until its status changes, so its status is
  // checked again every few seconds until it is ready or failed. Reloaded in full then, since a
  // video room's doc is written at the end.
  // Only sources still in the room: a removed one is no longer checked.
  const waitingKey = state.docs
    .map((d) => contents[d.id])
    .filter((c): c is DocContent => typeof c === "object" && AI_WAITING.has(c.ai_status ?? ""))
    .map((c) => c.id)
    .join(" ");
  useEffect(() => {
    if (isDemo || !waitingKey) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const ids = waitingKey.split(" ");
      const statuses = await loadAiStatuses(ids).catch(() => null);
      if (cancelled || !statuses) return;
      for (const id of ids) {
        const status = statuses[id];
        // No row: the room was deleted (its row is hidden then), so it has no AI status to wait for.
        if (!status || AI_WAITING.has(status)) {
          setContents((prev) => {
            const c = prev[id];
            const next = status ?? null;
            return typeof c === "object" && c.ai_status !== next ? { ...prev, [id]: { ...c, ai_status: next } } : prev;
          });
          continue;
        }
        loadDoc(id)
          .then((c) => {
            if (!cancelled && c) setContents((prev) => ({ ...prev, [id]: c }));
          })
          .catch(() => {});
      }
    }, AI_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isDemo, waitingKey]);

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
  // The room's status, kept live: the backend pauses a room nobody has used for a while and says so
  // on the room channel. A paused room is read only until it's resumed.
  const [status, setStatus] = useState<string>(primary.status);
  useEffect(() => onRoomStatus((m) => m.status && setStatus(m.status)), []);
  const isOwner = me.signedIn && ownerId === me.id;
  const [resuming, setResuming] = useState(false);
  async function resume() {
    if (isDemo || resuming) return;
    setResuming(true);
    try {
      const session = await getFreshSession();
      if (!session) throw new Error("Sign in again to resume the room");
      const room = await api.updateRoom(roomId, { status: "running" }, session.access_token);
      setStatus(room.status);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't resume the room");
    } finally {
      setResuming(false);
    }
  }
  // The owner opening a paused room picks it back up: they're here to use it.
  useEffect(() => {
    if (!isDemo && isOwner && status === "paused") void resume(); // eslint-disable-line react-hooks/set-state-in-effect -- resumes on the server
  }, [isOwner, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const readOnly = status !== "running";
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
  // The room notebook opens as a drawer from the top bar.
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [focusAnnotation, setFocusAnnotation] = useState<string | null>(null);
  // A request to show a block (from a citation, the history or a comment list); n makes repeats count.
  const [jump, setJump] = useState<{
    doc: string;
    block: string;
    ratio: number;
    n: number;
  } | null>(null);
  function jumpTo(doc: string, block: string, ratio = 0) {
    setActiveDoc(doc);
    setFollowing(null);
    setJump((prev) => ({ doc, block, ratio, n: (prev?.n ?? 0) + 1 }));
  }

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
    syncRef.current?.push(made);
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
      const before = state.annotations.find((a) => a.id === id);
      const earlier = new Set(before?.kind === "note" ? parseMentions(before.body, mentionables).map((m) => m.id) : []);
      const [made] = emit({ type: "note.edit", annotation_id: id, body });
      // Only people newly mentioned in this edit are notified.
      if (made) {
        const fresh = parseMentions(body, mentionables).filter((m) => !earlier.has(m.id));
        announce("note", made.id, body, fresh);
      }
    },
    moveAnnotation(id: string, x: number, y: number) {
      const round = (n: number) => Math.round(n * 10000) / 10000;
      emit({ type: "annot.move", annotation_id: id, x: round(x), y: round(y) });
    },
    chat(text: string, replyTo?: string) {
      const id = nanoid(10);
      const made = emit({
        type: "chat",
        message: {
          id,
          text,
          author: actor,
          at: new Date().toISOString(),
          ...(replyTo ? { reply_to: replyTo } : {}),
        },
      });
      if (made.length) announce("chat", id, text, parseMentions(text, mentionables));
    },
    // Opens the document a reader is on, at their exact spot. Uses their latest scroll update, or
    // asks them for it when there's none yet (they joined before you, or haven't scrolled).
    goToReader(peerId: string) {
      const peer = channel.peers.find((p) => p.id === peerId);
      if (!peer) return;
      const known = channel.scrolls[peerId];
      if (known && (!peer.doc || known.doc === peer.doc)) {
        jumpTo(known.doc, known.block, known.ratio);
        return;
      }
      if (peer.doc) setActiveDoc(peer.doc);
      setPendingReader({ id: peerId, asked: Date.now() });
      channel.send.requestPosition(peerId);
    },
    react(messageId: string, emoji: string) {
      emit({ type: "chat.react", message_id: messageId, emoji });
    },
    // Notebook entries: a typed note, a passage saved from a source, or an image (with optional text).
    addToNotebook(entry: Pick<NotebookEntry, "kind" | "text" | "quote" | "image">) {
      const made = emit({
        type: "notebook.add",
        entry: { ...entry, id: nanoid(12), author: actor, at: new Date().toISOString() },
      });
      return made.length > 0;
    },
    editNotebook(entryId: string, text: string) {
      emit({ type: "notebook.edit", entry_id: entryId, text });
    },
    removeFromNotebook(entryId: string) {
      emit({ type: "notebook.remove", entry_id: entryId });
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
      let made: Awaited<ReturnType<typeof generate>>;
      try {
        made = await generate(roomId, kind, docs, realDoc(roomId) && docs.every((d) => realDoc(d.id)));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't make that");
        return null;
      }
      const { body, preview } = made;
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
    realDoc, // a document the backend has a room for (not demo, bundled or an unsaved link)
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
    openArtifact,
    setOpenArtifact,
    showCursors,
    setShowCursors,
    included,
    excluded,
    toggleSource,
    role,
    perms,
    readOnly,
    status,
    resume: perms.manage ? () => void resume() : null, // the owner or an admin
    resuming,
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
    notebookOpen,
    setNotebookOpen,
    setTab,
    panelOpen,
    setPanelOpen,
    focusAnnotation,
    setFocusAnnotation,
    jump,
    jumpTo,
    reportView,
    focus: {
      leader: activeFocus, // someone else's focus you're in
      mine: focusing,
      start: () => {
        setFollowing(null);
        setFocusing(true);
      },
      stop: () => setFocusing(false),
      leave: () => activeFocus && setLeftFocus(activeFocus.id),
    },
    channel,
    mentionables,
    huddleTick,
    // The room auth for backend routes (a signed-in token, or the guest id and key).
    roomAuth: async () =>
      authFor(me, me.signedIn ? ((await getFreshSession().catch(() => null))?.access_token ?? null) : null, guestKey),
    // The paragraph you're reading now (from the viewer), for huddle captions.
    currentView: () => viewPos.current,
    catchup: catchupDismissed ? null : catchup,
    dismissCatchup: () => setCatchupDismissed(true),
    presenceFeed,
    kickedOut,
    actions,
  };
}

const CURSORS_KEY = "linkroom-show-cursors";

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
