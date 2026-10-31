"use client";

import { PRESENCE_COLORS } from "@linkroom/shared";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { Avatar } from "./bits";
import { randomColor } from "./identity";

// Vertical bars rising in a soft gradient behind the entry screens (after blocks.mvp-subha "gradient bars").
export function GradientBars({ className }: { className?: string }) {
  const bars = 15;
  return (
    <div className={cn("pointer-events-none absolute inset-0 flex items-end overflow-hidden", className)} aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const mid = Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
        return (
          <motion.span
            key={i}
            className="flex-1 origin-bottom"
            style={{
              height: `${30 + mid * 60}%`,
              background: "linear-gradient(to top, rgb(47 91 255 / 0.55), rgb(139 92 246 / 0.18) 60%, transparent)",
            }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: [0.9, 1, 0.9] }}
            transition={{
              duration: 3.2,
              repeat: Infinity,
              delay: i * 0.12,
              ease: "easeInOut",
            }}
          />
        );
      })}
      <div className="absolute inset-0 backdrop-blur-[60px]" />
    </div>
  );
}

export function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-16">
      <GradientBars className="opacity-60 dark:opacity-80" />
      <div className="absolute top-5 left-5">
        <Logo />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", bounce: 0.2, duration: 0.8 }}
        className="liquid-glass liquid-glass-strong relative w-full max-w-md rounded-[2.25rem] p-8"
      >
        {children}
      </motion.div>
    </div>
  );
}

// A guest joins with a name and a colour; signed-in people skip this.
export function JoinGate({
  title,
  onJoin,
  nextPath,
}: {
  title: string;
  onJoin: (name: string, color: string) => void;
  nextPath: string;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(randomColor);

  return (
    <GateShell>
      <div className="eyebrow text-center text-[0.5625rem] text-muted-foreground">You&apos;re invited to read</div>
      <h1 className="mt-3 text-center font-display text-[2.4rem] leading-[0.95] text-balance">{title}</h1>
      <form
        className="mt-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onJoin(name, color);
        }}
      >
        <label className="text-[0.75rem] font-medium" htmlFor="guest-name">
          Your name
        </label>
        <div className="mt-1.5 flex items-center gap-2.5 rounded-2xl bg-background/70 p-1.5 pl-2 ring-1 ring-(--hairline) focus-within:ring-azure/50">
          <Avatar actor={{ name: name || "?", color }} size={32} />
          <input
            id="guest-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            placeholder="How the room will see you"
            className="h-9 min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none"
          />
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[0.75rem] font-medium">Cursor colour</span>
          <div className="flex gap-1.5">
            {PRESENCE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  "size-6 rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                  color === c && "ring-2 ring-foreground/70",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <button
          type="submit"
          disabled={!name.trim()}
          className="group mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-[0.9375rem] font-medium text-pearl shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] transition active:scale-[0.99] disabled:opacity-50 dark:bg-azure"
        >
          Join as guest
          <ArrowRightIcon weight="bold" className="size-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </form>
      <p className="mt-5 text-center text-[0.75rem] text-muted-foreground">
        Have an account?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(nextPath)}`}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </GateShell>
  );
}
