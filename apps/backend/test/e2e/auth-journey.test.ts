import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeSupabase, type FakeSupabase } from "../support/fake-supabase";

// Runs the production build (`npm run build`) as a separate process, the way it is deployed,
// with the default auth rate limit, and walks through the whole account journey over HTTP.

const DIST = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const WEB = "http://web.e2e";

let supabase: FakeSupabase;
let server: ChildProcess;
let api: string;
let logs = "";

async function freePort() {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address() as AddressInfo;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

async function waitForHealth(url: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`backend exited early:\n${logs}`);
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`backend did not start:\n${logs}`);
}

beforeAll(async () => {
  if (!existsSync(DIST)) throw new Error("dist/index.js is missing: run `npm run build` first");

  supabase = await startFakeSupabase();
  const port = await freePort();
  api = `http://127.0.0.1:${port}`;

  server = spawn(process.execPath, [DIST], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      SERVER_PORT: String(port),
      WEB_ORIGIN: WEB,
      API_PUBLIC_URL: api,
      SUPABASE_URL: supabase.url,
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d) => (logs += d));
  server.stderr?.on("data", (d) => (logs += d));
  await waitForHealth(api);
});

afterAll(async () => {
  server?.kill();
  await supabase?.close();
});

const post = (path: string, body: unknown, token?: string) =>
  fetch(`${api}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });

const get = (path: string, token?: string) =>
  fetch(`${api}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe("account journey against the production build", () => {
  const email = "e2e.user@example.com";
  const password = "a long enough password";

  it("signs up, verifies by email, logs in, creates a room and logs out", async () => {
    // 1. Sign up: a verification email is sent, no session yet.
    const signup = await post("/api/auth/signup", { email, password, name: "E2E User" });
    expect(signup.status).toBe(201);
    expect(supabase.outbox).toHaveLength(1);

    // 2. Logging in before verifying is refused.
    expect((await post("/api/auth/login", { email, password })).status).toBe(403);

    // 3. Room creation is refused without an account.
    expect((await post("/api/rooms/text", { text: "hello" })).status).toBe(401);

    // 4. Clicking the emailed link verifies the account and lands on the frontend login page.
    const link = supabase.verificationLink(email);
    expect(link.startsWith(`${api}/api/auth/verify?`)).toBe(true);
    const verify = await fetch(link, { redirect: "manual" });
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toBe(`${WEB}/login?verified=1`);

    // 5. Log in.
    const login = await post("/api/auth/login", { email, password });
    expect(login.status).toBe(200);
    const session = await login.json();
    expect(session.user).toMatchObject({ email, name: "E2E User" });

    // 6. Who am I.
    const me = await get("/api/auth/me", session.access_token);
    expect(await me.json()).toEqual(session.user);

    // 7. Create a room as the logged-in user.
    const room = await post("/api/rooms/text", { title: "E2E", text: "para one\n\npara two" }, session.access_token);
    expect(room.status).toBe(201);
    const { id } = await room.json();
    expect(supabase.rows("rooms").find((r) => r.id === id)?.created_by).toBe(session.user.id);

    // 8. Refresh, then log out with the new token.
    const refreshed = await (await post("/api/auth/refresh", { refresh_token: session.refresh_token })).json();
    expect(refreshed.access_token).toEqual(expect.any(String));
    const logout = await post("/api/auth/logout", {}, refreshed.access_token);
    expect(logout.status).toBe(204);

    // 9. The revoked session no longer works.
    expect((await get("/api/auth/me", refreshed.access_token)).status).toBe(401);
    expect((await post("/api/auth/refresh", { refresh_token: refreshed.refresh_token })).status).toBe(401);
  });

  it("sends security headers and allows the frontend origin", async () => {
    const res = await fetch(`${api}/health`, { headers: { Origin: WEB } });
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rate limits repeated login attempts", async () => {
    // The journey above used 3 of the 10 attempts in this window (signup and two logins),
    // so 7 more get through and the rest are blocked.
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) {
      statuses.push((await post("/api/auth/login", { email, password: "wrong password" })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 401, 429, 429]);

    const limited = await post("/api/auth/signup", { email: "late@example.com", password, name: "Late" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "Too many attempts. Try again in a few minutes." });
  });
});
