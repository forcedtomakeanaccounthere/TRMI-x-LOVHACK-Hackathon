"use client";

import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { SignupRequest } from "@linkroom/shared";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { EASE_OUT_EXPO } from "@/components/fx/reveal";
import { api } from "@/lib/api";
import { AFTER_LOGIN, safeNext } from "@/lib/session";
import { cn } from "@/lib/utils";
import { AuthHeading, Field, Notice, SubmitButton } from "./fields";
import { ResendButton } from "./resend-button";

type Errors = Partial<Record<"name" | "email" | "password", string>>;

const MESSAGES: Record<keyof Errors, string> = {
  name: "Tell us what to call you",
  email: "Enter a valid email address",
  password: "Use at least 8 characters",
};

// 0–4, from length and character variety. Only a nudge; the backend enforces the minimum.
function strength(pw: string) {
  if (!pw) return 0;
  let s = pw.length >= 8 ? 1 : 0;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

const STRENGTH_LABEL = ["Too short", "Fair", "Good", "Strong", "Excellent"];

export function SignupForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"), AFTER_LOGIN);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const score = strength(password);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = SignupRequest.safeParse({ name: name.trim(), email: email.trim(), password });
    if (!parsed.success) {
      const errs: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        errs[key] ??= MESSAGES[key];
      }
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);

    try {
      await api.auth.signup(parsed.data);
      setSentTo(parsed.data.email);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence mode="wait">
      {sentTo ? (
        <motion.div
          key="sent"
          initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.8, ease: EASE_OUT_EXPO }}
        >
          <div className="liquid-glass mb-8 grid size-16 place-items-center rounded-2xl">
            <EnvelopeSimpleIcon weight="thin" className="size-8 text-azure" />
          </div>
          <AuthHeading
            eyebrow="One last step"
            title={
              <>
                Check your <span className="italic text-royal-gradient">inbox.</span>
              </>
            }
            sub={
              <>
                We sent a verification link to <span className="font-medium text-foreground">{sentTo}</span>. Open it
                on this device and you&apos;ll come straight back to sign in.
              </>
            }
          />
          <div className="space-y-3 text-[0.875rem] text-muted-foreground">
            <p>
              Nothing yet? Check spam, or <ResendButton email={sentTo} />.
            </p>
            <p>
              Wrong address?{" "}
              <button type="button" onClick={() => setSentTo(null)} className="font-medium text-foreground underline-offset-4 hover:underline">
                Start over
              </button>
            </p>
          </div>
          <Link
            href={`/login?email=${encodeURIComponent(sentTo)}${next !== AFTER_LOGIN ? `&next=${encodeURIComponent(next)}` : ""}`}
            className="mt-10 inline-flex h-12 w-full items-center justify-center rounded-full text-[0.9375rem] font-medium ring-1 ring-(--hairline) transition-colors hover:bg-foreground/4"
          >
            I&apos;ve verified — sign in
          </Link>
        </motion.div>
      ) : (
        <motion.div key="form" exit={{ opacity: 0, y: -12, filter: "blur(6px)" }} transition={{ duration: 0.4 }}>
          <AuthHeading
            eyebrow="Create your account"
            title={
              <>
                Open a <span className="italic text-royal-gradient">room.</span>
              </>
            }
            sub="An account lets you create rooms. Everyone you invite joins with just a name."
          />

          {formError && <Notice tone="error">{formError}</Notice>}

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Field
              label="Your name"
              name="name"
              autoComplete="name"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              autoFocus
            />
            <Field
              label="Email"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
            />
            <Field
              label="Password"
              type="password"
              name="password"
              autoComplete="new-password"
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              hint={
                password ? (
                  <div className="flex items-center gap-3">
                    <div className="flex flex-1 gap-1" aria-hidden>
                      {[1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className={cn(
                            "h-1 flex-1 rounded-full bg-foreground/10 transition-colors duration-500",
                            i <= score && (score <= 1 ? "bg-amber-500" : "bg-azure"),
                          )}
                        />
                      ))}
                    </div>
                    <span className="w-16 text-right text-[0.75rem]">{STRENGTH_LABEL[score]}</span>
                  </div>
                ) : (
                  "At least 8 characters."
                )
              }
            />
            <SubmitButton busy={busy} busyLabel="Creating your account…">
              Create account
            </SubmitButton>
          </form>

          <p className="mt-8 text-center text-[0.875rem] text-muted-foreground">
            Already have an account?{" "}
            <Link
              href={`/login${next !== AFTER_LOGIN ? `?next=${encodeURIComponent(next)}` : ""}`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
