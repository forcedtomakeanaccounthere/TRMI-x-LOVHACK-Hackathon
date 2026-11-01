"use client";

import { LoginRequest } from "@linkroom/shared";
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

    try {
      const session = await api.auth.login(parsed.data);
      setSession(session);
      toast.success(`Welcome back, ${session.user.name.split(" ")[0]}.`);
      router.push(next);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setUnverified(true);
      else setFormError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
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
