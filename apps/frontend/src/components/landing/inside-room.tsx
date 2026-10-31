"use client";

import { ChatsCircleIcon, CrosshairIcon, HighlighterIcon, SparkleIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { EASE_OUT_EXPO, Reveal } from "@/components/fx/reveal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { PEOPLE } from "./content";

const TABS = [
  {
    id: "highlight",
    label: "Highlight",
    icon: HighlighterIcon,
    title: "Mark what matters.",
    body: "Select text and it's saved in your colour. It appears for everyone in the room within a heartbeat, and stays after a refresh.",
  },
  {
    id: "discuss",
    label: "Discuss",
    icon: ChatsCircleIcon,
    title: "Talk beside the text.",
    body: "Every highlight opens a thread in the side panel. No more “which paragraph?” — the quote is right there.",
  },
  {
    id: "follow",
    label: "Follow",
    icon: CrosshairIcon,
    title: "Read as a guided tour.",
    body: "Click someone's avatar to follow their scroll, or press Bring everyone here to gather the room at one passage.",
  },
  {
    id: "recap",
    label: "Recap",
    icon: SparkleIcon,
    title: "Leave with one summary.",
    body: "Claude reads the group's highlights and comments and writes a recap: key points, disagreements, open questions and next steps.",
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

const AUTOPLAY_MS = 4000;

// Tab navigation with a sliding glass indicator and a stage that crossfades per tab.
// On phones the tabs advance on their own while the section is on screen.
export function InsideRoom() {
  const [tab, setTab] = useState<TabId>("highlight");
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const reduce = useReducedMotion();

  // Depends on `tab` so a manual pick restarts the 4s countdown.
  useEffect(() => {
    if (!inView || reduce) return;
    const mq = window.matchMedia("(max-width: 767px)");
    let id: number | undefined;
    const sync = () => {
      window.clearInterval(id);
      if (!mq.matches) return;
      id = window.setInterval(() => {
        setTab((t) => TABS[(TABS.findIndex((x) => x.id === t) + 1) % TABS.length]!.id);
      }, AUTOPLAY_MS);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => {
      window.clearInterval(id);
      mq.removeEventListener("change", sync);
    };
  }, [tab, inView, reduce]);

  return (
    <section ref={ref} id="inside" className="relative pt-16 pb-4 md:pt-24 md:pb-6">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <div className="eyebrow text-azure">Inside a room</div>
          <h2 className="mt-6 font-display text-[clamp(2.8rem,5.5vw,5rem)] font-normal">
            Four verbs. <span className="italic">One page.</span>
          </h2>
        </Reveal>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="mt-14 items-center gap-0">
          <Reveal delay={0.1}>
            <TabsList className="liquid-glass h-auto gap-1 rounded-full bg-transparent p-1.5">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="relative h-10 rounded-full border-0 px-4 text-[0.8125rem] font-medium text-muted-foreground shadow-none! transition-colors data-active:bg-transparent! data-active:text-foreground sm:px-5 dark:data-active:bg-transparent!"
                >
                  {tab === t.id && (
                    <motion.span
                      layoutId="inside-tab"
                      className="absolute inset-0 rounded-full bg-card shadow-[0_6px_20px_-8px_rgb(14_30_90/0.35),inset_0_1px_0_rgb(255_255_255/0.6)] dark:bg-foreground/10 dark:shadow-none"
                      transition={{ type: "spring", bounce: 0.15, duration: 0.55 }}
                    />
                  )}
                  <span className="relative flex items-center gap-1.5">
                    <t.icon weight="light" className="size-4" />
                    <span className="sr-only sm:not-sr-only">{t.label}</span>
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Reveal>

          {TABS.map((t) => (
            <TabsContent key={t.id} value={t.id} className="mt-12 w-full" forceMount hidden={tab !== t.id}>
              <AnimatePresence mode="wait">
                {tab === t.id && (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.7, ease: EASE_OUT_EXPO }}
                    className="bezel"
                  >
                    <div className="bezel-core grid gap-10 p-8 md:grid-cols-[1fr_1.3fr] md:items-center md:p-14">
                      <div>
                        <t.icon weight="thin" className="size-12 text-azure" />
                        <h3 className="mt-6 font-display text-[clamp(2.2rem,4vw,3.4rem)] leading-[0.95] font-normal">
                          {t.title}
                        </h3>
                        <p className="mt-5 max-w-md text-[1rem] leading-[1.75] text-muted-foreground">{t.body}</p>
                      </div>
                      <Stage id={t.id} reduceMotion={!!reduce} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}

const [abhishek, arun, mei, leo] = PEOPLE as unknown as [
  (typeof PEOPLE)[number],
  (typeof PEOPLE)[number],
  (typeof PEOPLE)[number],
  (typeof PEOPLE)[number],
];

function Stage({ id, reduceMotion }: { id: TabId; reduceMotion: boolean }) {
  return (
    <div className="relative min-h-[20rem] overflow-hidden rounded-[1.25rem] bg-[radial-gradient(90%_80%_at_80%_0%,color-mix(in_oklab,var(--azure)_12%,transparent),transparent)] p-7 ring-1 ring-(--hairline)">
      {id === "highlight" && (
        <p className="font-display text-[1.5rem] leading-[1.55] text-foreground/80">
          Packet switching let many conversations share{" "}
          <Mark color={abhishek.color} delay={0.2}>
            the same wire at once
          </Mark>
          , which is why the early network survived when{" "}
          <Mark color={arun.color} delay={0.7}>
            individual links failed
          </Mark>
          .
        </p>
      )}

      {id === "discuss" && (
        <div className="space-y-3">
          <div className="rounded-xl border-l-2 bg-foreground/4 px-4 py-2.5 font-display text-[1.1rem] italic" style={{ borderColor: abhishek.color }}>
            “the same wire at once”
          </div>
          {[
            { p: mei, t: "So this is why it scaled so fast?", d: 0.15 },
            { p: abhishek, t: "Partly. Cheap routers mattered as much.", d: 0.45 },
            { p: leo, t: "Adding the 1974 paper to our notes.", d: 0.75 },
          ].map(({ p, t, d }) => (
            <motion.div
              key={t}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: d, ease: EASE_OUT_EXPO }}
              className="flex items-start gap-3"
            >
              <Dot color={p.color} name={p.name} />
              <div>
                <div className="text-[0.75rem] font-semibold">
                  {p.name} <span className="font-normal text-muted-foreground">· now</span>
                </div>
                <div className="text-[0.875rem] text-foreground/80">{t}</div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {id === "follow" && (
        <div className="flex h-full flex-col gap-5">
          <div className="liquid-glass liquid-glass-strong flex items-center justify-between rounded-full py-1.5 pr-1.5 pl-4 text-[0.8125rem]">
            <span className="flex items-center gap-2 font-medium">
              <span className="size-2 rounded-full" style={{ backgroundColor: arun.color }} />
              Following Arun
            </span>
            <span className="rounded-full bg-foreground/6 px-3 py-1 text-[0.75rem]">Stop</span>
          </div>
          {/* The looping scroll is decoration only, so it stays still for reduced motion. */}
          <motion.div
            className="space-y-3"
            animate={reduceMotion ? undefined : { y: [0, -60, -60, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: [0.45, 0, 0.2, 1], times: [0, 0.4, 0.7, 1] }}
          >
            {[96, 88, 100, 70, 92, 84, 98, 64].map((w, i) => (
              <div key={i} className="h-2.5 rounded-full bg-foreground/8" style={{ width: `${w}%` }} />
            ))}
          </motion.div>
          <button
            type="button"
            tabIndex={-1}
            className="mt-auto self-start rounded-full bg-ink px-4 py-2 text-[0.8125rem] font-medium text-pearl dark:bg-pearl dark:text-ink"
          >
            Bring everyone here
          </button>
        </div>
      )}

      {id === "recap" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[0.75rem] text-muted-foreground">
            <SparkleIcon weight="fill" className="size-3.5 text-azure" />
            Recapped by abhishek · for 4 readers
          </div>
          <p className="font-display text-[1.4rem] leading-snug">
            The room traced how packet switching made the network resilient, and debated whether that was by design.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ["Key point", "Shared lines, many conversations."],
              ["Disagreement", "Military design vs. happy accident."],
              ["Open question", "What failed first in 1983?"],
              ["Next step", "Read the 1974 TCP paper."],
            ].map(([k, v], i) => (
              <motion.div
                key={k}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, delay: 0.15 + i * 0.1, ease: EASE_OUT_EXPO }}
                className="rounded-xl bg-foreground/4 p-3"
              >
                <div className="eyebrow text-[0.5625rem] text-azure">{k}</div>
                <div className="mt-1 text-[0.8125rem]">{v}</div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Mark({ color, delay, children }: { color: string; delay: number; children: React.ReactNode }) {
  return (
    <motion.span
      className="rounded-[4px] bg-no-repeat"
      style={{ backgroundImage: `linear-gradient(${color}40, ${color}40)` }}
      initial={{ backgroundSize: "0% 100%" }}
      animate={{ backgroundSize: "100% 100%" }}
      transition={{ duration: 1.1, delay, ease: EASE_OUT_EXPO }}
    >
      {children}
    </motion.span>
  );
}

function Dot({ color, name }: { color: string; name: string }) {
  return (
    <span
      className={cn("grid size-7 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold text-white")}
      style={{ backgroundColor: color }}
    >
      {name[0]}
    </span>
  );
}
