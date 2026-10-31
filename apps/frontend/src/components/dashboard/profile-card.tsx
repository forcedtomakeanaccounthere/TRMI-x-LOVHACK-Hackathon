"use client";

import { CalendarBlankIcon, EnvelopeSimpleIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { PersonAvatar } from "./primitives";
import { useDashboard } from "./store";

// Dark brand tile with the user's profile, rotating hairline rings behind it.
export function ProfileCard({ onEdit }: { onEdit: () => void }) {
  const { state } = useDashboard();
  const { profile } = state;
  const reduce = useReducedMotion();
  const since = new Date(profile.created_at).toLocaleDateString("en", { month: "long", year: "numeric" });

  const stats = [
    { label: "Rooms", value: profile.stats.rooms_hosted },
    { label: "Highlights", value: profile.stats.highlights },
    { label: "Followers", value: profile.stats.followers },
    { label: "Following", value: profile.stats.following },
  ];

  return (
    <section
      id="profile"
      aria-label="Your profile"
      className="relative scroll-mt-28 overflow-hidden rounded-[1.75rem] p-6 text-pearl"
      style={{ background: "var(--ink-tile)" }}
    >
      <motion.svg
        viewBox="0 0 400 400"
        className="pointer-events-none absolute -top-24 -right-28 size-80 text-pearl/12"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 90, repeat: Infinity, ease: "linear" }}
        aria-hidden
      >
        <circle cx="160" cy="200" r="120" />
        <circle cx="240" cy="200" r="120" stroke="rgb(109 143 255 / 0.65)" />
        <circle cx="200" cy="200" r="185" strokeDasharray="1 7" />
      </motion.svg>
      <div className="pointer-events-none absolute -bottom-32 -left-20 size-72 rounded-full bg-[radial-gradient(circle,rgb(47_91_255/0.35),transparent_65%)]" />

      <button
        type="button"
        onClick={onEdit}
        aria-label="Edit profile"
        className="absolute top-4 right-4 z-10 grid size-9 place-items-center rounded-full bg-pearl/10 text-pearl ring-1 ring-pearl/15 backdrop-blur transition-colors hover:bg-pearl/20"
      >
        <PencilSimpleIcon className="size-4" />
      </button>

      <div className="relative flex items-center gap-4 pr-10">
        <PersonAvatar person={profile} size="lg" className="size-16 text-[1.25rem] ring-2 ring-pearl/20" />
        <div className="min-w-0">
          <div className="eyebrow text-[0.5625rem] text-pearl/55">Reader</div>
          <h2 className="mt-1 truncate font-display text-[2rem] leading-none font-medium">{profile.name}</h2>
          <div className="mt-1 text-[0.8125rem] text-pearl/60">@{profile.handle}</div>
        </div>
      </div>

      {profile.bio && (
        <p className="relative mt-5 font-display text-[1.2rem] leading-snug text-pearl/85 italic">“{profile.bio}”</p>
      )}

      <dl className="relative mt-5 space-y-1.5 text-[0.75rem] text-pearl/65">
        <div className="flex items-center gap-2">
          <EnvelopeSimpleIcon className="size-3.5" />
          <dt className="sr-only">Email</dt>
          <dd className="truncate">{profile.email}</dd>
        </div>
        <div className="flex items-center gap-2">
          <CalendarBlankIcon className="size-3.5" />
          <dt className="sr-only">Member since</dt>
          <dd>Reading since {since}</dd>
        </div>
      </dl>

      <dl className="relative mt-6 grid grid-cols-4 gap-2 border-t border-pearl/10 pt-5">
        {stats.map((s) => (
          // Term first for screen readers; the number shows on top.
          <div key={s.label} className="flex min-w-0 flex-col-reverse">
            <dt className="mt-1.5 truncate text-[0.625rem] tracking-wide text-pearl/55 uppercase">{s.label}</dt>
            <dd className="font-display text-[1.7rem] leading-none tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
