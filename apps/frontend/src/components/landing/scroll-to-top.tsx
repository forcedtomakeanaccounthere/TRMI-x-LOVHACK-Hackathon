"use client";

import { ArrowUpIcon } from "@phosphor-icons/react";
import { useLenis } from "lenis/react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { EASE_OUT_EXPO } from "@/components/fx/reveal";

// Floating glass button that appears once the visitor has scrolled past the hero.
export function ScrollToTop() {
  const [show, setShow] = useState(false);
  const lenis = useLenis();
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setShow(y > window.innerHeight * 0.9));

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          aria-label="Scroll to top"
          onClick={() => (lenis ? lenis.scrollTo(0, { duration: 1.4 }) : window.scrollTo({ top: 0, behavior: "smooth" }))}
          initial={{ opacity: 0, y: 16, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.85 }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
          className="liquid-glass liquid-glass-strong group fixed right-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] z-40 grid size-12 place-items-center rounded-full md:right-8 md:bottom-8"
        >
          <ArrowUpIcon
            weight="light"
            className="size-5 transition-transform duration-500 ease-fluid group-hover:-translate-y-0.5"
          />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
