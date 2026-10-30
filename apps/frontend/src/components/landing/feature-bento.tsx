"use client";

import {
  ChatsCircleIcon,
  CrosshairIcon,
  FilePdfIcon,
  HighlighterIcon,
  QrCodeIcon,
  SparkleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { Reveal, SplitReveal } from "@/components/fx/reveal";
import { cn } from "@/lib/utils";
import { PEOPLE } from "./content";
import { FakeCursor } from "./fake-cursor";

// Asymmetric bento: one hero tile, then mixed spans. Collapses to one column on mobile.
export function FeatureBento() {
  return (
    <section id="features" className="relative py-28 md:py-40">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="grid items-end gap-8 md:grid-cols-[1.2fr_1fr]">
          <div>
            <Reveal>
              <div className="eyebrow text-azure">The room</div>
            </Reveal>
            <SplitReveal
              as="h2"
              text="Everything a group needs to read well."
              className="mt-6 block font-display text-[clamp(2.8rem,5.5vw,5rem)] font-normal"
              wordClassName={(w) => (w === "together" || w === "well." ? "italic text-royal-gradient pr-[0.06em]" : undefined)}
            />
          </div>
          <Reveal delay={0.2}>
            <p className="max-w-md text-[1.0625rem] leading-[1.75] text-muted-foreground md:ml-auto">
              The page stays calm and readable. The colour comes from the people in it: every reader gets one
              colour for their cursor, avatar and highlights.
            </p>
          </Reveal>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-12 md:grid-rows-[repeat(3,minmax(15rem,auto))]">
          <Tile className="md:col-span-8 md:row-span-2" delay={0}>
            <CursorsArt />
            <TileText icon={CrosshairIcon} title="Live cursors and follow mode">
              See where everyone is reading. Click an avatar to ride along with their scroll, or bring the whole
              room to your paragraph.
            </TileText>
          </Tile>

          <Tile className="md:col-span-4" delay={0.08}>
            <HighlightArt />
            <TileText icon={HighlighterIcon} title="Shared highlights">
              Select any line. It glows in your colour on every screen.
            </TileText>
          </Tile>

          <Tile className="md:col-span-4" delay={0.16}>
            <ThreadArt />
            <TileText icon={ChatsCircleIcon} title="Threads in the margin">
              Every highlight can start a conversation.
            </TileText>
          </Tile>

          <Tile className="md:col-span-6" dark delay={0.08}>
            <RecapArt />
            <TileText icon={SparkleIcon} title="One recap, on every screen" dark>
              Claude reads what the group highlighted and argued about, and the summary arrives for everyone at once.
            </TileText>
          </Tile>

          <Tile className="md:col-span-3" delay={0.16}>
            <div className="flex flex-1 items-center justify-center py-6">
              <div className="rounded-2xl bg-pearl p-3 shadow-[0_20px_40px_-20px_rgb(14_30_90/0.4)]">
                <QRCodeSVG value="https://linkroom.app/r/x7Kp2qLm" size={104} fgColor="#05070d" bgColor="#ffffff" />
              </div>
            </div>
            <TileText icon={QrCodeIcon} title="Join from a phone">
              Scan, type a name, you&apos;re in.
            </TileText>
          </Tile>

          <Tile className="md:col-span-3" delay={0.24}>
            <PdfArt />
            <TileText icon={FilePdfIcon} title="PDFs too">
              Papers, slides and notes, page by page.
            </TileText>
          </Tile>
        </div>
      </div>
    </section>
  );
}

function Tile({
  className,
  children,
  dark,
  delay,
}: {
  className?: string;
  children: React.ReactNode;
  dark?: boolean;
  delay?: number;
}) {
  const mx = useMotionValue(-400);
  const my = useMotionValue(-400);
  const reduce = useReducedMotion();
  const spotlight = useMotionTemplate`radial-gradient(420px circle at ${mx}px ${my}px, color-mix(in oklab, var(--azure) 14%, transparent), transparent 70%)`;

  return (
    <Reveal delay={delay} className={cn("bezel group", className)}>
      <div
        onPointerMove={(e) => {
          if (reduce) return;
          const r = e.currentTarget.getBoundingClientRect();
          mx.set(e.clientX - r.left);
          my.set(e.clientY - r.top);
        }}
        onPointerLeave={() => {
          mx.set(-400);
          my.set(-400);
        }}
        className={cn(
          "bezel-core relative flex h-full flex-col overflow-hidden p-7 md:p-8",
          dark && "text-pearl",
        )}
        style={dark ? { background: "var(--ink-tile)" } : undefined}
      >
        <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: spotlight }} />
        {children}
      </div>
    </Reveal>
  );
}

function TileText({
  icon: Icon,
  title,
  children,
  dark,
}: {
  icon: Icon;
  title: string;
  children?: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div className="relative mt-auto">
      <div className="flex items-center gap-2.5">
        <Icon weight="light" className="size-5 text-azure" />
        <h3 className="font-display text-[1.65rem] leading-tight font-medium">{title}</h3>
      </div>
      {children && (
        <p className={cn("mt-2 max-w-md text-[0.9375rem] leading-relaxed", dark ? "text-pearl/60" : "text-muted-foreground")}>
          {children}
        </p>
      )}
    </div>
  );
}

function CursorsArt() {
  const [a, b, c] = PEOPLE as [(typeof PEOPLE)[number], (typeof PEOPLE)[number], (typeof PEOPLE)[number]];
  return (
    <div className="relative mb-8 min-h-[16rem] flex-1 overflow-hidden rounded-[1.25rem] bg-[radial-gradient(80%_90%_at_30%_10%,color-mix(in_oklab,var(--azure)_10%,transparent),transparent)] ring-1 ring-(--hairline)">
      <div className="absolute inset-x-8 top-8 space-y-3.5">
        <div className="h-5 w-1/2 rounded-md bg-foreground/10" />
        {[100, 94, 98, 72, 0, 96, 88, 60].map((w, i) =>
          w ? <div key={i} className="h-2.5 rounded-full bg-foreground/6" style={{ width: `${w}%` }} /> : <div key={i} className="h-2" />,
        )}
      </div>
      <FakeCursor name={a.name} color={a.color} path={{ x: ["12%", "60%", "35%"], y: ["20%", "48%", "70%"] }} duration={8} />
      <FakeCursor name={b.name} color={b.color} path={{ x: ["70%", "25%", "55%"], y: ["65%", "30%", "18%"] }} duration={10} delay={0.4} />
      <FakeCursor name={c.name} color={c.color} path={{ x: ["45%", "80%", "18%"], y: ["80%", "22%", "55%"] }} duration={11} delay={0.8} />
      <div className="liquid-glass liquid-glass-strong absolute bottom-4 left-4 flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[0.75rem] font-medium">
        <span className="size-2 rounded-full" style={{ backgroundColor: a.color }} />
        Following abhishek
        <span className="text-muted-foreground">· Stop</span>
      </div>
    </div>
  );
}

function PdfArt() {
  return (
    <div className="relative flex min-h-40 flex-1 items-center justify-center" aria-hidden>
      {[-8, 0, 8].map((rot, i) => (
        <motion.div
          key={rot}
          initial={{ rotate: 0, y: 10, opacity: 0 }}
          whileInView={{ rotate: rot, y: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1, delay: 0.2 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="absolute h-28 w-22 rounded-lg bg-card p-3 shadow-[0_12px_30px_-12px_rgb(14_30_90/0.35)] ring-1 ring-(--hairline)"
        >
          <div className="h-1.5 w-3/4 rounded-full bg-foreground/15" />
          <div className="mt-2 space-y-1.5">
            {[100, 90, 96, 70].map((w) => (
              <div key={w} className="h-1 rounded-full bg-foreground/8" style={{ width: `${w}%` }} />
            ))}
          </div>
          {i === 2 && <div className="mt-2 h-2 w-2/3 rounded-sm bg-azure/25" />}
        </motion.div>
      ))}
    </div>
  );
}

function HighlightArt() {
  return (
    <p className="mb-8 font-display text-[1.45rem] leading-snug text-foreground/80">
      “Reading is{" "}
      <motion.span
        className="rounded-[4px] bg-[linear-gradient(transparent_8%,rgb(59_130_246/0.28)_8%,rgb(59_130_246/0.28)_92%,transparent_92%)] bg-no-repeat"
        initial={{ backgroundSize: "0% 100%" }}
        whileInView={{ backgroundSize: "100% 100%" }}
        viewport={{ once: true, margin: "-20%" }}
        transition={{ duration: 1.4, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        better with company
      </motion.span>
      .”
    </p>
  );
}

function ThreadArt() {
  const [a, b] = PEOPLE as [(typeof PEOPLE)[number], (typeof PEOPLE)[number]];
  return (
    <div className="mb-8 space-y-2">
      {[
        { p: a, t: "Is this claim sourced?" },
        { p: b, t: "Footnote 14 — it's the 2019 study." },
      ].map(({ p, t }, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.3 + i * 0.25, ease: [0.16, 1, 0.3, 1] }}
          className={cn("flex items-start gap-2.5", i === 1 && "pl-6")}
        >
          <span
            className="grid size-6 shrink-0 place-items-center rounded-full text-[0.625rem] font-semibold text-white"
            style={{ backgroundColor: p.color }}
          >
            {p.name[0]}
          </span>
          <span className="rounded-2xl rounded-tl-sm bg-foreground/5 px-3 py-1.5 text-[0.8125rem]">{t}</span>
        </motion.div>
      ))}
    </div>
  );
}

function RecapArt() {
  return (
    <div className="relative mb-8 rounded-[1.25rem] bg-pearl/5 p-5 ring-1 ring-pearl/10">
      <div className="eyebrow text-[0.5625rem] text-pearl/50">Group recap</div>
      <p className="mt-3 font-display text-[1.35rem] leading-snug">
        The group agreed the Internet and the Web are different layers, but split on who governs it.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {["3 key points", "1 disagreement", "2 open questions"].map((t) => (
          <span key={t} className="rounded-full bg-pearl/8 px-3 py-1 text-[0.75rem] text-pearl/75 ring-1 ring-pearl/10">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
