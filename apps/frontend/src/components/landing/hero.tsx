"use client";

import { motion, useInView, useReducedMotion, useScroll, useTransform } from "motion/react";
import dynamic from "next/dynamic";
import { useRef } from "react";
import { EASE_OUT_EXPO, SplitReveal } from "@/components/fx/reveal";
import { useTheme } from "@/lib/theme";
import { DemoModal, DemoTrigger } from "./demo-modal";
import { HeroLinkForm } from "./hero-link-form";
import { Avatars, RoomPreview } from "./room-preview";

// WebGL never renders on the server; the rings fade in once the canvas is ready.
const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false });

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { margin: "100px 0px" });
  const dark = useTheme() === "dark";
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });

  // Parallax: each layer leaves at its own speed.
  const sceneY = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "38%"]);
  const cardY = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "-18%"]);
  const copyY = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "22%"]);
  const fade = useTransform(scrollYProgress, [0, 0.75], [1, 0]);

  return (
    <section ref={ref} id="hero" className="relative isolate min-h-dvh overflow-hidden pt-32 pb-20 md:pt-40">
      {/* Atmosphere: hairline grid fading out from the centre, and slow blue orbs. */}
      <div className="hairline-grid absolute inset-0 -z-20 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_35%,black,transparent_75%)]" />
      <div className="animate-float-slow absolute -top-40 -left-40 -z-10 size-[42rem] rounded-full bg-[radial-gradient(circle,var(--orb-1),transparent_62%)] blur-3xl" />
      <div className="animate-float-slow absolute top-1/3 -right-48 -z-10 size-[38rem] rounded-full bg-[radial-gradient(circle,var(--orb-2),transparent_62%)] blur-3xl [animation-delay:-4s]" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-background" />

      <div className="mx-auto grid max-w-7xl items-center gap-16 px-5 md:px-8 lg:grid-cols-[1.08fr_1fr] lg:gap-10">
        <motion.div style={{ y: copyY, opacity: fade }}>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: EASE_OUT_EXPO }}
            className="liquid-glass inline-flex items-center gap-2.5 rounded-full py-1.5 pr-4 pl-1.5"
          >
            <span className="rounded-full bg-ink px-2.5 py-1 text-[0.625rem] font-semibold tracking-[0.08em] text-pearl uppercase dark:bg-pearl dark:text-ink">
              New
            </span>
            <span className="eyebrow text-[0.625rem] text-foreground/70">
              Multiplayer everything<span className="hidden sm:inline"> · MMXXVI</span>
            </span>
          </motion.div>

          <h1 className="mt-8 font-display text-[clamp(3.6rem,8.4vw,7.75rem)] font-normal">
            <SplitReveal text="Every link," className="block" delay={0.15} />
            <SplitReveal
              text="read together."
              className="block"
              delay={0.35}
              wordClassName={(_, i) => (i === 1 ? "italic text-royal-gradient" : undefined)}
            />
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1.2, delay: 0.7, ease: EASE_OUT_EXPO }}
            className="mt-7 max-w-[34rem] text-[1.0625rem] leading-[1.7] text-muted-foreground md:text-[1.1875rem]"
          >
            LinkRoom turns any article or PDF into a live room. Share one link, then highlight, comment and
            follow each other as you read, and finish with an AI recap of what the group cared about.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 0.85, ease: EASE_OUT_EXPO }}
            className="mt-10 max-w-[38rem]"
          >
            <HeroLinkForm />
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2, delay: 1.1 }}
            className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-5"
          >
            <DemoModal trigger={<DemoTrigger />} />
            <div className="flex items-center gap-3">
              <Avatars />
              <div className="text-[0.8125rem] leading-tight">
                <div className="flex items-center gap-1.5 font-medium">
                  <span className="relative flex size-2">
                    <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60" />
                    <span className="relative size-2 rounded-full bg-emerald-500" />
                  </span>
                  4 reading now
                </div>
                <div className="text-muted-foreground">Wikipedia · Internet</div>
              </div>
            </div>
          </motion.div>
        </motion.div>

        <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
          <motion.div
            style={{ y: sceneY }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.8, delay: 0.3, ease: EASE_OUT_EXPO }}
            className="absolute -inset-x-16 -top-24 -bottom-10 -z-10 md:-inset-x-24"
            aria-hidden
          >
            <HeroScene still={!!reduce} active={inView} dark={dark} />
          </motion.div>
          <motion.div
            style={{ y: cardY, transformPerspective: 1400 }}
            initial={{ opacity: 0, rotateX: 18, rotateY: -14 }}
            animate={{ opacity: 1, rotateX: 6, rotateY: -8 }}
            transition={{ duration: 1.6, delay: 0.55, ease: EASE_OUT_EXPO }}
            className="relative mt-24 lg:mt-40"
          >
            <RoomPreview className="mx-auto max-w-[30rem]" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
