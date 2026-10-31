"use client";

import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { EASE_OUT_EXPO, Reveal } from "@/components/fx/reveal";
import { STEPS } from "./content";

// Sticky section: the numeral column pins while the steps scroll past it.
export function HowItWorks() {
  const [active, setActive] = useState(0);
  const step = STEPS[active]!;

  return (
    <section id="how" className="relative pt-16 pb-12 md:pt-20 md:pb-16">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 md:grid-cols-[0.9fr_1.1fr] md:gap-20 md:px-8">
        <div className="md:sticky md:top-32 md:h-[calc(100dvh-10rem)]">
          <Reveal>
            <div className="eyebrow text-azure">How it works</div>
            <h2 className="mt-6 font-display text-[clamp(2.8rem,5.5vw,5rem)] font-normal">
              Three steps.
              <br />
              <span className="italic text-muted-foreground">No onboarding.</span>
            </h2>
          </Reveal>

          <div className="relative mt-14 hidden h-[16rem] md:block" aria-hidden>
            <AnimatePresence mode="popLayout">
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 60, filter: "blur(12px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -60, filter: "blur(12px)" }}
                transition={{ duration: 0.9, ease: EASE_OUT_EXPO }}
                className="absolute font-regal text-[14rem] leading-none font-normal text-royal-gradient"
              >
                {step.n}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-6 hidden gap-2 md:flex" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={s.n}
                className="h-px flex-1 origin-left bg-foreground/15 transition-[background-color] duration-700"
                style={{ backgroundColor: i <= active ? "var(--azure)" : undefined }}
              />
            ))}
          </div>
        </div>

        <ol className="flex flex-col">
          {STEPS.map((s, i) => (
            <StepCard key={s.n} index={i} onActive={setActive} {...s} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function StepCard({
  index,
  n,
  title,
  body,
  onActive,
}: (typeof STEPS)[number] & { index: number; onActive: (i: number) => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { margin: "-45% 0px -45% 0px" });

  useEffect(() => {
    if (inView) onActive(index);
  }, [inView, index, onActive]);

  return (
    <li ref={ref} className="flex items-center py-6 first:pt-0 md:min-h-[78vh] md:last:min-h-[60vh]">
      <Reveal className="bezel w-full">
        <div className="bezel-core p-8 md:p-12">
          <div className="flex items-baseline justify-between">
            <span className="font-regal text-[1.75rem] text-azure">{n}</span>
            <span className="font-mono text-[0.75rem] text-muted-foreground">0{index + 1} / 03</span>
          </div>
          <h3 className="mt-10 font-display text-[clamp(2.2rem,4vw,3.4rem)] leading-[0.95] font-normal">{title}</h3>
          <p className="mt-5 max-w-md text-[1rem] leading-[1.75] text-muted-foreground">{body}</p>
          <StepArt index={index} />
        </div>
      </Reveal>
    </li>
  );
}

// Hairline illustrations, one per step.
function StepArt({ index }: { index: number }) {
  const stroke = "currentColor";
  const common = {
    fill: "none",
    stroke,
    strokeWidth: 1,
    vectorEffect: "non-scaling-stroke" as const,
  };
  return (
    <motion.svg
      viewBox="0 0 320 120"
      className="mt-10 h-28 w-full text-foreground/35"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-20%" }}
    >
      {index === 0 && (
        <>
          <motion.rect x="10" y="40" width="240" height="40" rx="20" {...common} variants={draw} />
          <motion.path d="M30 60h120" {...common} strokeDasharray="2 6" variants={draw} />
          <motion.circle cx="230" cy="60" r="12" {...common} stroke="var(--azure)" variants={draw} />
          <motion.path d="M225 60h10m-4-4 4 4-4 4" {...common} stroke="var(--azure)" variants={draw} />
          <motion.path d="M260 60c20 0 30-30 50-30" {...common} variants={draw} />
        </>
      )}
      {index === 1 && (
        <>
          <motion.circle cx="160" cy="60" r="22" {...common} stroke="var(--azure)" variants={draw} />
          {[40, 100, 220, 280].map((x, i) => (
            <motion.g key={x}>
              <motion.circle cx={x} cy={i % 2 ? 30 : 90} r="10" {...common} variants={draw} />
              <motion.path d={`M${x} ${i % 2 ? 30 : 90}L160 60`} {...common} strokeDasharray="3 5" variants={draw} />
            </motion.g>
          ))}
        </>
      )}
      {index === 2 && (
        <>
          {[0, 1, 2, 3].map((i) => (
            <motion.path key={i} d={`M10 ${24 + i * 22}h${i === 1 ? 300 : 260 - i * 30}`} {...common} variants={draw} />
          ))}
          <motion.rect x="70" y="38" width="150" height="16" rx="3" fill="var(--azure)" fillOpacity="0.16" stroke="none" variants={draw} />
          <motion.path d="M236 92 250 64l6 14 12-4Z" {...common} stroke="var(--azure)" variants={draw} />
        </>
      )}
    </motion.svg>
  );
}

const draw = {
  hidden: { pathLength: 0, opacity: 0 },
  show: (i = 0) => ({
    pathLength: 1,
    opacity: 1,
    transition: { pathLength: { duration: 1.6, ease: EASE_OUT_EXPO, delay: 0.2 + i * 0.1 }, opacity: { duration: 0.3 } },
  }),
};
