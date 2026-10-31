"use client";

import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EASE_OUT_EXPO } from "@/components/fx/reveal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Panel, PanelHeader, StatusBadge } from "./primitives";
import { useDashboard } from "./store";
import type { RoomView } from "./types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_TITLES = 3;
const FALLBACK_COLOR = "#2f5bff";

// The calendar shows three statuses, each always on its own row so a status lines up across the week.
// Closed and deleted rooms stay off the calendar.
const ROWS = [
  { status: "running", label: "Active" },
  { status: "paused", label: "Paused" },
  { status: "archived", label: "Archived" },
] as const;
type CalendarStatus = (typeof ROWS)[number]["status"];

// Local midnight, so a room started at 23:00 still lands on that day.
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a: Date, b: Date) => dayStart(a).getTime() === dayStart(b).getTime();
const shortDate = (d: Date) => d.toLocaleDateString("en", { month: "short", day: "numeric" });

type Span = { room: RoomView; start: Date; end: Date; color: string };

// A run of consecutive days in one week where at least one room has the status: drawn as one bar,
// however many rooms join or leave along the way. rooms is everyone in the run, earliest start first.
type Segment = {
  status: CalendarStatus;
  row: number;
  col: number;
  len: number;
  from: Date;
  to: Date;
  rooms: Span[];
  clippedStart: boolean;
  clippedEnd: boolean;
};

// Running and paused rooms run until today; archived rooms end on closed_at.
function spanOf(room: RoomView, today: Date, color: string): Span | null {
  if (room.status !== "running" && room.status !== "paused" && room.status !== "archived") return null;
  const start = dayStart(new Date(room.created_at));
  const end = dayStart(room.closed_at && room.status === "archived" ? new Date(room.closed_at) : today);
  return { room, start, end: end < start ? start : end, color };
}

function layoutWeek(days: Date[], spans: Span[]): Segment[] {
  const segments: Segment[] = [];
  ROWS.forEach(({ status }, row) => {
    const perDay = days.map((day) => spans.filter((s) => s.room.status === status && s.start <= day && s.end >= day));
    let d = 0;
    while (d < 7) {
      if (!perDay[d]!.length) {
        d++;
        continue;
      }
      let end = d;
      while (end + 1 < 7 && perDay[end + 1]!.length) end++;
      const rooms = [...new Map(perDay.slice(d, end + 1).flat().map((s) => [s.room.id, s])).values()].sort(
        (a, b) => a.start.getTime() - b.start.getTime(),
      );
      segments.push({
        status,
        row,
        col: d,
        len: end - d + 1,
        from: days[d]!,
        to: days[end]!,
        rooms,
        // Rounded ends only where the run really starts or stops, not at the week's edge.
        clippedStart: d === 0 && perDay[0]!.some((s) => s.start < days[0]!),
        clippedEnd: end === 6 && perDay[6]!.some((s) => s.end > days[6]!),
      });
      d = end + 1;
    }
  });
  return segments;
}

// An active bar takes one colour: that of the room running longest, which is its group's colour,
// or the room's own colour when it has no group.
function segmentColor(s: Segment) {
  const longest = s.rooms.reduce((a, b) => (b.end.getTime() - b.start.getTime() > a.end.getTime() - a.start.getTime() ? b : a));
  return longest.color;
}

export function RoomCalendar() {
  const { state, groupById } = useDashboard();
  const today = useMemo(() => dayStart(new Date()), []);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<Date>(today);

  const spans = useMemo(
    () =>
      state.rooms
        .map((r) => spanOf(r, today, (r.group_id && groupById.get(r.group_id)?.color) || r.color || FALLBACK_COLOR))
        .filter((s): s is Span => s !== null)
        .sort((a, b) => b.room.last_activity_at.localeCompare(a.room.last_activity_at)),
    [state.rooms, today, groupById],
  );

  // Weeks start on Monday; the grid always shows whole weeks around the month.
  const weeks = useMemo(() => {
    const offset = (month.getDay() + 6) % 7;
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const count = Math.ceil((offset + last.getDate()) / 7);
    return Array.from({ length: count }, (_, w) => {
      const days = Array.from(
        { length: 7 },
        (_, d) => new Date(month.getFullYear(), month.getMonth(), 1 - offset + w * 7 + d),
      );
      return { days, segments: layoutWeek(days, spans) };
    });
  }, [month, spans]);

  // The list under the grid covers every room on the selected day, closed ones included.
  const onSelected = state.rooms.filter((r) => {
    if (r.status === "deleted") return false;
    const start = dayStart(new Date(r.created_at));
    const end = dayStart(r.closed_at ? new Date(r.closed_at) : today);
    return start <= selected && end >= selected;
  });
  const label = month.toLocaleDateString("en", { month: "long", year: "numeric" });
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <Panel id="calendar" aria-label="Room calendar" className="scroll-mt-28">
      <PanelHeader
        eyebrow="Calendar"
        title={
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
              className="inline-block"
            >
              {label.split(" ")[0]} <span className="italic text-muted-foreground">{label.split(" ")[1]}</span>
            </motion.span>
          </AnimatePresence>
        }
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                setSelected(today);
              }}
              className="h-9 rounded-full px-3.5 text-[0.8125rem] font-medium ring-1 ring-(--hairline) hover:bg-foreground/5"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => shift(-1)}
              className="grid size-9 place-items-center rounded-full ring-1 ring-(--hairline) hover:bg-foreground/5"
            >
              <CaretLeftIcon className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => shift(1)}
              className="grid size-9 place-items-center rounded-full ring-1 ring-(--hairline) hover:bg-foreground/5"
            >
              <CaretRightIcon className="size-4" />
            </button>
          </div>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.75rem] text-muted-foreground">
        <Legend swatch={<span className="animate-blink-5s h-2 w-5 rounded-full bg-azure" />}>
          Active (group or room colour)
        </Legend>
        <Legend swatch={<span className="h-2 w-5 rounded-full bg-red-500" />}>Paused</Legend>
        <Legend swatch={<span className="h-2 w-5 rounded-full bg-neutral-700" />}>Archived</Legend>
      </div>

      <div className="-mx-1 mt-4 overflow-x-auto px-1 pb-1">
        <div className="min-w-[38rem]">
          <div className="grid grid-cols-7 pb-2">
            {WEEKDAYS.map((d) => (
              <div key={d} className="eyebrow px-2 text-[0.5625rem] text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-[1.2rem] ring-1 ring-(--hairline)">
            {weeks.map((week) => (
              <div key={week.days[0]!.toISOString()} className="relative border-t border-(--hairline) first:border-t-0">
                <div className="grid grid-cols-7">
                  {week.days.map((day) => {
                    const outside = day.getMonth() !== month.getMonth();
                    const isToday = sameDay(day, today);
                    const isSelected = sameDay(day, selected);
                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        onClick={() => setSelected(day)}
                        aria-pressed={isSelected}
                        aria-label={day.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}
                        className={cn(
                          "relative flex h-24 flex-col items-start justify-start border-l border-(--hairline) p-1.5 text-left transition-colors first:border-l-0 hover:bg-foreground/[0.025]",
                          isSelected && "bg-azure/[0.06]",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-6 place-items-center rounded-full font-display text-[0.95rem] tabular-nums",
                            outside && "text-muted-foreground/45",
                            isToday && "bg-ink text-pearl dark:bg-pearl dark:text-ink",
                            isSelected && !isToday && "ring-1 ring-azure/50",
                          )}
                        >
                          {day.getDate()}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Three fixed rows (active, paused, archived) above the day buttons; empty space lets
                    clicks through to the days, bars take their own clicks. */}
                <div className="pointer-events-none absolute inset-x-0 top-8.5 grid grid-cols-7 grid-rows-3 gap-y-[3px] px-0.5">
                  {week.segments.map((s) => (
                    <StatusBar key={`${s.status}-${s.col}`} segment={s} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="eyebrow text-[0.5625rem] text-muted-foreground">
          {selected.toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" })}
        </div>
        <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {onSelected.map((r) => (
            <li key={r.id}>
              <Link
                href={`/r/${r.id}`}
                className="flex items-center gap-3 rounded-2xl px-3 py-2.5 ring-1 ring-(--hairline) transition-colors hover:bg-foreground/5"
              >
                <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: barColor(r, groupById) }} />
                <span className="min-w-0 flex-1 truncate font-display text-[1.1rem]">{r.title}</span>
                <StatusBadge status={r.status} />
              </Link>
            </li>
          ))}
          {onSelected.length === 0 && <li className="text-[0.8125rem] text-muted-foreground">No rooms on this day.</li>}
        </ul>
      </div>
    </Panel>
  );
}

function barColor(r: RoomView, groups: Map<string, { color: string }>) {
  if (r.status === "paused") return "#ef4444";
  if (r.status === "archived" || r.status === "closed") return "#404040";
  return (r.group_id && groups.get(r.group_id)?.color) || r.color || FALLBACK_COLOR;
}

function StatusBar({ segment: s }: { segment: Segment }) {
  const titles = s.rooms.slice(0, MAX_TITLES).map((x) => x.room.title);
  const extra = s.rooms.length - titles.length;
  const label = ROWS[s.row]!.label;
  const style = s.status === "running" ? { backgroundColor: segmentColor(s) } : undefined;
  const range = sameDay(s.from, s.to) ? shortDate(s.from) : `${shortDate(s.from)} – ${shortDate(s.to)}`;

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label}: ${s.rooms.map((x) => x.room.title).join(", ")}`}
        className={cn(
          "pointer-events-auto flex h-4 min-w-0 items-center gap-1 overflow-hidden px-1.5 text-left text-[0.6rem] leading-none font-semibold whitespace-nowrap text-white transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          s.clippedStart ? "rounded-l-none" : "rounded-l-full",
          s.clippedEnd ? "rounded-r-none" : "rounded-r-full",
          s.status === "running" && "animate-blink-5s",
          s.status === "paused" && "bg-red-500",
          s.status === "archived" && "bg-neutral-700 text-white/80",
        )}
        style={{ gridColumn: `${s.col + 1} / span ${s.len}`, gridRow: s.row + 1, ...style }}
      >
        <span className="min-w-0 truncate">{titles.join(", ")}</span>
        {extra > 0 && <span className="shrink-0 rounded-full bg-black/25 px-1 py-px text-[0.55rem]">+{extra}</span>}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        data-lenis-prevent
        className="w-80 rounded-[1.1rem] bg-popover/97 p-2 shadow-[0_24px_60px_-24px_rgb(5_10_30/0.5)] backdrop-blur-2xl"
      >
        <div className="flex items-center justify-between px-2 pt-1 pb-2">
          <span className="eyebrow text-[0.5625rem] text-muted-foreground">
            {label} · {s.rooms.length}
          </span>
          <span className="text-[0.6875rem] text-muted-foreground">{range}</span>
        </div>
        <ul className="max-h-60 space-y-0.5 overflow-y-auto">
          {s.rooms.map((x) => (
            <li key={x.room.id}>
              <Link
                href={`/r/${x.room.id}`}
                className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-[0.8125rem] hover:bg-foreground/5"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: s.status === "paused" ? "#ef4444" : s.status === "archived" ? "#404040" : x.color,
                  }}
                />
                <span className="min-w-0 flex-1 truncate font-display text-[1rem]">{x.room.title}</span>
                <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">{timeline(x)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// "Oct 22 – today" for rooms still going, "Oct 3 – Oct 9" for archived ones.
function timeline(s: Span) {
  const ongoing = s.room.status !== "archived";
  const end = ongoing && sameDay(s.end, new Date()) ? "today" : shortDate(s.end);
  return sameDay(s.start, s.end) && !ongoing ? shortDate(s.start) : `${shortDate(s.start)} – ${end}`;
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      {swatch}
      {children}
    </span>
  );
}
