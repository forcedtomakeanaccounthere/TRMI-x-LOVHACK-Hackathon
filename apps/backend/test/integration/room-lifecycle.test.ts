import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

let supabase: TestSupabase;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
let app: Express;

const PASSWORD = randomBytes(12).toString("base64url");
type Session = { access_token: string; user: { id: string } };
let owner: Session;
let guest: Session;

async function createSession(label: string) {
  const email = uniqueEmail(`lifecycle-${label}`);
  await request(app).post("/api/auth/signup").send({ email, password: PASSWORD, name: label });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body as Session;
}

const auth = (s: Session) => ({ Authorization: `Bearer ${s.access_token}` });

beforeAll(async () => {
  supabase = await connectSupabase();
  admin = createClient(supabase.url, supabase.serviceRoleKey, { auth: { persistSession: false } });
  Object.assign(process.env, {
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    API_PUBLIC_URL: "http://127.0.0.1:4000",
    WEB_ORIGIN: "http://web.test",
  });

  const { createApp } = await import("../../src/app");
  app = createApp();

  owner = await createSession("owner");
  guest = await createSession("guest");
}, 60_000);

afterAll(async () => {
  await supabase?.close();
});

describe("Room Lifecycle Integration", () => {
  it("stamp_room_status trigger accurately sets and clears archived_at and paused_at", async () => {
    // 1. Create a running room
    const createRes = await request(app)
      .post("/api/rooms/text")
      .set(auth(owner))
      .send({ title: "Lifecycle Stamp Room", text: "Testing timestamps." });
    expect(createRes.status).toBe(201);
    const roomId = (createRes.body as { id: string }).id;

    // 2. Pause the room
    const pauseRes = await request(app)
      .patch(`/api/rooms/${roomId}`)
      .set(auth(owner))
      .send({ status: "paused" });
    expect(pauseRes.status).toBe(200);

    const { data: pausedData } = await admin
      .from("rooms")
      .select("status, paused_at, archived_at, closed_at")
      .eq("id", roomId)
      .single();

    expect(pausedData?.status).toBe("paused");
    expect(pausedData?.paused_at).toBeTruthy();
    expect(pausedData?.archived_at).toBeNull();
    expect(pausedData?.closed_at).toBeNull();

    // 3. Archive the room
    const archiveRes = await request(app)
      .patch(`/api/rooms/${roomId}`)
      .set(auth(owner))
      .send({ status: "archived" });
    expect(archiveRes.status).toBe(200);

    const { data: archivedData } = await admin
      .from("rooms")
      .select("status, paused_at, archived_at")
      .eq("id", roomId)
      .single();

    expect(archivedData?.status).toBe("archived");
    expect(archivedData?.archived_at).toBeTruthy();
    expect(archivedData?.paused_at).toBeNull();

    // 4. Resume to running clears lifecycle timestamps
    const resumeRes = await request(app)
      .patch(`/api/rooms/${roomId}`)
      .set(auth(owner))
      .send({ status: "running" });
    expect(resumeRes.status).toBe(200);

    const { data: runningData } = await admin
      .from("rooms")
      .select("status, paused_at, archived_at, closed_at, last_activity_at")
      .eq("id", roomId)
      .single();

    expect(runningData?.status).toBe("running");
    expect(runningData?.paused_at).toBeNull();
    expect(runningData?.archived_at).toBeNull();
    expect(runningData?.closed_at).toBeNull();
    // Inactivity clock is reset when resuming
    expect(Date.now() - Date.parse(runningData!.last_activity_at)).toBeLessThan(10_000);
  });

  it("sweep_room_lifecycle pauses empty rooms after 30 minutes", async () => {
    const createRes = await request(app)
      .post("/api/rooms/text")
      .set(auth(owner))
      .send({ title: "Empty 30m Test Room", text: "Abandoned room test." });
    const roomId = (createRes.body as { id: string }).id;

    // Join room with guest
    const joinRes = await request(app).post(`/api/rooms/${roomId}/join`).set(auth(guest));
    expect(joinRes.status).toBe(200);

    // Backdate participant last_seen_at and room timestamps to 35 minutes ago
    const thirtyFiveMinAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    await admin
      .from("room_participants")
      .update({ last_seen_at: thirtyFiveMinAgo })
      .eq("room_id", roomId);

    await admin
      .from("rooms")
      .update({ last_activity_at: thirtyFiveMinAgo, created_at: thirtyFiveMinAgo, last_presence_at: thirtyFiveMinAgo })
      .eq("id", roomId);

    // Run sweep RPC
    const { data: sweepResult, error: sweepError } = await admin.rpc("sweep_room_lifecycle");
    expect(sweepError).toBeNull();

    const transitioned = (sweepResult as unknown as { room_id: string; new_status: string; transition_reason: string }[])
      .find((t) => t.room_id === roomId);

    expect(transitioned).toBeDefined();
    expect(transitioned?.new_status).toBe("paused");
    expect(transitioned?.transition_reason).toBe("empty_30m");

    const { data: roomAfter } = await admin.from("rooms").select("status").eq("id", roomId).single();
    expect(roomAfter?.status).toBe("paused");
  });

  it("sweep_room_lifecycle pauses idle rooms (>2 hours) even when participants are present", async () => {
    const createRes = await request(app)
      .post("/api/rooms/text")
      .set(auth(owner))
      .send({ title: "Idle 2h Test Room", text: "Idle present room test." });
    const roomId = (createRes.body as { id: string }).id;

    // Join room with guest
    await request(app).post(`/api/rooms/${roomId}/join`).set(auth(guest));

    // Keep participant active (seen 1 minute ago), but backdate activity to 2 hours 10 minutes ago
    const oneMinAgo = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    const twoHoursTenMinAgo = new Date(Date.now() - 130 * 60 * 1000).toISOString();

    await admin
      .from("room_participants")
      .update({ last_seen_at: oneMinAgo })
      .eq("room_id", roomId);
    await admin
      .from("rooms")
      .update({ last_activity_at: twoHoursTenMinAgo })
      .eq("id", roomId);

    // Run sweep RPC
    const { data: sweepResult, error: sweepError } = await admin.rpc("sweep_room_lifecycle");
    expect(sweepError).toBeNull();

    const transitioned = (sweepResult as unknown as { room_id: string; new_status: string; transition_reason: string }[])
      .find((t) => t.room_id === roomId);

    expect(transitioned).toBeDefined();
    expect(transitioned?.new_status).toBe("paused");
    expect(transitioned?.transition_reason).toBe("idle_2h");
  });

  it("sweep_room_lifecycle archives paused rooms after 10 days starting from last inactive day", async () => {
    const createRes = await request(app)
      .post("/api/rooms/text")
      .set(auth(owner))
      .send({ title: "Archive 10d Test Room", text: "10 day archive test." });
    const roomId = (createRes.body as { id: string }).id;

    // Pause the room and backdate last_activity_at to 11 days ago
    const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
    await admin
      .from("rooms")
      .update({
        status: "paused",
        last_activity_at: elevenDaysAgo.toISOString(),
      })
      .eq("id", roomId);

    // Run sweep RPC
    const { data: sweepResult, error: sweepError } = await admin.rpc("sweep_room_lifecycle");
    expect(sweepError).toBeNull();

    const transitioned = (sweepResult as unknown as { room_id: string; new_status: string; transition_reason: string }[])
      .find((t) => t.room_id === roomId);

    expect(transitioned).toBeDefined();
    expect(transitioned?.new_status).toBe("archived");
    expect(transitioned?.transition_reason).toBe("archived_10d_inactive");

    const { data: roomAfter } = await admin
      .from("rooms")
      .select("status, archived_at")
      .eq("id", roomId)
      .single();

    expect(roomAfter?.status).toBe("archived");

    // "archive date starts from last inactive day" (last_activity_at + 10 days)
    const expectedArchiveDate = new Date(elevenDaysAgo.getTime() + 10 * 24 * 60 * 60 * 1000);
    const actualArchiveDate = new Date(roomAfter!.archived_at);
    // Should match within a few seconds
    expect(Math.abs(actualArchiveDate.getTime() - expectedArchiveDate.getTime())).toBeLessThan(5000);
  });
});
