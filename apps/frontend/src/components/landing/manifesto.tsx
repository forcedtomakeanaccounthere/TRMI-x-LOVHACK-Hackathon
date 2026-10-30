"use client";

import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { useRef } from "react";

const TEXT =
  "The internet is single-player. We share a link, everyone reads it alone, and the conversation happens somewhere else, in screenshots and “which paragraph?” messages. LinkRoom puts the people back on the page.";

// Emphasised words light up in the accent colour instead of the foreground.
const ACCENT = new Set(["single-player.", "people", "page."]);

// Text reveal on scroll: the section pins while each word brightens in reading order.
export function Manifesto() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const words = TEXT.split(" ");

  return (
    <section ref={ref} aria-label="Why LinkRoom" className="relative -mb-[14vh] h-[260vh]">
      <div className="sticky top-0 flex min-h-dvh items-center">
        <div className="mx-auto max-w-6xl px-5 md:px-8">
          <div className="eyebrow mb-10 text-azure">The problem</div>
          <p className="font-display text-[clamp(2.2rem,5.2vw,4.6rem)] leading-[1.06] font-normal tracking-[-0.02em]">
            {words.map((word, i) => {
              const start = i / words.length;
              return (
                <Word
                  key={i}
                  progress={scrollYProgress}
                  range={[start * 0.85, start * 0.85 + 0.12]}
                  accent={ACCENT.has(word)}
                >
                  {word}
                </Word>
              );
            })}
          </p>
        </div>
      </div>
    </section>
  );
}

function Word({
  children,
  progress,
  range,
  accent,
}: {
  children: string;
  progress: MotionValue<number>;
  range: [number, number];
  accent: boolean;
}) {
  const opacity = useTransform(progress, range, [0.12, 1]);
  return (
    <span className="relative mr-[0.24em] inline-block">
      <motion.span style={{ opacity }} className={accent ? "italic text-royal-gradient" : undefined}>
        {children}
      </motion.span>
    </span>
  );
}
