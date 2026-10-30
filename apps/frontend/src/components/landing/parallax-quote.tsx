"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

// Layered parallax: the quote, the hairline rings and the glow each travel at a different speed.
export function ParallaxQuote() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const k = reduce ? 0 : 1;

  const glowY = useTransform(scrollYProgress, [0, 1], [`${-30 * k}%`, `${30 * k}%`]);
  const ringsY = useTransform(scrollYProgress, [0, 1], [180 * k, -180 * k]);
  const ringsRotate = useTransform(scrollYProgress, [0, 1], [-20 * k, 25 * k]);
  const quoteY = useTransform(scrollYProgress, [0, 1], [60 * k, -60 * k]);
  const attribY = useTransform(scrollYProgress, [0, 1], [120 * k, -40 * k]);

  return (
    <section ref={ref} aria-label="A note on reading" className="relative overflow-x-clip pt-20 pb-28 md:pt-28 md:pb-40">
      <motion.div
        style={{ y: glowY }}
        className="absolute inset-x-0 top-[15%] bottom-[15%] -z-10 bg-[radial-gradient(closest-side,var(--orb-1),transparent)]"
      />
      <motion.svg
        style={{ y: ringsY, rotate: ringsRotate }}
        viewBox="0 0 600 600"
        className="absolute top-1/2 left-1/2 -z-10 size-[min(52rem,120vw)] -translate-x-1/2 -translate-y-1/2 text-foreground/10"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        aria-hidden
      >
        {[280, 230, 180, 130].map((r) => (
          <circle key={r} cx="300" cy="300" r={r} />
        ))}
        <circle cx="300" cy="300" r="230" stroke="var(--azure)" strokeDasharray="2 10" strokeOpacity="0.6" />
        <path d="M20 300h560M300 20v560" strokeDasharray="1 8" />
      </motion.svg>

      <div className="mx-auto max-w-5xl px-5 text-center md:px-8">
        <motion.blockquote
          style={{ y: quoteY }}
          className="font-display text-[clamp(2.4rem,5.6vw,5.2rem)] leading-[1.02] font-light tracking-[-0.025em]"
        >
          “Reading was never meant to be <span className="italic text-royal-gradient">a solitary act.</span> It just
          became one on the internet.”
        </motion.blockquote>
        <motion.div style={{ y: attribY }} className="eyebrow mt-10 text-muted-foreground">
          The LinkRoom manifesto
        </motion.div>
      </div>
    </section>
  );
}
