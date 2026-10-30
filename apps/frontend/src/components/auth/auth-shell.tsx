"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { LogoMark } from "@/components/brand/logo";
import { EASE_OUT_EXPO } from "@/components/fx/reveal";
import { Avatars } from "@/components/landing/room-preview";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

// Symmetric ease for the panel swap: a fast-start curve reads as a jump when the first frames land late.
const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

const COPY = {
  login: {
    crumb: "Sign in",
    eyebrow: "The reading room",
    title: (
      <>
        Your rooms are <span className="italic">waiting.</span>
      </>
    ),
    quote: "We read the whole paper as a group the night before the exam. It felt like sitting at one table.",
    by: "abhishek, study group of four",
  },
  signup: {
    crumb: "Create account",
    eyebrow: "Multiplayer everything",
    title: (
      <>
        Every link, <span className="italic">read together.</span>
      </>
    ),
    quote: "We stopped sending screenshots of paragraphs. Now we just send the room.",
    by: "Arun, product team",
  },
};

// Asymmetric split: an atmospheric brand panel and the form. Sign in keeps the brand panel on the
// left; create account swaps the two, and moving between the pages slides them past each other.
export function AuthShell({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const pathname = usePathname();
  const mode = pathname.startsWith("/signup") ? "signup" : "login";
  const swapped = mode === "signup";
  const copy = COPY[mode];
  const swap = { layout: "position" as const, transition: { duration: reduce ? 0 : 0.9, ease: EASE_IN_OUT } };
  const router = useRouter();

  // Warm the other page so the slide starts the moment the link is clicked.
  useEffect(() => {
    router.prefetch(swapped ? "/login" : "/signup");
  }, [router, swapped]);

  return (
    <div className="grid min-h-dvh overflow-x-clip lg:grid-cols-2">
      <motion.aside
        {...swap}
        className={cn(
          "relative z-10 hidden overflow-hidden p-10 text-pearl will-change-transform lg:flex lg:flex-col xl:p-14",
          swapped && "lg:order-2",
        )}
        style={{ background: "var(--ink-tile)" }}
      >
        {/* Decoration mirrors so the rings always lean towards the form side. */}
        <div
          aria-hidden
          className={cn("absolute inset-0 transition-transform duration-900 ease-in-out", swapped && "-scale-x-100")}
        >
          <div className="hairline-grid absolute inset-0 opacity-50 [--hairline:rgb(255_255_255/0.05)] [mask-image:radial-gradient(ellipse_70%_60%_at_40%_40%,black,transparent)]" />
          <div className="animate-float-slow absolute -right-40 -bottom-48 size-[44rem] rounded-full bg-[radial-gradient(circle,rgb(47_91_255/0.45),transparent_68%)]" />
          <motion.svg
            viewBox="0 0 400 400"
            className="absolute top-1/2 -right-24 size-[34rem] -translate-y-1/2 text-pearl/15"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
            animate={reduce ? undefined : { rotate: 360 }}
            transition={{ duration: 120, repeat: Infinity, ease: "linear" }}
          >
            <circle cx="160" cy="200" r="120" />
            <circle cx="240" cy="200" r="120" stroke="rgb(109 143 255 / 0.7)" />
            <circle cx="200" cy="200" r="190" strokeDasharray="1 7" />
          </motion.svg>
        </div>

        <Link href="/" className="relative flex items-center gap-2.5" aria-label="LinkRoom home">
          <LogoMark className="size-8 text-pearl" />
          <span className="font-display text-[1.6rem] leading-none font-medium">
            Link<span className="italic">Room</span>
          </span>
        </Link>

        <div className="relative mt-auto max-w-xl">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
            >
              <div className="eyebrow text-pearl/55">{copy.eyebrow}</div>
              <h2 className="mt-6 font-display text-[clamp(3rem,4.6vw,4.8rem)] font-normal">{copy.title}</h2>

              <figure className="mt-14 rounded-[1.75rem] bg-pearl/8 p-7 ring-1 ring-pearl/10">
                <blockquote className="font-display text-[1.45rem] leading-snug text-pearl/90 italic">
                  “{copy.quote}”
                </blockquote>
                <figcaption className="mt-5 flex items-center justify-between gap-4">
                  <span className="text-[0.8125rem] text-pearl/60">{copy.by}</span>
                  <Avatars size="sm" className="[&>span]:ring-[#0b1230]" />
                </figcaption>
              </figure>
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.aside>

      <motion.main {...swap} className="relative flex flex-col px-5 py-6 will-change-transform sm:px-10 lg:px-14 xl:px-20">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_100%_0%,var(--orb-2),transparent_70%)] opacity-60 lg:opacity-40" />
        <header className="flex items-center justify-between">
          <Breadcrumb>
            <BreadcrumbList className="text-[0.8125rem]">
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/" className="flex items-center gap-1.5">
                    <LogoMark className="size-5 lg:hidden" />
                    Home
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/#hero">Account</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="font-medium">{copy.crumb}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <ThemeToggle />
        </header>

        <div className="flex flex-1 items-center justify-center py-14">
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE_OUT_EXPO, delay: 0.3 }}
            className="w-full max-w-[25rem]"
          >
            {children}
          </motion.div>
        </div>

        <footer className="text-center text-[0.75rem] text-muted-foreground lg:text-left">
          Guests never need an account. You only sign in to create rooms.
        </footer>
      </motion.main>
    </div>
  );
}
