import { randomBytes } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeSupabase, type FakeSupabase } from "../support/fake-supabase";

let supabase: FakeSupabase;
let app: Express;

const API = "http://api.test";
const WEB = "http://web.test";
// Generated per run: these only reach the fake Supabase server.
const PASSWORD = randomBytes(12).toString("base64url");

beforeAll(async () => {
  supabase = await startFakeSupabase();
  Object.assign(process.env, {
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    API_PUBLIC_URL: API,
    WEB_ORIGIN: WEB,
    AUTH_RATE_LIMIT: "1000",
  });
  // env.ts reads process.env on import, so load the app after setting it.
  const { createApp } = await import("../../src/app");
  app = createApp();
});

afterAll(() => supabase.close());

let n = 0;
const newEmail = () => `user${++n}@example.com`;

const signup = (email: string, password = PASSWORD, name = "Priya") =>
  request(app).post("/api/auth/signup").send({ email, password, name });

const login = (email: string, password = PASSWORD) =>
  request(app).post("/api/auth/login").send({ email, password });

// Follows the emailed link through our backend, as a browser would.
async function verify(email: string) {
  const link = new URL(supabase.verificationLink(email));
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
    expect(supabase.outbox.at(-1)).toMatchObject({ to: email, redirectTo: `${API}/api/auth/verify` });
  });

  it("normalises the email before sending it to Supabase", async () => {
    const res = await signup("  Mixed.Case@Example.COM ");
    expect(res.status).toBe(201);
    expect(supabase.outbox.at(-1)?.to).toBe("mixed.case@example.com");
  });

  it("gives the same reply for an already registered email", async () => {
    const { user } = await verifiedSession("taken@example.com");
    const res = await signup("taken@example.com", `${PASSWORD}-other`);

    expect(user.id).toBeTruthy();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "Check your email to verify your account." });
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
    expect(res.headers.location).toBe(`${WEB}/login?verified=1`);
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
    supabase.expireVerificationTokens();
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
    supabase.expireVerificationTokens();

    const res = await request(app).post("/api/auth/resend-verification").send({ email });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sent a new email/);

    expect((await verify(email)).headers.location).toBe(`${WEB}/login?verified=1`);
  });

  it("gives the same reply for unknown emails", async () => {
    const res = await request(app).post("/api/auth/resend-verification").send({ email: "ghost@example.com" });
    expect(res.status).toBe(200);
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

    for (const res of [await login(email, `${PASSWORD}-wrong`), await login("nobody@example.com")]) {
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
    expect(res.body.user).toEqual(session.user);

    const reused = await request(app).post("/api/auth/refresh").send({ refresh_token: session.refresh_token });
    expect(reused.status).toBe(401);
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
    expect(supabase.rows("rooms").find((r) => r.id === res.body.id)).toMatchObject({
      kind: "link",
      title: "Notes",
      created_by: session.user.id,
      content_html: '<p data-block="b0">first</p><p data-block="b1">second</p>',
    });
  });

  it("pdf rooms upload the file and record the creator", async () => {
    const session = await verifiedSession();
    const res = await request(app)
      .post("/api/rooms/pdf")
      .set("Authorization", `Bearer ${session.access_token}`)
      .attach("file", Buffer.from("%PDF-1.4 fake"), { filename: "paper.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(supabase.objects.get(`pdfs/${res.body.id}.pdf`)).toBeDefined();
    expect(supabase.rows("rooms").find((r) => r.id === res.body.id)).toMatchObject({
      kind: "pdf",
      title: "paper.pdf",
      created_by: session.user.id,
    });
  });

  it("pdf rooms reject other file types", async () => {
    const session = await verifiedSession();
    const res = await request(app)
      .post("/api/rooms/pdf")
      .set("Authorization", `Bearer ${session.access_token}`)
      .attach("file", Buffer.from("hello"), { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
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
