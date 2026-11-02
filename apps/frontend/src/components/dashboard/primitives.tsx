"use client";

import { cn } from "@/lib/utils";
import type { Person, ViewStatus } from "./types";

export const STATUS_META: Record<ViewStatus, { label: string; dot: string; badge: string }> = {
  running: {
    label: "Running",
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  },
  paused: {
    label: "Paused",
    dot: "bg-amber-500",
    badge: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  },
  closed: {
    label: "Closed",
    dot: "bg-foreground/40",
    badge: "bg-foreground/6 text-foreground/70 ring-foreground/10",
  },
  archived: {
    label: "Archived",
    dot: "bg-slate-400",
    badge: "bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300",
  },
  deleted: {
    label: "Deleted",
    dot: "bg-red-500",
    badge: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300",
  },
};

export function StatusBadge({ status, live }: { status: ViewStatus; live?: number }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ring-1 ring-inset",
        meta.badge,
      )}
    >
      <span className="relative flex size-1.5">
        {status === "running" && live ? (
          <span className={cn("absolute inset-0 animate-ping rounded-full opacity-70", meta.dot)} />
        ) : null}
        <span className={cn("relative size-1.5 rounded-full", meta.dot)} />
      </span>
      {meta.label}
      {status === "running" && live ? <span className="font-normal opacity-75">· {live} live</span> : null}
    </span>
  );
}

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function timeAgo(iso: string, now = Date.now()) {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RTF.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function initials(name: string) {
  // Words that start with a letter or digit, so "Ada (demo)" is "A", not "A(".
  const parts = name.trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

export function PersonAvatar({
  person,
  size = "md",
  className,
}: {
  person: Pick<Person, "name" | "color"> & { avatar_url?: string | null };
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizes = {
    xs: "size-6 text-[0.5625rem]",
    sm: "size-7 text-[0.625rem]",
    md: "size-9 text-[0.75rem]",
    lg: "size-12 text-[0.95rem]",
    xl: "size-20 text-[1.6rem]",
  };
  return (
    <span
      title={person.name}
      aria-label={person.name}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]",
        sizes[size],
        className,
      )}
      style={{ background: `linear-gradient(145deg, ${person.color}, color-mix(in oklab, ${person.color} 70%, black))` }}
    >
      {person.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- user uploads are data URLs; next/image can't optimise them
        <img src={person.avatar_url} alt="" className="size-full rounded-full object-cover" />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = "xs" }: { people: Person[]; max?: number; size?: "xs" | "sm" }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((p) => (
        <PersonAvatar key={p.id} person={p} size={size} className="ring-2 ring-card" />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            "grid place-items-center rounded-full bg-foreground/8 font-semibold text-foreground/70 ring-2 ring-card",
            size === "xs" ? "size-6 text-[0.5625rem]" : "size-7 text-[0.625rem]",
          )}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

// Glass panel used for every dashboard section.
export function Panel({
  className,
  children,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section className={cn("liquid-glass rounded-[1.75rem] p-5 md:p-6", className)} {...props}>
      {children}
    </section>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow text-[0.5625rem] text-azure">{eyebrow}</div>}
        <h2 className="mt-1.5 font-display text-[1.75rem] leading-none font-medium">{title}</h2>
      </div>
      {action}
    </div>
  );
}
