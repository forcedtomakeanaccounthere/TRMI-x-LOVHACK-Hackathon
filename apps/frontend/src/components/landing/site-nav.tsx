"use client";

import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useLenis } from "lenis/react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { EASE_OUT_EXPO } from "@/components/fx/reveal";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { signOut, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { FEATURES, USE_CASES } from "./content";

const triggerClass =
  "h-9 rounded-full bg-transparent px-3.5 text-[0.8125rem] font-medium tracking-[-0.005em] text-foreground/75 hover:bg-foreground/5 hover:text-foreground focus:bg-foreground/5 data-open:bg-foreground/5 data-open:text-foreground";

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const session = useSession();
  const lenis = useLenis();
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));

  useEffect(() => {
    if (open) lenis?.stop();
    else lenis?.start();
  }, [open, lenis]);

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-4 md:pt-5">
        <motion.nav
          initial={{ y: -24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1, ease: EASE_OUT_EXPO, delay: 0.1 }}
          aria-label="Main"
          className={cn(
            "liquid-glass pointer-events-auto flex h-14 w-full max-w-5xl items-center justify-between gap-2 rounded-full pr-2 pl-5 transition-[background-color,max-width] duration-700 ease-fluid",
            scrolled && "liquid-glass-strong max-w-4xl",
          )}
        >
          <Logo />

          <NavigationMenu
            className="hidden md:flex"
            viewportClassName="mt-3 rounded-[1.75rem] bg-popover/[0.97] ring-1 ring-foreground/10 shadow-[0_30px_80px_-30px_rgb(5_10_30/0.55)] backdrop-blur-2xl"
          >
            <NavigationMenuList className="gap-0.5">
              <NavigationMenuItem>
                <NavigationMenuTrigger className={triggerClass}>Product</NavigationMenuTrigger>
                <NavigationMenuContent className="p-2.5">
                  <div className="grid w-[640px] grid-cols-[1fr_1.35fr] gap-2.5">
                    <Link
                      href="#hero"
                      className="group relative flex flex-col justify-end overflow-hidden rounded-[1.25rem] bg-ink p-5 text-pearl dark:bg-[#0b1430]"
                    >
                      <div className="absolute -top-16 -right-10 size-48 rounded-full bg-[radial-gradient(circle,rgb(47_91_255/0.75),transparent_65%)] blur-xl transition-transform duration-1000 ease-fluid group-hover:scale-125" />
                      <div className="absolute top-5 left-5 eyebrow text-pearl/60">Flagship</div>
                      <div className="relative font-display text-[2rem] leading-[0.95]">
                        Live <span className="italic">rooms</span>
                      </div>
                      <p className="relative mt-2 text-[0.8125rem] leading-relaxed text-pearl/65">
                        Paste a link, share it, read together. Everything else follows.
                      </p>
                    </Link>
                    <ul className="grid grid-cols-2 gap-1">
                      {FEATURES.map(({ icon: Icon, title, body, href }) => (
                        <li key={title}>
                          <NavigationMenuLink asChild>
                            <Link href={href} className="flex-col items-start gap-1 rounded-2xl p-3 hover:bg-foreground/5">
                              <span className="flex items-center gap-2 text-[0.8125rem] font-semibold">
                                <Icon weight="light" className="size-[18px] text-azure" />
                                {title}
                              </span>
                              <span className="text-[0.75rem] leading-snug text-muted-foreground">{body}</span>
                            </Link>
                          </NavigationMenuLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                </NavigationMenuContent>
              </NavigationMenuItem>

              <NavigationMenuItem>
                <NavigationMenuTrigger className={triggerClass}>Use cases</NavigationMenuTrigger>
                <NavigationMenuContent className="p-1.5">
                  <ul className="grid w-[230px] gap-1">
                    {USE_CASES.slice(0, 4).map(({ icon: Icon, title, kicker }) => (
                      <li key={title}>
                        <NavigationMenuLink asChild>
                          <Link href="#use-cases" className="gap-3.5 rounded-2xl p-3 hover:bg-foreground/5">
                            <span className="grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-(--hairline)">
                              <Icon weight="light" className="size-5 text-azure" />
                            </span>
                            <span className="flex flex-col">
                              <span className="font-display text-[1.25rem] leading-tight">{title}</span>
                              <span className="text-[0.75rem] text-muted-foreground">{kicker}</span>
                            </span>
                          </Link>
                        </NavigationMenuLink>
                      </li>
                    ))}
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>

              <NavigationMenuItem>
                <NavigationMenuLink asChild className={cn(triggerClass, "inline-flex items-center")}>
                  <Link href="#how">How it works</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink asChild className={cn(triggerClass, "inline-flex items-center")}>
                  <Link href="#inside">Inside a room</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>

          <div className="flex items-center gap-1">
            <ThemeToggle />
            {session ? (
              <button
                type="button"
                onClick={() => void signOut()}
                className="hidden h-9 items-center rounded-full px-3.5 text-[0.8125rem] font-medium text-foreground/75 hover:bg-foreground/5 hover:text-foreground sm:inline-flex"
              >
                Sign out
              </button>
            ) : (
              <Link
                href="/login"
                className="hidden h-9 items-center rounded-full px-3.5 text-[0.8125rem] font-medium text-foreground/75 hover:bg-foreground/5 hover:text-foreground sm:inline-flex"
              >
                Sign in
              </Link>
            )}
            <Link
              href={session ? "#hero" : "/signup"}
              className="group hidden h-10 items-center gap-2 rounded-full bg-ink pr-1.5 pl-4 text-[0.8125rem] font-medium text-pearl transition-transform duration-300 ease-fluid active:scale-[0.97] sm:inline-flex dark:bg-pearl dark:text-ink"
            >
              {session ? "New room" : "Start a room"}
              <span className="grid size-7 place-items-center rounded-full bg-pearl/12 transition-transform duration-500 ease-fluid group-hover:translate-x-0.5 group-hover:-translate-y-px dark:bg-ink/8">
                <ArrowUpRightIcon weight="light" className="size-3.5" />
              </span>
            </Link>
            <Hamburger open={open} onToggle={() => setOpen((o) => !o)} />
          </div>
        </motion.nav>
      </header>

      <MobileMenu open={open} onClose={() => setOpen(false)} signedIn={!!session} />
    </>
  );
}

function Hamburger({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      className="relative z-50 grid size-10 place-items-center rounded-full md:hidden"
    >
      <span className="relative block h-3 w-5">
        <span
          className={cn(
            "absolute left-0 h-px w-5 bg-current transition-transform duration-500 ease-fluid",
            open ? "top-1.5 rotate-45" : "top-0",
          )}
        />
        <span
          className={cn(
            "absolute left-0 h-px w-5 bg-current transition-transform duration-500 ease-fluid",
            open ? "top-1.5 -rotate-45" : "top-3",
          )}
        />
      </span>
    </button>
  );
}

const MOBILE_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#inside", label: "Inside a room" },
];

function MobileMenu({ open, onClose, signedIn }: { open: boolean; onClose: () => void; signedIn: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const links = [...MOBILE_LINKS, signedIn ? { href: "#hero", label: "New room" } : { href: "/login", label: "Sign in" }];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="mobile-menu"
          initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
          animate={{ opacity: 1, backdropFilter: "blur(28px)" }}
          exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
          className="fixed inset-0 z-30 flex flex-col justify-between bg-background/80 px-6 pt-28 pb-10 md:hidden"
          data-lenis-prevent
        >
          <nav aria-label="Mobile">
            <ul className="flex flex-col gap-1">
              {links.map((link, i) => (
                <li key={link.label} className="overflow-hidden">
                  <motion.div
                    initial={{ y: "100%", opacity: 0 }}
                    animate={{ y: "0%", opacity: 1 }}
                    exit={{ y: "60%", opacity: 0, transition: { duration: 0.25 } }}
                    transition={{ duration: 0.9, delay: 0.08 + i * 0.06, ease: EASE_OUT_EXPO }}
                  >
                    <Link
                      href={link.href}
                      onClick={onClose}
                      className="flex items-baseline gap-4 py-2 font-display text-[2.75rem] leading-none"
                    >
                      <span className="eyebrow text-muted-foreground">0{i + 1}</span>
                      {link.label}
                    </Link>
                  </motion.div>
                </li>
              ))}
            </ul>
          </nav>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: EASE_OUT_EXPO }}
            className="flex items-center justify-between border-t border-(--hairline) pt-6"
          >
            <span className="eyebrow text-muted-foreground">Every link, read together</span>
            <ThemeToggle />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
