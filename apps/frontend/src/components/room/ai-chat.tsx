"use client";

import { ArrowUpIcon, AtIcon, FileTextIcon, SparkleIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AiText, Avatar, PreviewTag, Thinking, timeAgo } from "./bits";
import { useAwaitingAnswer, useRoom } from "./store";
import { ROOM_CHAT_THREAD } from "./types";

const SUGGESTIONS = [
  "Summarise the main argument",
  "What are the key terms?",
  "Where do the sources disagree?",
  "What should we discuss first?",
];

// The room's AI chat: about one document, several, or @all. Shared, so the whole room sees the thread.
export function AiChat() {
  const { state, actions, included, perms, loaded, jumpTo } = useRoom();
  const docs = state.docs.filter((d) => d.kind !== "video");
  const thread = state.threads[ROOM_CHAT_THREAD] ?? [];
  const [draft, setDraft] = useState("");
  const [targets, setTargets] = useState<string[] | "all">("all");
  const [mention, setMention] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const pending = useAwaitingAnswer(thread);
  const titles = useMemo(() => new Map(state.docs.map((d) => [d.id, d.title])), [state.docs]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread.length, pending]);

  const sources = targets === "all" ? included : targets;

  const send = (text: string) => {
    const q = text.replace(/@all\b/gi, "").trim();
    if (!q || pending || !perms.useAi) return;
    const chosen = /@all\b/i.test(text) ? included : sources;
    // Every source unticked: nothing to answer from, rather than quietly using them all again.
    if (chosen.length === 0) return;
    setDraft("");
    setMention(null);
    void actions.ask(ROOM_CHAT_THREAD, q, { sources: chosen });
  };

  const pick = (id: string | "all") => {
    setTargets((prev) => {
      if (id === "all") return "all";
      const list = prev === "all" ? [] : prev;
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      return next.length ? next : "all";
    });
    setDraft((d) => d.replace(/@[^\s@]*$/, ""));
    setMention(null);
    input.current?.focus();
  };

  const matches = mention !== null ? docs.filter((d) => d.title.toLowerCase().includes(mention.toLowerCase())) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-lenis-prevent className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
        {thread.length === 0 ? (
          <div className="flex flex-col items-center pt-8 text-center">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", bounce: 0.35 }}
              className="relative grid size-14 place-items-center rounded-2xl bg-[linear-gradient(135deg,#2f5bff,#8b5cf6)] text-white shadow-[0_18px_40px_-14px_rgb(47_91_255/0.8)]"
            >
              <SparkleIcon weight="fill" className="size-7" />
              <span className="absolute inset-0 animate-ping rounded-2xl bg-azure/20 [animation-duration:2.4s]" />
            </motion.div>
            <h3 className="mt-5 font-display text-[1.75rem] leading-none">Ask the room</h3>
            <p className="mt-2 max-w-[30ch] text-[0.8125rem] text-muted-foreground">
              Answers come from {sources.length === 1 ? "one source" : `${sources.length} sources`}. Type{" "}
              <code className="rounded bg-foreground/8 px-1">@</code> to choose.
            </p>
            {perms.useAi && (
              <div className="mt-6 flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full bg-card/70 px-3.5 py-1.5 text-[0.75rem] ring-1 ring-(--hairline) transition hover:ring-azure/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          thread.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
                  {m.author.name} · {timeAgo(m.at)}
                  <Avatar actor={m.author} size={16} />
                </div>
                <div className="max-w-[88%] rounded-2xl rounded-tr-md bg-ink px-3.5 py-2 text-[0.8125rem] text-pearl dark:bg-azure dark:text-white">
                  {m.text}
                </div>
                <div className="flex max-w-[88%] flex-wrap justify-end gap-1">
                  {m.sources.length === included.length && included.length > 1 ? (
                    <Chip>@all</Chip>
                  ) : (
                    m.sources.slice(0, 3).map((s) => <Chip key={s}>{titles.get(s) ?? "source"}</Chip>)
                  )}
                </div>
              </div>
            ) : (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-2.5"
              >
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#2f5bff,#8b5cf6)] text-white">
                  <SparkleIcon weight="fill" className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-1.5 text-[0.6875rem] font-semibold">
                    LinkRoom AI {m.preview && <PreviewTag />}
                  </div>
                  <AiText text={m.text} />
                  {m.citations.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.citations.map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => jumpTo(c.doc, c.block)}
                          title={c.quote}
                          className="flex max-w-full items-center gap-1 rounded-full bg-azure/8 px-2 py-0.5 text-[0.6875rem] text-azure ring-1 ring-azure/20 hover:bg-azure/14"
                        >
                          <span className="grid size-3.5 place-items-center rounded-full bg-azure text-[0.5rem] font-bold text-white">
                            {i + 1}
                          </span>
                          <span className="truncate">{titles.get(c.doc) ?? "source"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ),
          )
        )}
        {pending && (
          <div className="flex gap-2.5">
            <span className="grid size-6 place-items-center rounded-full bg-[linear-gradient(135deg,#2f5bff,#8b5cf6)] text-white">
              <SparkleIcon weight="fill" className="size-3.5" />
            </span>
            <Thinking />
          </div>
        )}
        <div ref={end} />
      </div>

      {perms.useAi ? (
        <div className="relative border-t border-(--hairline) p-3">
          {mention !== null && (
            <div className="liquid-glass liquid-glass-strong absolute right-3 bottom-full left-3 mb-2 max-h-56 overflow-y-auto rounded-2xl p-1.5">
              <MentionItem
                onPick={() => pick("all")}
                icon={<AtIcon className="size-4" />}
                label="all"
                hint={`Every source (${included.length})`}
              />
              {matches.map((d) => (
                <MentionItem
                  key={d.id}
                  onPick={() => pick(d.id)}
                  icon={<FileTextIcon className="size-4" />}
                  label={d.title}
                  hint={loaded.some((l) => l.id === d.id) ? "" : "loading…"}
                />
              ))}
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => pick("all")} className={cn(chipCls, targets === "all" && chipOn)}>
              @all
            </button>
            {docs.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => pick(d.id)}
                className={cn(chipCls, "max-w-[11rem]", targets !== "all" && targets.includes(d.id) && chipOn)}
              >
                <span className="truncate">{d.title}</span>
              </button>
            ))}
          </div>
          <form
            className="liquid-glass flex items-end gap-2 rounded-2xl p-1.5 pl-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <textarea
              ref={input}
              value={draft}
              rows={1}
              maxLength={2000}
              onChange={(e) => {
                setDraft(e.target.value);
                const m = e.target.value.match(/@([^\s@]*)$/);
                setMention(m ? m[1]! : null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (mention !== null) pick(matches[0]?.id ?? "all");
                  else send(draft);
                }
                if (e.key === "Escape") setMention(null);
              }}
              placeholder="Ask anything, or @ a source…"
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-2 text-[0.8125rem] outline-none field-sizing-content"
            />
            <button
              type="submit"
              disabled={!draft.trim() || pending || (sources.length === 0 && !/@all\b/i.test(draft))}
              aria-label="Send"
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#2f5bff,#8b5cf6)] text-white shadow-[0_8px_20px_-8px_rgb(47_91_255/0.9)] transition active:scale-95 disabled:opacity-35"
            >
              <ArrowUpIcon weight="bold" className="size-4" />
            </button>
          </form>
          <p className="mt-2 text-center text-[0.625rem] text-muted-foreground">
            {sources.length === 0
              ? "Tick at least one source in Sources to ask about it."
              : "AI can be wrong. Check the cited passages."}
          </p>
        </div>
      ) : (
        <p className="border-t border-(--hairline) p-4 text-center text-[0.75rem] text-muted-foreground">
          The owner turned AI off for viewers.
        </p>
      )}
    </div>
  );
}

const chipCls =
  "flex h-6 items-center rounded-full bg-foreground/5 px-2 text-[0.6875rem] text-muted-foreground ring-1 ring-transparent transition hover:text-foreground";
const chipOn = "bg-azure/10 text-azure ring-azure/30";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="max-w-[10rem] truncate rounded-full bg-foreground/5 px-1.5 py-px text-[0.625rem] text-muted-foreground">
      {children}
    </span>
  );
}

function MentionItem({
  onPick,
  icon,
  label,
  hint,
}: {
  onPick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[0.8125rem] hover:bg-foreground/6"
    >
      <span className="text-azure">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[0.6875rem] text-muted-foreground">{hint}</span>
    </button>
  );
}
