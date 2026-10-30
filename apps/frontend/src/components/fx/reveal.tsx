"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";

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

type SplitRevealProps = {
  text: string;
  className?: string;
  wordClassName?: (word: string, index: number) => string | undefined;
  delay?: number;
  stagger?: number;
  as?: "h1" | "h2" | "h3" | "p" | "span";
};

// Words rise out of a clipped line one after another (masked reveal).
export function SplitReveal({
  text,
  className,
  wordClassName,
  delay = 0,
  stagger = 0.06,
  as = "span",
}: SplitRevealProps) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  const words = text.split(" ");

  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
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
            className={`inline-block ${wordClassName?.(word, i) ?? ""}`}
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
