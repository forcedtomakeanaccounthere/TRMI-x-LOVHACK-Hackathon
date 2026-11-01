import Link from "next/link";
import { Logo } from "@/components/brand/logo";

// A single hairline thread that draws itself in, loops, frays and breaks off; the faint dotted line
// beyond the gap is where it should have gone. Pure SVG + CSS (globals.css thread-draw), so it plays
// on the server-rendered page with no JavaScript.
function Thread() {
  return (
    <svg viewBox="0 0 820 240" className="h-auto w-full max-w-3xl overflow-visible" fill="none" aria-hidden>
      <defs>
        <linearGradient id="thread-ink" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.18" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="0.7" stopColor="var(--azure)" stopOpacity="0.95" />
          <stop offset="1" stopColor="var(--azure)" />
        </linearGradient>
      </defs>

      {/* The thread */}
      <path
        className="animate-thread-draw"
        pathLength={1}
        d="M-20 168 C 70 172 110 70 200 82 S 300 214 380 152 C 432 112 474 92 522 118 C 566 142 548 194 504 184 C 458 174 478 112 566 104"
        stroke="url(#thread-ink)"
        strokeWidth="1.25"
        strokeLinecap="round"
      />

      {/* Frayed end */}
      <g className="animate-thread-fray" stroke="var(--azure)" strokeWidth="1" strokeLinecap="round">
        <path d="M566 104 c8 -3 15 -9 21 -16" />
        <path d="M566 104 c10 0 18 -3 26 -7" />
        <path d="M566 104 c9 3 16 4 24 3" />
      </g>
      <circle className="animate-thread-fray" cx="566" cy="104" r="2.5" fill="var(--azure)" />

      {/* Where it should have continued */}
      <path
        className="animate-thread-ghost"
        d="M640 98 C 690 92 726 124 760 118 S 812 96 840 100"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1"
        strokeDasharray="1 7"
        strokeLinecap="round"
      />
      <circle className="animate-thread-ghost" cx="760" cy="118" r="3.5" stroke="currentColor" strokeOpacity="0.35" />
    </svg>
  );
}

type Props = { eyebrow: string; title: React.ReactNode; body: string; showDemo?: boolean };

export function LostThread({ eyebrow, title, body, showDemo = true }: Props) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <div className="hairline-grid absolute inset-0 -z-20 [mask-image:radial-gradient(ellipse_65%_55%_at_50%_45%,black,transparent_75%)]" />
      <div className="animate-float-slow absolute top-[18%] left-1/2 -z-10 size-[44rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--orb-1),transparent_62%)] blur-3xl" />

      <header className="mx-auto flex w-full max-w-6xl items-center px-5 py-6 md:px-8">
        <Logo />
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-5 pb-20 text-center">
        <div className="relative w-full text-foreground">
          <Thread />
          <span
            className="animate-thread-rise pointer-events-none absolute inset-0 grid place-items-center font-display text-[clamp(6rem,20vw,13rem)] leading-none text-foreground/[0.06] select-none"
            style={{ animationDelay: "0.2s" }}
            aria-hidden
          >
            404
          </span>
        </div>

        <div className="eyebrow animate-thread-rise mt-2 text-[0.625rem] text-azure" style={{ animationDelay: "0.5s" }}>
          {eyebrow}
        </div>
        <h1
          className="animate-thread-rise mt-4 font-display text-[clamp(2.4rem,6vw,4.25rem)] font-normal text-balance"
          style={{ animationDelay: "0.6s" }}
        >
          {title}
        </h1>
        <p
          className="animate-thread-rise mt-5 max-w-[34rem] text-[1rem] leading-relaxed text-muted-foreground"
          style={{ animationDelay: "0.72s" }}
        >
          {body}
        </p>

        <div
          className="animate-thread-rise mt-9 flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "0.85s" }}
        >
          <Link
            href="/"
            className="flex h-11 items-center rounded-full bg-ink px-6 text-[0.875rem] font-medium text-pearl shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] transition active:scale-[0.98] dark:bg-pearl dark:text-ink"
          >
            Back home
          </Link>
          <Link
            href="/dashboard"
            className="liquid-glass flex h-11 items-center rounded-full px-6 text-[0.875rem] font-medium transition active:scale-[0.98]"
          >
            Your rooms
          </Link>
          {showDemo && (
            <Link
              href="/r/demo"
              className="flex h-11 items-center px-3 text-[0.875rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Try the demo room →
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
