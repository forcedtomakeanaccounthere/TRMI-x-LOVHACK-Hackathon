import Link from "next/link";
import { cn } from "@/lib/utils";

// Two interlocking hairline rings: a link, and two people in one room.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn("size-7", className)} aria-hidden>
      <circle cx="12.5" cy="16" r="7.5" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="19.5" cy="16" r="7.5" stroke="var(--azure)" strokeWidth="1.1" />
      <path d="M16 10.3a7.5 7.5 0 0 1 0 11.4" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="LinkRoom home" className={cn("group inline-flex items-center gap-2", className)}>
      <LogoMark className="transition-transform duration-700 ease-fluid group-hover:rotate-[24deg]" />
      <span className="font-display text-[1.45rem] leading-none font-medium tracking-[-0.02em]">
        Link<span className="italic text-royal-gradient">Room</span>
      </span>
    </Link>
  );
}
