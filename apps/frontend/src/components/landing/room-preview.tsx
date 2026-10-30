"use client";

import { SparkleIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { PEOPLE } from "./content";
import { FakeCursor } from "./fake-cursor";

const [abhishek, arun, mei] = PEOPLE as [(typeof PEOPLE)[number], (typeof PEOPLE)[number], (typeof PEOPLE)[number]];

export function Avatars({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <div className={cn("flex -space-x-2", className)}>
      {PEOPLE.map((p) => (
        <span
          key={p.name}
          title={p.name}
          className={cn(
            "grid place-items-center rounded-full font-semibold text-white ring-2 ring-background",
            size === "sm" ? "size-6 text-[0.625rem]" : "size-8 text-[0.75rem]",
          )}
          style={{ backgroundColor: p.color }}
        >
          {p.name[0]}
        </span>
      ))}
    </div>
  );
}

// A miniature, animated LinkRoom: the product explained without a word.
export function RoomPreview({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <div className={cn("liquid-glass relative overflow-hidden rounded-[1.75rem] p-1.5", className)}>
      <div className="relative overflow-hidden rounded-[calc(1.75rem-0.375rem)] bg-card/85 dark:bg-card/70">
        <div className="flex items-center justify-between gap-3 border-b border-(--hairline) px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-foreground/15" />
            <span className="size-2.5 rounded-full bg-foreground/15" />
            <span className="size-2.5 rounded-full bg-foreground/15" />
          </div>
          <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">linkroom.app/r/x7Kp2qLm</span>
          <Avatars size="sm" />
        </div>

        <div className="relative px-6 pt-6 pb-7 sm:px-8">
          <div className="eyebrow text-[0.5625rem] text-muted-foreground">en.wikipedia.org</div>
          <h3 className="mt-2 font-display text-[2rem] leading-none font-medium">Internet</h3>
          <p className="mt-4 text-[0.8125rem] leading-[1.75] text-foreground/75">
            The Internet is a global system of interconnected computer networks that{" "}
            <span className="relative">
              <motion.span
                className="absolute inset-x-0 -inset-y-0.5 origin-left rounded-[3px]"
                style={{ backgroundColor: `${abhishek.color}40` }}
                initial={{ scaleX: reduce ? 1 : 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 1.4, delay: 1.6, ease: [0.16, 1, 0.3, 1] }}
              />
              <span className="relative">uses a common set of protocols to communicate</span>
            </span>{" "}
            between networks and devices.
          </p>
          <div className="mt-3 space-y-2">
            <div className="h-2 w-full rounded-full bg-foreground/7" />
            <div className="h-2 w-[92%] rounded-full bg-foreground/7" />
            <div className="h-2 w-[78%] rounded-full bg-foreground/7" />
          </div>
          <p className="mt-4 text-[0.8125rem] leading-[1.75] text-foreground/75">
            It is a{" "}
            <span className="rounded-[3px] px-0.5" style={{ backgroundColor: `${arun.color}38` }}>
              network of networks
            </span>{" "}
            of local to global scope, linked by a broad array of technologies.
          </p>

          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, delay: 2.6, ease: [0.16, 1, 0.3, 1] }}
            className="liquid-glass liquid-glass-strong absolute right-4 bottom-4 w-[13.5rem] rounded-2xl p-3"
          >
            <div className="flex items-center gap-2 text-[0.6875rem] font-semibold">
              <span className="size-2 rounded-full" style={{ backgroundColor: mei.color }} />
              Arnav
              <span className="font-normal text-muted-foreground">just now</span>
            </div>
            <p className="mt-1 text-[0.75rem] leading-snug text-foreground/80">
              Is this the same as the web? Feels like people mix them up.
            </p>
          </motion.div>
        </div>

        <FakeCursor
          name={abhishek.name}
          color={abhishek.color}
          path={{ x: ["22%", "58%", "40%", "70%"], y: ["34%", "40%", "62%", "36%"] }}
          duration={10}
        />
        <FakeCursor
          name={arun.name}
          color={arun.color}
          path={{ x: ["70%", "30%", "52%", "18%"], y: ["70%", "58%", "30%", "48%"] }}
          duration={12}
          delay={0.6}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1, delay: 3.4, ease: [0.16, 1, 0.3, 1] }}
        className="liquid-glass liquid-glass-strong absolute -top-1 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full px-3.5 py-1.5 text-[0.6875rem] font-medium sm:flex"
      >
        <SparkleIcon weight="light" className="size-3.5 text-azure" />
        Recap ready for 4 readers
      </motion.div>
    </div>
  );
}
