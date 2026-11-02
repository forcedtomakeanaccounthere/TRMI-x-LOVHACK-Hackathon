"use client";

import { DEMO_ACCOUNTS, type DemoAccount, LoginRequest } from "@linkroom/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { AFTER_LOGIN, safeNext, setSession } from "@/lib/session";
import { AuthHeading, Field, Notice, SubmitButton } from "./fields";
import { ResendButton } from "./resend-button";

type Errors = Partial<Record<"email" | "password", string>>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), AFTER_LOGIN);
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);

  // Sends a reset link to the email typed above; the link opens /forgot-password.
  async function forgotPassword() {
    const typed = email.trim();
    const parsed = LoginRequest.shape.email.safeParse(typed);
    if (!parsed.success) {
      setErrors({ email: "Enter your email first, then tap Forgot password." });
      return;
    }
    setErrors({});
    setSendingReset(true);
    try {
      await api.auth.forgotPassword(parsed.data);
      toast.success("Check your email", {
        description: `If there's an account for ${parsed.data}, a link to reset the password is on its way.`,
      });
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 404
          ? "Password reset isn't available yet."
          : err instanceof Error
            ? err.message
            : "Couldn't send the reset email",
      );
    } finally {
      setSendingReset(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setUnverified(false);

    const parsed = LoginRequest.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const errs: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        errs[key] ??= key === "password" ? "Enter your password" : "Enter a valid email address";
      }
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    await signIn(parsed.data);
  }

  async function signIn(data: LoginRequest, demo = false) {
    try {
      const session = await api.auth.login(data);
      setSession(session);
      toast.success(
        demo
          ? `Signed in as ${session.user.name}. Open the demo room to try everything.`
          : `Welcome back, ${session.user.name.split(" ")[0]}.`,
      );
      router.push(next);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setUnverified(true);
      else
        setFormError(
          demo && err instanceof ApiError && err.status === 401
            ? "The demo accounts aren't set up on this server yet (npm run seed:demo -w apps/backend)."
            : err instanceof Error
              ? err.message
              : "Something went wrong",
        );
      setBusy(false);
      setDemoBusy(null);
    }
  }

  // One click for judges: fills the form so the credentials are visible, then signs in.
  async function signInAsDemo(account: DemoAccount) {
    setFormError(null);
    setUnverified(false);
    setErrors({});
    setEmail(account.email);
    setPassword(account.password);
    setDemoBusy(account.email);
    await signIn({ email: account.email, password: account.password }, true);
  }

  return (
    <>
      <AuthHeading
        eyebrow="Welcome back"
        title={
          <>
            Sign <span className="italic text-royal-gradient">in.</span>
          </>
        }
        sub="Pick up where your group left off."
      />

      {params.get("reset") === "1" && (
        <Notice tone="success">Your password is changed. Sign in with the new one.</Notice>
      )}
      {params.get("verified") === "1" && (
        <Notice tone="success">Your email is verified. Sign in to start your first room.</Notice>
      )}
      {params.get("verified") === "0" && (
        <Notice tone="error">That verification link has expired or was already used. Sign in to get a new one.</Notice>
      )}
      {unverified && (
        <Notice>
          Please verify your email first. We sent a link to <span className="font-medium">{email}</span>.{" "}
          <ResendButton email={email.trim()} />
        </Notice>
      )}
      {formError && <Notice tone="error">{formError}</Notice>}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          autoFocus
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <div className="-mt-1 flex justify-end">
          <button
            type="button"
            onClick={forgotPassword}
            disabled={sendingReset}
            className="text-[0.8125rem] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-60"
          >
            {sendingReset ? "Sending link…" : "Forgot password?"}
          </button>
        </div>
        <SubmitButton busy={busy} busyLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      <DemoAccounts busy={demoBusy} disabled={busy || demoBusy !== null} onPick={signInAsDemo} />

      <p className="mt-8 text-center text-[0.875rem] text-muted-foreground">
        New to LinkRoom?{" "}
        <Link
          href={`/signup${next !== AFTER_LOGIN ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}

// "Sign in as a guest judge": the seeded demo accounts, with their credentials in plain sight.
function DemoAccounts({
  busy,
  disabled,
  onPick,
}: {
  busy: string | null;
  disabled: boolean;
  onPick: (account: DemoAccount) => void;
}) {
  return (
    <section className="mt-6 rounded-2xl border border-dashed border-(--hairline) bg-foreground/[0.02] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="eyebrow text-[0.625rem] text-muted-foreground">Judging? Sign in as a guest</h2>
        <span className="text-[0.6875rem] text-muted-foreground">no email needed</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {DEMO_ACCOUNTS.map((account) => (
          <button
            key={account.email}
            type="button"
            disabled={disabled}
            onClick={() => onPick(account)}
            className="group flex items-center gap-3 rounded-xl border border-(--hairline) bg-card px-3 py-2.5 text-left transition hover:border-foreground/25 hover:shadow-sm disabled:opacity-60"
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full text-[0.75rem] font-semibold text-white"
              style={{ background: account.color }}
            >
              {account.name[0]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] font-medium">
                {busy === account.email ? "Signing in…" : account.name}
              </span>
              <span className="block truncate text-[0.6875rem] text-muted-foreground">{account.blurb}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted-foreground">
        {DEMO_ACCOUNTS.map((a) => a.email).join(" · ")} · password{" "}
        <code className="rounded bg-foreground/6 px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">
          {DEMO_ACCOUNTS[0]!.password}
        </code>
        . Sign in as both in two windows to see live cursors, follow and huddles.
      </p>
    </section>
  );
}
