"use client";

import { motion } from "motion/react";
import { useId, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import { applyTheme, restoreTheme, useTheme } from "@/lib/theme";

// Sun/moon morph. The switch itself is a circular reveal that grows out of the button.
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === "dark";
  const maskId = `theme-mask-${useId().replace(/:/g, "")}`;

  useLayoutEffect(restoreTheme, []);

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    const next = dark ? "light" : "dark";
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduce) {
      applyTheme(next);
      return;
    }

    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    document.startViewTransition(() => applyTheme(next)).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 700, easing: "cubic-bezier(0.32, 0.72, 0, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "relative grid size-9 place-items-center rounded-full text-foreground/80 transition-[transform,color] duration-300 ease-fluid hover:text-foreground active:scale-[0.94]",
        className,
      )}
    >
      <motion.svg
        viewBox="0 0 24 24"
        className="size-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        animate={{ rotate: dark ? 40 : 90 }}
        transition={{ type: "spring", bounce: 0, duration: 0.6 }}
      >
        <mask id={maskId}>
          <rect width="24" height="24" fill="white" />
          <motion.circle
            r="9"
            fill="black"
            initial={false}
            animate={{ cx: dark ? 17 : 30, cy: dark ? 7 : 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.6 }}
          />
        </mask>
        <motion.circle
          cx="12"
          cy="12"
          fill="currentColor"
          stroke="none"
          mask={`url(#${maskId})`}
          initial={false}
          animate={{ r: dark ? 8 : 4.5 }}
          transition={{ type: "spring", bounce: 0, duration: 0.6 }}
        />
        <motion.g
          initial={false}
          animate={{ opacity: dark ? 0 : 1, scale: dark ? 0.5 : 1 }}
          style={{ originX: "12px", originY: "12px" }}
          transition={{ type: "spring", bounce: 0, duration: 0.5 }}
        >
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <line key={deg} x1="12" y1="1.75" x2="12" y2="3.75" transform={`rotate(${deg} 12 12)`} />
          ))}
        </motion.g>
      </motion.svg>
    </button>
  );
}
