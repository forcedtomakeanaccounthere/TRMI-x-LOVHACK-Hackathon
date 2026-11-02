"use client";

import {
  ArrowSquareOutIcon,
  ClosedCaptioningIcon,
  CrosshairSimpleIcon,
  MicrophoneIcon,
  SparkleIcon,
  WaveformIcon,
  type Icon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Reveal, SplitReveal } from "@/components/fx/reveal";
import { cn } from "@/lib/utils";
import { PEOPLE } from "./content";

// The two features that make a room feel like a room: talking in it (voice huddles with live
// captions and AI notes) and pointing at something together (laser focus).
export function TalkTogether() {
  return (
    <section id="talk" className="relative py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="grid items-end gap-8 md:grid-cols-[1.2fr_1fr]">
          <div>
            <Reveal>
              <div className="eyebrow text-azure">Talk it through</div>
            </Reveal>
            <SplitReveal
              as="h2"
              text="Say it out loud, right on the page."
              className="mt-6 block font-display text-[clamp(2.8rem,5.5vw,5rem)] font-normal"
              wordClassName={(w) =>
                w === "loud," || w === "page." ? "italic text-royal-gradient pr-[0.06em]" : undefined
              }
            />
          </div>
          <Reveal delay={0.2}>
            <p className="max-w-md text-[1.0625rem] leading-[1.75] text-muted-foreground md:ml-auto">
              Hop into a voice huddle without leaving the text, and show everyone the exact line you mean. The talk is
              captioned, kept and turned into notes that point back at the passages.
            </p>
          </Reveal>
        </div>

        <div className="mt-16 grid gap-4 lg:grid-cols-2">
          <Panel delay={0}>
            <HuddleArt />
            <PanelText icon={WaveformIcon} title="Voice huddles with live captions">
              Talk with the whole room or pick a few people. Captions run under the reading, the transcript builds as
              you speak, and one click writes the notes: decisions, action items and open questions, each linked to the
              paragraph people were on when it was said.
            </PanelText>
            <Chips items={["Room-wide or private", "Live captions", "Transcript .txt / .md", "AI notes"]} />
          </Panel>
          <Panel delay={0.1}>
            <LaserArt />
            <PanelText icon={CrosshairSimpleIcon} title="Laser focus: everyone, look here">
              One click brings every reader to your document and scroll position, and your pointer becomes a laser they
              all see. Stop, and everyone glides back to where they were reading.
            </PanelText>
            <Chips items={["Brings everyone to you", "Shared laser pointer", "Back to their spot"]} />
          </Panel>
        </div>
      </div>
    </section>
  );
}

function Panel({ children, delay }: { children: React.ReactNode; delay?: number }) {
  return (
    <Reveal delay={delay} className="bezel">
      <div className="bezel-core relative flex h-full flex-col overflow-hidden p-7 md:p-9">{children}</div>
    </Reveal>
  );
}

function PanelText({ icon: Icon, title, children }: { icon: Icon; title: string; children: React.ReactNode }) {
  return (
    <div className="relative mt-8">
      <div className="flex items-center gap-2.5">
        <Icon weight="light" className="size-5 text-azure" />
        <h3 className="font-display text-[1.75rem] leading-tight font-medium">{title}</h3>
      </div>
      <p className="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {items.map((t) => (
        <span
          key={t}
          className="rounded-full bg-foreground/5 px-3 py-1 text-[0.75rem] text-foreground/70 ring-1 ring-(--hairline)"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

const [ABHISHEK, ARUN, ARNAV] = PEOPLE as [(typeof PEOPLE)[number], (typeof PEOPLE)[number], (typeof PEOPLE)[number]];

const LINES = [
  { who: ARUN, text: "So the IMU drifts, which is why we fuse it with the encoders." },
  { who: ARNAV, text: "Right. I'll do the Kalman filter slide for Friday." },
  { who: ABHISHEK, text: "Let's decide LiDAR versus stereo on Wednesday." },
];

// Plays only while on screen, and holds still for reduced motion.
function useTicker(ms: number) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-15% 0px" });
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [inView, reduce, ms]);
  return { ref, tick };
}

function HuddleArt() {
  const { ref, tick } = useTicker(110);
  // Each line types out over ~5 s, then the next speaker takes over.
  const per = 46;
  const line = LINES[Math.floor(tick / per) % LINES.length]!;
  const shown = line.text
    .split(" ")
    .slice(0, Math.max(1, Math.floor(((tick % per) / per) * 1.35 * line.text.split(" ").length)));

  return (
    <div ref={ref} className="relative grid gap-4 sm:grid-cols-[13rem_1fr]">
      {/* The call card, as it sits in the room's Sources rail. */}
      <div className="rounded-2xl border border-(--hairline) bg-card p-3.5 shadow-[0_24px_50px_-30px_rgb(14_30_90/0.45)]">
        <div className="flex items-center gap-2.5">
          <span className="relative grid size-8 place-items-center rounded-xl bg-emerald-500/12 text-emerald-600 ring-1 ring-emerald-500/30">
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <path d="M6 4v16M18 4v16M6 12h12" />
            </svg>
            <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
          </span>
          <div className="min-w-0">
            <p className="text-[0.75rem] font-medium">Room huddle</p>
            <p className="text-[0.625rem] text-muted-foreground">4:12 · 3 in</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2.5">
          {[ABHISHEK, ARUN, ARNAV].map((p) => {
            const speaking = p.name === line.who.name;
            return (
              <div key={p.name} className="flex flex-col items-center gap-1">
                <span className="relative">
                  <motion.span
                    className="absolute -inset-1 rounded-full"
                    style={{ boxShadow: `0 0 0 2px ${p.color}` }}
                    animate={{ opacity: speaking ? [0.35, 1, 0.35] : 0, scale: speaking ? [1, 1.1, 1] : 1 }}
                    transition={{ duration: 1, repeat: speaking ? Infinity : 0 }}
                  />
                  <span
                    className="grid size-8 place-items-center rounded-full text-[0.6875rem] font-semibold text-white"
                    style={{ background: p.color }}
                  >
                    {p.name[0]}
                  </span>
                </span>
                <span className="text-[0.5625rem] text-muted-foreground">{p.name}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-1.5 border-t border-(--hairline) pt-2.5">
          <span className="grid size-7 place-items-center rounded-full bg-foreground/6">
            <MicrophoneIcon weight="fill" className="size-3.5" />
          </span>
          <span className="grid size-7 place-items-center rounded-full bg-foreground text-background">
            <ClosedCaptioningIcon weight="fill" className="size-3.5" />
          </span>
          <span className="ml-auto flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[0.5rem] font-semibold tracking-wide text-rose-600 uppercase">
            <span className="size-1 animate-pulse rounded-full bg-rose-500" /> Transcribing
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {/* Live subtitles over the reading. */}
        <div className="relative rounded-2xl border border-(--hairline) bg-card/70 p-4">
          <div className="space-y-2">
            {[88, 72, 94].map((w, i) => (
              <div key={i} className="h-2 rounded-full bg-foreground/8" style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className="mt-4 min-h-13 rounded-xl bg-black/80 px-3 py-2 text-[0.8125rem] leading-snug text-white">
            <span className="mr-1.5 text-[0.6875rem] font-semibold" style={{ color: line.who.color }}>
              {line.who.name}
            </span>
            {shown.join(" ")}
            <span className="ml-0.5 inline-block h-3 w-px translate-y-0.5 animate-pulse bg-white/70" />
          </div>
        </div>

        {/* The AI notes, each point tied to a passage. */}
        <div className="rounded-2xl border border-(--hairline) bg-card p-3.5">
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-medium">
            <SparkleIcon weight="fill" className="size-3.5 text-azure" /> AI notes
          </p>
          <ul className="mt-2 space-y-1.5 text-[0.75rem]">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 rounded bg-emerald-500/12 px-1 text-[0.5625rem] font-semibold text-emerald-700 uppercase dark:text-emerald-300">
                Action
              </span>
              <span className="min-w-0">
                Kalman filter slide <span className="text-amber-700 dark:text-amber-300">· Arnav</span>
                <span className="ml-1 inline-flex items-center gap-0.5 text-[0.625rem] text-muted-foreground">
                  <ArrowSquareOutIcon className="size-2.5" /> §5 Sensor fusion
                </span>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 rounded bg-azure/12 px-1 text-[0.5625rem] font-semibold text-azure uppercase">
                Open
              </span>
              <span className="min-w-0">
                LiDAR or stereo for depth?
                <span className="ml-1 inline-flex items-center gap-0.5 text-[0.625rem] text-muted-foreground">
                  <ArrowSquareOutIcon className="size-2.5" /> §3 Exteroception
                </span>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// A page of text, a laser on one line, and two readers' cursors arriving at it.
function LaserArt() {
  const { ref, tick } = useTicker(2600);
  const focusing = tick % 3 !== 2; // on for two beats, then everyone goes back for one
  const reduce = useReducedMotion();

  return (
    <div ref={ref} className="relative min-h-70 overflow-hidden rounded-2xl border border-(--hairline) bg-card p-5">
      <AnimatePresence>
        {focusing && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border-2 bg-card px-3 py-1 text-[0.6875rem] whitespace-nowrap shadow-lg"
            style={{ borderColor: ABHISHEK.color }}
          >
            <CrosshairSimpleIcon className="size-3" style={{ color: ABHISHEK.color }} />
            <span className="font-semibold">{ABHISHEK.name}</span> wants everyone to look here
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-9 space-y-2.5">
        {[92, 84, 96, 70].map((w, i) => (
          <div key={i} className="h-2 rounded-full bg-foreground/8" style={{ width: `${w}%` }} />
        ))}
        <div className="relative py-1">
          <div
            className={cn("h-2.5 w-[78%] rounded-full transition-colors duration-700", !focusing && "bg-foreground/8")}
            style={focusing ? { background: `color-mix(in oklab, ${ABHISHEK.color} 35%, transparent)` } : undefined}
          />
        </div>
        {[88, 64, 90].map((w, i) => (
          <div key={i} className="h-2 rounded-full bg-foreground/8" style={{ width: `${w}%` }} />
        ))}
      </div>

      {/* The laser: a glowing dot that sways along the line, with its label. */}
      <AnimatePresence>
        {focusing && (
          <motion.div
            className="pointer-events-none absolute z-10"
            style={{ top: "58%", left: "18%" }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={reduce ? { opacity: 1, scale: 1 } : { opacity: 1, scale: 1, x: [0, 90, 150, 60, 0] }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ x: { duration: 5, repeat: Infinity, ease: "easeInOut" }, default: { duration: 0.4 } }}
          >
            <span className="absolute -inset-3 rounded-full blur-md" style={{ background: `${ABHISHEK.color}66` }} />
            <span
              className="relative block size-3 rounded-full"
              style={{ background: ABHISHEK.color, boxShadow: `0 0 12px ${ABHISHEK.color}` }}
            />
            <span
              className="absolute top-3 left-4 rounded-full px-2 py-0.5 text-[0.625rem] font-semibold whitespace-nowrap text-white"
              style={{ background: ABHISHEK.color }}
            >
              {ABHISHEK.name} · look here
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Everyone else is brought to the spot, and back to their own when it ends. */}
      {[
        { p: ARUN, home: { top: "84%", left: "70%" }, near: { top: "66%", left: "44%" } },
        { p: ARNAV, home: { top: "22%", left: "78%" }, near: { top: "48%", left: "58%" } },
      ].map(({ p, home, near }) => (
        <motion.div
          key={p.name}
          className="pointer-events-none absolute z-10"
          initial={home}
          animate={focusing ? near : home}
          transition={{ duration: reduce ? 0 : 1.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <svg width="16" height="16" viewBox="0 0 18 18" className="drop-shadow-[0_2px_4px_rgb(0_0_0/0.25)]">
            <path
              d="M2 1.5 15.5 7.8 9.2 9.4 6.6 15.8Z"
              fill={p.color}
              stroke="white"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className={cn(
              "ml-3 -mt-0.5 inline-block rounded-full px-2 py-0.5 text-[0.625rem] font-semibold text-white",
            )}
            style={{ background: p.color }}
          >
            {p.name}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
