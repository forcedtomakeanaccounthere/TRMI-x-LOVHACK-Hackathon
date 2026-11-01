"use client";

import {
  ArrowBendUpLeftIcon,
  PaperPlaneRightIcon,
  SignInIcon,
  SignOutIcon,
  SmileyIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Avatar, timeAgo } from "./bits";
import { useRoom } from "./store";
import type { ChatMessage } from "./types";

// Quick emoji to send as a message, and the smaller set to react with.
const SEND_EMOJI = ["👍", "❤️", "😂", "🔥", "🎉", "🤔", "👀", "🙏"];
const REACT_EMOJI = ["👍", "❤️", "😂", "🔥", "🤔", "🎉"];

type Item =
  | { kind: "msg"; id: string; at: string; message: ChatMessage }
  | { kind: "presence"; id: string; at: string; joined: boolean; name: string; color: string };

// A message that is only emoji (up to three) shows large, without a bubble.
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*\s*){1,3}$/u;

const snippet = (text: string) => (text.length > 80 ? `${text.slice(0, 80)}…` : text);

// The room's group chat: replies, emoji reactions, quick emoji, and "joined" / "left" lines.
export function Discussion() {
  const { state, presenceFeed, actions, me, readOnly } = useRoom();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [tray, setTray] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(state.chat.map((m) => [m.id, m])), [state.chat]);

  const items = useMemo<Item[]>(() => {
    const msgs: Item[] = state.chat.map((m) => ({ kind: "msg", id: m.id, at: m.at, message: m }));
    const presence: Item[] = presenceFeed.map((p, i) => ({
      kind: "presence",
      id: `p${i}`,
      at: p.at,
      joined: p.kind === "joined",
      name: p.peer.name,
      color: p.peer.color,
    }));
    return [...msgs, ...presence].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }, [state.chat, presenceFeed]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length]);

  const send = (text: string) => {
    const body = text.trim();
    if (!body || readOnly) return;
    actions.chat(body.slice(0, 2000), replyTo?.id);
    setDraft("");
    setReplyTo(null);
  };

  const startReply = (m: ChatMessage) => {
    setReplyTo(m);
    input.current?.focus();
  };

  // Clicking a quoted message scrolls to the original and flashes it.
  const showOriginal = (id: string) => {
    document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1400);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {items.length === 0 && (
          <div className="pt-14 text-center">
            <div className="font-display text-[1.6rem] leading-none">Say hello</div>
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">Everyone in the room sees this chat.</p>
          </div>
        )}
        <ul className="space-y-1">
          {items.map((item, i) => {
            if (item.kind === "presence") {
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-center gap-1.5 py-2 text-[0.6875rem] text-muted-foreground"
                >
                  {item.joined ? (
                    <SignInIcon className="size-3.5 text-emerald-500" />
                  ) : (
                    <SignOutIcon className="size-3.5" />
                  )}
                  <span className="font-medium" style={{ color: item.color }}>
                    {item.name}
                  </span>
                  {item.joined ? "joined" : "left"} · {timeAgo(item.at)}
                </li>
              );
            }
            const m = item.message;
            const prev = items[i - 1];
            const grouped =
              !m.reply_to &&
              prev?.kind === "msg" &&
              prev.message.author.id === m.author.id &&
              Date.parse(m.at) - Date.parse(prev.at) < 120_000;
            return (
              <MessageRow
                key={item.id}
                message={m}
                grouped={grouped}
                mine={m.author.id === me.id}
                meId={me.id}
                quoted={m.reply_to ? (byId.get(m.reply_to) ?? null) : null}
                reactions={state.reactions[m.id] ?? {}}
                flashing={flash === m.id}
                canAct={!readOnly}
                onReply={() => startReply(m)}
                onReact={(emoji) => actions.react(m.id, emoji)}
                onShowOriginal={showOriginal}
              />
            );
          })}
        </ul>
        <div ref={end} />
      </div>

      <form
        className="border-t border-(--hairline) p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <AnimatePresence initial={false}>
          {replyTo && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mb-2 flex items-center gap-2 rounded-xl bg-foreground/[0.04] py-1.5 pr-1.5 pl-3 text-[0.75rem]">
                <ArrowBendUpLeftIcon className="size-3.5 shrink-0 text-azure" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  Replying to <span className="font-semibold text-foreground">{replyTo.author.name}</span>:{" "}
                  {snippet(replyTo.text)}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                  className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            </motion.div>
          )}
          {tray && !readOnly && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ type: "spring", bounce: 0.25, duration: 0.3 }}
              className="mb-2 flex justify-between rounded-2xl bg-foreground/[0.04] px-2 py-1.5"
              role="group"
              aria-label="Send an emoji"
            >
              {SEND_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => send(e)}
                  aria-label={`Send ${e}`}
                  className="grid size-9 place-items-center rounded-xl text-[1.25rem] transition hover:scale-125 hover:bg-foreground/6 active:scale-95"
                >
                  {e}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="liquid-glass flex items-center gap-1 rounded-full p-1 pl-1.5">
          <button
            type="button"
            onClick={() => setTray((t) => !t)}
            disabled={readOnly}
            aria-label={tray ? "Hide emoji" : "Show emoji"}
            aria-pressed={tray}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full transition disabled:opacity-30",
              tray ? "bg-foreground/8 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <SmileyIcon weight={tray ? "fill" : "regular"} className="size-[18px]" />
          </button>
          <input
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setReplyTo(null)}
            maxLength={2000}
            disabled={readOnly}
            placeholder={readOnly ? "This room is read only" : replyTo ? "Write a reply…" : "Message the room…"}
            className="h-9 min-w-0 flex-1 bg-transparent px-1 text-[0.8125rem] outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-pearl transition active:scale-95 disabled:opacity-30 dark:bg-azure"
          >
            <PaperPlaneRightIcon weight="fill" className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

type RowProps = {
  message: ChatMessage;
  grouped: boolean;
  mine: boolean;
  meId: string;
  quoted: ChatMessage | null;
  reactions: Record<string, { id: string; name: string }[]>;
  flashing: boolean;
  canAct: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onShowOriginal: (id: string) => void;
};

function MessageRow({
  message: m,
  grouped,
  mine,
  meId,
  quoted,
  reactions,
  flashing,
  canAct,
  onReply,
  onReact,
  onShowOriginal,
}: RowProps) {
  const [picker, setPicker] = useState(false);
  const emojiOnly = EMOJI_ONLY.test(m.text.trim());
  const chips = Object.entries(reactions);

  return (
    <motion.li
      id={`msg-${m.id}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("group flex gap-2", mine && "flex-row-reverse", !grouped && "pt-2")}
    >
      <span className="w-6 shrink-0">{!grouped && <Avatar actor={m.author} size={24} />}</span>
      <div className={cn("flex max-w-[80%] min-w-0 flex-col", mine && "items-end")}>
        {!grouped && (
          <span className="mb-0.5 text-[0.625rem] text-muted-foreground">
            <span className="font-semibold text-foreground/80">{mine ? "You" : m.author.name}</span> · {timeAgo(m.at)}
          </span>
        )}

        {m.reply_to && (
          <button
            type="button"
            onClick={() => quoted && onShowOriginal(quoted.id)}
            disabled={!quoted}
            className={cn(
              "mb-0.5 flex max-w-full items-center gap-1.5 rounded-xl border-l-2 border-azure/60 bg-foreground/[0.04] py-1 pr-2.5 pl-2 text-left text-[0.6875rem] text-muted-foreground transition hover:bg-foreground/[0.07]",
              mine && "self-end",
            )}
          >
            <ArrowBendUpLeftIcon className="size-3 shrink-0" />
            <span className="truncate">
              {quoted ? (
                <>
                  <span className="font-semibold text-foreground/80">{quoted.author.name}</span> {snippet(quoted.text)}
                </>
              ) : (
                "Original message unavailable"
              )}
            </span>
          </button>
        )}

        <div className={cn("relative flex items-center gap-1", mine && "flex-row-reverse")}>
          {emojiOnly ? (
            <p className={cn("text-[2rem] leading-none transition", flashing && "scale-110")}>{m.text}</p>
          ) : (
            <p
              className={cn(
                "rounded-2xl px-3 py-1.5 text-[0.8125rem] leading-relaxed whitespace-pre-wrap break-words transition-shadow duration-500",
                mine
                  ? "rounded-tr-md bg-ink text-pearl dark:bg-azure dark:text-white"
                  : "rounded-tl-md bg-card ring-1 ring-(--hairline)",
                flashing && "shadow-[0_0_0_3px_var(--azure)]",
              )}
            >
              {m.text}
            </p>
          )}

          {/* Hover actions: reply and react */}
          {canAct && (
            <div
              className={cn(
                "flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100",
                picker && "opacity-100",
              )}
            >
              <button
                type="button"
                onClick={onReply}
                aria-label="Reply"
                title="Reply"
                className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
              >
                <ArrowBendUpLeftIcon className="size-3.5" />
              </button>
              <Popover open={picker} onOpenChange={setPicker}>
                <PopoverTrigger
                  aria-label="React"
                  title="React"
                  className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
                >
                  <SmileyIcon className="size-3.5" />
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align={mine ? "end" : "start"}
                  className="flex w-auto gap-0.5 rounded-full p-1"
                >
                  {REACT_EMOJI.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => {
                        onReact(e);
                        setPicker(false);
                      }}
                      aria-label={`React ${e}`}
                      className="grid size-8 place-items-center rounded-full text-[1.1rem] transition hover:scale-125 hover:bg-foreground/6"
                    >
                      {e}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>

        {chips.length > 0 && (
          <div className={cn("mt-1 flex flex-wrap gap-1", mine && "justify-end")}>
            {chips.map(([emoji, who]) => {
              const reacted = who.some((a) => a.id === meId);
              return (
                <button
                  key={emoji}
                  type="button"
                  disabled={!canAct}
                  onClick={() => onReact(emoji)}
                  title={who.map((a) => (a.id === meId ? "You" : a.name)).join(", ")}
                  className={cn(
                    "flex h-6 items-center gap-1 rounded-full px-2 text-[0.75rem] ring-1 transition active:scale-95",
                    reacted
                      ? "bg-azure/12 ring-azure/40"
                      : "bg-foreground/[0.04] ring-(--hairline) hover:ring-foreground/20",
                  )}
                >
                  <span>{emoji}</span>
                  <span className="text-[0.6875rem] font-medium tabular-nums">{who.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </motion.li>
  );
}
