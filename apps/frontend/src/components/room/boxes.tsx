"use client";

import { ArrowUpIcon, CaretDownIcon, DotsSixVerticalIcon, SparkleIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { initials } from "@/components/dashboard/primitives";
import { cn } from "@/lib/utils";
import { AiText, Avatar, ByLine, PreviewTag, Thinking, timeAgo } from "./bits";
import { MentionText, useMentionPicker } from "./mention-composer";
import { useAwaitingAnswer, useRoom } from "./store";
import type { Actor, Annotation } from "./types";

type Note = Extract<Annotation, { kind: "note" }>;
type AiNote = Extract<Annotation, { kind: "ai" }>;

const CARD_SURFACE =
  "liquid-glass liquid-glass-strong pointer-events-auto w-72 rounded-2xl text-left shadow-[0_24px_60px_-24px_rgb(14_30_90/0.45)]";
const CARD = `${CARD_SURFACE} absolute z-30`;

// "Edited by Bo" / "Moved by Bo" when someone other than the author changed a box.
function ChangedBy({ author, edited, moved }: { author: Actor; edited?: Actor; moved?: Actor }) {
  const parts = [
    edited && edited.id !== author.id ? `Edited by ${edited.name}` : null,
    moved && moved.id !== author.id ? `Moved by ${moved.name}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <div className="mt-0.5 truncate text-[0.625rem] text-muted-foreground italic">{parts.join(" · ")}</div>;
}

function useCanRemove(a: Annotation) {
  return useRoom().canRemove(a.author.id);
}

// Drag a box by a handle: it follows the pointer 1:1 (a CSS translate), and on release the new spot
// is saved through onDrop. A press that barely moves stays a click, so handles can also be buttons.
function useDrag(onDrop: (dx: number, dy: number) => void, enabled: boolean) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const handlers = enabled
    ? {
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest("[data-no-drag]")) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, y: e.clientY, moved: false };
        },
        onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
          const s = start.current;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (!s.moved && Math.hypot(dx, dy) < 4) return;
          s.moved = true;
          setOffset({ x: dx, y: dy });
        },
        onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
          const s = start.current;
          start.current = null;
          if (!s?.moved) return;
          suppressClick.current = true;
          setOffset({ x: 0, y: 0 });
          onDrop(e.clientX - s.x, e.clientY - s.y);
        },
        onPointerCancel: () => {
          start.current = null;
          setOffset({ x: 0, y: 0 });
        },
      }
    : {};

  // Call from a handle's onClick: true when that click ended a drag and should be ignored.
  const wasDrag = () => {
    const was = suppressClick.current;
    suppressClick.current = false;
    return was;
  };
  const dragging = offset.x !== 0 || offset.y !== 0;
  return { handlers, wasDrag, dragging, transform: dragging ? `translate(${offset.x}px, ${offset.y}px)` : undefined };
}

// A text comment pinned anywhere on the page. New notes open in edit mode for their author.
export function NoteBox({
  note,
  style,
  autoEdit,
  onDrop,
}: {
  note: Note;
  style: React.CSSProperties;
  autoEdit: boolean;
  onDrop: (dx: number, dy: number) => void;
}) {
  const { actions, perms, focusAnnotation, setFocusAnnotation, readOnly, mentionables, me } = useRoom();
  // Only the author edits a note, and not once the room is read only.
  // Anyone who can annotate edits any comment (History records who changed whose).
  const mine = perms.annotate && !readOnly;
  const [editing, setEditing] = useState(autoEdit && mine && !note.body);
  const [draft, setDraft] = useState(note.body);
  const picker = useMentionPicker(draft, setDraft, mentionables);
  const named = [...mentionables, { id: me.id, name: me.name }];
  const [open, setOpen] = useState(autoEdit || !note.body);
  const canRemove = useCanRemove(note);
  const focused = focusAnnotation === note.id;
  const drag = useDrag(onDrop, perms.annotate);

  const save = () => {
    const body = draft.trim();
    if (!body) actions.removeAnnotation(note.id);
    else if (body !== note.body) actions.editNote(note.id, body.slice(0, 2000));
    setEditing(false);
  };

  return (
    <div
      data-room-ui
      className={cn("pointer-events-none absolute z-30", drag.dragging && "z-50")}
      style={{ ...style, transform: drag.transform }}
    >
      <button
        type="button"
        onClick={() => !drag.wasDrag() && setOpen((o) => !o)}
        {...drag.handlers}
        aria-label={`Comment by ${note.author.name}${canRemove ? ", drag to move" : ""}`}
        aria-expanded={open}
        className={cn(
          "pointer-events-auto grid size-7 -translate-x-1/2 -translate-y-full touch-none place-items-center rounded-full rounded-bl-none text-[0.625rem] font-bold text-white shadow-lg ring-2 ring-background transition-transform hover:scale-110",
          canRemove && "cursor-grab active:cursor-grabbing",
          focused && !drag.dragging && "animate-bounce",
        )}
        style={{ backgroundColor: note.color }}
      >
        {initials(note.author.name)}
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", bounce: 0.2, duration: 0.35 }}
          className={cn(CARD, "top-1 left-3 p-3")}
          style={{ borderTop: `3px solid ${note.color}` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            setFocusAnnotation(note.id);
          }}
        >
          <div
            className={cn("flex touch-none items-center gap-2", canRemove && "cursor-grab active:cursor-grabbing")}
            {...drag.handlers}
          >
            <div className="min-w-0 flex-1">
              <ByLine actor={note.author} at={note.at} />
              <ChangedBy author={note.author} edited={note.edited_by} moved={note.moved_by} />
            </div>
            {canRemove && (
              <button
                type="button"
                data-no-drag
                aria-label="Delete comment"
                onClick={() => actions.removeAnnotation(note.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <TrashIcon className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              data-no-drag
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
          {editing ? (
            <form
              className="relative mt-2"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              {picker.menu}
              <textarea
                autoFocus
                value={draft}
                {...picker.bind}
                onKeyDown={(e) => {
                  if (picker.handleKey(e)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    save();
                  }
                  if (e.key === "Escape") save();
                }}
                maxLength={2000}
                rows={3}
                placeholder="Write a comment… (@ to mention)"
                className="w-full resize-none rounded-xl bg-background/60 p-2 text-[0.8125rem] ring-1 ring-(--hairline) outline-none focus:ring-azure/50"
              />
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button
                  type="submit"
                  className="h-7 rounded-full bg-ink px-3 text-[0.75rem] font-medium text-pearl dark:bg-azure"
                >
                  Save
                </button>
              </div>
            </form>
          ) : (
            <p
              className={cn("mt-2 text-[0.8125rem] leading-relaxed whitespace-pre-wrap", mine && "cursor-text")}
              onDoubleClick={() => mine && setEditing(true)}
            >
              {note.body ? (
                <MentionText text={note.body} people={named} meId={me.id} />
              ) : (
                <span className="text-muted-foreground">Empty comment</span>
              )}
            </p>
          )}
        </motion.div>
      )}
    </div>
  );
}

const QUICK = ["Explain this", "Simplify it", "Give an example", "Why does it matter?"];

// An AI conversation anchored beside a line (or a lens snapshot). Anyone with AI access can follow up.
export function AiBox({
  box,
  style,
  autoFocus,
  onDrop,
}: {
  box: AiNote;
  style: React.CSSProperties;
  autoFocus: boolean;
  onDrop: (dx: number, dy: number) => void;
}) {
  const { state, actions, perms, included, activeDoc, setFocusAnnotation, focusAnnotation } = useRoom();
  const thread = state.threads[box.id] ?? [];
  // Only a box just made here opens by itself; after a reload they all start folded into chips.
  const [open, setOpen] = useState(autoFocus);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const canRemove = useCanRemove(box);
  const pending = useAwaitingAnswer(thread);
  const focused = focusAnnotation === box.id;
  const drag = useDrag(onDrop, perms.annotate);

  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [thread.length]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    setDraft("");
    // Answer from this document first, plus whatever else is ticked in Sources.
    const sources = [activeDoc, ...included.filter((d) => d !== activeDoc)];
    void actions.ask(box.id, q, {
      sources: box.doc ? [box.doc, ...sources.filter((s) => s !== box.doc)] : sources,
      quote: box.quote,
      image: box.image,
    });
  };

  if (!open) {
    return (
      <div
        data-room-ui
        className={cn("pointer-events-none absolute z-30", drag.dragging && "z-50")}
        style={{ ...style, width: undefined, transform: drag.transform }}
      >
        <button
          type="button"
          onClick={() => !drag.wasDrag() && setOpen(true)}
          {...drag.handlers}
          title={canRemove ? "Open, or drag to move" : undefined}
          className={cn(
            "liquid-glass pointer-events-auto flex h-8 touch-none items-center gap-1.5 rounded-full pr-3 pl-1.5 text-[0.75rem] font-medium",
            canRemove && "cursor-grab active:cursor-grabbing",
          )}
        >
          <span className="grid size-5 place-items-center rounded-full bg-[linear-gradient(120deg,#2f5bff,#8b5cf6)] text-white">
            <SparkleIcon weight="fill" className="size-3" />
          </span>
          AI · {thread.filter((m) => m.role === "user").length || "new"}
        </button>
      </div>
    );
  }

  return (
    // The outer layer is positioned and dragged; the card inside keeps its own entrance animation.
    <div
      data-room-ui
      className={cn("pointer-events-none absolute z-30", (drag.dragging || focused) && "z-40")}
      style={{ ...style, transform: drag.transform }}
    >
      <motion.div
        initial={{ opacity: 0, x: -8, scale: 0.97 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ type: "spring", bounce: 0.2, duration: 0.45 }}
        className={cn(
          CARD_SURFACE,
          "relative flex max-h-[26rem] w-full flex-col overflow-hidden",
          focused && "ring-2 ring-azure/60",
          drag.dragging && "shadow-[0_32px_80px_-24px_rgb(14_30_90/0.6)]",
        )}
        onPointerDown={(e) => {
          e.stopPropagation();
          setFocusAnnotation(box.id);
        }}
      >
        <div
          className={cn(
            "flex touch-none items-center gap-2 border-b border-(--hairline) px-3 py-2",
            canRemove && "cursor-grab active:cursor-grabbing",
          )}
          {...drag.handlers}
        >
          {canRemove && (
            <DotsSixVerticalIcon weight="bold" className="-mx-1 size-3.5 text-muted-foreground/60" aria-hidden />
          )}
          <span className="grid size-6 place-items-center rounded-full bg-[linear-gradient(120deg,#2f5bff,#8b5cf6)] text-white shadow-[0_4px_12px_-4px_rgb(47_91_255/0.8)]">
            <SparkleIcon weight="fill" className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[0.75rem] font-semibold">{box.image ? "AI lens" : "Ask AI"}</div>
            <ByLine actor={box.author} at={box.at} />
            <ChangedBy author={box.author} moved={box.moved_by} />
          </div>
          {canRemove && (
            <button
              type="button"
              data-no-drag
              aria-label="Delete AI box"
              onClick={() => actions.removeAnnotation(box.id)}
              className="text-muted-foreground hover:text-destructive"
            >
              <TrashIcon className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            data-no-drag
            aria-label="Collapse"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <CaretDownIcon className="size-3.5" />
          </button>
        </div>

        <div
          ref={scroller}
          data-lenis-prevent
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-2.5"
        >
          {box.quote && (
            <blockquote className="border-l-2 border-azure/60 pl-2 text-[0.75rem] text-muted-foreground italic line-clamp-4">
              “{box.quote}”
            </blockquote>
          )}
          {box.image && (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL snapshot
            <img src={box.image} alt="Snapshot sent to the AI" className="w-full rounded-lg ring-1 ring-(--hairline)" />
          )}
          {thread.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex items-start gap-2">
                <Avatar actor={m.author} size={20} />
                <div className="min-w-0">
                  <div className="text-[0.625rem] text-muted-foreground">
                    {m.author.name} · {timeAgo(m.at)}
                  </div>
                  <p className="text-[0.8125rem] font-medium">{m.text}</p>
                </div>
              </div>
            ) : (
              <div key={m.id} className="rounded-xl bg-foreground/[0.035] p-2.5 ring-1 ring-(--hairline)">
                {m.preview && <PreviewTag className="mb-1.5 inline-block" />}
                <AiText text={m.text} />
              </div>
            ),
          )}
          {pending && <Thinking />}
          {thread.length === 0 && perms.useAi && (
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="rounded-full bg-background/70 px-2.5 py-1 text-[0.6875rem] ring-1 ring-(--hairline) hover:ring-azure/50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>

        {perms.useAi && (
          <form
            className="flex items-center gap-1.5 border-t border-(--hairline) p-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <input
              autoFocus={autoFocus}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={1000}
              placeholder={
                thread.length
                  ? "Ask a follow-up…"
                  : box.image
                    ? "What do you want to know about this?"
                    : "Ask about this line…"
              }
              className="h-8 min-w-0 flex-1 rounded-full bg-background/60 px-3 text-[0.8125rem] ring-1 ring-(--hairline) outline-none focus:ring-azure/50"
            />
            <button
              type="submit"
              disabled={!draft.trim() || pending}
              aria-label="Send"
              className="grid size-8 place-items-center rounded-full bg-ink text-pearl transition disabled:opacity-30 dark:bg-azure"
            >
              <ArrowUpIcon weight="bold" className="size-3.5" />
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
