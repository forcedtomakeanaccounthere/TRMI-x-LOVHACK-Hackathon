"use client";

import { LoginRequest } from "@linkroom/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { safeNext, setSession } from "@/lib/session";
import { AuthHeading, Field, Notice, SubmitButton } from "./fields";
import { ResendButton } from "./resend-button";

type Errors = Partial<Record<"email" | "password", string>>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);

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

      {params.get("verified") === "1" && <Notice tone="success">Your email is verified. Sign in to start your first room.</Notice>}
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
        <SubmitButton busy={busy} busyLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      <p className="mt-8 text-center text-[0.875rem] text-muted-foreground">
        New to LinkRoom?{" "}
        <Link
          href={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}
