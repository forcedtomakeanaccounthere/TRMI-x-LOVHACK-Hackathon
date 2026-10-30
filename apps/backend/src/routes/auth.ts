import {
  LoginRequest,
  RefreshRequest,
  ResendVerificationRequest,
  SignupRequest,
  type AuthSession,
  type MessageResponse,
} from "@linkroom/shared";
import type { AuthError, Session } from "@supabase/supabase-js";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { env, webOrigin } from "../env";
import { supabaseAdmin, supabaseAuth } from "../lib/supabase";
import { requireAuth, toAuthUser } from "../middleware/auth";
import { HttpError } from "../middleware/error";

export const authRouter = Router();

const VERIFY_URL = `${env.API_PUBLIC_URL}/api/auth/verify`;
const CHECK_EMAIL = "Check your email to verify your account.";

// Brute-force guard on the endpoints that take a password or send email.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in a few minutes." },
});

function toSession(session: Session): AuthSession {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
    user: toAuthUser(session.user),
  };
}

// Errors the user can act on; anything else is logged and returned as a 500.
function signupError(error: AuthError): HttpError {
  switch (error.code) {
    case "weak_password":
      return new HttpError(400, error.message);
    case "email_address_invalid":
      return new HttpError(400, "Invalid email address");
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return new HttpError(429, "Too many emails sent. Try again later.");
    case "signup_disabled":
      return new HttpError(403, "Sign up is disabled");
    default:
      console.error("[auth] signup failed", error);
      return new HttpError(500, "Could not create account");
  }
}

// POST /api/auth/signup  { email, password, name }
// Creates the user and sends a verification email. The reply is the same whether or
// not the email is already registered, so it cannot be used to discover accounts.
authRouter.post("/signup", authLimiter, async (req, res) => {
  const { email, password, name } = SignupRequest.parse(req.body);

  const { data, error } = await supabaseAuth().auth.signUp({
    email,
    password,
    options: { data: { name }, emailRedirectTo: VERIFY_URL },
  });
  if (error && error.code !== "user_already_exists") throw signupError(error);
  if (data?.session) {
    console.warn("[auth] signup returned a session: enable 'Confirm email' in Supabase Auth settings");
  }

  res.status(201).json({ message: CHECK_EMAIL } satisfies MessageResponse);
});

// GET /api/auth/verify?token_hash=...&type=email
// Target of the link in the "Confirm signup" email. Redirects back to the frontend.
const VerifyQuery = z.object({
  token_hash: z.string().min(1),
  type: z.enum(["email", "signup"]).default("email"),
});

authRouter.get("/verify", async (req, res) => {
  const parsed = VerifyQuery.safeParse(req.query);
  const redirect = (params: Record<string, string>) =>
    res.redirect(302, `${webOrigin}/login?${new URLSearchParams(params)}`);

  if (!parsed.success) return redirect({ verified: "0", error: "invalid_link" });

  const { error } = await supabaseAuth().auth.verifyOtp(parsed.data);
  if (error) {
    return redirect({ verified: "0", error: error.code === "otp_expired" ? "expired_link" : "invalid_link" });
  }
  redirect({ verified: "1" });
});

// POST /api/auth/resend-verification  { email }
authRouter.post("/resend-verification", authLimiter, async (req, res) => {
  const { email } = ResendVerificationRequest.parse(req.body);

  const { error } = await supabaseAuth().auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: VERIFY_URL },
  });
  if (error?.code === "over_email_send_rate_limit") {
    throw new HttpError(429, "Too many emails sent. Try again later.");
  }
  if (error) console.warn("[auth] resend failed", error.code ?? error.message);

  res.json({ message: "If that account needs verifying, we sent a new email." } satisfies MessageResponse);
});

// POST /api/auth/login  { email, password }
authRouter.post("/login", authLimiter, async (req, res) => {
  const { email, password } = LoginRequest.parse(req.body);

  const { data, error } = await supabaseAuth().auth.signInWithPassword({ email, password });
  if (error?.code === "email_not_confirmed") throw new HttpError(403, "Please verify your email first");
  if (error || !data.session) throw new HttpError(401, "Invalid email or password");

  res.json(toSession(data.session));
});

// POST /api/auth/refresh  { refresh_token }
authRouter.post("/refresh", async (req, res) => {
  const { refresh_token } = RefreshRequest.parse(req.body);

  const { data, error } = await supabaseAuth().auth.refreshSession({ refresh_token });
  if (error || !data.session) throw new HttpError(401, "Session expired. Please log in again.");

  res.json(toSession(data.session));
});

// POST /api/auth/logout  (Bearer token): revokes the session's refresh tokens.
authRouter.post("/logout", requireAuth, async (req, res) => {
  const { error } = await supabaseAdmin().auth.admin.signOut(req.accessToken!, "local");
  if (error) console.warn("[auth] logout failed", error.code ?? error.message);
  res.status(204).end();
});

// GET /api/auth/me  (Bearer token)
authRouter.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});
