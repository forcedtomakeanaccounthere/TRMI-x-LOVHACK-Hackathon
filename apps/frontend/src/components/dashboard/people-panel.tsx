"use client";

import { MagnifyingGlassIcon, UserPlusIcon, XIcon } from "@phosphor-icons/react";
import { LayoutGroup, motion } from "motion/react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getFreshSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Person } from "./types";
import { Panel, PanelHeader, PersonAvatar, timeAgo } from "./primitives";
import { useDashboard } from "./store";

type Tab = "recent" | "following" | "followers";

export const PEOPLE_SEARCH_ID = "people-search";

const toPerson = (u: { id: string; display_name: string; avatar_color: string | null }): Person => ({
  id: u.id,
  name: u.display_name,
  handle:
    u.display_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 20) || "reader",
  color: u.avatar_color ?? "#2f5bff",
  avatar_url: null,
});

type Search = { q: string; status: "idle" | "loading" | "done" | "error"; people: Person[] };

// Finds people on LinkRoom by name (GET /api/users/search). In preview the search runs over the demo
// people instead, since there's no backend to ask.
function usePeopleSearch(query: string, live: boolean, local: Person[]) {
  const [result, setResult] = useState<Search>({ q: "", status: "idle", people: [] });
  const q = query.trim();
  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!live) {
        const needle = q.toLowerCase();
        const people = local.filter((p) => p.name.toLowerCase().includes(needle) || p.handle.includes(needle));
        if (!cancelled) setResult({ q, status: "done", people });
        return;
      }
      setResult((r) => ({ ...r, q, status: "loading" }));
      try {
        const session = await getFreshSession();
        if (!session) throw new Error("Signed out");
        const { users } = await api.users.search(q, session.access_token);
        if (!cancelled) setResult({ q, status: "done", people: users.map(toPerson) });
      } catch {
        if (!cancelled) setResult({ q, status: "error", people: [] });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, live, local]);
  return q && result.q === q ? result : { q, status: q ? ("loading" as const) : ("idle" as const), people: [] };
}

// Quick-add list: people I've read with, people I follow and people who follow me.
export function PeoplePanel({ onAddToRoom }: { onAddToRoom: (person: Person) => void }) {
  const { state, actions, source } = useDashboard();
  const [tab, setTab] = useState<Tab>("recent");
  const [query, setQuery] = useState("");
  // Everyone the preview knows, once each (someone can be in all three lists).
  const [everyone] = useState(() => [
    ...new Map([...state.participants, ...state.following, ...state.followers].map((p) => [p.id, p])).values(),
  ]);
  const search = usePeopleSearch(query, source === "live", everyone);
  const searching = search.status !== "idle";
  const followingIds = new Set(state.following.map((p) => p.id));
  const followerIds = new Set(state.followers.map((p) => p.id));

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "recent", label: "Read with", count: state.participants.length },
    { id: "following", label: "Following", count: state.following.length },
    { id: "followers", label: "Followers", count: state.followers.length },
  ];

  // The side panel is narrow, so status ("follows you", "mutual") rides in the meta line.
  const rows: { person: Person; meta: string; title: string }[] = searching
    ? search.people.map((p) => ({
        person: p,
        meta: `@${p.handle}${followerIds.has(p.id) ? " · follows you" : ""}`,
        title: p.name,
      }))
    : tab === "recent"
      ? state.participants.map((p) => ({
          person: p,
          meta: `${p.rooms_together} room${p.rooms_together === 1 ? "" : "s"}${followerIds.has(p.id) ? " · follows you" : ""}`,
          title: `${p.rooms_together} rooms together, last ${timeAgo(p.last_seen_at)}`,
        }))
      : (tab === "following" ? state.following : state.followers).map((p) => {
          const mutual = followingIds.has(p.id) && followerIds.has(p.id);
          return { person: p, meta: `@${p.handle}${mutual ? " · mutual" : ""}`, title: `@${p.handle}` };
        });

  return (
    <Panel id="people" aria-label="People" className="scroll-mt-28">
      <PanelHeader eyebrow="Your circle" title={<span className="italic">People</span>} />

      <label className="mt-4 flex h-10 items-center gap-2 rounded-full bg-foreground/5 px-3.5 ring-1 ring-transparent transition focus-within:bg-card focus-within:ring-azure/40">
        <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          id={PEOPLE_SEARCH_ID}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          maxLength={40}
          placeholder="Find people on LinkRoom by name"
          aria-label="Find people by name"
          className="min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        )}
      </label>

      {!searching && (
        <LayoutGroup id="people-tabs">
          <div role="tablist" aria-label="People lists" className="mt-4 flex gap-1 rounded-full bg-foreground/5 p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-[0.75rem] font-medium transition-colors",
                  tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="people-tab"
                    className="absolute inset-0 rounded-full bg-card shadow-[0_4px_14px_-8px_rgb(14_30_90/0.4)] ring-1 ring-(--hairline) dark:bg-foreground/10"
                    transition={{ type: "spring", bounce: 0.15, duration: 0.45 }}
                  />
                )}
                <span className="relative">{t.label}</span>
                <span className="relative text-[0.625rem] text-muted-foreground tabular-nums">{t.count}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
      )}

      {searching && (
        <p className="mt-3 px-2 text-[0.75rem] text-muted-foreground" aria-live="polite">
          {search.status === "loading"
            ? "Searching…"
            : search.status === "error"
              ? "Couldn't search right now. Is the backend running?"
              : search.people.length === 0
                ? `No one called “${search.q}” yet.`
                : `${search.people.length} ${search.people.length === 1 ? "person" : "people"}`}
        </p>
      )}

      <ul className="mt-3 space-y-0.5" data-lenis-prevent>
        {rows.map(({ person, meta, title }) => {
          const following = followingIds.has(person.id);
          return (
            <li
              key={person.id}
              className="group/row flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-foreground/4"
            >
              <PersonAvatar person={person} size="md" />
              <div className="min-w-0 flex-1" title={title}>
                <div className="truncate text-[0.875rem] font-medium">{person.name}</div>
                <div className="truncate text-[0.75rem] text-muted-foreground">{meta}</div>
              </div>
              <button
                type="button"
                onClick={() => onAddToRoom(person)}
                aria-label={`Add ${person.name} to a room`}
                title="Add to a room"
                className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground ring-1 ring-(--hairline) transition-colors hover:bg-foreground/6 hover:text-foreground"
              >
                <UserPlusIcon className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => actions.toggleFollow(person)}
                aria-pressed={following}
                className={cn(
                  "h-8 w-22 shrink-0 rounded-full text-[0.75rem] font-medium transition-colors",
                  following
                    ? "text-foreground/80 ring-1 ring-(--hairline) hover:bg-foreground/5"
                    : "bg-ink text-pearl dark:bg-pearl dark:text-ink",
                )}
              >
                {following ? "Following" : tab === "followers" ? "Follow back" : "Follow"}
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
