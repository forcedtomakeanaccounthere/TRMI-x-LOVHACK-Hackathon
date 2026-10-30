"use client";

import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Reveal } from "@/components/fx/reveal";
import { USE_CASES } from "./content";

// Horizontal scroll: the section pins, and vertical scroll drives the track sideways.
export function UseCases() {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const measure = () => {
      if (!track.current) return;
      setDistance(Math.max(0, track.current.scrollWidth - window.innerWidth));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (track.current) ro.observe(track.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });
  const raw = useTransform(scrollYProgress, [0, 1], [0, -distance]);
  const x = useSpring(raw, { stiffness: 120, damping: 30, mass: 0.3 });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });

  return (
    <section
      ref={section}
      id="use-cases"
      className={reduce ? "relative" : "relative -mb-[8vh]"}
      style={{ height: reduce ? "auto" : `calc(100dvh + ${distance}px)` }}
    >
      <div className={reduce ? "py-28" : "sticky top-0 flex h-dvh flex-col justify-center overflow-hidden"}>
        <div className="mx-auto mb-12 flex w-full max-w-7xl items-end justify-between gap-6 px-5 md:px-8">
          <Reveal>
            <div className="eyebrow text-azure">Made for</div>
            <h2 className="mt-5 font-display text-[clamp(2.6rem,5vw,4.6rem)] font-normal">
              Every kind of <span className="italic">reading circle.</span>
            </h2>
          </Reveal>
          <div className="hidden w-48 md:block" aria-hidden>
            <div className="h-px w-full bg-foreground/15">
              <motion.div style={{ scaleX: progress }} className="h-px origin-left bg-azure" />
            </div>
          </div>
        </div>

        <motion.div
          ref={track}
          style={reduce ? undefined : { x }}
          className={
            reduce
              ? "flex snap-x gap-5 overflow-x-auto px-5 pb-4 md:px-8"
              : "flex w-max gap-5 pr-[8vw] pl-5 will-change-transform md:pl-[max(2rem,calc((100vw-80rem)/2+2rem))]"
          }
        >
          {USE_CASES.map((u, i) => (
            <article
              key={u.title}
              className="bezel w-[82vw] shrink-0 snap-start sm:w-[26rem] md:w-[30rem]"
            >
              <div className="bezel-core flex h-[24rem] flex-col p-8 md:h-[27rem] md:p-10">
                <div className="flex items-center justify-between">
                  <u.icon weight="thin" className="size-12 text-azure" />
                  <span className="font-regal text-[0.875rem] text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="eyebrow mt-auto text-muted-foreground">{u.kicker}</div>
                <h3 className="mt-3 font-display text-[2.6rem] leading-none font-normal">{u.title}</h3>
                <p className="mt-4 text-[0.9375rem] leading-[1.7] text-muted-foreground">{u.body}</p>
                <div className="mt-6 flex items-center gap-2 border-t border-(--hairline) pt-5 text-[0.8125rem]">
                  <span className="size-1.5 rounded-full bg-azure" />
                  <span className="text-muted-foreground">Room:</span>
                  <span className="truncate font-display text-[1.05rem] italic">{u.sample}</span>
                </div>
              </div>
            </article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
