import { randomBytes } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makePdf } from "../support/pdf";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

let supabase: TestSupabase;
let app: Express;

const API = "http://127.0.0.1:4000";
const WEB = "http://web.test";
// Generated per run: these only reach the local Supabase.
const PASSWORD = randomBytes(12).toString("base64url");

beforeAll(async () => {
  supabase = await connectSupabase();
  Object.assign(process.env, {
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    API_PUBLIC_URL: API,
    WEB_ORIGIN: WEB,
    AUTH_RATE_LIMIT: "1000",
  });
  // env.ts reads process.env on import, so load the app after setting it.
  const { createApp } = await import("../../src/app");
  app = createApp();
});

afterAll(() => supabase?.close());

// Where the emailed link lands once it verifies the account: the login page, email filled in.
const verifiedUrl = (email: string) => `${WEB}/login?${new URLSearchParams({ verified: "1", email })}`;

let n = 0;
const newEmail = () => uniqueEmail(`user${++n}`);

const signup = (email: string, password = PASSWORD, name = "abhishek") =>
  request(app).post("/api/auth/signup").send({ email, password, name });

const login = (email: string, password = PASSWORD) =>
  request(app).post("/api/auth/login").send({ email, password });

// Follows the emailed link through our backend, as a browser would.
async function verify(email: string, count?: number) {
  const link = new URL(await supabase.verificationLink(email, count));
  return request(app).get(`${link.pathname}${link.search}`);
}

async function verifiedSession(email = newEmail()) {
  await signup(email);
  await verify(email);
  const res = await login(email);
  expect(res.status).toBe(200);
  return res.body as { access_token: string; refresh_token: string; user: { id: string } };
}

describe("POST /api/auth/signup", () => {
  it("creates the user and sends a verification email pointing at the backend", async () => {
    const email = newEmail();
    const res = await signup(email);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "Check your email to verify your account." });
    expect(await supabase.verificationLink(email)).toMatch(`${API}/api/auth/verify?token_hash=`);
  });

  it("normalises the email before sending it to Supabase", async () => {
    const email = uniqueEmail("mixed.case");
    const res = await signup(`  ${email.replace("mixed.case", "Mixed.Case").replace("example.com", "Example.COM")} `);
    expect(res.status).toBe(201);
    expect(await supabase.verificationLinks(email)).toHaveLength(1);
  });

  it("gives the same reply for an already registered email", async () => {
    const email = uniqueEmail("taken");
    const { user } = await verifiedSession(email);
    const res = await signup(email, `${PASSWORD}-other`);

    expect(user.id).toBeTruthy();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "Check your email to verify your account." });
  });

  it("signing up again before verifying: only the newest link works, with the newest password and name", async () => {
    const email = newEmail();
    const firstPassword = `${PASSWORD}-first`;
    await signup(email, firstPassword, "First");
    const firstLink = await supabase.verificationLink(email);
    expect((await signup(email, PASSWORD, "Second")).status).toBe(201);
    await supabase.verificationLink(email, 2);

    const old = new URL(firstLink);
    expect((await request(app).get(`${old.pathname}${old.search}`)).headers.location).toBe(
      `${WEB}/login?verified=0&error=expired_link`,
    );
    expect((await verify(email, 2)).headers.location).toBe(verifiedUrl(email));

    expect((await login(email, firstPassword)).status).toBe(401);
    const res = await login(email);
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Second");
  });

  it("never changes a verified account's password, even for a signup that raced the verification", async () => {
    // A signup that passed its first check while the account was unverified reaches the
    // password write only after the owner verified: the write must do nothing.
    const email = newEmail();
    const { user } = await verifiedSession(email);
    expect(await supabase.setUnconfirmedPassword(user.id, `${PASSWORD}-attacker`)).toBe(false);

    expect((await login(email, `${PASSWORD}-attacker`)).status).toBe(401);
    expect((await login(email)).status).toBe(200);
  });

  it.each([
    [{ email: "nope", password: PASSWORD, name: "A" }, /Invalid email/],
    [{ email: "a@b.co", password: "short", name: "A" }, /at least 8 characters/],
    [{ email: "a@b.co", password: "x".repeat(73), name: "A" }, /.+/],
    [{ email: "a@b.co", password: PASSWORD, name: "   " }, /.+/],
    [{ email: "a@b.co", password: PASSWORD, name: "x".repeat(41) }, /.+/],
    [{ email: "a@b.co", password: PASSWORD }, /.+/],
  ])("rejects invalid input %j with 400", async (body, message) => {
    const res = await request(app).post("/api/auth/signup").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });
});

describe("GET /api/auth/verify", () => {
  it("confirms the email and redirects to the login page", async () => {
    const email = newEmail();
    await signup(email);
    const res = await verify(email);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(verifiedUrl(email));
    expect((await login(email)).status).toBe(200);
  });

  it("rejects a link that was already used", async () => {
    const email = newEmail();
    await signup(email);
    await verify(email);
    const res = await verify(email);

    expect(res.headers.location).toBe(`${WEB}/login?verified=0&error=expired_link`);
  });

  it("reports an expired link", async () => {
    const email = newEmail();
    await signup(email);
    await supabase.expireVerificationLink(email);
    const res = await verify(email);

    expect(res.headers.location).toBe(`${WEB}/login?verified=0&error=expired_link`);
    expect((await login(email)).status).toBe(403);
  });

  it.each(["", "?type=email", "?token_hash=abc&type=recovery"])("redirects malformed link %j", async (query) => {
    const res = await request(app).get(`/api/auth/verify${query}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${WEB}/login?verified=0&error=invalid_link`);
  });
});

describe("POST /api/auth/resend-verification", () => {
  it("sends a fresh link that works", async () => {
    const email = newEmail();
    await signup(email);
    await supabase.expireVerificationLink(email);

    const res = await request(app).post("/api/auth/resend-verification").send({ email });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sent a new email/);

    expect((await verify(email, 2)).headers.location).toBe(verifiedUrl(email));
  });

  it("gives the same reply for unknown emails, without creating an account or sending anything", async () => {
    const email = uniqueEmail("ghost");
    const res = await request(app).post("/api/auth/resend-verification").send({ email });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sent a new email/);
    expect(await supabase.verificationLinks(email)).toHaveLength(0);
    expect((await login(email)).status).toBe(401);
  });

  it("sends nothing to an account that is already verified", async () => {
    const email = newEmail();
    await verifiedSession(email);
    const res = await request(app).post("/api/auth/resend-verification").send({ email });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sent a new email/);
    // Give a stray email time to arrive before counting.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await supabase.verificationLinks(email)).toHaveLength(1);
  });
});

describe("POST /api/auth/login", () => {
  it("refuses an unverified account with 403", async () => {
    const email = newEmail();
    await signup(email);
    const res = await login(email);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Please verify your email first" });
  });

  it("returns a session for a verified account", async () => {
    const email = newEmail();
    await signup(email, PASSWORD, "Arun");
    await verify(email);
    const res = await login(email);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      expires_at: expect.any(Number),
      user: { id: expect.any(String), email, name: "Arun" },
    });
  });

  it("returns the same 401 for a wrong password and an unknown email", async () => {
    const email = newEmail();
    await verifiedSession(email);

    for (const res of [await login(email, `${PASSWORD}-wrong`), await login(uniqueEmail("nobody"))]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Invalid email or password" });
    }
  });
});

describe("authenticated session", () => {
  it("GET /me returns the user for a valid token and 401 otherwise", async () => {
    const session = await verifiedSession();

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${session.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body).toEqual(session.user);

    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", "Bearer forged")).status).toBe(401);
  });

  it("POST /refresh rotates the tokens", async () => {
    const session = await verifiedSession();

    const res = await request(app).post("/api/auth/refresh").send({ refresh_token: session.refresh_token });
    expect(res.status).toBe(200);
    expect(res.body.access_token).not.toBe(session.access_token);
    expect(res.body.refresh_token).not.toBe(session.refresh_token);
    expect(res.body.user).toEqual(session.user);

    // Supabase accepts the old refresh token for a few seconds (refresh_token_reuse_interval), so two
    // tabs refreshing at once both stay logged in. Logging out ends it for good (see the logout test).
    const reused = await request(app).post("/api/auth/refresh").send({ refresh_token: session.refresh_token });
    expect(reused.status).toBe(200);
  });

  it("POST /refresh refuses an unknown refresh token", async () => {
    const res = await request(app).post("/api/auth/refresh").send({ refresh_token: "not-a-real-token" });
    expect(res.status).toBe(401);
  });

  it("POST /refresh reports a temporary Auth failure with 503 and keeps the token usable", async () => {
    const session = await verifiedSession();
    supabase.failNext("POST /auth/v1/token", 429, "over_request_rate_limit");

    const failed = await request(app).post("/api/auth/refresh").send({ refresh_token: session.refresh_token });
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({ error: "Could not refresh your session. Please try again." });

    const retried = await request(app).post("/api/auth/refresh").send({ refresh_token: session.refresh_token });
    expect(retried.status).toBe(200);
  });

  it("POST /logout revokes the session", async () => {
    const session = await verifiedSession();
    const auth = `Bearer ${session.access_token}`;

    expect((await request(app).post("/api/auth/logout").set("Authorization", auth)).status).toBe(204);
    expect((await request(app).get("/api/auth/me").set("Authorization", auth)).status).toBe(401);
    const refresh = await request(app).post("/api/auth/refresh").send({ refresh_token: session.refresh_token });
    expect(refresh.status).toBe(401);
  });

  it("POST /logout reports a failed revoke with 502 so the client can retry", async () => {
    const session = await verifiedSession();
    const auth = `Bearer ${session.access_token}`;
    supabase.failNext("POST /auth/v1/logout", 500, "unexpected_failure");

    const failed = await request(app).post("/api/auth/logout").set("Authorization", auth);
    expect(failed.status).toBe(502);
    expect(failed.body).toEqual({ error: "Could not log out. Please try again." });

    // The session was not revoked, so the retry succeeds and then revokes it.
    expect((await request(app).post("/api/auth/logout").set("Authorization", auth)).status).toBe(204);
    expect((await request(app).get("/api/auth/me").set("Authorization", auth)).status).toBe(401);
  });

  it("POST /logout treats an already-ended session as logged out", async () => {
    const session = await verifiedSession();
    supabase.failNext("POST /auth/v1/logout", 404, "session_not_found");

    const res = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${session.access_token}`);
    expect(res.status).toBe(204);
  });

  it("POST /logout needs a token", async () => {
    expect((await request(app).post("/api/auth/logout")).status).toBe(401);
  });
});

describe("room creation authorization", () => {
  it.each(["/api/rooms/link", "/api/rooms/text", "/api/rooms/pdf"])("%s needs a token", async (path) => {
    const res = await request(app).post(path).send({ text: "hi", url: "https://example.com" });
    expect(res.status).toBe(401);
  });

  it("text rooms record the creator", async () => {
    const session = await verifiedSession();
    const res = await request(app)
      .post("/api/rooms/text")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ title: "Notes", text: "first\n\nsecond" });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[\w-]{8}$/);
    expect(await supabase.room(res.body.id)).toMatchObject({
      kind: "link",
      title: "Notes",
      created_by: session.user.id,
      content_html: '<p data-block="b0">first</p><p data-block="b1">second</p>',
    });
  });

  it("pdf rooms upload the file, keep its text and record the creator", async () => {
    const session = await verifiedSession();
    const file = makePdf(["Attention is all you need", "Results"]);
    const res = await request(app)
      .post("/api/rooms/pdf")
      .set("Authorization", `Bearer ${session.access_token}`)
      .attach("file", file, { filename: "résumé.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    const stored = await supabase.pdf(`${res.body.id}.pdf`);
    expect(Buffer.from(await stored!.arrayBuffer()).equals(file)).toBe(true);
    expect(await supabase.room(res.body.id)).toMatchObject({
      kind: "pdf",
      title: "résumé.pdf",
      pdf_path: `${res.body.id}.pdf`,
      content_text: "[Page 1] Attention is all you need\n\n[Page 2] Results",
      created_by: session.user.id,
    });
  });

  const uploadPdf = async (file: Buffer, contentType = "application/pdf") => {
    const session = await verifiedSession();
    return request(app)
      .post("/api/rooms/pdf")
      .set("Authorization", `Bearer ${session.access_token}`)
      .attach("file", file, { filename: "paper.pdf", contentType });
  };

  it("pdf rooms reject other file types", async () => {
    const res = await uploadPdf(Buffer.from("hello"), "text/plain");
    expect(res.status).toBe(400);
  });

  it("pdf rooms check the bytes, not the Content-Type", async () => {
    const res = await uploadPdf(Buffer.from("<html>not a pdf</html>"));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "That file is not a PDF" });
  });

  it("pdf rooms refuse a damaged PDF", async () => {
    const res = await uploadPdf(Buffer.from("%PDF-1.4 but nothing else"));
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "We couldn't read this PDF. It may be damaged." });
  });

  it("pdf rooms refuse files over 20 MB with a 413", async () => {
    const big = Buffer.concat([makePdf(["big"]), Buffer.alloc(20 * 1024 * 1024)]);
    const res = await uploadPdf(big);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "PDF must be 20 MB or smaller" });
  });

  it("pdf rooms need a file", async () => {
    const session = await verifiedSession();
    const res = await request(app)
      .post("/api/rooms/pdf")
      .set("Authorization", `Bearer ${session.access_token}`)
      .field("title", "no file");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "A PDF file is required" });
  });

  it("link rooms pass auth and then apply URL checks", async () => {
    const session = await verifiedSession();
    const res = await request(app)
      .post("/api/rooms/link")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ url: "http://127.0.0.1/admin" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid URL" });
  });

  it("a token from a logged-out session is refused", async () => {
    const session = await verifiedSession();
    await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${session.access_token}`);
    const res = await request(app)
      .post("/api/rooms/text")
      .set("Authorization", `Bearer ${session.access_token}`)
      .send({ text: "hi" });

    expect(res.status).toBe(401);
  });
});

describe("health and unknown routes", () => {
  it("GET /health works without auth", async () => {
    expect((await request(app).get("/health")).body).toEqual({ ok: true, service: "backend" });
  });

  it("unknown routes return JSON 404", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});
