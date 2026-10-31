import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBackend, WEB, type Backend } from "../support/backend-process";
import { makePdf } from "../support/pdf";
import { uniqueEmail } from "../support/supabase";

// User stories run against the production build as a separate process, over HTTP.
// Passwords are generated per run: they only ever reach the local Supabase.
const newPassword = () => randomBytes(12).toString("base64url");

type Session = { access_token: string; refresh_token: string; user: { id: string; email: string; name: string } };

// Where the emailed link lands once it verifies the account: the login page, email filled in.
const verifiedUrl = (email: string) => `${WEB}/login?${new URLSearchParams({ verified: "1", email })}`;

// Shared steps, so each story reads as the user's actions.
async function signUpAndVerify(be: Backend, email: string, password: string, name: string) {
  expect((await be.post("/api/auth/signup", { email, password, name })).status).toBe(201);
  const click = await be.clickVerificationLink(email);
  expect(click.headers.get("location")).toBe(verifiedUrl(email));
}

async function logIn(be: Backend, email: string, password: string): Promise<Session> {
  const res = await be.post("/api/auth/login", { email, password });
  expect(res.status).toBe(200);
  return res.json();
}

async function createTextRoom(be: Backend, token: string, title: string) {
  const res = await be.post("/api/rooms/text", { title, text: "para one\n\npara two" }, token);
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return be.supabase.room(id);
}

describe("user stories (production build)", () => {
  let be: Backend;

  // A high limit so the stories don't trip each other; the default limit is tested below.
  beforeAll(async () => {
    be = await startBackend({ AUTH_RATE_LIMIT: "100" });
  });
  afterAll(() => be?.stop());

  it("new user: sign up → verify by email → log in → create a room → log out", async () => {
    const email = uniqueEmail("new.user");
    const password = newPassword();

    // 1. Sign up: a verification email is sent, no session yet.
    const signup = await be.post("/api/auth/signup", { email, password, name: "New User" });
    expect(signup.status).toBe(201);
    expect(await be.supabase.verificationLinks(email)).toHaveLength(1);

    // 2. Logging in before verifying is refused.
    expect((await be.post("/api/auth/login", { email, password })).status).toBe(403);

    // 3. Room creation is refused without an account.
    expect((await be.post("/api/rooms/text", { text: "hello" })).status).toBe(401);

    // 4. Clicking the emailed link verifies the account and lands on the frontend login page.
    expect((await be.supabase.verificationLink(email)).startsWith(`${be.api}/api/auth/verify?`)).toBe(true);
    const verify = await be.clickVerificationLink(email);
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toBe(verifiedUrl(email));

    // 5. Log in.
    const session = await logIn(be, email, password);
    expect(session.user).toMatchObject({ email, name: "New User" });

    // 6. Who am I.
    expect(await (await be.get("/api/auth/me", session.access_token)).json()).toEqual(session.user);

    // 7. Create a room as the logged-in user.
    expect((await createTextRoom(be, session.access_token, "First room"))?.created_by).toBe(session.user.id);

    // 8. Refresh, then log out with the new token.
    const refreshed = await (await be.post("/api/auth/refresh", { refresh_token: session.refresh_token })).json();
    expect(refreshed.access_token).toEqual(expect.any(String));
    expect((await be.post("/api/auth/logout", {}, refreshed.access_token)).status).toBe(204);

    // 9. The revoked session no longer works.
    expect((await be.get("/api/auth/me", refreshed.access_token)).status).toBe(401);
    expect((await be.post("/api/auth/refresh", { refresh_token: refreshed.refresh_token })).status).toBe(401);
  });

  it("returning user: log in → create rooms → log out → log in again on a new session", async () => {
    const email = uniqueEmail("returning.user");
    const password = newPassword();
    await signUpAndVerify(be, email, password, "Returning User");

    // 1. Comes back later and logs in; no new verification email is needed.
    const first = await logIn(be, email, password);
    expect(await be.supabase.verificationLinks(email)).toHaveLength(1);

    // 2. Creates a text room and a PDF room; both belong to them.
    expect((await createTextRoom(be, first.access_token, "Notes"))?.created_by).toBe(first.user.id);

    const form = new FormData();
    const file = makePdf(["e2e"]);
    form.append("file", new Blob([new Uint8Array(file)], { type: "application/pdf" }), "paper.pdf");
    const pdf = await be.postForm("/api/rooms/pdf", form, first.access_token);
    expect(pdf.status).toBe(201);
    const { id: pdfId } = (await pdf.json()) as { id: string };
    const stored = await be.supabase.pdf(`${pdfId}.pdf`);
    expect(Buffer.from(await stored!.arrayBuffer()).equals(file)).toBe(true);
    expect(await be.supabase.room(pdfId)).toMatchObject({
      kind: "pdf",
      title: "paper.pdf",
      content_text: "[Page 1] e2e",
      created_by: first.user.id,
    });

    // 3. Logs out.
    expect((await be.post("/api/auth/logout", {}, first.access_token)).status).toBe(204);
    expect((await be.post("/api/rooms/text", { text: "hi" }, first.access_token)).status).toBe(401);

    // 4. Logs in again: a fresh session for the same account.
    const second = await logIn(be, email, password);
    expect(second.user).toEqual(first.user);
    expect(second.access_token).not.toBe(first.access_token);
    expect((await createTextRoom(be, second.access_token, "Again"))?.created_by).toBe(first.user.id);
  });

  it("lost email: sign up → link expires → resend → verify with the new link → log in", async () => {
    const email = uniqueEmail("lost.email");
    const password = newPassword();

    // 1. Signs up but doesn't click the link in time.
    expect((await be.post("/api/auth/signup", { email, password, name: "Lost Email" })).status).toBe(201);
    const oldLink = await be.supabase.verificationLink(email);
    await be.supabase.expireVerificationLink(email);

    // 2. The old link no longer works and says why.
    const expired = await be.clickVerificationLink(email);
    expect(expired.headers.get("location")).toBe(`${WEB}/login?verified=0&error=expired_link`);
    expect((await be.post("/api/auth/login", { email, password })).status).toBe(403);

    // 3. Asks for a new email.
    const resend = await be.post("/api/auth/resend-verification", { email });
    expect(resend.status).toBe(200);
    const newLink = await be.supabase.verificationLink(email, 2);
    expect(newLink).not.toBe(oldLink);

    // 4. The new link verifies the account.
    const verify = await be.clickVerificationLink(email, 2);
    expect(verify.headers.get("location")).toBe(verifiedUrl(email));

    // 5. Logs in and can create a room.
    const session = await logIn(be, email, password);
    expect((await createTextRoom(be, session.access_token, "Finally"))?.created_by).toBe(session.user.id);

    // 6. The new link can't be reused.
    const reused = await be.clickVerificationLink(email, 2);
    expect(reused.headers.get("location")).toBe(`${WEB}/login?verified=0&error=expired_link`);
  });

  it("taken email: signing up again can't take over an existing account", async () => {
    const email = uniqueEmail("owner");
    const ownerPassword = newPassword();
    const intruderPassword = newPassword();
    await signUpAndVerify(be, email, ownerPassword, "Owner");

    // 1. Someone signs up with the same email: same reply as a fresh signup, so the account isn't revealed.
    const again = await be.post("/api/auth/signup", { email, password: intruderPassword, name: "Intruder" });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ message: "Check your email to verify your account." });
    expect(await be.supabase.verificationLinks(email)).toHaveLength(1);

    // 2. Their password doesn't work; the owner's still does, with the owner's name.
    expect((await be.post("/api/auth/login", { email, password: intruderPassword })).status).toBe(401);
    expect((await logIn(be, email, ownerPassword)).user.name).toBe("Owner");
  });

  it("sends security headers and allows the frontend origin", async () => {
    const res = await fetch(`${be.api}/health`, { headers: { Origin: WEB } });
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("rate limiting (default limit of 10 per 15 min)", () => {
  let be: Backend;

  beforeAll(async () => {
    be = await startBackend();
  });
  afterAll(() => be?.stop());

  it("blocks the 11th auth request from the same IP across signup, login and resend", async () => {
    const email = uniqueEmail("brute.force");
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await be.post("/api/auth/login", { email, password: newPassword() })).status);
    }
    expect(statuses).toEqual(Array(10).fill(401));

    const login = await be.post("/api/auth/login", { email, password: newPassword() });
    expect(login.status).toBe(429);

    // The limit is shared, so signup and resend are blocked too.
    const signup = await be.post("/api/auth/signup", { email, password: newPassword(), name: "Late" });
    expect(signup.status).toBe(429);
    expect(await signup.json()).toEqual({ error: "Too many attempts. Try again in a few minutes." });
    expect((await be.post("/api/auth/resend-verification", { email })).status).toBe(429);

    // Routes outside the limiter keep working.
    expect((await be.get("/health")).status).toBe(200);
  });
});

describe("mail server down", () => {
  let be: Backend;

  // Nothing listens on port 1, so every email fails to send.
  beforeAll(async () => {
    be = await startBackend({ AUTH_RATE_LIMIT: "100", SMTP_PORT: "1" });
  });
  afterAll(() => be?.stop());

  it("signup and resend say the email didn't go out, so the user can try again", async () => {
    const email = uniqueEmail("no.smtp");
    const signup = await be.post("/api/auth/signup", { email, password: newPassword(), name: "Offline" });
    expect(signup.status).toBe(502);
    expect(await signup.json()).toEqual({ error: "Could not send the verification email. Please try again." });

    const resend = await be.post("/api/auth/resend-verification", { email });
    expect(resend.status).toBe(502);
  });
});
