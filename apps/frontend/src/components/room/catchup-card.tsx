"use client";

import { ArrowBendUpLeftIcon, ClockCounterClockwiseIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { timeAgo } from "@/components/dashboard/primitives";
import type { Catchup } from "./catchup";
import { useRoom } from "./store";

// "While you were away": shown when you come back to a room in which others did something since
// your last visit. Dismissed with ×, and gone on the next visit (which starts a new "since").

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function who(c: Catchup) {
  const names = c.people.map((p) => p.name.split(" ")[0]);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${plural(names.length - 2, "other")}`;
}

export function CatchupCard() {
  const { catchup, dismissCatchup, jumpTo, setTab, setPanelOpen } = useRoom();
  const counts = catchup
    ? [
        catchup.highlights.length && plural(catchup.highlights.length, "highlight"),
        catchup.comments.length && plural(catchup.comments.length, "comment"),
        catchup.messages.length && plural(catchup.messages.length, "message"),
        catchup.roomNotes.length && plural(catchup.roomNotes.length, "room note"),
      ].filter(Boolean)
    : [];
  const openDiscussion = () => {
    setPanelOpen(true);
    setTab("discussion");
    dismissCatchup();
  };

  return (
    <AnimatePresence>
      {catchup && (
        <motion.section
          key="catchup"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          aria-label="While you were away"
          data-room-ui
          className="liquid-glass liquid-glass-strong absolute top-4 right-4 z-40 w-[min(26rem,calc(100%-2rem))] rounded-2xl p-4 text-[0.8125rem] shadow-xl"
        >
          <div className="flex items-start gap-2">
            <ClockCounterClockwiseIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-azure" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">While you were away</div>
              <div className="text-[0.75rem] text-muted-foreground">
                Since {timeAgo(catchup.since)}: {who(catchup)} added {counts.join(", ")}.
              </div>
            </div>
            <button
              type="button"
              onClick={dismissCatchup}
              aria-label="Dismiss"
              className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/8"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>

          {catchup.waiting.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[0.6875rem] font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
                Waiting on you
              </div>
              <ul className="space-y-1">
                {catchup.waiting.slice(0, 3).map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={openDiscussion}
                      className="flex w-full items-start gap-2 rounded-xl bg-amber-500/10 px-2.5 py-1.5 text-left hover:bg-amber-500/15"
                    >
                      <ArrowBendUpLeftIcon className="mt-0.5 size-3.5 shrink-0" />
                      <span className="min-w-0">
                        <strong>{m.author.name}:</strong> <span className="line-clamp-2">{m.text}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {catchup.highlights.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
                New highlights
              </div>
              <ul className="space-y-1">
                {catchup.highlights.slice(0, 3).map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(h.doc, h.block)}
                      className="w-full rounded-xl px-2.5 py-1.5 text-left hover:bg-foreground/5"
                      style={{ borderLeft: `3px solid ${h.color}` }}
                    >
                      <span className="line-clamp-2">“{h.quote}”</span>
                      <span className="text-[0.6875rem] text-muted-foreground">{h.author.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {catchup.comments.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
                Being discussed
              </div>
              <ul className="space-y-1">
                {catchup.comments.slice(0, 2).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(c.doc, c.block)}
                      className="w-full rounded-xl px-2.5 py-1.5 text-left hover:bg-foreground/5"
                    >
                      <span className="line-clamp-2">{c.body}</span>
                      <span className="text-[0.6875rem] text-muted-foreground">{c.author.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {catchup.messages.length > 0 && (
            <button
              type="button"
              onClick={openDiscussion}
              className="mt-3 text-[0.75rem] font-medium text-azure hover:underline"
            >
              Open the discussion ({plural(catchup.messages.length, "new message")})
            </button>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}
