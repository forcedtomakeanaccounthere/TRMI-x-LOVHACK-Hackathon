import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { DashboardResponse } from "@linkroom/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBackend, type Backend } from "../support/backend-process";
import { uniqueEmail } from "../support/supabase";

type Session = { access_token: string; user: { id: string } };

describe("Room Lifecycle E2E Journey", () => {
  let be: Backend;
  let host: Session;
  let friend: Session;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dbAdmin: any;

  async function account(label: string): Promise<Session> {
    const email = uniqueEmail(`lifecycle.e2e.${label}`);
    const password = randomBytes(12).toString("base64url");
    expect((await be.post("/api/auth/signup", { email, password, name: label })).status).toBe(201);
    await be.clickVerificationLink(email);
    const res = await be.post("/api/auth/login", { email, password });
    expect(res.status).toBe(200);
    return (await res.json()) as Session;
  }

  beforeAll(async () => {
    be = await startBackend();
    dbAdmin = createClient(be.supabase.url, be.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    });
    host = await account("host");
    friend = await account("friend");
  });

  afterAll(async () => {
    await be?.stop();
  });

  it("completes full lifecycle: created -> active -> 30m abandon pause -> resume -> 2h idle pause -> 10d auto-archive", async () => {
    // 1. Host creates a reading room
    const createRes = await be.post(
      "/api/rooms/text",
      { title: "Quantum Computing Reading Group", text: "Paragraph 1\n\nParagraph 2" },
      host.access_token,
    );
    expect(createRes.status).toBe(201);
    const roomId = ((await createRes.json()) as { id: string }).id;

    // 2. Host and Friend join
    const joinHost = await be.post(`/api/rooms/${roomId}/join`, {}, host.access_token);
    expect(joinHost.status).toBe(200);
    const joinFriend = await be.post(`/api/rooms/${roomId}/join`, {}, friend.access_token);
    expect(joinFriend.status).toBe(200);

    // 3. Both send activity (keystrokes / mouse events)
    const act1 = await be.post(`/api/rooms/${roomId}/activity`, {}, host.access_token);
    expect(act1.status).toBe(200);
    const act2 = await be.post(`/api/rooms/${roomId}/activity`, {}, friend.access_token);
    expect(act2.status).toBe(200);

    // 4. Everyone leaves the room. Simulate 35 minutes passing with no participants.
    const thirtyFiveMinAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    await dbAdmin
      .from("room_participants")
      .update({ last_seen_at: thirtyFiveMinAgo })
      .eq("room_id", roomId);
    await dbAdmin
      .from("rooms")
      .update({ last_activity_at: thirtyFiveMinAgo, created_at: thirtyFiveMinAgo, last_presence_at: thirtyFiveMinAgo })
      .eq("id", roomId);

    // Run sweep
    const sweep1 = await dbAdmin.rpc("sweep_room_lifecycle");
    expect(sweep1.error).toBeNull();

    // Verify room is now paused
    const { data: pausedRoom } = await dbAdmin.from("rooms").select("status, paused_at").eq("id", roomId).single();
    expect(pausedRoom?.status).toBe("paused");
    expect(pausedRoom?.paused_at).toBeTruthy();

    // Activity ping is now rejected with 409
    const actPaused = await be.post(`/api/rooms/${roomId}/activity`, {}, friend.access_token);
    expect(actPaused.status).toBe(409);

    // Dashboard confirms room is in Paused tab
    const dashPaused = await be.get(`/api/me/rooms?status=paused`, host.access_token);
    const pausedList = ((await dashPaused.json()) as DashboardResponse).rooms;
    expect(pausedList.some((r) => r.id === roomId)).toBe(true);

    // 5. Host resumes the room
    const resumeRes = await fetch(`${be.api}/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.access_token}` },
      body: JSON.stringify({ status: "running" }),
    });
    expect(resumeRes.status).toBe(200);

    // 6. People are present (heartbeats fresh), but idle for 2h 5m
    const now = new Date().toISOString();
    const twoHoursFiveMinAgo = new Date(Date.now() - 125 * 60 * 1000).toISOString();

    await dbAdmin
      .from("room_participants")
      .update({ last_seen_at: now })
      .eq("room_id", roomId);
    await dbAdmin
      .from("rooms")
      .update({ last_activity_at: twoHoursFiveMinAgo })
      .eq("id", roomId);

    // Run sweep
    const sweep2 = await dbAdmin.rpc("sweep_room_lifecycle");
    expect(sweep2.error).toBeNull();

    // Verify room paused due to 2 hours idle
    const { data: idlePausedRoom } = await dbAdmin.from("rooms").select("status").eq("id", roomId).single();
    expect(idlePausedRoom?.status).toBe("paused");

    // 7. Advance time by 11 days (after pause, wait 10 days for archiving)
    const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
    await dbAdmin
      .from("rooms")
      .update({
        status: "paused",
        last_activity_at: elevenDaysAgo.toISOString(),
      })
      .eq("id", roomId);

    // Run sweep
    const sweep3 = await dbAdmin.rpc("sweep_room_lifecycle");
    expect(sweep3.error).toBeNull();

    // Verify room is now archived with archived_at = last_activity_at + 10 days
    const { data: archivedRoom } = await dbAdmin
      .from("rooms")
      .select("status, archived_at")
      .eq("id", roomId)
      .single();

    expect(archivedRoom?.status).toBe("archived");
    expect(archivedRoom?.archived_at).toBeTruthy();

    const expectedDate = new Date(elevenDaysAgo.getTime() + 10 * 24 * 60 * 60 * 1000);
    const actualDate = new Date(archivedRoom!.archived_at);
    expect(Math.abs(actualDate.getTime() - expectedDate.getTime())).toBeLessThan(5000);

    // 8. Verify room appears in Archived tab on Dashboard
    const dashArchived = await be.get(`/api/me/rooms?status=archived`, host.access_token);
    const archivedList = ((await dashArchived.json()) as DashboardResponse).rooms;
    expect(archivedList.some((r) => r.id === roomId)).toBe(true);
  });
});
