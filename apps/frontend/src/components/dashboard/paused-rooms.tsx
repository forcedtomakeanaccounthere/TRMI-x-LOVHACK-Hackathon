"use client";

import { PlayIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { toast } from "sonner";
import { AvatarStack, Panel, PanelHeader, timeAgo } from "./primitives";
import { useDashboard } from "./store";

// "Pick up where you paused": paused rooms with a one-tap resume.
export function PausedRooms() {
  const { state, actions, groupById } = useDashboard();
  const paused = state.rooms
    .filter((r) => r.status === "paused")
    .sort((a, b) => (b.paused_at ?? "").localeCompare(a.paused_at ?? ""));

  return (
    <Panel aria-label="Paused rooms">
      <PanelHeader
        eyebrow="Pick up where you paused"
        title={
          <>
            Paused <span className="italic text-muted-foreground">rooms</span>
          </>
        }
      />
      <ul className="mt-4 space-y-2">
        {paused.map((r) => {
          const color = (r.group_id && groupById.get(r.group_id)?.color) || "#2f5bff";
          return (
            <li key={r.id} className="flex items-center gap-3 rounded-2xl p-2.5 ring-1 ring-(--hairline)">
              <span className="animate-blink-soft h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <div className="min-w-0 flex-1">
                <Link href={`/r/${r.id}`} className="block truncate font-display text-[1.15rem] leading-tight hover:underline">
                  {r.title}
                </Link>
                <div className="mt-1 flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
                  <AvatarStack people={r.participants} max={3} />
                  {r.paused_at && <span>Paused {timeAgo(r.paused_at)}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  actions.setStatus(r, "running");
                  toast.success(`${r.title} is running again`);
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 text-[0.75rem] font-medium text-pearl dark:bg-pearl dark:text-ink"
              >
                <PlayIcon weight="fill" className="size-3" /> Resume
              </button>
            </li>
          );
        })}
        {paused.length === 0 && (
          <li className="py-6 text-center text-[0.8125rem] text-muted-foreground">No paused rooms. Everything is moving.</li>
        )}
      </ul>
    </Panel>
  );
}
