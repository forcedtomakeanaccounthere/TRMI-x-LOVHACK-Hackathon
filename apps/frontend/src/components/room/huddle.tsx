"use client";

import type { HuddleNotePoint, HuddleNotesResponse, HuddleSummary, HuddleTranscriptSegment } from "@linkroom/shared";
import {
  ArrowSquareOutIcon,
  CheckIcon,
  ClosedCaptioningIcon,
  DownloadSimpleIcon,
  HeadphonesIcon,
  MagnifyingGlassIcon,
  MicrophoneIcon,
  MicrophoneSlashIcon,
  PhoneDisconnectIcon,
  ScrollIcon,
  SparkleIcon,
  SpeakerHighIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Avatar } from "./bits";
import { useRoom } from "./store";
import { CAPTION_LANGS, type CallPerson, useHuddle } from "./use-huddle";

// The huddle corner at the foot of the Sources rail: start a voice huddle with everyone or a few
// people, join running ones, talk with live captions, then read the transcript and the AI notes.

const PALETTE = ["#2f5bff", "#e2557a", "#14a37f", "#f59e0b", "#8b5cf6", "#0ea5e9", "#ef4444", "#22c55e"];
const hashColor = (id: string) =>
  PALETTE[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length]!;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function useColorOf() {
  const { channel, me } = useRoom();
  return (id: string) => (id === me.id ? me.color : (channel.peers.find((p) => p.id === id)?.color ?? hashColor(id)));
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const mm = Math.floor(s / 60);
  return (
    <span className="tabular-nums">
      {mm >= 60 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, "0")}` : mm}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

// The "H" mark: two strokes and a bar that ripples while a call is live.
function HuddleMark({ live }: { live?: boolean }) {
  return (
    <span
      className={cn(
        "relative grid size-8 shrink-0 place-items-center rounded-xl ring-1",
        live
          ? "bg-emerald-500/12 text-emerald-600 ring-emerald-500/30 dark:text-emerald-400"
          : "bg-foreground/5 ring-(--hairline)",
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      >
        <path d="M6 4v16M18 4v16" />
        <path d="M6 12h12" className={live ? "animate-pulse" : undefined} />
      </svg>
      {live && <span className="absolute -top-0.5 -right-0.5 size-2.5 animate-ping rounded-full bg-emerald-500/70" />}
      {live && (
        <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
      )}
    </span>
  );
}

const present = (h: HuddleSummary) => (h.members ?? []).filter((m) => m.joined_at && !m.left_at);

export function HuddleDock() {
  const h = useHuddle();
  const [starting, setStarting] = useState(false);
  const [record, setRecord] = useState<{ huddle: HuddleSummary; tab: "notes" | "transcript" } | null>(null);
  const [showRecent, setShowRecent] = useState(false);

  return (
    <div className="shrink-0 px-3 pb-3">
      <div className="overflow-hidden rounded-2xl border border-(--hairline) bg-card/80 shadow-[0_1px_0_rgb(0_0_0/0.02),0_8px_24px_-16px_rgb(0_0_0/0.25)] backdrop-blur">
        {h.call ? (
          <InCall onTranscript={() => h.call && setRecord({ huddle: h.call, tab: "transcript" })} />
        ) : (
          <Idle
            onStart={() => setStarting(true)}
            onOpen={(huddle, tab) => setRecord({ huddle, tab })}
            showRecent={showRecent}
            setShowRecent={setShowRecent}
          />
        )}
        <AnimatePresence>
          {h.ended && !h.call && (
            <motion.button
              type="button"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              onClick={() => {
                if (h.ended) setRecord({ huddle: h.ended, tab: "notes" });
                h.clearEnded();
              }}
              className="flex w-full items-center gap-2 border-t border-(--hairline) bg-azure/6 px-3 py-2 text-left text-[0.75rem] text-azure"
            >
              <SparkleIcon weight="fill" className="size-3.5 shrink-0" />
              <span className="flex-1">Huddle ended. See the notes</span>
              <ArrowSquareOutIcon className="size-3.5" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <StartHuddleDialog open={starting} onOpenChange={setStarting} />
      {record && <HuddleRecord huddle={record.huddle} tab={record.tab} onClose={() => setRecord(null)} />}
    </div>
  );
}

function Idle({
  onStart,
  onOpen,
  showRecent,
  setShowRecent,
}: {
  onStart: () => void;
  onOpen: (h: HuddleSummary, tab: "notes" | "transcript") => void;
  showRecent: boolean;
  setShowRecent: (v: boolean) => void;
}) {
  const h = useHuddle();
  const colorOf = useColorOf();
  if (h.unavailable)
    return (
      <div className="flex items-center gap-3 p-3">
        <HuddleMark />
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-medium">Huddle</p>
          <p className="text-[0.6875rem] leading-snug text-muted-foreground">{h.unavailable}</p>
        </div>
      </div>
    );

  return (
    <div>
      <div className="flex items-center gap-3 p-3">
        <HuddleMark live={h.running.length > 0} />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium">Huddle</p>
          <p className="truncate text-[0.6875rem] text-muted-foreground">
            {h.running.length ? `${h.running.length} running now` : "Talk it through, with captions"}
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={h.busy !== null}
          className="flex h-8 items-center gap-1.5 rounded-full bg-ink px-3 text-[0.75rem] font-medium text-pearl transition hover:opacity-90 disabled:opacity-50 dark:bg-azure"
        >
          <WaveformIcon weight="bold" className="size-3.5" />
          {h.busy === "start" ? "Starting…" : "Start"}
        </button>
      </div>

      {h.running.length > 0 && (
        <ul className="space-y-1 border-t border-(--hairline) p-2">
          {h.running.map((r) => {
            const here = present(r);
            return (
              <li key={r.id} className="flex items-center gap-2 rounded-xl px-1.5 py-1.5 hover:bg-foreground/4">
                <span className="flex -space-x-1.5">
                  {(here.length ? here : [{ member_id: r.created_by, name: r.created_by_name }])
                    .slice(0, 3)
                    .map((m) => (
                      <Avatar key={m.member_id} actor={{ name: m.name, color: colorOf(m.member_id) }} size={20} ring />
                    ))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.75rem] font-medium">
                    {r.audience === "all" ? "Everyone" : "Private"} · {r.created_by_name.split(" ")[0]}
                  </p>
                  <p className="text-[0.625rem] text-muted-foreground">
                    {here.length} in · <Elapsed since={r.started_at} />
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => h.join(r.id)}
                  disabled={h.busy !== null}
                  className="h-7 rounded-full bg-emerald-500 px-3 text-[0.6875rem] font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
                >
                  {h.busy === r.id ? "Joining…" : "Join"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {h.recent.length > 0 && (
        <div className="border-t border-(--hairline)">
          <button
            type="button"
            onClick={() => setShowRecent(!showRecent)}
            className="flex w-full items-center justify-between px-3 py-2 text-[0.6875rem] text-muted-foreground hover:text-foreground"
          >
            <span className="eyebrow text-[0.5625rem]">Past huddles · {h.recent.length}</span>
            <span>{showRecent ? "Hide" : "Show"}</span>
          </button>
          <AnimatePresence initial={false}>
            {showRecent && (
              <motion.ul
                initial={{ height: 0 }}
                animate={{ height: "auto" }}
                exit={{ height: 0 }}
                data-lenis-prevent
                className="max-h-44 overflow-y-auto px-2 pb-2"
              >
                {h.recent.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-xl px-1.5 py-1.5 hover:bg-foreground/4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.75rem]">
                        {r.audience === "all" ? "Everyone" : "Private"} · {r.created_by_name.split(" ")[0]}
                      </p>
                      <p className="text-[0.625rem] text-muted-foreground">
                        {new Date(r.started_at).toLocaleDateString([], { month: "short", day: "numeric" })},{" "}
                        {clock(r.started_at)}
                        {r.notes_status === "ready" && " · notes ready"}
                        {r.notes_status === "generating" && " · writing notes…"}
                      </p>
                    </div>
                    <IconButton label="Transcript" onClick={() => onOpen(r, "transcript")}>
                      <ScrollIcon className="size-3.5" />
                    </IconButton>
                    <IconButton label="Notes" onClick={() => onOpen(r, "notes")}>
                      <SparkleIcon className="size-3.5" />
                    </IconButton>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  active,
  tone,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  tone?: "danger";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "grid size-8 place-items-center rounded-full transition",
            tone === "danger"
              ? "bg-rose-500 text-white hover:bg-rose-600"
              : active
                ? "bg-foreground text-background"
                : "bg-foreground/6 text-foreground hover:bg-foreground/10",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function InCall({ onTranscript }: { onTranscript: () => void }) {
  const h = useHuddle();
  const { me, perms } = useRoom();
  const colorOf = useColorOf();
  const [inviting, setInviting] = useState(false);
  const call = h.call!;
  const canEnd = call.created_by === me.id || perms.manage;
  const canInvite = call.audience === "private" && h.canSpeak;

  return (
    <div>
      <div className="flex items-center gap-3 p-3 pb-2">
        <HuddleMark live />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium">{call.audience === "all" ? "Room huddle" : "Private huddle"}</p>
          <p className="text-[0.6875rem] text-muted-foreground">
            <Elapsed since={call.started_at} /> · {h.inCall.length} in
          </p>
        </div>
        {h.transcribing && (
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.5625rem] font-semibold tracking-wide uppercase transition-colors",
              h.hearing ? "bg-rose-500/12 text-rose-600 dark:text-rose-400" : "bg-foreground/6 text-muted-foreground",
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", h.hearing ? "animate-pulse bg-rose-500" : "bg-foreground/30")}
            />
            {h.hearing ? "Hearing you" : "Listening"}
          </span>
        )}
      </div>

      <ul data-lenis-prevent className="flex max-h-28 flex-wrap gap-2 overflow-y-auto px-3 pb-2">
        {h.inCall.map((p) => (
          <Speaker key={p.id} person={p} color={colorOf(p.id)} />
        ))}
      </ul>

      {/* Your voice: the live level of the mic you're sending, and the words captions made out. */}
      {h.canSpeak && h.micOn && (
        <div className="mx-3 mb-2 rounded-xl bg-foreground/4 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <MicMeter level={h.micLevel} />
            <span className="min-w-0 flex-1 truncate text-[0.625rem] text-muted-foreground">
              {h.micLevel > 0.08 ? "Your mic is picking you up" : "Mic on, say something"}
            </span>
            {h.captionsSupported && (
              <select
                aria-label="Caption language"
                value={h.captionLang}
                onChange={(e) => h.setCaptionLang(e.target.value)}
                className="max-w-24 cursor-pointer rounded-md bg-transparent text-[0.625rem] text-muted-foreground outline-none hover:text-foreground"
              >
                {CAPTION_LANGS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          {h.captionsSupported && (
            <p className="mt-1 line-clamp-2 text-[0.6875rem] leading-snug text-foreground/80">
              {h.heard ? (
                <>“{h.heard}”</>
              ) : (
                <span className="text-muted-foreground">
                  {h.transcribing ? "Captions are listening. Your words show here." : "Starting captions…"}
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {h.needsAudioClick && (
        <button
          type="button"
          onClick={h.enableAudio}
          className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center justify-center gap-1.5 rounded-xl bg-amber-500/12 py-1.5 text-[0.6875rem] font-medium text-amber-700 dark:text-amber-300"
        >
          <SpeakerHighIcon className="size-3.5" /> Tap to hear the others
        </button>
      )}
      {h.canSpeak && h.micOn && (!h.captionsSupported || h.captionIssue) && (
        <p className="mx-3 mb-2 rounded-xl bg-amber-500/10 px-2.5 py-1.5 text-[0.6875rem] leading-snug text-amber-800 dark:text-amber-200">
          {h.captionIssue ?? "Captions and the transcript need Chrome or Edge. You can still talk."}
        </p>
      )}

      <div className="flex items-center gap-1.5 border-t border-(--hairline) px-3 py-2">
        {h.canSpeak ? (
          <IconButton label={h.micOn ? "Mute" : "Unmute"} onClick={h.toggleMic} active={!h.micOn}>
            {h.micOn ? <MicrophoneIcon weight="fill" className="size-4" /> : <MicrophoneSlashIcon className="size-4" />}
          </IconButton>
        ) : (
          <span className="flex h-8 items-center gap-1 rounded-full bg-foreground/6 px-2.5 text-[0.625rem] text-muted-foreground">
            <HeadphonesIcon className="size-3.5" /> Listening
          </span>
        )}
        <IconButton
          label={h.showCaptions ? "Hide captions" : "Show captions"}
          onClick={() => h.setShowCaptions(!h.showCaptions)}
          active={h.showCaptions}
        >
          <ClosedCaptioningIcon weight={h.showCaptions ? "fill" : "regular"} className="size-4" />
        </IconButton>
        <IconButton label="Transcript" onClick={onTranscript}>
          <ScrollIcon className="size-4" />
        </IconButton>
        {canInvite && (
          <IconButton label="Invite people" onClick={() => setInviting(true)}>
            <UserPlusIcon className="size-4" />
          </IconButton>
        )}
        <span className="flex-1" />
        {canEnd && (
          <button
            type="button"
            onClick={h.end}
            className="h-8 rounded-full px-2 text-[0.6875rem] font-medium text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
          >
            End all
          </button>
        )}
        <IconButton label="Leave" onClick={h.leave} tone="danger">
          <PhoneDisconnectIcon weight="fill" className="size-4" />
        </IconButton>
      </div>
      <PeoplePicker
        open={inviting}
        onOpenChange={setInviting}
        title="Invite to the huddle"
        cta={(n) => (n ? `Invite ${n}` : "Invite")}
        exclude={new Set((call.members ?? []).map((m) => m.member_id))}
        onPick={(ids) => {
          void h.invite(ids);
          setInviting(false);
        }}
      />
    </div>
  );
}

function Speaker({ person, color }: { person: CallPerson; color: string }) {
  return (
    <li className="flex flex-col items-center gap-1" title={person.name}>
      <span className="relative">
        <motion.span
          className="absolute -inset-1 rounded-full"
          style={{ boxShadow: `0 0 0 2px ${color}` }}
          animate={{ opacity: person.speaking ? [0.4, 1, 0.4] : 0, scale: person.speaking ? [1, 1.08, 1] : 1 }}
          transition={{ duration: 1.1, repeat: person.speaking ? Infinity : 0 }}
        />
        <Avatar actor={{ name: person.name, color }} size={32} />
        {person.muted && (
          <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-background ring-1 ring-(--hairline)">
            <MicrophoneSlashIcon className="size-2.5 text-muted-foreground" />
          </span>
        )}
      </span>
      <span className="max-w-12 truncate text-[0.5625rem] text-muted-foreground">
        {person.me ? "You" : person.name.split(" ")[0]}
      </span>
    </li>
  );
}

// --- Starting a huddle: everyone, or a chosen few ---

function StartHuddleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const h = useHuddle();
  const [mode, setMode] = useState<"all" | "pick">("all");
  const [picking, setPicking] = useState(false);
  const go = (members: string[] | "all") => {
    onOpenChange(false);
    setPicking(false);
    h.start(members);
  };

  return (
    <>
      <Dialog open={open && !picking} onOpenChange={onOpenChange}>
        <DialogContent className="rounded-[1.5rem] p-5 sm:max-w-md">
          <DialogTitle className="font-display text-[1.6rem] leading-none">Start a huddle</DialogTitle>
          <DialogDescription className="text-[0.8125rem]">
            A voice call beside the reading. What&apos;s said is captioned live and kept as a transcript, so the AI can
            turn it into notes tied to the passages you were on.
          </DialogDescription>
          <div className="grid gap-2">
            <Choice
              active={mode === "all"}
              onClick={() => setMode("all")}
              icon={<UsersThreeIcon weight="duotone" className="size-5" />}
              title="Everyone in the room"
              body="Anyone here can hop in."
            />
            <Choice
              active={mode === "pick"}
              onClick={() => setMode("pick")}
              disabled={!h.canSpeak}
              icon={<UserPlusIcon weight="duotone" className="size-5" />}
              title="Pick people"
              body={
                h.canSpeak
                  ? "A private talk with the people you choose."
                  : "Editors and above can start private huddles."
              }
            />
          </div>
          <button
            type="button"
            onClick={() => (mode === "all" ? go("all") : setPicking(true))}
            className="flex h-11 items-center justify-center gap-2 rounded-full bg-ink text-[0.875rem] font-medium text-pearl transition hover:opacity-90 dark:bg-azure"
          >
            <WaveformIcon weight="bold" className="size-4" />
            {mode === "all" ? "Start huddle" : "Choose people"}
          </button>
          {!h.canSpeak && (
            <p className="-mt-2 text-center text-[0.6875rem] text-muted-foreground">
              You&apos;re a viewer here, so you&apos;ll join to listen.
            </p>
          )}
        </DialogContent>
      </Dialog>
      <PeoplePicker
        open={open && picking}
        onOpenChange={(o) => {
          if (!o) setPicking(false);
        }}
        title="Who's in?"
        cta={(n) => (n ? `Start with ${n}` : "Pick someone")}
        onPick={go}
      />
    </>
  );
}

function Choice({
  active,
  onClick,
  disabled,
  icon,
  title,
  body,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-3 text-left transition disabled:opacity-50",
        active ? "border-azure bg-azure/6" : "border-(--hairline) hover:bg-foreground/4",
      )}
    >
      <span
        className={cn("grid size-10 place-items-center rounded-xl", active ? "bg-azure text-white" : "bg-foreground/6")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.875rem] font-medium">{title}</span>
        <span className="block text-[0.75rem] text-muted-foreground">{body}</span>
      </span>
      <span
        className={cn(
          "grid size-5 place-items-center rounded-full border",
          active ? "border-azure bg-azure text-white" : "border-(--hairline)",
        )}
      >
        {active && <CheckIcon weight="bold" className="size-3" />}
      </span>
    </button>
  );
}

// Everyone who's been in the room: readers here now (guests too) and signed-in people who opened it.
function PeoplePicker({
  open,
  onOpenChange,
  title,
  cta,
  onPick,
  exclude,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  cta: (n: number) => string;
  onPick: (ids: string[]) => void;
  exclude?: Set<string>;
}) {
  const { channel, mentionables, me } = useRoom();
  const colorOf = useColorOf();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const online = new Set(channel.peers.map((p) => p.id));
  const everyone = [
    ...new Map(
      [...channel.peers.map((p) => ({ id: p.id, name: p.name })), ...mentionables]
        .filter((p) => p.id !== me.id && p.name.trim() && !exclude?.has(p.id))
        .map((p) => [p.id, p]),
    ).values(),
  ].sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.name.localeCompare(b.name));
  const shown = everyone.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setChosen(new Set());
      }}
    >
      <DialogContent className="gap-3 rounded-[1.5rem] p-5 sm:max-w-md">
        <DialogTitle className="font-display text-[1.6rem] leading-none">{title}</DialogTitle>
        <DialogDescription className="text-[0.8125rem]">
          Only the people you pick can join or read what&apos;s said.
        </DialogDescription>
        <label className="flex h-10 items-center gap-2 rounded-full border border-(--hairline) px-3">
          <MagnifyingGlassIcon className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people in this room"
            className="min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none"
          />
        </label>
        {chosen.size > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {everyone
              .filter((p) => chosen.has(p.id))
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className="flex items-center gap-1.5 rounded-full bg-azure/10 py-0.5 pr-2 pl-0.5 text-[0.6875rem] text-azure"
                >
                  <Avatar actor={{ name: p.name, color: colorOf(p.id) }} size={18} />
                  {p.name.split(" ")[0]} ×
                </button>
              ))}
          </div>
        )}
        <ul data-lenis-prevent className="-mx-2 max-h-72 overflow-y-auto">
          {shown.length === 0 && (
            <li className="px-2 py-8 text-center text-[0.8125rem] text-muted-foreground">
              {everyone.length ? "Nobody by that name." : "Nobody else has been in this room yet."}
            </li>
          )}
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p.id)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-foreground/4"
              >
                <span className="relative">
                  <Avatar actor={{ name: p.name, color: colorOf(p.id) }} size={30} />
                  {online.has(p.id) && (
                    <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-popover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-medium">{p.name}</span>
                  <span className="block text-[0.6875rem] text-muted-foreground">
                    {online.has(p.id) ? "In the room now" : "Has been here"}
                  </span>
                </span>
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-md border transition",
                    chosen.has(p.id) ? "border-azure bg-azure text-white" : "border-(--hairline)",
                  )}
                >
                  {chosen.has(p.id) && <CheckIcon weight="bold" className="size-3" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={chosen.size === 0}
          onClick={() => {
            onPick([...chosen]);
            setChosen(new Set());
          }}
          className="flex h-11 items-center justify-center gap-2 rounded-full bg-ink text-[0.875rem] font-medium text-pearl transition hover:opacity-90 disabled:opacity-40 dark:bg-azure"
        >
          {cta(chosen.size)}
        </button>
      </DialogContent>
    </Dialog>
  );
}

// --- Transcript and AI notes for one huddle ---

const SECTIONS: { key: "decisions" | "action_items" | "open_questions" | "key_points"; label: string }[] = [
  { key: "decisions", label: "Decisions" },
  { key: "action_items", label: "Action items" },
  { key: "open_questions", label: "Open questions" },
  { key: "key_points", label: "Key points" },
];

function download(name: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function HuddleRecord({
  huddle,
  tab: initialTab,
  onClose,
}: {
  huddle: HuddleSummary;
  tab: "notes" | "transcript";
  onClose: () => void;
}) {
  const { roomId, roomAuth, huddleTick, jumpTo, state } = useRoom();
  const h = useHuddle();
  const [tab, setTab] = useState(initialTab);
  const [segments, setSegments] = useState<HuddleTranscriptSegment[] | null>(null);
  const [notes, setNotes] = useState<HuddleNotesResponse | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const live = h.call?.id === huddle.id;
  const title = `${huddle.audience === "all" ? "Room huddle" : "Private huddle"} · ${new Date(huddle.started_at).toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock(huddle.started_at)}`;
  const docTitle = (id: string | null) => state.docs.find((d) => d.id === id)?.title ?? "a source";

  // The whole transcript, page by page; again every few seconds while the call is live.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const auth = await roomAuth();
      if (!auth) return;
      const all: HuddleTranscriptSegment[] = [];
      let after = 0;
      try {
        for (let page = 0; page < 20; page++) {
          const r = await api.huddles.transcript(roomId, huddle.id, after, auth);
          all.push(...r.segments);
          if (r.next == null) break;
          after = r.next;
        }
        if (!cancelled) setSegments(all);
      } catch {
        if (!cancelled) setSegments((s) => s ?? []);
      }
    };
    void load();
    const t = live ? setInterval(load, 2500) : undefined;
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [roomId, huddle.id, live, huddleTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // The notes; checked again every few seconds while the AI is writing them.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const auth = await roomAuth();
      if (!auth) return;
      const r = await api.huddles.notes(roomId, huddle.id, auth).catch(() => null);
      if (!cancelled && r) setNotes(r);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [roomId, huddle.id, huddleTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (notes?.status !== "generating") return;
    const t = setTimeout(async () => {
      const auth = await roomAuth();
      const r = auth ? await api.huddles.notes(roomId, huddle.id, auth).catch(() => null) : null;
      if (r) setNotes(r);
    }, 3000);
    return () => clearTimeout(t);
  }, [notes]); // eslint-disable-line react-hooks/exhaustive-deps

  const summarize = async () => {
    setSummarizing(true);
    setTab("notes");
    try {
      const auth = await roomAuth();
      if (!auth) throw new Error("Sign in again to summarize");
      setNotes(await api.huddles.summarize(roomId, huddle.id, auth));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't summarize the conversation");
    } finally {
      setSummarizing(false);
    }
  };

  const go = (doc: string | null, block: string | null) => {
    if (!doc || !block) return;
    jumpTo(doc, block);
    onClose();
  };

  const transcriptText = (md: boolean) =>
    [
      md ? `# ${title}\n` : `${title}\n`,
      ...(segments ?? []).map((s) =>
        md
          ? `**${s.speaker_name}** _${clock(s.start_at)}_  \n${s.text}\n`
          : `[${clock(s.start_at)}] ${s.speaker_name}: ${s.text}`,
      ),
    ].join("\n");
  const notesText = () => {
    const n = notes?.notes;
    if (!n) return "";
    const line = (p: HuddleNotePoint) =>
      `- ${p.text}${p.owner ? ` (${p.owner})` : ""}${p.anchor ? ` — on ${docTitle(p.anchor.doc)}` : ""}`;
    return [
      `# Notes: ${title}`,
      "",
      n.summary,
      ...SECTIONS.flatMap(({ key, label }) => (n[key].length ? ["", `## ${label}`, ...n[key].map(line)] : [])),
    ].join("\n");
  };
  const fileBase = `huddle-${huddle.started_at.slice(0, 10)}-${huddle.id.slice(-6)}`;
  const generating = summarizing || notes?.status === "generating";

  // In a live call, what's being said shows straight away from the caption stream, until the server
  // has the line (a caption and its saved line share an id).
  const savedIds = new Set((segments ?? []).map((s) => s.id));
  const unsavedLive = live ? h.captionLog.filter((c) => !savedIds.has(c.id)) : [];
  const lineCount = (segments?.length ?? 0) + unsavedLive.length;
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (live && tab === "transcript" && scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [live, tab, scroller, lineCount, h.captionLog]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-[1.5rem] p-0 sm:max-w-2xl">
        <div className="border-b border-(--hairline) p-5 pb-0">
          <DialogTitle className="font-display text-[1.6rem] leading-none">{title}</DialogTitle>
          <DialogDescription className="mt-1.5 text-[0.75rem]">
            Started by {huddle.created_by_name}
            {live ? " · live now" : huddle.ended_at ? ` · ended ${clock(huddle.ended_at)}` : ""}
          </DialogDescription>
          <div className="mt-4 flex items-end gap-4">
            {(["notes", "transcript"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "-mb-px border-b-2 pb-2 text-[0.8125rem] font-medium capitalize transition",
                  tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground",
                )}
              >
                {t === "notes" ? "AI notes" : `Transcript${segments ? ` · ${lineCount}` : ""}`}
              </button>
            ))}
          </div>
        </div>

        <div ref={setScroller} data-lenis-prevent className="min-h-64 flex-1 overflow-y-auto p-5">
          {tab === "transcript" ? (
            segments === null ? (
              <Skeleton />
            ) : lineCount === 0 ? (
              <Empty
                icon={<ScrollIcon weight="duotone" className="size-7" />}
                text={
                  live
                    ? "Start talking. Your words show here as you speak (captions need Chrome or Edge, with your mic on)."
                    : "No captions were recorded in this huddle, so there's nothing to summarize."
                }
              />
            ) : (
              <ol className="space-y-3">
                {segments.map((s, i) => {
                  const same = segments[i - 1]?.speaker_id === s.speaker_id;
                  return (
                    <li key={s.id} className={cn("grid grid-cols-[2rem_1fr] gap-x-3", same && "-mt-2")}>
                      <span>
                        {!same && <Avatar actor={{ name: s.speaker_name, color: hashColor(s.speaker_id) }} size={28} />}
                      </span>
                      <div>
                        {!same && (
                          <p className="text-[0.75rem]">
                            <span className="font-semibold">{s.speaker_name}</span>{" "}
                            <span className="text-muted-foreground">{clock(s.start_at)}</span>
                          </p>
                        )}
                        <p className="text-[0.875rem] leading-relaxed">
                          {s.text}
                          {s.doc && s.block && (
                            <button
                              type="button"
                              onClick={() => go(s.doc, s.block)}
                              className="ml-1.5 inline-flex -translate-y-px items-center gap-0.5 rounded-full bg-foreground/6 px-1.5 text-[0.625rem] text-muted-foreground hover:text-azure"
                              title={`Reading ${docTitle(s.doc)}`}
                            >
                              <ArrowSquareOutIcon className="size-2.5" />
                              {docTitle(s.doc).slice(0, 24)}
                            </button>
                          )}
                        </p>
                      </div>
                    </li>
                  );
                })}
                {unsavedLive.map((c) => (
                  <li key={`live-${c.id}`} className="grid grid-cols-[2rem_1fr] gap-x-3">
                    <span>
                      <Avatar actor={{ name: c.name === "You" ? "You" : c.name, color: hashColor(c.who) }} size={28} />
                    </span>
                    <div>
                      <p className="flex items-center gap-1.5 text-[0.75rem]">
                        <span className="font-semibold">{c.name}</span>
                        <span className="flex items-center gap-1 rounded-full bg-rose-500/10 px-1.5 text-[0.5625rem] font-semibold tracking-wide text-rose-600 uppercase dark:text-rose-400">
                          <span className="size-1 animate-pulse rounded-full bg-rose-500" />
                          {c.final ? "Saving" : "Live"}
                        </span>
                      </p>
                      <p className={cn("text-[0.875rem] leading-relaxed", !c.final && "text-foreground/60 italic")}>
                        {c.text}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )
          ) : generating ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
                <SparkleIcon weight="fill" className="size-4 animate-pulse text-azure" /> Writing the notes from the
                conversation…
              </p>
              <Skeleton />
            </div>
          ) : notes?.status === "ready" && notes.notes ? (
            <div className="space-y-5">
              <p className="rounded-2xl bg-azure/6 p-4 text-[0.9375rem] leading-relaxed">{notes.notes.summary}</p>
              {SECTIONS.map(({ key, label }) =>
                notes.notes![key].length ? (
                  <section key={key}>
                    <h3 className="eyebrow mb-2 text-[0.625rem] text-muted-foreground">{label}</h3>
                    <ul className="space-y-1.5">
                      {notes.notes![key].map((p, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            disabled={!p.anchor}
                            onClick={() => p.anchor && go(p.anchor.doc, p.anchor.block)}
                            className="group flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition enabled:hover:bg-foreground/4"
                          >
                            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                            <span className="flex-1 text-[0.875rem] leading-relaxed">
                              {p.text}
                              {p.owner && (
                                <span className="ml-1.5 rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-700 dark:text-amber-300">
                                  {p.owner}
                                </span>
                              )}
                              {p.anchor && (
                                <span className="mt-0.5 flex items-center gap-1 text-[0.6875rem] text-muted-foreground group-hover:text-azure">
                                  <ArrowSquareOutIcon className="size-3" /> said while on {docTitle(p.anchor.doc)}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null,
              )}
            </div>
          ) : (
            <Empty
              icon={<SparkleIcon weight="duotone" className="size-7" />}
              text={
                notes?.status === "failed"
                  ? // The backend's reason, from the latest copy of this huddle in the list.
                    `The notes couldn't be written. ${h.huddles.find((x) => x.id === huddle.id)?.notes_error ?? huddle.notes_error ?? "Try again."}`
                  : live
                    ? "Notes are written when the huddle ends, or summarize what's been said so far."
                    : "No notes yet. Summarize the conversation to get decisions, action items and open questions."
              }
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-(--hairline) px-5 py-3">
          {tab === "transcript" ? (
            <>
              <FooterButton
                disabled={!segments?.length}
                onClick={() => download(`${fileBase}.txt`, transcriptText(false), "text/plain")}
              >
                <DownloadSimpleIcon className="size-3.5" /> .txt
              </FooterButton>
              <FooterButton
                disabled={!segments?.length}
                onClick={() => download(`${fileBase}.md`, transcriptText(true))}
              >
                <DownloadSimpleIcon className="size-3.5" /> .md
              </FooterButton>
            </>
          ) : (
            <FooterButton
              disabled={notes?.status !== "ready"}
              onClick={() => download(`${fileBase}-notes.md`, notesText())}
            >
              <DownloadSimpleIcon className="size-3.5" /> Download notes
            </FooterButton>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={summarize}
            disabled={generating || segments?.length === 0}
            title={segments?.length === 0 ? "Nothing said yet to summarize" : undefined}
            className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[0.8125rem] font-medium text-pearl transition hover:opacity-90 disabled:opacity-40 dark:bg-azure"
          >
            <SparkleIcon weight="fill" className="size-3.5" />
            {notes?.status === "ready" ? "Refresh notes" : "Summarize conversation"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FooterButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 items-center gap-1.5 rounded-full border border-(--hairline) px-3 text-[0.75rem] font-medium transition hover:bg-foreground/4 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2.5">
      {[90, 70, 82, 55].map((w, i) => (
        <div key={i} className="h-3.5 animate-pulse rounded-full bg-foreground/8" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="grid place-items-center gap-3 py-12 text-center text-muted-foreground">
      <span className="grid size-14 place-items-center rounded-2xl bg-foreground/5">{icon}</span>
      <p className="max-w-xs text-[0.8125rem]">{text}</p>
    </div>
  );
}

// --- Live subtitles over the reading ---

export function HuddleCaptions() {
  const h = useHuddle();
  const colorOf = useColorOf();
  const lines = h.call && h.showCaptions ? h.captions.slice(-2) : [];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-4">
      <AnimatePresence>
        {lines.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="max-w-2xl space-y-1 rounded-2xl bg-black/75 px-4 py-2.5 text-white shadow-xl backdrop-blur-md"
            aria-live="polite"
          >
            {lines.map((c) => (
              <p key={c.id} className="text-[0.9375rem] leading-snug">
                <span className="mr-2 text-[0.75rem] font-semibold" style={{ color: colorOf(c.who) }}>
                  {c.name}
                </span>
                <span className={cn(!c.final && "text-white/75")}>{c.text}</span>
              </p>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Five bars that follow your microphone's real level.
function MicMeter({ level }: { level: number }) {
  return (
    <span className="flex h-3.5 items-end gap-0.5" aria-hidden>
      {[0.15, 0.3, 0.45, 0.6, 0.75].map((at, i) => (
        <span
          key={i}
          className={cn(
            "w-0.75 rounded-full transition-all duration-100",
            level > at ? "bg-emerald-500" : "bg-foreground/15",
          )}
          style={{ height: `${40 + i * 15}%` }}
        />
      ))}
    </span>
  );
}
