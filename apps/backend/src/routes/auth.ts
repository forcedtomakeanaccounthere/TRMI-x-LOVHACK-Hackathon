import {
  LoginRequest,
  RefreshRequest,
  ResendVerificationRequest,
  SignupRequest,
  type AuthSession,
  type MessageResponse,
} from "@linkroom/shared";
import { isAuthApiError, isAuthSessionMissingError, type AuthError, type Session } from "@supabase/supabase-js";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { env, webOrigin } from "../env";
import { sendVerificationEmail } from "../lib/mailer";
import { supabaseAdmin, supabaseAuth } from "../lib/supabase";
import { requireAuth, toAuthUser } from "../middleware/auth";
import { HttpError } from "../middleware/error";

export const authRouter = Router();

const VERIFY_URL = `${env.API_PUBLIC_URL}/api/auth/verify`;
const CHECK_EMAIL = "Check your email to verify your account.";

// Supabase only makes the token (admin generateLink sends nothing); we email the link ourselves
// over our own SMTP. type=email accepts both signup and recovery tokens.
const verifyLink = (tokenHash: string) =>
  `${VERIFY_URL}?${new URLSearchParams({ token_hash: tokenHash, type: "email" })}`;

async function emailVerification(email: string, tokenHash: string, name: unknown) {
  try {
    await sendVerificationEmail(email, verifyLink(tokenHash), typeof name === "string" ? name : undefined);
  } catch (err) {
    console.error("[auth] could not send verification email", err);
    throw new HttpError(502, "Could not send the verification email. Please try again.");
  }
}

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
    case "over_request_rate_limit":
      return new HttpError(429, "Too many attempts. Try again later.");
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

  // Creates the unconfirmed user, or for one that is still unconfirmed, replaces its token (so
  // earlier links stop working) and name. A confirmed account is left alone and gets no email.
  const generate = () =>
    supabaseAdmin().auth.admin.generateLink({ type: "signup", email, password, options: { data: { name } } });
  const alreadyVerified = () => res.status(201).json({ message: CHECK_EMAIL } satisfies MessageResponse);
  const first = await generate();
  if (first.error?.code === "email_exists") return alreadyVerified();
  if (first.error) throw signupError(first.error);

  // generateLink keeps an unconfirmed user's old password. Set this one, so the only working
  // link always belongs to the latest signup and someone who registered the address first
  // can't keep a password on the account its owner then verifies. The database only writes it
  // while the email is still unconfirmed, in the same statement, so a signup racing the owner's
  // verification can never change a verified account's password.
  const { data: changed, error: pwError } = await supabaseAdmin().rpc("set_unconfirmed_password", {
    p_user_id: first.data.user.id,
    p_password: password,
  });
  if (pwError) {
    console.error("[auth] could not set the signup password", pwError);
    throw new HttpError(500, "Could not create account");
  }
  if (!changed) return alreadyVerified();

  // A fresh link, so links from earlier signups for this address stop working.
  const { data, error } = await generate();
  if (error?.code === "email_exists") return alreadyVerified();
  if (error) throw signupError(error);

  await emailVerification(email, data.properties.hashed_token, name);
  res.status(201).json({ message: CHECK_EMAIL } satisfies MessageResponse);
});

// GET /api/auth/verify?token_hash=...&type=email
// Target of the link in the verification email. Redirects back to the frontend login page,
// with the email filled in once it is verified.
export const VerifyQuery = z.object({
  token_hash: z.string().min(1),
  type: z.enum(["email", "signup"]).default("email"),
});

authRouter.get("/verify", async (req, res) => {
  const parsed = VerifyQuery.safeParse(req.query);
  const redirect = (params: Record<string, string>) =>
    res.redirect(302, `${webOrigin}/login?${new URLSearchParams(params)}`);

  if (!parsed.success) return redirect({ verified: "0", error: "invalid_link" });

  const { data, error } = await supabaseAuth().auth.verifyOtp(parsed.data);
  if (error) {
    return redirect({ verified: "0", error: error.code === "otp_expired" ? "expired_link" : "invalid_link" });
  }
  redirect({ verified: "1", ...(data.user?.email && { email: data.user.email }) });
});

// POST /api/auth/resend-verification  { email }
authRouter.post("/resend-verification", authLimiter, async (req, res) => {
  const { email } = ResendVerificationRequest.parse(req.body);

  // A recovery link is the one kind generateLink makes without creating a user for an unknown
  // address, and opening it confirms an unconfirmed email. It is only sent to unconfirmed users;
  // for anyone else nothing is emailed and the reply is the same.
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({ type: "recovery", email });
  if (error && error.code !== "user_not_found") console.warn("[auth] resend failed", error.code ?? error.message);
  if (!error && !data.user.email_confirmed_at) {
    await emailVerification(email, data.properties.hashed_token, data.user.user_metadata?.name);
  }

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
  // 401 tells the client to forget the session, so it is only for tokens Auth actually refused.
  // An outage or rate limit is temporary: 503 lets the client keep the token and retry.
  if (error && !isRejectedRefreshToken(error)) {
    console.warn("[auth] refresh failed", error.code ?? error.message);
    throw new HttpError(503, "Could not refresh your session. Please try again.");
  }
  if (error || !data.session) throw new HttpError(401, "Session expired. Please log in again.");

  res.json(toSession(data.session));
});

// Auth answers an unknown, reused-too-late or revoked refresh token with a 4xx (or a missing
// session). Network failures, 5xx and 429 say nothing about the token itself.
export function isRejectedRefreshToken(error: AuthError) {
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 429;
}

// POST /api/auth/logout  (Bearer token): revokes the session's refresh tokens.
authRouter.post("/logout", requireAuth, async (req, res) => {
  const { error } = await supabaseAdmin().auth.admin.signOut(req.accessToken!, "local");
  // A session that is already gone counts as logged out. Any other failure means the
  // refresh token may still work, so report it and let the client retry.
  if (error && !isAuthSessionMissingError(error)) {
    console.warn("[auth] logout failed", error.code ?? error.message);
    throw new HttpError(502, "Could not log out. Please try again.");
  }
  res.status(204).end();
});

// GET /api/auth/me  (Bearer token)
authRouter.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});
