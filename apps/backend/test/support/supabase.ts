import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { inject } from "vitest";

// Helpers for tests that run against the real local Supabase (`npm run supabase:start`):
// GoTrue auth, PostgREST, Storage and Postgres with our migrations applied, and Mailpit,
// which catches the emails the backend sends over SMTP.

export type LocalSupabase = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
  mailUrl: string;
};

export type TestSupabase = Awaited<ReturnType<typeof connectSupabase>>;

// The local database and inbox keep their data between runs, so every run uses new addresses.
const RUN = randomBytes(4).toString("hex");
export const uniqueEmail = (label: string) => `${label}.${RUN}@example.com`;

export async function connectSupabase() {
  const local = inject("supabase");
  const admin = createClient(local.url, local.serviceRoleKey, { auth: { persistSession: false } });
  const sql = postgres(local.dbUrl, { max: 2, onnotice: () => {} });
  const proxy = await startFaultProxy(local.url);

  // Verification links from the emails the backend sent to `email`, oldest first.
  async function verificationLinks(email: string) {
    const query = encodeURIComponent(`to:"${email}"`);
    const { messages } = (await (await fetch(`${local.mailUrl}/api/v1/search?query=${query}`)).json()) as {
      messages: { ID: string }[];
    };
    const links: string[] = [];
    for (const { ID } of messages.reverse()) {
      const { HTML } = (await (await fetch(`${local.mailUrl}/api/v1/message/${ID}`)).json()) as { HTML: string };
      const href = HTML.match(/href="([^"]+)"/)?.[1];
      if (href) links.push(href.replaceAll("&amp;", "&"));
    }
    return links;
  }

  return {
    anonKey: local.anonKey,
    serviceRoleKey: local.serviceRoleKey,
    // The backend under test talks to Supabase through the fault proxy; requests pass through
    // unchanged unless a test calls failNext.
    url: proxy.url,
    failNext: proxy.failNext,
    verificationLinks,
    // The latest verification link, once at least `count` emails have reached the inbox.
    async verificationLink(email: string, count = 1) {
      const deadline = Date.now() + 5_000;
      for (;;) {
        const links = await verificationLinks(email);
        if (links.length >= count) return links.at(-1)!;
        if (Date.now() > deadline) throw new Error(`expected ${count} verification email(s) to ${email}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    // Makes the user's current verification link expired, as if it had been sent a day ago.
    async expireVerificationLink(email: string) {
      await sql`update auth.users set confirmation_sent_at = now() - interval '1 day' where email = ${email}`;
    },
    // The signup route's guarded password write (migration 0015), called directly.
    async setUnconfirmedPassword(userId: string, password: string) {
      const { data, error } = await admin.rpc("set_unconfirmed_password", { p_user_id: userId, p_password: password });
      if (error) throw error;
      return data as boolean;
    },
    async room(id: string) {
      const { data, error } = await admin.from("rooms").select().eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
    // AI state and chunks of a room (lib/ai-jobs.ts), read past RLS.
    async aiState(roomId: string) {
      const { data, error } = await admin.from("room_ai").select("status, error").eq("room_id", roomId).maybeSingle();
      if (error) throw error;
      return data as { status: string; error: string | null } | null;
    },
    async chunks(roomId: string) {
      const { data, error } = await admin.from("chunks").select().eq("room_id", roomId).order("idx");
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
    async matchChunks(roomId: string, query: string) {
      const { data, error } = await admin.rpc("match_chunks", { p_room: roomId, p_embedding: null, p_query: query, p_k: 8 });
      if (error) throw error;
      return data as { idx: number; content: string; block_ids: string[] }[];
    },
    async pdf(path: string) {
      const { data, error } = await admin.storage.from("pdfs").download(path);
      return error ? null : data;
    },
    close: async () => {
      await proxy.close();
      await sql.end();
    },
  };
}

// Forwards every request to the real Supabase. failNext makes the next request to one route
// fail once, for outages that can't be caused on demand (e.g. a 500 from the auth server).
async function startFaultProxy(upstream: string) {
  const failures = new Map<string, { status: number; code: string }>();

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const route = `${req.method} ${new URL(req.url ?? "/", upstream).pathname}`;

    const failure = failures.get(route);
    if (failure) {
      failures.delete(route);
      res.writeHead(failure.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ code: failure.status, error_code: failure.code, msg: `injected ${failure.code}` }));
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (key !== "host" && key !== "connection" && typeof value === "string") headers.set(key, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const upstreamRes = await fetch(`${upstream}${req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
      redirect: "manual",
    });
    const body = Buffer.from(await upstreamRes.arrayBuffer());
    // fetch has already decoded the body, so its original encoding and length no longer apply.
    const outHeaders: Record<string, string> = {};
    upstreamRes.headers.forEach((value, key) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key)) {
        outHeaders[key] = value;
      }
    });
    res.writeHead(upstreamRes.status, outHeaders);
    res.end(body);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: `fault proxy: ${String(err)}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    // e.g. failNext("POST /auth/v1/logout", 500, "unexpected_failure")
    failNext(route: string, status: number, code: string) {
      failures.set(route, { status, code });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
