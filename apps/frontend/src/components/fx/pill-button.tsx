"use client";

import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "glass" | "ghost";

const variants: Record<Variant, { shell: string; icon: string }> = {
  primary: {
    shell:
      "bg-ink text-pearl dark:bg-pearl dark:text-ink shadow-[0_10px_30px_-10px_rgb(29_68_224/0.55),inset_0_1px_0_rgb(255_255_255/0.18)]",
    icon: "bg-pearl/12 dark:bg-ink/8",
  },
  glass: {
    shell: "liquid-glass text-foreground",
    icon: "bg-foreground/6",
  },
  ghost: {
    shell: "text-foreground ring-1 ring-(--hairline) hover:bg-foreground/4",
    icon: "bg-foreground/6",
  },
};

type PillButtonProps = {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: Variant;
  icon?: React.ReactNode | false;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  magnetic?: boolean;
};

// Island CTA: a pill with its trailing icon nested in its own circle, pulled gently toward the pointer.
export function PillButton({
  children,
  href,
  onClick,
  variant = "primary",
  icon,
  className,
  type = "button",
  disabled,
  magnetic = true,
}: PillButtonProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.4 });
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.4 });
  const v = variants[variant];

  function onMove(e: React.PointerEvent) {
    if (!magnetic || reduce || e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * 0.18);
    y.set((e.clientY - (r.top + r.height / 2)) * 0.28);
  }

  const inner = (
    <>
      <span className="pl-1.5">{children}</span>
      {icon !== false && (
        <span
          className={cn(
            "grid size-8 place-items-center rounded-full transition-transform duration-500 ease-fluid group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105",
            v.icon,
          )}
        >
          {icon ?? <ArrowUpRightIcon weight="light" className="size-4" />}
        </span>
      )}
    </>
  );

  const shellClass = cn(
    "group inline-flex h-12 items-center gap-3 rounded-full pr-2 pl-5 text-[0.9375rem] font-medium tracking-[-0.01em] transition-[transform,background-color,box-shadow] duration-300 ease-fluid select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60",
    icon === false && "pr-5",
    v.shell,
    className,
  );

  return (
    <motion.div
      ref={ref}
      style={{ x, y }}
      onPointerMove={onMove}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
      className="inline-flex"
    >
      {href ? (
        <Link href={href} className={shellClass}>
          {inner}
        </Link>
      ) : (
        <button type={type} onClick={onClick} disabled={disabled} className={shellClass}>
          {inner}
        </button>
      )}
    </motion.div>
  );
}
