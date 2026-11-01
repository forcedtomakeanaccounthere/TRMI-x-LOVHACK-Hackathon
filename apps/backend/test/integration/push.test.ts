import { createECDH, randomBytes } from "node:crypto";
import http, { createServer, type Server } from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import request from "supertest";
import webpush from "web-push";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

// Web Push with real VAPID keys, delivered to a local stand-in for the browser's push service: a
// mention of a reader whose tab is closed reaches every browser they subscribed, and a browser the
// push service says is gone (410) is forgotten. Real push services are HTTPS only, and so is
// web-push; the stand-in speaks plain HTTP, so requests to it (and only it) skip TLS.

let supabase: TestSupabase;
let app: Express;
let pushService: Server;
let pushUrl: string;
const deliveries: { path: string; headers: Record<string, string | string[] | undefined>; bytes: number }[] = [];

const browserKeys = () => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
};

async function signUp(label: string, name: string) {
  const email = uniqueEmail(label);
  const password = randomBytes(12).toString("base64url");
  await request(app).post("/api/auth/signup").send({ email, password, name });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  const login = await request(app).post("/api/auth/login").send({ email, password });
  return { id: login.body.user.id as string, token: login.body.access_token as string, name };
}

beforeAll(async () => {
  pushService = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      deliveries.push({ path: req.url ?? "", headers: req.headers, bytes: Buffer.concat(chunks).length });
      res.writeHead(req.url?.startsWith("/gone") ? 410 : 201).end();
    });
  });
  await new Promise<void>((resolve) => pushService.listen(0, "127.0.0.1", resolve));
  const port = (pushService.address() as AddressInfo).port;
  pushUrl = `https://127.0.0.1:${port}`;
  const realRequest = https.request.bind(https);
  vi.spyOn(https, "request").mockImplementation(((options: https.RequestOptions, callback?: (res: http.IncomingMessage) => void) => {
    if (options.hostname === "127.0.0.1" && Number(options.port) === port) {
      const plain = { ...options, agent: undefined };
      return http.request({ ...plain, protocol: "http:" }, callback);
    }
    return realRequest(options, callback);
  }) as typeof https.request);

  supabase = await connectSupabase();
  const vapid = webpush.generateVAPIDKeys();
  Object.assign(process.env, {
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    API_PUBLIC_URL: "http://127.0.0.1:4000",
    WEB_ORIGIN: "http://web.test",
    AUTH_RATE_LIMIT: "1000",
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "mailto:test@linkroom.local",
  });
  const { createApp } = await import("../../src/app");
  app = createApp();
});

afterAll(async () => {
  await new Promise((resolve) => pushService.close(resolve));
  await supabase.close();
});

describe("web push for an offline reader", () => {
  it("serves the public key, delivers to each subscribed browser and drops the gone one", async () => {
    const [ana, cleo] = [await signUp("push-ana", "Ana"), await signUp("push-cleo", "Cleo")];

    const key = await request(app).get("/api/notifications/key").set({ Authorization: `Bearer ${cleo.token}` });
    expect(key.body.vapid_public_key).toBe(process.env.VAPID_PUBLIC_KEY);

    const live = `${pushUrl}/live/${randomBytes(4).toString("hex")}`;
    const gone = `${pushUrl}/gone/${randomBytes(4).toString("hex")}`;
    for (const endpoint of [live, gone]) {
      const res = await request(app)
        .post("/api/notifications/subscribe")
        .set({ Authorization: `Bearer ${cleo.token}` })
        .send({ endpoint, keys: browserKeys() });
      expect(res.status).toBe(200);
    }

    const room = await request(app)
      .post("/api/rooms/text")
      .set({ Authorization: `Bearer ${ana.token}` })
      .send({ title: "Push room", text: "Some text to read." });
    const roomId = room.body.id as string;
    await request(app).post(`/api/rooms/${roomId}/join`).set({ Authorization: `Bearer ${cleo.token}` });
    await supabase.setLastSeen(roomId, cleo.id, new Date(Date.now() - 10 * 60_000));

    const res = await request(app)
      .post(`/api/notifications/rooms/${roomId}/mentions`)
      .set({ Authorization: `Bearer ${ana.token}` })
      .send({
        event_id: `push-${randomBytes(4).toString("hex")}`,
        kind: "note",
        body: "@Cleo come back",
        author: { id: ana.id, name: "Ana" },
        mentions: [{ id: cleo.id, name: "Cleo" }],
      });
    expect(res.body).toEqual({ notified: 1 });

    const paths = deliveries.map((d) => d.path).sort();
    expect(paths).toEqual([new URL(gone).pathname, new URL(live).pathname].sort());
    for (const d of deliveries) {
      // Encrypted for the browser and signed with our VAPID key.
      expect(d.headers["content-encoding"]).toBe("aes128gcm");
      expect(String(d.headers.authorization)).toMatch(/^vapid t=.+, k=/);
      expect(d.bytes).toBeGreaterThan(0);
    }

    const left = await supabase.sql<{ endpoint: string }[]>`select endpoint from push_subscriptions where user_id = ${cleo.id}`;
    expect(left.map((r) => r.endpoint)).toEqual([live]);
  });
});
