"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { useEffect, useState } from "react";

export const EASE_FLUID = [0.32, 0.72, 0, 1] as const;
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

type RevealProps = HTMLMotionProps<"div"> & { delay?: number; y?: number };

// Heavy fade-up with a blur that resolves as the element enters the viewport.
export function Reveal({ delay = 0, y = 40, children, ...props }: RevealProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y, filter: "blur(10px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 1.1, delay, ease: EASE_OUT_EXPO }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// True once the page's web fonts have loaded (or after a short wait), so a reveal doesn't start in
// the fallback font and jump when the real one swaps in halfway through.
export function useFontsReady(maxWaitMs = 900) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      // The frame after, so the swap has been painted before anything moves.
      requestAnimationFrame(() => setReady(true));
    };
    const timer = setTimeout(go, maxWaitMs);
    void document.fonts?.ready.then(go);
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [maxWaitMs]);
  return ready;
}

type SplitRevealProps = {
  text: string;
  className?: string;
  wordClassName?: (word: string, index: number) => string | undefined;
  delay?: number;
  stagger?: number;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  // Plays on load (once fonts are in) instead of when scrolled into view: for text above the fold.
  immediate?: boolean;
};

// Words rise out of a clipped line one after another (masked reveal).
export function SplitReveal({
  text,
  className,
  wordClassName,
  delay = 0,
  stagger = 0.06,
  as = "span",
  immediate = false,
}: SplitRevealProps) {
  const reduce = useReducedMotion();
  const fontsReady = useFontsReady();
  const Tag = motion[as];
  const words = text.split(" ");

  return (
    <Tag
      className={className}
      initial="hidden"
      {...(immediate
        ? { animate: fontsReady ? "show" : "hidden" }
        : { whileInView: "show", viewport: { once: true, margin: "0px 0px -10% 0px" } })}
      transition={{ staggerChildren: stagger, delayChildren: delay }}
      aria-label={text}
    >
      {words.map((word, i) => (
        // The mask is padded (and pulled back with negative margins) so descenders and italic overhangs aren't clipped.
        <span
          key={i}
          aria-hidden
          className="-mr-[0.12em] -mb-[0.22em] inline-block overflow-hidden pr-[0.12em] pb-[0.36em] align-bottom"
        >
          <motion.span
            className={`inline-block will-change-transform ${wordClassName?.(word, i) ?? ""}`}
            variants={{
              hidden: reduce ? { opacity: 0 } : { y: "110%", rotate: 4, opacity: 0 },
              show: { y: "0%", rotate: 0, opacity: 1, transition: { duration: 1.2, ease: EASE_OUT_EXPO } },
            }}
          >
            {word}
          </motion.span>
          {i < words.length - 1 && " "}
        </span>
      ))}
    </Tag>
  );
}
