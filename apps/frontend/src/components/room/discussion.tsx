"use client";

import { PaperPlaneRightIcon, SignInIcon, SignOutIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Avatar, timeAgo } from "./bits";
import { useRoom } from "./store";

type Item =
  | {
      kind: "msg";
      id: string;
      at: string;
      text: string;
      author: { id: string; name: string; color: string };
    }
  | {
      kind: "presence";
      id: string;
      at: string;
      joined: boolean;
      name: string;
      color: string;
    };

// The room's group chat, with "joined" and "left" lines from presence.
export function Discussion() {
  const { state, presenceFeed, actions, me, readOnly } = useRoom();
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const msgs: Item[] = state.chat.map((m) => ({
      kind: "msg",
      id: m.id,
      at: m.at,
      text: m.text,
      author: m.author,
    }));
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
            const prev = items[i - 1];
            const grouped =
              prev?.kind === "msg" &&
              prev.author.id === item.author.id &&
              Date.parse(item.at) - Date.parse(prev.at) < 120_000;
            const mine = item.author.id === me.id;
            return (
              <motion.li
                key={item.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-2", mine && "flex-row-reverse", !grouped && "pt-2")}
              >
                <span className="w-6 shrink-0">{!grouped && <Avatar actor={item.author} size={24} />}</span>
                <div className={cn("flex max-w-[80%] flex-col", mine && "items-end")}>
                  {!grouped && (
                    <span className="mb-0.5 text-[0.625rem] text-muted-foreground">
                      <span className="font-semibold text-foreground/80">{mine ? "You" : item.author.name}</span> ·{" "}
                      {timeAgo(item.at)}
                    </span>
                  )}
                  <p
                    className={cn(
                      "rounded-2xl px-3 py-1.5 text-[0.8125rem] leading-relaxed whitespace-pre-wrap break-words",
                      mine
                        ? "rounded-tr-md bg-ink text-pearl dark:bg-azure dark:text-white"
                        : "rounded-tl-md bg-card ring-1 ring-(--hairline)",
                    )}
                  >
                    {item.text}
                  </p>
                </div>
              </motion.li>
            );
          })}
        </ul>
        <div ref={end} />
      </div>
      <form
        className="border-t border-(--hairline) p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (!text) return;
          actions.chat(text.slice(0, 2000));
          setDraft("");
        }}
      >
        <div className="liquid-glass flex items-center gap-2 rounded-full p-1 pl-4">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            disabled={readOnly}
            placeholder={readOnly ? "This room is read only" : "Message the room…"}
            className="h-9 min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send"
            className="grid size-9 place-items-center rounded-full bg-ink text-pearl transition active:scale-95 disabled:opacity-30 dark:bg-azure"
          >
            <PaperPlaneRightIcon weight="fill" className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
