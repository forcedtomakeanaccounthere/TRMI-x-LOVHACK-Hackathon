import { randomBytes } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeAi, type FakeAi } from "../support/fake-ai";
import { startFakeLiveKit, type FakeLiveKit } from "../support/fake-livekit";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

let supabase: TestSupabase;
let ai: FakeAi;
let fakeLiveKit: FakeLiveKit;
let app: Express;

type Session = { access_token: string; user: { id: string } };
let owner: Session;
let member: Session;

type Writer = { id: string; name: string; headers: Record<string, string> };
const asUser = (s: Session, name: string): Writer => ({
  id: s.user.id,
  name,
  headers: { Authorization: `Bearer ${s.access_token}` },
});
const asGuest = (
  name: string,
  key = randomBytes(16).toString("hex"),
  id = `guest-${randomBytes(5).toString("hex")}`,
): Writer => ({
  id,
  name,
  headers: { "X-Guest-Id": id, "X-Guest-Key": key },
});

function decodeJwt(token: string): Record<string, unknown> {
  const payload = Buffer.from(token.split(".")[1]!, "base64").toString("utf8");
  return JSON.parse(payload) as Record<string, unknown>;
}

beforeAll(async () => {
  supabase = await connectSupabase();
  ai = await startFakeAi();
  fakeLiveKit = await startFakeLiveKit();

  Object.assign(process.env, {
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    API_PUBLIC_URL: "http://127.0.0.1:4000",
    WEB_ORIGIN: "http://web.test",
    AUTH_RATE_LIMIT: "1000",
    LEDGER_RATE_LIMIT: "10000",
    HUDDLE_RATE_LIMIT: "1000",
    AI_SERVICE_URL: ai.url,
    AI_INTERNAL_TOKEN: ai.token,
    LIVEKIT_URL: fakeLiveKit.url,
    LIVEKIT_API_KEY: "fake-livekit-key",
    LIVEKIT_API_SECRET: "fake-livekit-secret",
  });

  const { createApp } = await import("../../src/app");
  app = createApp();

  owner = await session("huddles-owner", "Alice");
  member = await session("huddles-member", "Bob");
});

afterAll(async () => {
  await fakeLiveKit.stop();
  await ai.stop();
  await supabase.close();
});

async function session(label: string, name: string): Promise<Session> {
  const email = uniqueEmail(label);
  const password = randomBytes(12).toString("base64url");
  await request(app).post("/api/auth/signup").send({ email, password, name });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  return (await request(app).post("/api/auth/login").send({ email, password })).body as Session;
}

async function newRoom() {
  const res = await request(app)
    .post("/api/rooms/text")
    .set({ Authorization: `Bearer ${owner.access_token}` })
    .send({ title: "Huddle room", text: "LinkRoom test document." });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

let n = 0;
const at = () => new Date(Date.UTC(2026, 10, 1, 10, 0, 0, ++n)).toISOString();
const actor = (w: Writer) => ({ id: w.id, name: w.name, color: "#3b82f6" });
const event = (w: Writer, payload: Record<string, unknown>) => ({
  id: `ev${Date.now()}x${++n}`,
  at: at(),
  actor: actor(w),
  ...payload,
});

describe("voice huddles", () => {
  it("story: owner starts all, a guest joins, viewer has canPublish: false", async () => {
    const roomId = await newRoom();
    const alice = asUser(owner, "Alice");
    const gus = asGuest("Gus");

    // Alice starts a room-wide huddle
    const createRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(alice.headers)
      .send({ audience: "all" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.huddle.audience).toBe("all");
    expect(createRes.body.huddle.created_by).toBe(alice.id);
    expect(createRes.body.livekit.url).toBe(process.env.LIVEKIT_URL);

    const ownerPayload = decodeJwt(createRes.body.livekit.token);
    expect(ownerPayload.sub).toBe(alice.id);
    const ownerVideo = ownerPayload.video as Record<string, unknown>;
    expect(ownerVideo.canPublish).toBe(true);

    // Gus joins
    const joinRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${createRes.body.huddle.id}/join`)
      .set(gus.headers);
    expect(joinRes.status).toBe(200);

    const guestPayload = decodeJwt(joinRes.body.livekit.token);
    expect(guestPayload.sub).toBe(gus.id);
    expect((guestPayload.video as Record<string, unknown>).room).toBe(createRes.body.huddle.livekit_room);
    expect((guestPayload.video as Record<string, unknown>).canPublish).toBe(true); // default editor

    // Set guest role to viewer in room settings
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(alice.headers)
      .send({
        events: [event(alice, { type: "settings.update", patch: { guestRole: "viewer" } })],
      });

    // Another viewer guest joins
    const viewerGuest = asGuest("Victor");
    const viewerJoin = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${createRes.body.huddle.id}/join`)
      .set(viewerGuest.headers);
    expect(viewerJoin.status).toBe(200);
    const viewerPayload = decodeJwt(viewerJoin.body.livekit.token);
    expect((viewerPayload.video as Record<string, unknown>).canPublish).toBe(false);
  });

  it("story: guest auth rules (401 without key, 403 wrong key, 403 kicked, 404 private non-invitee)", async () => {
    const roomId = await newRoom();
    const alice = asUser(owner, "Alice");
    const bob = asUser(member, "Bob");
    const realGuest = asGuest("Gary", "a".repeat(32));
    const fakeGuest = asGuest("Gary", "b".repeat(32), realGuest.id);

    // 1. Guest without key/id -> 401
    const noAuthRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .send({ audience: "all" });
    expect(noAuthRes.status).toBe(401);

    // 2. Real guest claims id
    const startRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(realGuest.headers)
      .send({ audience: "all" });
    expect(startRes.status).toBe(201);
    const huddleId = startRes.body.huddle.id as string;

    // Impostor with different key -> 403
    const impRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${huddleId}/join`)
      .set(fakeGuest.headers);
    expect(impRes.status).toBe(403);
    expect(impRes.body.error).toBe("That guest id belongs to someone else.");

    // 3. Bob writes to room so he is a known member, then Alice kicks him
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(bob.headers)
      .send({ events: [event(bob, { type: "chat", message: { id: "m1", text: "Hi", author: actor(bob), at: at() } })] });

    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(alice.headers)
      .send({ events: [event(alice, { type: "member.kick", member: bob.id, name: bob.name })] });

    // Kicked Bob tries to join -> 403
    const kickedRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${huddleId}/join`)
      .set(bob.headers);
    expect(kickedRes.status).toBe(403);
    expect(kickedRes.body.error).toBe("You were removed from this room.");

    // 4. Alice starts private huddle inviting only Gary (realGuest)
    const privateRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(alice.headers)
      .send({ audience: "private", members: [realGuest.id] });
    expect(privateRes.status).toBe(201);
    const privateHid = privateRes.body.huddle.id as string;

    // Create participant Charlie
    const charlie = asGuest("Charlie");
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(charlie.headers)
      .send({ events: [event(charlie, { type: "chat", message: { id: "m2", text: "Hey", author: actor(charlie), at: at() } })] });

    // Charlie is not invited to Alice's private huddle -> 404
    const charlieAliceAccess = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${privateHid}/join`)
      .set(charlie.headers);
    expect(charlieAliceAccess.status).toBe(404);

    // Charlie creates a private huddle inviting only Gary (realGuest)
    const charliePrivate = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(charlie.headers)
      .send({ audience: "private", members: [realGuest.id] });
    expect(charliePrivate.status).toBe(201);
    const charlieHid = charliePrivate.body.huddle.id as string;

    // Alice is the room owner, but is NOT invited to Charlie's private huddle -> 404!
    const ownerPrivateAccess = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${charlieHid}/join`)
      .set(alice.headers);
    expect(ownerPrivateAccess.status).toBe(404);
  });

  it("story: starting all twice returns the same huddle", async () => {
    const roomId = await newRoom();
    const alice = asUser(owner, "Alice");

    const first = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(alice.headers)
      .send({ audience: "all" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(alice.headers)
      .send({ audience: "all" });
    expect(second.status).toBe(201);
    expect(second.body.huddle.id).toBe(first.body.huddle.id);
  });

  it("story: ledger member.kick during a huddle notifies LiveKit to remove participant", async () => {
    const roomId = await newRoom();
    const alice = asUser(owner, "Alice");
    const bob = asUser(member, "Bob");

    // Bob writes so he is in room_members
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(bob.headers)
      .send({ events: [event(bob, { type: "chat", message: { id: "m3", text: "Hi", author: actor(bob), at: at() } })] });

    // Start all huddle
    const huddleRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(alice.headers)
      .send({ audience: "all" });
    const livekitRoom = huddleRes.body.huddle.livekit_room as string;

    // Bob joins
    await request(app)
      .post(`/api/rooms/${roomId}/huddles/${huddleRes.body.huddle.id}/join`)
      .set(bob.headers);

    fakeLiveKit.reset();

    // Alice kicks Bob via the ledger
    const kickRes = await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(alice.headers)
      .send({ events: [event(alice, { type: "member.kick", member: bob.id, name: bob.name })] });
    expect(kickRes.status).toBe(200);

    // Give fire-and-forget a tiny tick
    await new Promise((r) => setTimeout(r, 50));

    const removeCalls = fakeLiveKit.calls.filter(
      (c) => c.path.endsWith("RemoveParticipant") && c.body.identity === bob.id && c.body.room === livekitRoom,
    );
    expect(removeCalls).toHaveLength(1);
  });
});
