"use client";

import { CheckIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AuthHeading, Field, Notice, SubmitButton } from "./fields";
import { SecretArt } from "./secret-art";

// Same limits as signup (SignupRequest in @linkroom/shared).
const MIN = 8;
const MAX = 72;
const Email = z.string().trim().toLowerCase().email().max(254);

const unavailable = (err: unknown) => err instanceof ApiError && err.status === 404;
const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// /forgot-password: without a token, ask for a reset link; from the emailed link (?token_hash=…),
// choose the new password.
export function ForgotPassword() {
  const params = useSearchParams();
  const token = params.get("token_hash");
  const [mode, setMode] = useState<"request" | "reset">(token ? "reset" : "request");

  return (
    <div className="relative isolate min-h-dvh overflow-hidden">
      <div className="hairline-grid absolute inset-0 -z-20 [mask-image:radial-gradient(ellipse_70%_60%_at_30%_40%,black,transparent_75%)]" />
      <div className="animate-float-slow absolute -top-40 -left-40 -z-10 size-[40rem] rounded-full bg-[radial-gradient(circle,var(--orb-1),transparent_62%)] blur-3xl" />

      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 md:px-8">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 md:px-8 lg:min-h-[calc(100dvh-6rem)] lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <section aria-hidden className="order-2 lg:order-1">
          <SecretArt />
        </section>

        <section className="order-1 lg:order-2">
          <div className="liquid-glass liquid-glass-strong mx-auto w-full max-w-md rounded-[2.25rem] p-7 md:p-9">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                {mode === "reset" && token ? (
                  <ResetForm token={token} onExpired={() => setMode("request")} />
                ) : (
                  <RequestForm initialEmail={params.get("email") ?? ""} expired={!!token} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <p className="mt-6 text-center text-[0.875rem] text-muted-foreground">
            Remembered it?{" "}
            <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}

function RequestForm({ initialEmail, expired }: { initialEmail: string; expired: boolean }) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const parsed = Email.safeParse(email);
    if (!parsed.success) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.auth.forgotPassword(parsed.data);
      setSentTo(parsed.data);
      toast.success("Check your email", { description: "If there's an account for it, a reset link is on its way." });
    } catch (err) {
      toast.error(unavailable(err) ? "Password reset isn't available yet." : message(err, "Couldn't send the email"));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="text-center">
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", bounce: 0.4 }}
          className="mx-auto grid size-16 place-items-center rounded-2xl bg-[linear-gradient(135deg,#2f5bff,#8b5cf6)] text-white shadow-[0_18px_40px_-14px_rgb(47_91_255/0.8)]"
        >
          <EnvelopeSimpleIcon weight="fill" className="size-8" />
        </motion.span>
        <h1 className="mt-6 font-display text-[2.4rem] leading-none">Check your inbox</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
          If there&apos;s an account for <span className="font-medium text-foreground">{sentTo}</span>, we sent a link
          to choose a new password. It works once.
        </p>
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy}
          className="mt-6 text-[0.875rem] font-medium text-azure underline-offset-4 hover:underline disabled:opacity-60"
        >
          {busy ? "Sending…" : "Didn't get it? Send again"}
        </button>
      </div>
    );
  }

  return (
    <>
      <AuthHeading
        eyebrow="Forgot password"
        title={
          <>
            Let&apos;s get you <span className="italic text-royal-gradient">back in.</span>
          </>
        }
        sub="Tell us your email and we'll send a link to choose a new password."
      />
      {expired && (
        <Notice tone="error">That reset link has expired or was already used. Ask for a new one below.</Notice>
      )}
      <form onSubmit={send} noValidate className="space-y-4">
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error ?? undefined}
          autoFocus
        />
        <SubmitButton busy={busy} busyLabel="Sending link…">
          Send reset link
        </SubmitButton>
      </form>
    </>
  );
}

// Rough strength: length, plus a point each for mixed case, a digit and a symbol.
function strength(pw: string) {
  if (!pw) return 0;
  let score = pw.length >= 12 ? 2 : pw.length >= MIN ? 1 : 0;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score);
}
const STRENGTH = ["Too short", "Weak", "Okay", "Good", "Strong"];
const STRENGTH_COLOR = ["bg-destructive", "bg-orange-500", "bg-amber-400", "bg-emerald-500", "bg-emerald-500"];

function ResetForm({ token, onExpired }: { token: string; onExpired: () => void }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const score = password.length < MIN ? 0 : strength(password);
  const long = password.length >= MIN && password.length <= MAX;
  const matches = confirm.length > 0 && confirm === password;

  // After a moment on the success screen, go to sign in.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.push("/login?reset=1"), 2600);
    return () => clearTimeout(timer);
  }, [done, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: typeof errors = {};
    if (!long)
      next.password = password.length > MAX ? `Use at most ${MAX} characters` : `Use at least ${MIN} characters`;
    if (!matches) next.confirm = "The passwords don't match";
    setErrors(next);
    if (next.password || next.confirm) return;

    setBusy(true);
    try {
      await api.auth.resetPassword({ token_hash: token, password });
      setDone(true);
      toast.success("Password changed");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && /expired|used|invalid/i.test(err.message)) {
        toast.error("That link has expired");
        onExpired();
      } else {
        setFormError(
          unavailable(err) ? "Password reset isn't available yet." : message(err, "Couldn't change your password"),
        );
      }
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <motion.span
          initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", bounce: 0.45 }}
          className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_18px_40px_-14px_rgb(16_185_129/0.8)]"
        >
          <CheckIcon weight="bold" className="size-8" />
        </motion.span>
        <h1 className="mt-6 font-display text-[2.4rem] leading-none">
          All set. <span className="italic text-royal-gradient">Shh.</span>
        </h1>
        <p className="mt-3 text-[0.9375rem] text-muted-foreground">
          Your new password works now. Taking you to sign in…
        </p>
        <Link
          href="/login?reset=1"
          className="mt-6 inline-flex h-11 items-center rounded-full bg-ink px-6 text-[0.875rem] font-medium text-pearl dark:bg-pearl dark:text-ink"
        >
          Sign in now
        </Link>
      </div>
    );
  }

  return (
    <>
      <AuthHeading
        eyebrow="Reset password"
        title={
          <>
            Choose a <span className="italic text-royal-gradient">new one.</span>
          </>
        }
        sub="Make it something you'll remember. We won't tell."
      />
      {formError && <Notice tone="error">{formError}</Notice>}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          autoFocus
          hint={
            password ? (
              <span className="flex items-center gap-2">
                <span className="flex flex-1 gap-1" aria-hidden>
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1 flex-1 rounded-full bg-foreground/10 transition-colors duration-300",
                        i <= score && STRENGTH_COLOR[score],
                      )}
                    />
                  ))}
                </span>
                <span className="w-16 text-right text-[0.75rem]">{STRENGTH[score]}</span>
              </span>
            ) : undefined
          }
        />
        <Field
          label="Confirm new password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <ul className="space-y-1.5 px-1 text-[0.8125rem]" aria-label="Password requirements">
          <Requirement met={long}>At least {MIN} characters</Requirement>
          <Requirement met={matches}>Both passwords match</Requirement>
        </ul>
        <SubmitButton busy={busy} busyLabel="Saving…">
          Save new password
        </SubmitButton>
      </form>
    </>
  );
}

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-center gap-2 transition-colors", met ? "text-foreground" : "text-muted-foreground")}>
      <span
        className={cn(
          "grid size-4 place-items-center rounded-full ring-1 transition-colors",
          met ? "bg-emerald-500 text-white ring-emerald-500" : "ring-(--hairline)",
        )}
      >
        {met && <CheckIcon weight="bold" className="size-2.5" />}
      </span>
      {children}
    </li>
  );
}
