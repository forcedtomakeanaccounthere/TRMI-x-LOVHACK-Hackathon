"use client";

import { CaretDownIcon, CaretUpIcon, FadersHorizontalIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { RoomCard } from "./room-card";
import { Panel, PanelHeader, STATUS_META } from "./primitives";
import { activeFilterCount, type Filters, type SinceFilter, type SortKey, type StatusFilter, useDashboard } from "./store";
import type { RoomView } from "./types";

const TABS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "paused", label: "Paused" },
  { id: "closed", label: "Closed" },
  { id: "archived", label: "Archived" },
  { id: "deleted", label: "Deleted" },
];

// One row of the three-column grid at a time.
const PAGE = 3;

export function RoomsSection({ onInvite }: { onInvite: (room: RoomView) => void }) {
  const { state, dispatch, visibleRooms } = useDashboard();
  const { filters } = state;

  // How many cards are shown, reset to one row whenever the search, tab or filters change.
  const filterKey = JSON.stringify(filters);
  const [shown, setShown] = useState({ key: filterKey, count: PAGE });
  const count = shown.key === filterKey ? shown.count : PAGE;
  const cards = visibleRooms.slice(0, count);
  const remaining = visibleRooms.length - cards.length;

  const countFor = (id: StatusFilter) =>
    id === "all"
      ? state.rooms.filter((r) => r.status !== "archived" && r.status !== "deleted").length
      : state.rooms.filter((r) => r.status === id).length;

  return (
    <Panel id="rooms" aria-label="Your rooms" className="scroll-mt-28">
      <PanelHeader
        eyebrow="Library"
        title={
          <>
            Your <span className="italic">rooms</span>
          </>
        }
        action={<FilterPopover />}
      />

      <LayoutGroup id="room-tabs">
        <div
          role="tablist"
          aria-label="Room status"
          className="-mx-1 mt-5 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-none"
        >
          {TABS.map((t) => {
            const active = filters.status === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => dispatch({ type: "filters", patch: { status: t.id } })}
                className={cn(
                  "relative flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[0.8125rem] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="room-tab"
                    className="absolute inset-0 rounded-full bg-card shadow-[0_6px_20px_-10px_rgb(14_30_90/0.4),inset_0_1px_0_rgb(255_255_255/0.6)] ring-1 ring-(--hairline) dark:bg-foreground/10 dark:shadow-none"
                    transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                  />
                )}
                {t.id !== "all" && <span className={cn("relative size-1.5 rounded-full", STATUS_META[t.id].dot)} />}
                <span className="relative">{t.label}</span>
                <span className="relative text-[0.6875rem] text-muted-foreground tabular-nums">{countFor(t.id)}</span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      {filters.query && (
        <div className="mt-3 flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
          <MagnifyingGlassIcon className="size-3.5" />
          {visibleRooms.length} result{visibleRooms.length === 1 ? "" : "s"} for “{filters.query}”
          <button
            type="button"
            onClick={() => dispatch({ type: "filters", patch: { query: "" } })}
            className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-foreground/80 ring-1 ring-(--hairline) hover:bg-foreground/5"
          >
            <XIcon className="size-3" /> Clear
          </button>
        </div>
      )}

      {/* Columns follow the panel's own width, so the side column never squeezes three cards. */}
      <div className="@container mt-5">
        <div className="grid gap-3.5 @xl:grid-cols-2 @3xl:grid-cols-3">
          {cards.map((room) => (
            <RoomCard key={room.id} room={room} onInvite={onInvite} />
          ))}
        </div>
      </div>

      {visibleRooms.length > PAGE && (
        <div className="mt-5 flex flex-col items-center gap-2">
          {remaining > 0 ? (
            <button
              type="button"
              onClick={() => setShown({ key: filterKey, count: count + PAGE })}
              className="inline-flex h-10 items-center gap-2 rounded-full px-5 text-[0.8125rem] font-medium ring-1 ring-(--hairline) transition-colors hover:bg-foreground/5"
            >
              Show more
              <CaretDownIcon className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShown({ key: filterKey, count: PAGE })}
              className="inline-flex h-10 items-center gap-2 rounded-full px-5 text-[0.8125rem] font-medium text-muted-foreground ring-1 ring-(--hairline) transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              Show less
              <CaretUpIcon className="size-3.5" />
            </button>
          )}
          <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
            Showing {cards.length} of {visibleRooms.length}
          </span>
        </div>
      )}

      {visibleRooms.length === 0 && (
        <div className="grid place-items-center rounded-[1.4rem] border border-dashed border-(--hairline) py-14 text-center">
          <p className="font-display text-[1.6rem] italic">Nothing here yet.</p>
          <p className="mt-2 max-w-xs text-[0.8125rem] text-muted-foreground">
            {filters.status === "deleted"
              ? "Deleted rooms wait here until you restore them."
              : "Try another status or clear the filters."}
          </p>
        </div>
      )}
    </Panel>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; color?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="eyebrow text-[0.5625rem] text-muted-foreground">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.75rem] font-medium ring-1 ring-(--hairline) transition-colors",
              value === o.value
                ? "bg-ink text-pearl ring-transparent dark:bg-pearl dark:text-ink"
                : "text-foreground/75 hover:bg-foreground/5",
            )}
          >
            {o.color && <span className="size-2 rounded-full" style={{ backgroundColor: o.color }} />}
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function FilterPopover() {
  const { state, dispatch } = useDashboard();
  const f = state.filters;
  const count = activeFilterCount(f);
  const set = (patch: Partial<Filters>) => dispatch({ type: "filters", patch });

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[0.8125rem] font-medium ring-1 ring-(--hairline) transition-colors hover:bg-foreground/5 data-[state=open]:bg-foreground/5",
          count > 0 && "ring-azure/40",
        )}
      >
        <FadersHorizontalIcon className="size-4" />
        Filters
        {count > 0 && (
          <span className="grid size-5 place-items-center rounded-full bg-azure text-[0.625rem] font-semibold text-white">
            {count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        data-lenis-prevent
        className="w-[min(22rem,calc(100vw-2rem))] space-y-5 rounded-[1.4rem] bg-popover/97 p-5 shadow-[0_30px_80px_-30px_rgb(5_10_30/0.5)] backdrop-blur-2xl"
      >
        <Segmented
          label="Type"
          value={f.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { value: "any", label: "Any" },
            { value: "link", label: "Links" },
            { value: "pdf", label: "PDFs" },
          ]}
        />
        <Segmented
          label="Group"
          value={f.group}
          onChange={(group) => set({ group })}
          options={[
            { value: "any", label: "All groups" },
            ...state.groups.map((g) => ({ value: g.id, label: g.name, color: g.color })),
          ]}
        />
        <Segmented<SinceFilter>
          label="Last active"
          value={f.since}
          onChange={(since) => set({ since })}
          options={[
            { value: "any", label: "Any time" },
            { value: "7d", label: "Past 7 days" },
            { value: "30d", label: "Past 30 days" },
          ]}
        />
        <Segmented<SortKey>
          label="Sort by"
          value={f.sort}
          onChange={(sort) => set({ sort })}
          options={[
            { value: "activity", label: "Activity" },
            { value: "created", label: "Newest" },
            { value: "comments", label: "Most discussed" },
            { value: "title", label: "A–Z" },
          ]}
        />
        <div className="flex justify-end border-t border-(--hairline) pt-4">
          <button
            type="button"
            disabled={count === 0}
            onClick={() => dispatch({ type: "reset-filters" })}
            className="text-[0.8125rem] font-medium text-azure disabled:text-muted-foreground disabled:opacity-60"
          >
            Clear filters
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
