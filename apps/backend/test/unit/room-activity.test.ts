import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f";
type Result = { data?: unknown; error?: unknown; count?: number };
type Call = [method: string, ...args: unknown[]];

const calls: Record<string, Call[]> = {};
const results: Record<string, Result[]> = {};

function table(name: string) {
  const log = (calls[name] ??= []);
  const builder: Record<string, unknown> = {
    then: (resolve: (r: Result) => unknown) =>
      resolve({ data: [], error: null, count: 0, ...results[name]?.shift() }),
  };
  for (const method of [
    "select",
    "eq",
    "neq",
    "in",
    "or",
    "order",
    "range",
    "limit",
    "maybeSingle",
    "single",
    "update",
    "delete",
    "insert",
    "upsert",
  ]) {
    builder[method] = (...args: unknown[]) => {
      log.push([method, ...args]);
      return builder;
    };
  }
  return builder;
}

vi.mock("../../src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: table,
    rpc: async (fn: string, args: unknown) => {
      (calls.rpc ??= []).push([fn, args]);
      return { data: [], error: null, ...results.rpc?.shift() };
    },
    auth: {
      getUser: async (token: string) => {
        if (token === "valid-token") {
          return {
            data: {
              user: {
                id: USER,
                email: "reader@example.com",
                email_confirmed_at: "2026-10-30T00:00:00Z",
                user_metadata: { name: "Reader Alice" },
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: new Error("invalid token") };
      },
    },
  }),
}));

const { createApp } = await import("../../src/app");
const app = createApp();

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  for (const key of Object.keys(results)) delete results[key];
});

describe("POST /api/rooms/:id/activity", () => {
  it("returns 404 if the room does not exist", async () => {
    results.rooms = [{ data: null, error: null }];

    const res = await request(app).post("/api/rooms/nonexistent/activity");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 404 if the room is deleted", async () => {
    results.rooms = [{ data: { id: "deleted01", status: "deleted" }, error: null }];

    const res = await request(app).post("/api/rooms/deleted01/activity");
    expect(res.status).toBe(404);
  });

  it("returns 409 if the room is paused", async () => {
    results.rooms = [{ data: { id: "paused001", status: "paused" }, error: null }];

    const res = await request(app).post("/api/rooms/paused001/activity");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/room is paused/i);
  });

  it("returns 409 if the room is archived", async () => {
    results.rooms = [{ data: { id: "archived1", status: "archived" }, error: null }];

    const res = await request(app).post("/api/rooms/archived1/activity");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/room is archived/i);
  });

  it("updates last_activity_at for guest callers on running rooms", async () => {
    results.rooms = [
      { data: { id: "running01", status: "running" }, error: null }, // select room
      { data: { id: "running01", status: "running", last_activity_at: "2026-10-31T20:00:00.000Z" }, error: null }, // update last_activity_at
    ];

    const res = await request(app).post("/api/rooms/running01/activity");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "running01",
      status: "running",
    });
    expect(res.body.last_activity_at).toBeDefined();

    // Verify rooms table received update
    const roomUpdates = calls.rooms?.filter(([m]) => m === "update") ?? [];
    expect(roomUpdates).toHaveLength(1);
    expect(roomUpdates[0]?.[1]).toHaveProperty("last_activity_at");

    // Guest call should NOT touch room_participants
    expect(calls.room_participants).toBeUndefined();
  });

  it("updates both last_activity_at and room_participants for authenticated callers", async () => {
    results.rooms = [
      { data: { id: "running01", status: "running" }, error: null }, // select room
      { data: { id: "running01", status: "running", last_activity_at: "2026-10-31T20:00:00.000Z" }, error: null }, // update last_activity_at
    ];
    results.room_participants = [
      { data: null, error: null }, // upsert participant last_seen_at
    ];

    const res = await request(app)
      .post("/api/rooms/running01/activity")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("running");

    // Verify room_participants received upsert
    const participantUpserts = calls.room_participants?.filter(([m]) => m === "upsert") ?? [];
    expect(participantUpserts).toHaveLength(1);
    expect(participantUpserts[0]?.[1]).toMatchObject({
      room_id: "running01",
      user_id: USER,
    });
  });

  it("returns 409 if the room transitioned to paused concurrently between read and update", async () => {
    results.rooms = [
      { data: { id: "race01", status: "running" }, error: null }, // initial read: running
      { data: null, error: null }, // update matches 0 rows because status changed to paused
      { data: { id: "race01", status: "paused" }, error: null }, // re-check read: paused
    ];

    const res = await request(app).post("/api/rooms/race01/activity");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/room is paused/i);
  });
});

describe("POST /api/rooms/:id/heartbeat", () => {
  beforeEach(() => {
    for (const key of Object.keys(calls)) delete calls[key];
    for (const key of Object.keys(results)) delete results[key];
  });

  it("returns 404 if room does not exist", async () => {
    results.rooms = [{ data: null, error: null }];

    const res = await request(app).post("/api/rooms/nonexistent/heartbeat");
    expect(res.status).toBe(404);
  });

  it("updates last_presence_at without touching last_activity_at for guest readers", async () => {
    results.rooms = [
      { data: { id: "running01", status: "running" }, error: null }, // select room
      { data: null, error: null }, // update last_presence_at
    ];

    const res = await request(app).post("/api/rooms/running01/heartbeat");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "running01", status: "running" });

    const roomUpdates = calls.rooms?.filter(([m]) => m === "update") ?? [];
    expect(roomUpdates).toHaveLength(1);
    expect(roomUpdates[0]?.[1]).toHaveProperty("last_presence_at");
    expect(roomUpdates[0]?.[1]).not.toHaveProperty("last_activity_at");
  });

  it("updates both last_presence_at and room_participants for authenticated callers", async () => {
    results.rooms = [
      { data: { id: "running01", status: "running" }, error: null },
      { data: null, error: null },
    ];
    results.room_participants = [{ data: null, error: null }];

    const res = await request(app)
      .post("/api/rooms/running01/heartbeat")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);

    const participantUpserts = calls.room_participants?.filter(([m]) => m === "upsert") ?? [];
    expect(participantUpserts).toHaveLength(1);
    expect(participantUpserts[0]?.[1]).toMatchObject({
      room_id: "running01",
      user_id: USER,
    });
  });
});
