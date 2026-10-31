"use client";

import { CheckIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PersonAvatar, StatusBadge } from "./primitives";
import { useDashboard } from "./store";
import type { Person, RoomView } from "./types";

export type InviteTarget = { room: RoomView } | { person: Person } | null;

// Two directions, one dialog: invite people to a room, or add one person to one of my active rooms.
// Sending maps to POST /api/rooms/:id/invites (proposed).
export function InviteDialog({ target, onClose }: { target: InviteTarget; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-lenis-prevent
        className="liquid-glass liquid-glass-strong w-[min(30rem,calc(100%-2rem))] max-w-none gap-0 rounded-[1.75rem] p-0 ring-0 sm:max-w-none"
      >
        {target && "room" in target && <InvitePeople room={target.room} onDone={onClose} />}
        {target && "person" in target && <AddToRoom person={target.person} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function InvitePeople({ room, onDone }: { room: RoomView; onDone: () => void }) {
  const { state } = useDashboard();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Following first, then everyone I've read with; people already in the room are left out.
  const candidates = useMemo(() => {
    const inRoom = new Set(room.participants.map((p) => p.id));
    const seen = new Set<string>();
    return [...state.following, ...state.participants].filter((p) => {
      if (inRoom.has(p.id) || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [room, state.following, state.participants]);

  const q = query.trim().toLowerCase();
  const shown = q ? candidates.filter((p) => `${p.name} ${p.handle}`.toLowerCase().includes(q)) : candidates;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="p-6">
      <div className="eyebrow text-[0.5625rem] text-azure">Invite to room</div>
      <DialogTitle className="mt-2 font-display text-[1.9rem] leading-none font-medium">{room.title}</DialogTitle>
      <DialogDescription className="mt-2 text-[0.8125rem] text-muted-foreground">
        People you follow and people you&apos;ve read with. They get a link that drops them straight in.
      </DialogDescription>

      <label className="mt-5 flex h-11 items-center gap-2.5 rounded-full bg-foreground/5 px-4 ring-1 ring-(--hairline) focus-within:ring-ring">
        <MagnifyingGlassIcon className="size-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people"
          className="h-full flex-1 bg-transparent text-[0.875rem] outline-none placeholder:text-muted-foreground"
        />
      </label>

      <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
        {shown.map((p) => {
          const on = picked.has(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p.id)}
                aria-pressed={on}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors hover:bg-foreground/5",
                  on && "bg-azure/8",
                )}
              >
                <PersonAvatar person={p} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.875rem] font-medium">{p.name}</span>
                  <span className="block text-[0.75rem] text-muted-foreground">@{p.handle}</span>
                </span>
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full ring-1 ring-(--hairline) transition-colors",
                    on && "bg-azure text-white ring-azure",
                  )}
                >
                  {on && <CheckIcon weight="bold" className="size-3" />}
                </span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="py-8 text-center text-[0.8125rem] text-muted-foreground">No one matches “{query}”.</li>
        )}
      </ul>

      <button
        type="button"
        disabled={picked.size === 0}
        onClick={() => {
          toast.success(`Invited ${picked.size} ${picked.size === 1 ? "person" : "people"} to ${room.title}`);
          onDone();
        }}
        className="mt-5 h-11 w-full rounded-full bg-ink text-[0.875rem] font-medium text-pearl transition-opacity disabled:opacity-40 dark:bg-pearl dark:text-ink"
      >
        {picked.size ? `Send ${picked.size} invite${picked.size === 1 ? "" : "s"}` : "Pick people to invite"}
      </button>
    </div>
  );
}

function AddToRoom({ person, onDone }: { person: Person; onDone: () => void }) {
  const { state } = useDashboard();
  const rooms = state.rooms.filter((r) => r.status === "running" || r.status === "paused");

  return (
    <div className="p-6">
      <div className="flex items-center gap-3">
        <PersonAvatar person={person} size="lg" />
        <div>
          <div className="eyebrow text-[0.5625rem] text-azure">Add to a room</div>
          <DialogTitle className="mt-1.5 font-display text-[1.7rem] leading-none font-medium">{person.name}</DialogTitle>
        </div>
      </div>
      <DialogDescription className="mt-4 text-[0.8125rem] text-muted-foreground">
        Pick one of your active rooms. {person.name.split(" ")[0]} gets an invite with the link.
      </DialogDescription>
      <ul className="mt-4 max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {rooms.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => {
                toast.success(`Invited ${person.name} to ${r.title}`);
                onDone();
              }}
              className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left ring-1 ring-(--hairline) transition-colors hover:bg-foreground/5"
            >
              <span className="min-w-0 truncate font-display text-[1.15rem]">{r.title}</span>
              <StatusBadge status={r.status} live={r.live_count} />
            </button>
          </li>
        ))}
        {rooms.length === 0 && (
          <li className="py-8 text-center text-[0.8125rem] text-muted-foreground">No running or paused rooms yet.</li>
        )}
      </ul>
    </div>
  );
}
