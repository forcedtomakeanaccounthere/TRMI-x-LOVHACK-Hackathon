"use client";

import { PillButton } from "@/components/fx/pill-button";
import { Reveal, SplitReveal } from "@/components/fx/reveal";
import { useSession } from "@/lib/session";
import { DemoModal, DemoTrigger } from "./demo-modal";

export function FinalCta() {
  const session = useSession();
  return (
    <section className="relative px-4 pb-10 md:px-6">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2.5rem] px-6 py-24 text-center text-pearl md:py-36" style={{ background: "var(--ink-tile)" }}>
        <div className="hairline-grid absolute inset-0 opacity-40 [--hairline:rgb(255_255_255/0.06)] [mask-image:radial-gradient(ellipse_60%_70%_at_50%_40%,black,transparent)]" />
        <div className="animate-float-slow absolute -bottom-40 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(47_91_255/0.55),transparent_65%)] blur-3xl" />

        <div className="relative">
          <Reveal>
            <div className="eyebrow text-pearl/60">Any link · Any PDF</div>
          </Reveal>
          <SplitReveal
            as="h2"
            text="Make your next read multiplayer."
            className="mx-auto mt-6 block max-w-4xl font-display text-[clamp(3rem,7vw,6.5rem)] font-normal"
            wordClassName={(w) => (w === "multiplayer." ? "italic pr-[0.06em]" : undefined)}
          />
          <Reveal delay={0.3} className="mt-12 flex flex-wrap items-center justify-center gap-6">
            <PillButton
              href={session ? "#hero" : "/signup"}
              className="bg-pearl text-ink shadow-[0_10px_40px_-10px_rgb(47_91_255/0.8)] dark:bg-pearl dark:text-ink"
            >
              {session ? "Open a new room" : "Create your first room"}
            </PillButton>
            <div className="text-pearl [&_button]:text-pearl/80 [&_button:hover]:text-pearl">
              <DemoModal trigger={<DemoTrigger />} />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
