import { AuthApiError } from "@supabase/supabase-js";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/auth/forgot-password and /api/auth/reset-password against a stubbed Supabase Auth and
// mailer: who gets an email, that the reply never tells accounts apart, and how bad links and
// passwords are reported.

const generateLink = vi.fn();
const updateUserById = vi.fn();
const signOut = vi.fn();
const verifyOtp = vi.fn();
const sendPasswordResetEmail = vi.fn();

vi.mock("../../src/lib/supabase", () => ({
  supabaseAdmin: () => ({ auth: { admin: { generateLink, updateUserById, signOut } } }),
  supabaseAuth: () => ({ auth: { verifyOtp } }),
}));
vi.mock("../../src/lib/mailer", () => ({
  sendPasswordResetEmail: (...args: unknown[]) => sendPasswordResetEmail(...args),
  sendVerificationEmail: vi.fn(),
  sendMentionEmail: vi.fn(),
}));

// Every request here comes from one IP; the limiter itself is not what's being tested.
process.env.AUTH_RATE_LIMIT = "1000";
const { createApp } = await import("../../src/app");
const { webOrigin } = await import("../../src/env");
const app = createApp();

const user = (confirmed: boolean) => ({
  id: "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f",
  email: "ana@example.com",
  email_confirmed_at: confirmed ? "2026-10-30T00:00:00Z" : null,
  user_metadata: { name: "Ana" },
});
const link = (confirmed: boolean) => ({ data: { user: user(confirmed), properties: { hashed_token: "hash123" } }, error: null });

beforeEach(() => {
  for (const fn of [generateLink, updateUserById, signOut, verifyOtp, sendPasswordResetEmail]) fn.mockReset();
  sendPasswordResetEmail.mockResolvedValue(undefined);
  updateUserById.mockResolvedValue({ data: {}, error: null });
  signOut.mockResolvedValue({ error: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/auth/forgot-password", () => {
  const forgot = (email: string) => request(app).post("/api/auth/forgot-password").send({ email });

  it("emails a verified account a link to the frontend's /forgot-password page", async () => {
    generateLink.mockResolvedValue(link(true));
    const res = await forgot("ana@example.com");
    expect(res.status).toBe(200);
    expect(generateLink).toHaveBeenCalledWith({ type: "recovery", email: "ana@example.com" });
    expect(sendPasswordResetEmail).toHaveBeenCalledWith("ana@example.com", `${webOrigin}/forgot-password?token_hash=hash123`, "Ana");
  });

  it("gives the same reply for unknown and unverified addresses, and emails neither", async () => {
    generateLink.mockResolvedValue(link(true));
    const known = await forgot("ana@example.com");
    generateLink.mockResolvedValue({ data: { user: null, properties: null }, error: new AuthApiError("User not found", 404, "user_not_found") });
    const unknown = await forgot("nobody@example.com");
    generateLink.mockResolvedValue(link(false));
    const unverified = await forgot("new@example.com");
    expect(unknown.status).toBe(200);
    expect(unverified.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(unverified.body).toEqual(known.body);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it("answers 502 when the email can't be sent", async () => {
    generateLink.mockResolvedValue(link(true));
    sendPasswordResetEmail.mockRejectedValue(new Error("SMTP down"));
    expect((await forgot("ana@example.com")).status).toBe(502);
  });

  it("refuses an invalid email", async () => {
    expect((await forgot("not-an-email")).status).toBe(400);
    expect(generateLink).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/reset-password", () => {
  const reset = (body: object) => request(app).post("/api/auth/reset-password").send(body);
  const verified = { data: { user: user(true), session: { access_token: "access" } }, error: null };

  it("uses the token once, sets the password and signs the account out everywhere", async () => {
    verifyOtp.mockResolvedValue(verified);
    const res = await reset({ token_hash: "hash123", password: "new-secret-1" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/changed/);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash123", type: "recovery" });
    expect(updateUserById).toHaveBeenCalledWith(user(true).id, { password: "new-secret-1" });
    expect(signOut).toHaveBeenCalledWith("access", "global");
  });

  it("says the link expired when the token is refused, so the page offers a new one", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: new AuthApiError("Token has expired or is invalid", 403, "otp_expired") });
    const res = await reset({ token_hash: "old", password: "new-secret-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("answers 400 for a weak or reused password", async () => {
    verifyOtp.mockResolvedValue(verified);
    updateUserById.mockResolvedValue({ data: null, error: new AuthApiError("Password is known to be weak", 422, "weak_password") });
    expect((await reset({ token_hash: "h", password: "password" })).status).toBe(400);
    updateUserById.mockResolvedValue({ data: null, error: new AuthApiError("New password should be different", 422, "same_password") });
    const reused = await reset({ token_hash: "h", password: "old-secret-1" });
    expect(reused.status).toBe(400);
    expect(reused.body.error).toMatch(/haven't used/);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("checks the password's length like signup, before using the token", async () => {
    expect((await reset({ token_hash: "h", password: "short" })).status).toBe(400);
    expect((await reset({ token_hash: "h", password: "x".repeat(73) })).status).toBe(400);
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
