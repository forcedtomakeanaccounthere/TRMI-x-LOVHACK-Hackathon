"use client";

import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useLenis } from "lenis/react";
import { motion } from "motion/react";
import { EASE_OUT_EXPO } from "@/components/fx/reveal";
import { cn } from "@/lib/utils";
import { STATUS_META } from "./primitives";
import { useDashboard } from "./store";
import type { ViewStatus } from "./types";

const CARDS: { status: Exclude<ViewStatus, "deleted">; caption: (n: number, live: number) => string }[] = [
  { status: "running", caption: (_, live) => `${live} ${live === 1 ? "person" : "people"} reading now` },
  { status: "paused", caption: (n) => (n ? "Waiting for you to resume" : "Nothing on hold") },
  { status: "closed", caption: () => "Finished, still searchable" },
  { status: "archived", caption: () => "Tucked away, never lost" },
];

// Status totals; each card filters the room list to that status.
export function StatCards() {
  const { state, dispatch } = useDashboard();
  const lenis = useLenis();

  return (
    <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
      {CARDS.map(({ status, caption }, i) => {
        const rooms = state.rooms.filter((r) => r.status === status);
        const live = rooms.reduce((sum, r) => sum + r.live_count, 0);
        const featured = status === "running";
        return (
          <motion.button
            key={status}
            type="button"
            onClick={() => {
              dispatch({ type: "filters", patch: { status } });
              lenis?.scrollTo("#rooms", { offset: -96 });
            }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 + i * 0.06, ease: EASE_OUT_EXPO }}
            className={cn(
              "group relative overflow-hidden rounded-[1.6rem] p-5 text-left transition-transform duration-500 ease-fluid hover:-translate-y-0.5",
              featured ? "text-pearl shadow-[0_24px_60px_-28px_rgb(29_68_224/0.7)]" : "liquid-glass",
            )}
            style={featured ? { background: "var(--ink-tile)" } : undefined}
          >
            {featured && (
              <svg
                viewBox="0 0 200 200"
                className="pointer-events-none absolute -right-10 -bottom-12 size-44 text-pearl/15"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.8"
                aria-hidden
              >
                <circle cx="80" cy="100" r="60" />
                <circle cx="120" cy="100" r="60" stroke="rgb(109 143 255 / 0.6)" />
              </svg>
            )}
            <div className="relative flex items-center justify-between">
              <span className={cn("flex items-center gap-2 text-[0.8125rem] font-medium", !featured && "text-foreground/80")}>
                <span className={cn("size-1.5 rounded-full", STATUS_META[status].dot)} />
                {STATUS_META[status].label}
              </span>
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-full transition-transform duration-500 ease-fluid group-hover:rotate-45",
                  featured ? "bg-pearl text-ink" : "ring-1 ring-(--hairline)",
                )}
              >
                <ArrowUpRightIcon className="size-3.5" />
              </span>
            </div>
            <div className="relative mt-5 font-display text-[3.4rem] leading-[0.85] font-normal tabular-nums">
              {String(rooms.length).padStart(2, "0")}
            </div>
            <div className={cn("relative mt-3 text-[0.75rem]", featured ? "text-pearl/65" : "text-muted-foreground")}>
              {caption(rooms.length, live)}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
