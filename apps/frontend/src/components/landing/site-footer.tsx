import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      ["How it works", "#how"],
      ["Features", "#features"],
      ["Inside a room", "#inside"],
    ],
  },
  {
    title: "Use cases",
    links: [
      ["Study groups", "#use-cases"],
      ["Product teams", "#use-cases"],
      ["Book clubs", "#use-cases"],
    ],
  },
  {
    title: "Account",
    links: [
      ["Sign in", "/login"],
      ["Create account", "/signup"],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden px-5 pt-24 pb-10 md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.4fr_repeat(3,1fr)] md:gap-12">
          <div className="col-span-2 md:col-span-1">
            <LogoMark className="size-10" />
            <p className="mt-5 max-w-xs text-[0.9375rem] leading-relaxed text-muted-foreground">
              The internet is single-player. LinkRoom makes every link multiplayer.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="eyebrow text-muted-foreground">{col.title}</div>
              <ul className="mt-5 space-y-3">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <Link
                      href={href!}
                      className="text-[0.9375rem] text-foreground/80 underline-offset-4 transition-colors hover:text-foreground hover:underline"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          aria-hidden
          className="mt-24 bg-gradient-to-b from-foreground/90 to-foreground/10 bg-clip-text text-center font-display text-[clamp(5rem,19vw,17rem)] leading-[0.8] tracking-[-0.04em] text-transparent select-none"
        >
          Link<span className="italic">Room</span>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-(--hairline) pt-6 text-[0.8125rem] text-muted-foreground sm:flex-row">
          <span>Built for TRMI × LovHack · Multiplayer Everything</span>
          <span className="font-mono text-[0.75rem]">© MMXXVI LinkRoom</span>
        </div>
      </div>
    </footer>
  );
}
