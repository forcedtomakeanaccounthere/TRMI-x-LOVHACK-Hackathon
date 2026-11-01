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
    HUDDLE_SEGMENT_RATE_LIMIT: "1000",
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
    expect(ownerPayload.name).toBe("Alice");
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

  it("story: kicked member and guests-disallowed room cannot create huddle", async () => {
    const roomId = await newRoom();
    const alice = asUser(owner, "Alice");
    const bob = asUser(member, "Bob");
    const guestUser = asGuest("Grace");

    // Bob writes so he is a known member
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(bob.headers)
      .send({ events: [event(bob, { type: "chat", message: { id: "m4", text: "Hello", author: actor(bob), at: at() } })] });

    // Alice kicks Bob
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(alice.headers)
      .send({ events: [event(alice, { type: "member.kick", member: bob.id, name: bob.name })] });

    // Kicked member POST /huddles {audience:"all"} -> 403 "You were removed from this room."
    const kickedCreate = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(bob.headers)
      .send({ audience: "all" });
    expect(kickedCreate.status).toBe(403);
    expect(kickedCreate.body.error).toBe("You were removed from this room.");

    // Alice disallows guests in room settings
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(alice.headers)
      .send({ events: [event(alice, { type: "settings.update", patch: { allowGuests: false } })] });

    // Guest POST /huddles -> 403
    const guestCreate = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(guestUser.headers)
      .send({ audience: "all" });
    expect(guestCreate.status).toBe(403);
  });

  it("story: a new guest joining with name Gita gets a token whose name claim is Gita", async () => {
    const roomId = await newRoom();
    const alice = asUser(owner, "Alice");

    const huddleRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(alice.headers)
      .send({ audience: "all" });
    const hid = huddleRes.body.huddle.id as string;

    const gita = asGuest("Gita");
    const joinRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/join`)
      .set(gita.headers)
      .send({ name: "Gita" });
    expect(joinRes.status).toBe(200);

    const decoded = decodeJwt(joinRes.body.livekit.token);
    expect(decoded.name).toBe("Gita");

    // A known member joining with a requested name retains their stored name
    const bob = asUser(member, "Bob");
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(bob.headers)
      .send({ events: [event(bob, { type: "chat", message: { id: "m5", text: "Bob here", author: actor(bob), at: at() } })] });

    const bobJoin = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/join`)
      .set(bob.headers)
      .send({ name: "Robert" });
    expect(bobJoin.status).toBe(200);
    const bobDecoded = decodeJwt(bobJoin.body.livekit.token);
    expect(bobDecoded.name).toBe("Bob");
  });

  it("story: list huddles respects limit(10) after visibility filtering", async () => {
    const roomId = await newRoom();
    const alice = asUser(owner, "Alice");
    const bob = asUser(member, "Bob");
    const charlie = asGuest("Charlie");

    // Bob writes to become known member
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(bob.headers)
      .send({ events: [event(bob, { type: "chat", message: { id: "m6", text: "Init", author: actor(bob), at: at() } })] });

    const { supabaseAdmin } = await import("../../src/lib/supabase");
    const db = supabaseAdmin();

    // Create 15 ended huddles: 12 private (between Alice and Bob) and 3 room-wide
    const now = Date.now();
    for (let i = 0; i < 12; i++) {
      const hid = `h_priv_${i}_${Date.now()}`;
      await db.from("huddles").insert({
        id: hid,
        room_id: roomId,
        livekit_room: `lr_${roomId}_${hid}`,
        audience: "private",
        created_by: alice.id,
        created_by_name: "Alice",
        started_at: new Date(now - 100_000 + i * 1000).toISOString(),
        ended_at: new Date(now - 50_000 + i * 1000).toISOString(),
        notes_status: "none",
      });
      await db.from("huddle_members").insert({
        huddle_id: hid,
        member_id: alice.id,
        name: "Alice",
      });
    }

    for (let i = 0; i < 3; i++) {
      const hid = `h_pub_${i}_${Date.now()}`;
      await db.from("huddles").insert({
        id: hid,
        room_id: roomId,
        livekit_room: `lr_${roomId}_${hid}`,
        audience: "all",
        created_by: alice.id,
        created_by_name: "Alice",
        started_at: new Date(now - 200_000 + i * 1000).toISOString(),
        ended_at: new Date(now - 150_000 + i * 1000).toISOString(),
        notes_status: "none",
      });
    }

    // Charlie (not in the private huddles) queries GET /huddles
    const listRes = await request(app)
      .get(`/api/rooms/${roomId}/huddles`)
      .set(charlie.headers);
    expect(listRes.status).toBe(200);
    // Should receive all 3 room-wide huddles, not 0
    const publicHuddles = listRes.body.huddles.filter((h: { audience: string }) => h.audience === "all");
    expect(publicHuddles.length).toBeGreaterThanOrEqual(3);
  });

  it("story: caption segments, member focus and transcript user stories", async () => {
    const roomId = await newRoom();
    const alice = asUser(owner, "Alice");
    const bob = asUser(member, "Bob");

    // Alice starts all huddle
    const huddleRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(alice.headers)
      .send({ audience: "all" });
    const hid = huddleRes.body.huddle.id as string;
    const huddleStartedAt = new Date(huddleRes.body.huddle.started_at).getTime();

    // 1. Editor posts captions and reads them back in order
    const seg1Time = new Date(huddleStartedAt + 1000).toISOString();
    const seg2Time = new Date(huddleStartedAt + 2000).toISOString();
    const seg3Time = new Date(huddleStartedAt + 3000).toISOString();

    const postRes1 = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/segments`)
      .set(alice.headers)
      .send({
        segments: [
          {
            id: "seg_1",
            text: "Hello everyone",
            start_at: seg1Time,
            end_at: seg2Time,
            focus: { doc: roomId, block: "p1" },
          },
          {
            id: "seg_2",
            text: "Welcome to the meeting",
            start_at: seg2Time,
            end_at: seg3Time,
            focus: { doc: roomId, block: "p2" },
          },
        ],
      });
    expect(postRes1.status).toBe(200);

    // Read back in order
    const transcript1 = await request(app)
      .get(`/api/rooms/${roomId}/huddles/${hid}/transcript?after=0`)
      .set(alice.headers);
    expect(transcript1.status).toBe(200);
    expect(transcript1.body.segments).toHaveLength(2);
    expect(transcript1.body.segments[0].id).toBe("seg_1");
    expect(transcript1.body.segments[1].id).toBe("seg_2");
    expect(transcript1.body.segments[0].text).toBe("Hello everyone");
    expect(transcript1.body.segments[1].text).toBe("Welcome to the meeting");
    expect(transcript1.body.segments[0].seq).toBeLessThan(transcript1.body.segments[1].seq);

    // Verify huddle_focus has speaker's focus appended
    const { supabaseAdmin } = await import("../../src/lib/supabase");
    const db = supabaseAdmin();
    const { data: focusRows } = await db.from("huddle_focus").select("*").eq("huddle_id", hid);
    expect(focusRows).toBeDefined();
    expect(focusRows!.length).toBeGreaterThanOrEqual(2);

    // 2. Speaker_id is the caller even if the body tries to set another
    const postResSpoof = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/segments`)
      .set(alice.headers)
      .send({
        segments: [
          {
            id: "seg_spoof",
            speaker_id: "bob-spoofed-id",
            text: "Spoof attempt",
            start_at: seg2Time,
            end_at: seg3Time,
            focus: null,
          },
        ],
      });
    expect(postResSpoof.status).toBe(200);

    const transcriptSpoof = await request(app)
      .get(`/api/rooms/${roomId}/huddles/${hid}/transcript?after=0`)
      .set(alice.headers);
    const spoofedSeg = transcriptSpoof.body.segments.find((s: { id: string }) => s.id === "seg_spoof");
    expect(spoofedSeg).toBeDefined();
    expect(spoofedSeg.speaker_id).toBe(alice.id);

    // 3. Viewer posting -> 403
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(alice.headers)
      .send({ events: [event(alice, { type: "settings.update", patch: { guestRole: "viewer" } })] });

    const victor = asGuest("Victor");
    await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/join`)
      .set(victor.headers);

    const viewerPost = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/segments`)
      .set(victor.headers)
      .send({
        segments: [
          {
            id: "seg_viewer",
            text: "I am a viewer trying to speak",
            start_at: seg2Time,
            end_at: seg3Time,
            focus: null,
          },
        ],
      });
    expect(viewerPost.status).toBe(403);

    // 4. A retried segment id is stored once
    const retryRes1 = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/segments`)
      .set(alice.headers)
      .send({
        segments: [
          {
            id: "seg_retry",
            text: "Original retry text",
            start_at: seg2Time,
            end_at: seg3Time,
            focus: null,
          },
        ],
      });
    expect(retryRes1.status).toBe(200);

    const retryRes2 = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/segments`)
      .set(alice.headers)
      .send({
        segments: [
          {
            id: "seg_retry",
            text: "Second retry text",
            start_at: seg2Time,
            end_at: seg3Time,
            focus: null,
          },
        ],
      });
    expect(retryRes2.status).toBe(200);

    const transcriptRetry = await request(app)
      .get(`/api/rooms/${roomId}/huddles/${hid}/transcript?after=0`)
      .set(alice.headers);
    const retrySegs = transcriptRetry.body.segments.filter((s: { id: string }) => s.id === "seg_retry");
    expect(retrySegs).toHaveLength(1);
    expect(retrySegs[0].text).toBe("Original retry text");

    // 5. Focus on a doc outside the room is dropped (stored as null)
    const outsideFocusRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/segments`)
      .set(alice.headers)
      .send({
        segments: [
          {
            id: "seg_outside",
            text: "Caption with external doc focus",
            start_at: seg2Time,
            end_at: seg3Time,
            focus: { doc: "other_room_non_existent", block: "p1" },
          },
        ],
      });
    expect(outsideFocusRes.status).toBe(200);

    const transcriptOutside = await request(app)
      .get(`/api/rooms/${roomId}/huddles/${hid}/transcript?after=0`)
      .set(alice.headers);
    const outsideSeg = transcriptOutside.body.segments.find((s: { id: string }) => s.id === "seg_outside");
    expect(outsideSeg).toBeDefined();
    expect(outsideSeg.doc).toBeNull();
    expect(outsideSeg.block).toBeNull();

    // 6. Non-member reading a private huddle's transcript -> 404
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(bob.headers)
      .send({ events: [event(bob, { type: "chat", message: { id: "m7", text: "Bob active", author: actor(bob), at: at() } })] });

    const privateRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(alice.headers)
      .send({ audience: "private", members: [bob.id] });
    expect(privateRes.status).toBe(201);
    const privHid = privateRes.body.huddle.id as string;

    const charlie = asGuest("Charlie");
    const nonMemberRead = await request(app)
      .get(`/api/rooms/${roomId}/huddles/${privHid}/transcript?after=0`)
      .set(charlie.headers);
    expect(nonMemberRead.status).toBe(404);

    const memberRead = await request(app)
      .get(`/api/rooms/${roomId}/huddles/${privHid}/transcript?after=0`)
      .set(bob.headers);
    expect(memberRead.status).toBe(200);

    // 7. Posting 61 s after end -> 403
    await db
      .from("huddles")
      .update({ ended_at: new Date(Date.now() - 61_000).toISOString() })
      .eq("id", hid);

    const latePostRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/segments`)
      .set(alice.headers)
      .send({
        segments: [
          {
            id: "seg_too_late",
            text: "61 seconds after huddle ended",
            start_at: seg2Time,
            end_at: seg3Time,
            focus: null,
          },
        ],
      });
    expect(latePostRes.status).toBe(403);
  });

  it("story: ending a huddle produces ready notes, refresh bumps version, viewer restrictions and non-member privacy hold", async () => {
    const roomId = await newRoom();
    const alice = asUser(owner, "Alice");
    const bob = asUser(member, "Bob");

    // 1. Alice starts a room-wide huddle
    const huddleRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(alice.headers)
      .send({ audience: "all" });
    expect(huddleRes.status).toBe(201);
    const hid = huddleRes.body.huddle.id as string;

    // Bob joins
    await request(app).post(`/api/rooms/${roomId}/huddles/${hid}/join`).set(bob.headers).send();

    // Post focus and segments
    const now = Date.now();
    await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/focus`)
      .set(bob.headers)
      .send({ doc: roomId, block: "b0" });

    await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/segments`)
      .set(alice.headers)
      .send({
        segments: [
          {
            id: "seg_notes_1",
            text: "Let us build voice huddles with AI notes.",
            start_at: new Date(now - 10_000).toISOString(),
            end_at: new Date(now - 5_000).toISOString(),
            focus: { doc: roomId, block: "b0" },
          },
        ],
      });

    // 2. Alice ends the huddle -> produces notes with status ready
    const endRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/end`)
      .set(alice.headers);
    expect(endRes.status).toBe(200);

    let readyNotesRes: request.Response | undefined;
    for (let i = 0; i < 50; i++) {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/huddles/${hid}/notes`)
        .set(alice.headers);
      if (res.body.status === "ready") {
        readyNotesRes = res;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(readyNotesRes).toBeDefined();
    if (!readyNotesRes) throw new Error("readyNotesRes not set");
    expect(readyNotesRes.status).toBe(200);
    expect(readyNotesRes.body.status).toBe("ready");
    expect(readyNotesRes.body.version).toBe(1);
    expect(readyNotesRes.body.notes).toBeDefined();
    expect(readyNotesRes.body.notes.summary).toBe("Fake huddle notes summary");

    // 3. Refresh bumps the version
    const refreshRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/notes`)
      .set(alice.headers);
    expect(refreshRes.status).toBe(202);

    let bumpedNotesRes: request.Response | undefined;
    for (let i = 0; i < 50; i++) {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/huddles/${hid}/notes`)
        .set(alice.headers);
      if (res.body.status === "ready" && res.body.version === 2) {
        bumpedNotesRes = res;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(bumpedNotesRes).toBeDefined();
    if (!bumpedNotesRes) throw new Error("bumpedNotesRes not set");
    expect(bumpedNotesRes.body.version).toBe(2);

    // 4. A non-member can't read a private huddle's notes (404)
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(bob.headers)
      .send({ events: [event(bob, { type: "chat", message: { id: "m_bob_p", text: "Active", author: actor(bob), at: at() } })] });

    const privHuddleRes = await request(app)
      .post(`/api/rooms/${roomId}/huddles`)
      .set(alice.headers)
      .send({ audience: "private", members: [bob.id] });
    expect(privHuddleRes.status).toBe(201);
    const privHid = privHuddleRes.body.huddle.id as string;

    const charlie = asGuest("Charlie");
    const nonMemberNotes = await request(app)
      .get(`/api/rooms/${roomId}/huddles/${privHid}/notes`)
      .set(charlie.headers);
    expect(nonMemberNotes.status).toBe(404);

    const memberNotes = await request(app)
      .get(`/api/rooms/${roomId}/huddles/${privHid}/notes`)
      .set(bob.headers);
    expect(memberNotes.status).toBe(200);

    // 5. A viewer refreshing in a room with viewersUseAi=false gets 403
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(alice.headers)
      .send({
        events: [
          event(alice, {
            type: "settings.update",
            patch: { guestRole: "viewer", viewersUseAi: false },
          }),
        ],
      });

    const viewerGuest = asGuest("ViewerGuest");
    await request(app)
      .post(`/api/rooms/${roomId}/events`)
      .set(viewerGuest.headers)
      .send({
        events: [
          event(viewerGuest, {
            type: "chat",
            message: { id: "m_viewer_hi", text: "Hello", author: actor(viewerGuest), at: at() },
          }),
        ],
      });

    const viewerRefresh = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/notes`)
      .set(viewerGuest.headers);
    expect(viewerRefresh.status).toBe(403);

    // 6. Anonymous request without auth headers -> 401
    const noAuthRefresh = await request(app)
      .post(`/api/rooms/${roomId}/huddles/${hid}/notes`);
    expect(noAuthRefresh.status).toBe(401);
  });
});
