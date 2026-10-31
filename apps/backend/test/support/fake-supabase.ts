import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// In-memory stand-in for the Supabase HTTP APIs the backend uses (GoTrue auth,
// PostgREST inserts, Storage uploads). The real supabase-js client talks to it
// over HTTP, so tests cover our code plus the client library without a real project.

type FakeUser = {
  id: string;
  email: string;
  password: string;
  name: string;
  confirmedAt: string | null;
  createdAt: string;
};

export type SentEmail = { to: string; type: "signup"; redirectTo: string; tokenHash: string };

export type FakeSupabase = Awaited<ReturnType<typeof startFakeSupabase>>;

const b64url = (data: unknown) => Buffer.from(JSON.stringify(data)).toString("base64url");

export async function startFakeSupabase() {
  const users = new Map<string, FakeUser>(); // by email
  const accessTokens = new Map<string, string>(); // token -> user id
  const refreshTokens = new Map<string, { userId: string; access: string }>();
  const verifyTokens = new Map<string, { userId: string; expired: boolean }>();
  const outbox: SentEmail[] = [];
  const tables = new Map<string, Record<string, unknown>[]>();
  const objects = new Map<string, { contentType: string; size: number }>();
  // One-shot injected failures, keyed by "METHOD /path".
  const failures = new Map<string, { status: number; code: string }>();

  const userById = (id: string) => [...users.values()].find((u) => u.id === id);

  const userJson = (u: FakeUser) => ({
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.confirmedAt,
    confirmed_at: u.confirmedAt,
    user_metadata: { name: u.name },
    app_metadata: { provider: "email" },
    identities: [],
    created_at: u.createdAt,
  });

  const issueSession = (u: FakeUser) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: u.id, exp })}.${randomBytes(8).toString("hex")}`;
    const refresh = randomBytes(16).toString("hex");
    accessTokens.set(access, u.id);
    refreshTokens.set(refresh, { userId: u.id, access });
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: exp,
      refresh_token: refresh,
      user: userJson(u),
    };
  };

  const sendVerification = (u: FakeUser, redirectTo: string) => {
    const tokenHash = randomBytes(16).toString("hex");
    verifyTokens.set(tokenHash, { userId: u.id, expired: false });
    outbox.push({ to: u.email, type: "signup", redirectTo, tokenHash });
  };

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const authError = (res: ServerResponse, status: number, code: string, msg: string) =>
    send(res, status, { code: status, error_code: code, msg });

  const bearer = (req: IncomingMessage) => req.headers.authorization?.replace(/^Bearer /, "") ?? "";

  async function readBody(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://fake");
    const raw = await readBody(req);
    const isJson = req.headers["content-type"]?.includes("application/json");
    const body = isJson && raw.length ? JSON.parse(raw.toString()) : {};
    const route = `${req.method} ${url.pathname}`;

    const failure = failures.get(route);
    if (failure) {
      failures.delete(route);
      return authError(res, failure.status, failure.code, `fake-supabase: injected ${failure.code}`);
    }

    // --- GoTrue ---
    if (route === "POST /auth/v1/signup") {
      if (typeof body.password !== "string" || body.password.length < 6) {
        return send(res, 422, {
          code: 422,
          error_code: "weak_password",
          msg: "Password should be at least 6 characters.",
          weak_password: { reasons: ["length"] },
        });
      }
      const redirectTo = url.searchParams.get("redirect_to") ?? "";
      const existing = users.get(body.email);
      if (existing) {
        // Like Supabase with "Confirm email" on: no error, an obfuscated user, no session.
        if (!existing.confirmedAt) sendVerification(existing, redirectTo);
        return send(res, 200, { ...userJson(existing), id: randomUUID(), identities: [] });
      }
      const user: FakeUser = {
        id: randomUUID(),
        email: body.email,
        password: body.password,
        name: body.data?.name ?? "",
        confirmedAt: null,
        createdAt: new Date().toISOString(),
      };
      users.set(user.email, user);
      sendVerification(user, redirectTo);
      return send(res, 200, userJson(user));
    }

    if (route === "POST /auth/v1/verify") {
      const entry = verifyTokens.get(body.token_hash);
      if (!entry) return authError(res, 403, "otp_expired", "Email link is invalid or has expired");
      if (entry.expired) return authError(res, 403, "otp_expired", "Email link is invalid or has expired");
      verifyTokens.delete(body.token_hash);
      const user = userById(entry.userId)!;
      user.confirmedAt = new Date().toISOString();
      return send(res, 200, issueSession(user));
    }

    if (route === "POST /auth/v1/resend") {
      const user = users.get(body.email);
      if (user && !user.confirmedAt) sendVerification(user, url.searchParams.get("redirect_to") ?? "");
      return send(res, 200, {});
    }

    if (route === "POST /auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const user = users.get(body.email);
        if (!user || user.password !== body.password) {
          return authError(res, 400, "invalid_credentials", "Invalid login credentials");
        }
        if (!user.confirmedAt) return authError(res, 400, "email_not_confirmed", "Email not confirmed");
        return send(res, 200, issueSession(user));
      }
      if (grant === "refresh_token") {
        const entry = refreshTokens.get(body.refresh_token);
        if (!entry) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
        refreshTokens.delete(body.refresh_token);
        accessTokens.delete(entry.access);
        return send(res, 200, issueSession(userById(entry.userId)!));
      }
    }

    if (route === "GET /auth/v1/user") {
      const userId = accessTokens.get(bearer(req));
      const user = userId ? userById(userId) : undefined;
      if (!user) return authError(res, 401, "bad_jwt", "invalid JWT");
      return send(res, 200, userJson(user));
    }

    if (route === "POST /auth/v1/logout") {
      const token = bearer(req);
      if (!accessTokens.has(token)) return authError(res, 401, "bad_jwt", "invalid JWT");
      accessTokens.delete(token);
      for (const [refresh, entry] of refreshTokens) if (entry.access === token) refreshTokens.delete(refresh);
      return send(res, 204);
    }

    // --- PostgREST ---
    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (req.method === "POST" && table) {
      const rows = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
      tables.set(table, [...(tables.get(table) ?? []), ...rows]);
      return send(res, 201);
    }

    // --- Storage ---
    const object = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (req.method === "POST" && object) {
      const key = `${object[1]}/${object[2]}`;
      objects.set(key, { contentType: String(req.headers["content-type"]), size: raw.length });
      return send(res, 200, { Key: key, Id: randomUUID() });
    }

    send(res, 404, { message: `fake-supabase: no route for ${route}` });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => send(res, 500, { message: String(err) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    outbox,
    rows: (name: string) => tables.get(name) ?? [],
    objects,
    // The link the "Confirm signup" template builds: {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email
    verificationLink(email: string) {
      const mail = [...outbox].reverse().find((m) => m.to === email);
      if (!mail) throw new Error(`no verification email sent to ${email}`);
      return `${mail.redirectTo}?token_hash=${mail.tokenHash}&type=email`;
    },
    // Makes the next request to `route` (e.g. "POST /auth/v1/logout") fail once.
    failNext(route: string, status: number, code: string) {
      failures.set(route, { status, code });
    },
    expireVerificationTokens() {
      for (const entry of verifyTokens.values()) entry.expired = true;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
