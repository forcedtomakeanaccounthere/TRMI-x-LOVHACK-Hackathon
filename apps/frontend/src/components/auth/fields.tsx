"use client";

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

type FieldProps = React.ComponentProps<"input"> & {
  label: string;
  error?: string;
  hint?: React.ReactNode;
};

// Floating-label input on a glass well. The label lifts when the field has focus or a value.
export function Field({ label, error, hint, className, type = "text", ...props }: FieldProps) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = type === "password";

  return (
    <div className={className}>
      <div
        className={cn(
          "liquid-glass group relative rounded-2xl transition-shadow duration-300 ease-fluid focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--azure)_16%,transparent),var(--glass-shadow)]",
          error && "shadow-[0_0_0_1px_var(--destructive),var(--glass-shadow)]",
        )}
      >
        <input
          id={id}
          type={isPassword && reveal ? "text" : type}
          placeholder=" "
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(
            "peer h-[3.75rem] w-full rounded-2xl bg-transparent px-4 pt-5 text-[0.9375rem] outline-none",
            isPassword && "pr-12",
          )}
          {...props}
        />
        <label
          htmlFor={id}
          className="pointer-events-none absolute top-1/2 left-4 origin-left -translate-y-1/2 text-[0.9375rem] text-muted-foreground transition-all duration-300 ease-fluid peer-focus:top-[1.15rem] peer-focus:scale-[0.78] peer-[:not(:placeholder-shown)]:top-[1.15rem] peer-[:not(:placeholder-shown)]:scale-[0.78]"
        >
          {label}
        </label>
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            {reveal ? <EyeSlashIcon weight="light" className="size-[18px]" /> : <EyeIcon weight="light" className="size-[18px]" />}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            key="error"
            id={`${id}-error`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-2 pl-1 text-[0.8125rem] text-destructive"
          >
            {error}
          </motion.p>
        ) : hint ? (
          <div id={`${id}-hint`} className="mt-2 pl-1 text-[0.8125rem] text-muted-foreground">
            {hint}
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function AuthHeading({ eyebrow, title, sub }: { eyebrow: string; title: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className="mb-9">
      <div className="eyebrow text-azure">{eyebrow}</div>
      <h1 className="mt-4 font-display text-[3.4rem] font-normal">{title}</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "error"; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "mb-6 rounded-2xl px-4 py-3 text-[0.875rem] leading-relaxed ring-1",
        tone === "success" && "bg-emerald-500/8 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
        tone === "error" && "bg-destructive/8 text-destructive ring-destructive/20",
        tone === "info" && "bg-azure/8 text-foreground ring-azure/20",
      )}
    >
      {children}
    </motion.div>
  );
}

export function SubmitButton({ busy, children, busyLabel }: { busy: boolean; children: React.ReactNode; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="group relative mt-2 inline-flex h-14 w-full items-center justify-between overflow-hidden rounded-full bg-ink pr-2 pl-6 text-[0.9375rem] font-medium text-pearl shadow-[0_14px_34px_-14px_rgb(29_68_224/0.7),inset_0_1px_0_rgb(255_255_255/0.16)] transition-transform duration-300 ease-fluid active:scale-[0.985] disabled:opacity-75 dark:bg-pearl dark:text-ink"
    >
      <span>{busy ? busyLabel : children}</span>
      <span className="grid size-10 place-items-center rounded-full bg-pearl/12 transition-transform duration-500 ease-fluid group-hover:translate-x-0.5 dark:bg-ink/8">
        {busy ? (
          <span className="size-4 animate-spin rounded-full border border-current border-t-transparent" />
        ) : (
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        )}
      </span>
    </button>
  );
}
