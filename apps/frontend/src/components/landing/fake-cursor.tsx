"use client";

import { motion, useReducedMotion } from "motion/react";

type Props = {
  name: string;
  color: string;
  path: { x: string[]; y: string[] };
  duration?: number;
  delay?: number;
};

// A teammate's cursor drifting along a looping path, with a name tag in their colour.
// The layer fills its container, so translate percentages are percentages of the container.
export function FakeCursor({ name, color, path, duration = 9, delay = 0 }: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-20 will-change-transform"
      initial={{ x: path.x[0], y: path.y[0] }}
      animate={reduce ? undefined : { x: path.x, y: path.y }}
      transition={{ duration, delay, repeat: Infinity, ease: [0.45, 0, 0.2, 1], repeatType: "mirror" }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow-[0_2px_4px_rgb(0_0_0/0.25)]">
        <path d="M2 1.5 15.5 7.8 9.2 9.4 6.6 15.8Z" fill={color} stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <span
        className="ml-3.5 -mt-0.5 inline-block rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold text-white shadow-[0_4px_12px_-4px_rgb(0_0_0/0.35)]"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </motion.div>
  );
}
