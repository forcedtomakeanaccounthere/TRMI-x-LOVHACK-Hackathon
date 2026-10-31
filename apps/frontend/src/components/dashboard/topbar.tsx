"use client";

import { BellIcon, ListIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useLenis } from "lenis/react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PersonAvatar, timeAgo } from "./primitives";
import { useDashboard } from "./store";

export function Topbar({ onMenu, onProfile }: { onMenu: () => void; onProfile: () => void }) {
  const { state, dispatch } = useDashboard();
  const lenis = useLenis();
  const input = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K jumps to search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-30">
      <div className="liquid-glass liquid-glass-strong flex h-14 items-center gap-2 rounded-full pr-2 pl-2 md:pl-4">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open menu"
          className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-foreground/5 lg:hidden"
        >
          <ListIcon className="size-5" />
        </button>

        <label className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full px-2 md:max-w-md md:bg-foreground/4 md:px-4">
          <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">Search rooms</span>
          <input
            ref={input}
            type="search"
            value={state.filters.query}
            onChange={(e) => dispatch({ type: "filters", patch: { query: e.target.value } })}
            onKeyDown={(e) => {
              if (e.key === "Enter") lenis?.scrollTo("#rooms", { offset: -96 });
              if (e.key === "Escape") dispatch({ type: "filters", patch: { query: "" } });
            }}
            placeholder="Search rooms, people or groups"
            className="h-full min-w-0 flex-1 bg-transparent text-[0.875rem] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {state.filters.query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => dispatch({ type: "filters", patch: { query: "" } })}
              className="grid size-6 place-items-center rounded-full hover:bg-foreground/8"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : (
            <kbd className="hidden rounded-md bg-foreground/6 px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground md:block">
              ⌘
            </kbd>
          )}
        </label>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Notifications />
          <button
            type="button"
            onClick={onProfile}
            aria-label="Edit profile"
            className="ml-1 flex items-center gap-2.5 rounded-full p-1 ring-1 ring-(--hairline) transition-colors hover:bg-foreground/5 sm:pr-3"
          >
            <PersonAvatar person={state.profile} size="sm" />
            <span className="hidden text-left leading-tight sm:block">
              <span className="block max-w-[9rem] truncate text-[0.8125rem] font-semibold">{state.profile.name}</span>
              <span className="block max-w-[9rem] truncate text-[0.6875rem] text-muted-foreground">{state.profile.email}</span>
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

// Demo activity built from the newest room events; becomes GET /api/me/invites + activity later.
function Notifications() {
  const { state } = useDashboard();
  const items = state.rooms
    .filter((r) => r.status === "running" && r.participants.length)
    .slice(0, 4)
    .map((r) => ({ room: r, who: r.participants[0]! }));

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notifications"
        className="relative grid size-10 place-items-center rounded-full hover:bg-foreground/5 data-[state=open]:bg-foreground/5"
      >
        <BellIcon className="size-[18px]" />
        {items.length > 0 && <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-azure ring-2 ring-background" />}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={12}
        data-lenis-prevent
        className="w-[min(21rem,calc(100vw-2rem))] rounded-[1.4rem] bg-popover/97 p-2 shadow-[0_30px_80px_-30px_rgb(5_10_30/0.5)] backdrop-blur-2xl"
      >
        <div className="eyebrow px-3 pt-2 pb-1 text-[0.5625rem] text-muted-foreground">Activity</div>
        <ul>
          {items.map(({ room, who }) => (
            <li key={room.id}>
              <Link href={`/r/${room.id}`} className="flex gap-3 rounded-2xl p-3 hover:bg-foreground/5">
                <PersonAvatar person={who} size="sm" />
                <span className="min-w-0 text-[0.8125rem] leading-snug">
                  <span className="font-semibold">{who.name.split(" ")[0]}</span> is reading{" "}
                  <span className="font-display text-[0.95rem] italic">{room.title}</span>
                  <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">{timeAgo(room.last_activity_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
