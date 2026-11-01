import { createECDH, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

// @mentions and notifications against the real local Supabase: the notification rows, the Mailpit
// inbox for offline readers, the realtime toast for online ones, and the push subscription store.

let supabase: TestSupabase;
let app: Express;

type User = { id: string; email: string; name: string; token: string };
let owner: User; // Ana: created the room
let online: User; // Ben: has the room open
let offline: User; // Cleo: opened the room once, tab closed since
let stranger: User; // Dev: never opened it
let roomId: string;

const auth = (u: User) => ({ Authorization: `Bearer ${u.token}` });

async function signUp(label: string, name: string): Promise<User> {
  const email = uniqueEmail(label);
  const password = randomBytes(12).toString("base64url");
  await request(app).post("/api/auth/signup").send({ email, password, name });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  const login = await request(app).post("/api/auth/login").send({ email, password });
  return { id: login.body.user.id as string, email, name, token: login.body.access_token as string };
}

let n = 0;
const mention = (author: User | { id: string; name: string }, mentions: User[], body: string, eventId = `evt-${++n}`) =>
  request(app)
    .post(`/api/notifications/rooms/${roomId}/mentions`)
    .set("token" in author ? auth(author) : {})
    .send({
      event_id: eventId,
      kind: "chat",
      body,
      author: { id: author.id, name: author.name },
      mentions: mentions.map((m) => ({ id: m.id, name: m.name })),
    });

async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (done(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

beforeAll(async () => {
  supabase = await connectSupabase();
  Object.assign(process.env, {
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    API_PUBLIC_URL: "http://127.0.0.1:4000",
    WEB_ORIGIN: "http://web.test",
    AUTH_RATE_LIMIT: "1000",
  });
  const { createApp } = await import("../../src/app");
  app = createApp();

  [owner, online, offline, stranger] = await Promise.all([
    signUp("mention-ana", "Ana"),
    signUp("mention-ben", "Ben"),
    signUp("mention-cleo", "Cleo"),
    signUp("mention-dev", "Dev"),
  ]);
  const created = await request(app)
    .post("/api/rooms/text")
    .set(auth(owner))
    .send({ title: "Chapter 3", text: "Photosynthesis turns light into chemical energy." });
  expect(created.status).toBe(201);
  roomId = created.body.id as string;

  for (const u of [online, offline]) expect((await request(app).post(`/api/rooms/${roomId}/join`).set(auth(u))).status).toBe(200);
  await supabase.setLastSeen(roomId, offline.id, new Date(Date.now() - 10 * 60_000));
});

afterAll(async () => {
  await supabase.close();
});

describe("who can be mentioned", () => {
  it("the composer lists the owner and everyone who opened the room, present or not", async () => {
    const res = await request(app).get(`/api/notifications/rooms/${roomId}/people`);
    expect(res.status).toBe(200);
    expect(res.body.people).toEqual([
      { id: owner.id, name: "Ana" },
      { id: online.id, name: "Ben" },
      { id: offline.id, name: "Cleo" },
    ]);
  });

  it("an unknown room has nobody", async () => {
    expect((await request(app).get("/api/notifications/rooms/nope0000/people")).status).toBe(404);
  });
});

describe("mentioning someone whose tab is closed", () => {
  it("Cleo gets a notification in her bell and an email that links back to the room", async () => {
    const res = await mention(owner, [offline], "@Cleo can you check the second paragraph?");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ notified: 1 });

    const inbox = await request(app).get("/api/notifications").set(auth(offline));
    expect(inbox.status).toBe(200);
    expect(inbox.body.unread).toBe(1);
    expect(inbox.body.notifications[0]).toMatchObject({
      kind: "mention",
      room_id: roomId,
      room_title: "Chapter 3",
      actor_name: "Ana",
      body: "@Cleo can you check the second paragraph?",
      read_at: null,
    });

    const mails = await waitFor(
      () => supabase.inbox(offline.email),
      (m) => m.some((x) => x.subject.includes("mentioned you")),
    );
    const mail = mails.find((m) => m.subject.includes("mentioned you"))!;
    expect(mail.subject).toBe("Ana mentioned you in Chapter 3");
    expect(mail.text).toContain(`http://web.test/r/${roomId}`);
    expect(mail.html.match(/href="([^"]+)"/)?.[1]).toBe(`http://web.test/r/${roomId}`);
    expect(mail.text).toContain("@Cleo can you check the second paragraph?");
  });

  it("the same message announced twice (a retry, a second tab) notifies once", async () => {
    const first = await mention(owner, [offline], "@Cleo once", "evt-dup");
    const again = await mention(owner, [offline], "@Cleo once", "evt-dup");
    expect(first.body).toEqual({ notified: 1 });
    expect(again.body).toEqual({ notified: 0 });
    const inbox = await request(app).get("/api/notifications").set(auth(offline));
    expect(inbox.body.notifications.filter((x: { body: string }) => x.body === "@Cleo once")).toHaveLength(1);
  });
});

describe("mentioning someone who is in the room", () => {
  it("Ben gets a realtime toast meant for him and no email", async () => {
    // The fault proxy forwards HTTP only, so the listener's websocket goes to Supabase directly.
    const listener = createClient(supabase.directUrl, supabase.anonKey, { auth: { persistSession: false } });
    const received: unknown[] = [];
    const channel = listener.channel(`room:${roomId}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "notify" }, ({ payload }) => received.push(payload));
    await new Promise<void>((resolve) => channel.subscribe((s) => s === "SUBSCRIBED" && resolve()));

    const before = (await supabase.inbox(online.email)).length;
    const res = await mention(owner, [online], "@Ben look here");
    expect(res.body).toEqual({ notified: 1 });

    await waitFor(async () => received.length, (len) => len > 0);
    expect(received).toEqual([
      { user_id: online.id, room_id: roomId, title: "Chapter 3", body: "@Ben look here", actor_name: "Ana" },
    ]);
    await listener.removeChannel(channel);

    expect((await supabase.inbox(online.email)).length).toBe(before);
    const inbox = await request(app).get("/api/notifications").set(auth(online));
    expect(inbox.body.notifications[0]).toMatchObject({ body: "@Ben look here", actor_name: "Ana" });
  });
});

describe("who is never notified", () => {
  it("yourself, people who never opened the room, and removed members", async () => {
    await supabase.kick(roomId, offline.id, "Cleo");
    try {
      const res = await mention(owner, [owner, stranger, offline], "@Ana @Dev @Cleo");
      expect(res.body).toEqual({ notified: 0 });
    } finally {
      await supabase.sql`delete from room_members where room_id = ${roomId} and member_id = ${offline.id}`;
    }
    const dev = await request(app).get("/api/notifications").set(auth(stranger));
    expect(dev.body).toEqual({ notifications: [], unread: 0 });
  });
});

describe("who may announce", () => {
  it("a guest can tag a member from the room chat", async () => {
    const res = await mention({ id: "guest-abc123", name: "Visitor" }, [offline], "@Cleo hello from a guest");
    expect(res.body).toEqual({ notified: 1 });
    const inbox = await request(app).get("/api/notifications").set(auth(offline));
    expect(inbox.body.notifications[0]).toMatchObject({ actor_name: "Visitor", body: "@Cleo hello from a guest" });
  });

  it("a signed-in caller can't pose as someone else; an anonymous one must be a guest", async () => {
    const posing = await request(app)
      .post(`/api/notifications/rooms/${roomId}/mentions`)
      .set(auth(stranger))
      .send({ event_id: "x1", kind: "chat", body: "@Cleo", author: { id: owner.id, name: "Ana" }, mentions: [{ id: offline.id, name: "Cleo" }] });
    expect(posing.status).toBe(403);
    const anonymous = await mention({ id: owner.id, name: "Ana" }, [offline], "@Cleo");
    expect(anonymous.status).toBe(401);
  });

  it("an invalid announcement is rejected", async () => {
    const res = await request(app).post(`/api/notifications/rooms/${roomId}/mentions`).set(auth(owner)).send({ kind: "chat" });
    expect(res.status).toBe(400);
  });
});

describe("the bell", () => {
  it("marks one notification, then the rest, as read", async () => {
    const before = await request(app).get("/api/notifications").set(auth(offline));
    expect(before.body.unread).toBeGreaterThan(1);
    const first = before.body.notifications[0].id as string;

    expect((await request(app).post("/api/notifications/read").set(auth(offline)).send({ ids: [first] })).status).toBe(200);
    const mid = await request(app).get("/api/notifications").set(auth(offline));
    expect(mid.body.unread).toBe(before.body.unread - 1);
    expect(mid.body.notifications[0].read_at).not.toBeNull();

    await request(app).post("/api/notifications/read").set(auth(offline)).send({});
    expect((await request(app).get("/api/notifications").set(auth(offline))).body.unread).toBe(0);
  });

  it("another reader's notifications can't be marked or read", async () => {
    const theirs = (await request(app).get("/api/notifications").set(auth(online))).body.notifications[0].id as string;
    await request(app).post("/api/notifications/read").set(auth(stranger)).send({ ids: [theirs] });
    const still = (await request(app).get("/api/notifications").set(auth(online))).body.notifications[0];
    expect(still.read_at).toBeNull();

    // Directly against PostgREST, RLS keeps the inbox private too.
    const browser = createClient(supabase.url, supabase.anonKey, { auth: { persistSession: false } });
    const { data } = await browser.from("notifications").select("id");
    expect(data ?? []).toEqual([]);
  });

  it("needs a signed-in user", async () => {
    expect((await request(app).get("/api/notifications")).status).toBe(401);
  });
});

describe("push subscriptions", () => {
  const endpoint = `https://push.example.com/send/${randomBytes(6).toString("hex")}`;
  // A browser's push keys: a fresh P-256 public key and 16 random auth bytes.
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const keys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };

  it("push is off until the server has VAPID keys", async () => {
    const res = await request(app).get("/api/notifications/key").set(auth(offline));
    expect(res.body).toEqual({ vapid_public_key: null });
  });

  it("a browser subscribes, can't be unsubscribed by someone else, then unsubscribes", async () => {
    expect((await request(app).post("/api/notifications/subscribe").set(auth(offline)).send({ endpoint, keys })).status).toBe(200);
    const [row] = await supabase.sql<{ user_id: string }[]>`select user_id from push_subscriptions where endpoint = ${endpoint}`;
    expect(row?.user_id).toBe(offline.id);

    expect((await request(app).post("/api/notifications/unsubscribe").set(auth(stranger)).send({ endpoint })).status).toBe(404);
    expect((await request(app).post("/api/notifications/unsubscribe").set(auth(offline)).send({ endpoint })).status).toBe(200);
    expect((await request(app).post("/api/notifications/unsubscribe").set(auth(offline)).send({ endpoint })).status).toBe(404);
  });

  it("rejects a subscription without keys", async () => {
    const res = await request(app).post("/api/notifications/subscribe").set(auth(offline)).send({ endpoint });
    expect(res.status).toBe(400);
  });
});
