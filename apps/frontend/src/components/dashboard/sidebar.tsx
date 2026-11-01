"use client";

import {
  CalendarDotsIcon,
  CaretRightIcon,
  FolderSimpleIcon,
  HouseLineIcon,
  SignOutIcon,
  SquaresFourIcon,
  StackIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useLenis } from "lenis/react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { signOut } from "@/lib/session";
import { cn } from "@/lib/utils";
import { STATUS_META } from "./primitives";
import { PEOPLE_SEARCH_ID } from "./people-panel";
import { useDashboard } from "./store";

export const SECTIONS = [
  { id: "overview", label: "Overview", icon: SquaresFourIcon },
  { id: "rooms", label: "Rooms", icon: StackIcon },
  { id: "calendar", label: "Calendar", icon: CalendarDotsIcon },
  { id: "groups", label: "Groups", icon: FolderSimpleIcon },
  { id: "people", label: "People", icon: UsersThreeIcon },
] as const;

// The section whose top is closest above a line 30% down the viewport. Picking the closest (not the
// last in SECTIONS order) handles the two-column layout, where People sits beside Rooms and Calendar.
function currentSection() {
  // At the very bottom the last sections can't scroll up to the line, so take the lowest one on screen.
  const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
  const line = atBottom ? window.innerHeight - 1 : window.innerHeight * 0.3;
  let best: string = SECTIONS[0].id;
  let bestTop = -Infinity;
  for (const { id } of SECTIONS) {
    const top = document.getElementById(id)?.getBoundingClientRect().top;
    if (top !== undefined && top <= line && top > bestTop) {
      best = id;
      bestTop = top;
    }
  }
  return best;
}

// Tracks the section in view. While a sidebar click scrolls the page, the clicked section stays
// highlighted (lockedTo), so the indicator doesn't flicker through every section passed on the way.
function useActiveSection() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const lockedTo = useRef<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!lockedTo.current) setActive(currentSection());
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const lock = (id: string) => {
    lockedTo.current = id;
    setActive(id);
  };
  const unlock = () => {
    lockedTo.current = null;
  };
  return { active, lock, unlock };
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { dispatch } = useDashboard();
  const lenis = useLenis();
  const router = useRouter();
  const { active, lock, unlock } = useActiveSection();

  const go = (id: string) => {
    onNavigate?.();
    lock(id);
    if (!lenis) {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
      window.setTimeout(unlock, 1200);
      return;
    }
    // A section near the page bottom may never reach the highlight line, so the lock (not the scroll
    // position) decides until the scroll settles; a timeout covers a scroll that gets interrupted.
    const fallback = window.setTimeout(unlock, 2000);
    lenis.scrollTo(`#${id}`, {
      offset: -96,
      onComplete: () => {
        window.clearTimeout(fallback);
        unlock();
      },
    });
  };

  const openGroup = (id: string) => {
    dispatch({ type: "filters", patch: { group: id, status: "all" } });
    go("rooms");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-2">
        <Logo />
      </div>

      <div className="eyebrow mt-9 px-3 text-[0.5625rem] text-muted-foreground">Menu</div>
      <nav aria-label="Dashboard sections" className="mt-3 space-y-0.5">
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const on = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              aria-current={on ? "true" : undefined}
              className={cn(
                "relative flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[0.875rem] font-medium transition-colors",
                on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {on && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl bg-card shadow-[0_8px_24px_-14px_rgb(14_30_90/0.5),inset_0_1px_0_rgb(255_255_255/0.6)] ring-1 ring-(--hairline) dark:bg-foreground/8 dark:shadow-none"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                />
              )}
              <Icon weight={on ? "fill" : "regular"} className={cn("relative size-[18px]", on && "text-azure")} />
              <span className="relative">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="eyebrow mt-8 px-3 text-[0.5625rem] text-muted-foreground">Groups</div>
      <GroupTree onOpenGroup={openGroup} onNavigate={onNavigate} />

      <div className="mt-auto space-y-3 pt-8">
        <div
          className="relative overflow-hidden rounded-[1.4rem] p-4 text-pearl"
          style={{ background: "var(--ink-tile)" }}
        >
          <svg
            viewBox="0 0 120 120"
            className="pointer-events-none absolute -top-6 -right-6 size-28 text-pearl/15"
            fill="none"
            stroke="currentColor"
            aria-hidden
          >
            <circle cx="50" cy="60" r="34" />
            <circle cx="70" cy="60" r="34" stroke="rgb(109 143 255 / 0.6)" />
          </svg>
          <div className="relative font-display text-[1.35rem] leading-tight">
            Read with your <span className="italic">circle</span>
          </div>
          <p className="relative mt-1 text-[0.6875rem] text-pearl/60">Follow people to invite them in one tap.</p>
          <button
            type="button"
            onClick={() => {
              go("people");
              // Ready to type a name once the page has scrolled there.
              window.setTimeout(() => document.getElementById(PEOPLE_SEARCH_ID)?.focus({ preventScroll: true }), 700);
            }}
            className="relative mt-3 h-8 w-full rounded-full bg-pearl text-[0.75rem] font-medium text-ink"
          >
            Find people
          </button>
        </div>
        <div className="flex gap-1">
          <Link
            href="/"
            className="flex h-10 flex-1 items-center gap-2.5 rounded-xl px-3 text-[0.8125rem] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            <HouseLineIcon className="size-[18px]" /> Home
          </Link>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              router.push("/");
            }}
            className="flex h-10 flex-1 items-center gap-2.5 rounded-xl px-3 text-[0.8125rem] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            <SignOutIcon className="size-[18px]" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// Groups as a tree: a hairline trunk with a curved branch into each group, and each group's rooms
// nested one level deeper. Groups start expanded; the chevron folds one away.
function GroupTree({ onOpenGroup, onNavigate }: { onOpenGroup: (id: string) => void; onNavigate?: () => void }) {
  const { state, roomHref } = useDashboard();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ul className="relative mt-3 ml-[1.35rem] border-l border-(--hairline)">
      {state.groups.map((g) => {
        const on = state.filters.group === g.id;
        const open = !collapsed.has(g.id);
        const rooms = state.rooms.filter((r) => r.group_id === g.id && r.status !== "deleted");
        return (
          <li key={g.id} className="relative">
            <span
              className="absolute top-0 -left-px h-[1.125rem] w-3.5 rounded-bl-[10px] border-b border-l border-(--hairline)"
              aria-hidden
            />
            <div className="ml-4 flex h-9 items-center gap-1">
              <button
                type="button"
                onClick={() => toggle(g.id)}
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${g.name}`}
                disabled={rooms.length === 0}
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
              >
                <CaretRightIcon
                  weight="bold"
                  className={cn(
                    "size-3 transition-transform duration-300 ease-fluid",
                    open && rooms.length > 0 && "rotate-90",
                  )}
                />
              </button>
              <button
                type="button"
                onClick={() => onOpenGroup(g.id)}
                aria-pressed={on}
                className={cn(
                  "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg pr-2 text-[0.8125rem] transition-colors",
                  on ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                <span className="flex-1 truncate text-left">{g.name}</span>
                <span className="text-[0.6875rem] tabular-nums opacity-70">{rooms.length}</span>
              </button>
            </div>

            {open && rooms.length > 0 && (
              <ul className="relative mb-1 ml-[2.05rem] border-l border-(--hairline)">
                {rooms.map((r) => (
                  <li key={r.id} className="relative">
                    <span
                      className="absolute top-0 -left-px h-3.5 w-3 rounded-bl-[8px] border-b border-l border-(--hairline)"
                      aria-hidden
                    />
                    <Link
                      href={roomHref(r.id)}
                      onClick={onNavigate}
                      title={`${r.title} · ${STATUS_META[r.status].label}`}
                      className="ml-3.5 flex h-7 items-center gap-2 rounded-md pr-2 pl-1 text-[0.75rem] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                    >
                      <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_META[r.status].dot)} />
                      <span className="truncate">{r.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
