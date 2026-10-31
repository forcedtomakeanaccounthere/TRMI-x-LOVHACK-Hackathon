import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f";
const OTHER = "11111111-1111-4111-8111-111111111111";
const THIRD = "33333333-3333-4333-8333-333333333333";
const GROUP = "22222222-2222-4222-8222-222222222222";

type Result = { data?: unknown; error?: unknown; count?: number };
type Call = [method: string, ...args: unknown[]];

const calls: Record<string, Call[]> = {};
const results: Record<string, Result[]> = {};

function table(name: string) {
  const log = (calls[name] ??= []);
  const builder: Record<string, unknown> = {
    then: (resolve: (r: Result) => unknown) => resolve({ data: [], error: null, count: 0, ...results[name]?.shift() }),
  };
  for (const method of [
    "select",
    "eq",
    "neq",
    "in",
    "or",
    "ilike",
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
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: USER,
            email: "ana@example.com",
            email_confirmed_at: "2026-10-30T00:00:00Z",
            user_metadata: { name: "Ana" },
          },
        },
        error: null,
      }),
    },
  }),
}));

const { createApp } = await import("../../src/app");
const app = createApp();

const called = (name: string, method: string) => (calls[name] ?? []).filter(([m]) => m === method).map(([, ...a]) => a);
const get = (path: string, query: Record<string, string> = {}) =>
  request(app).get(path).query(query).set("Authorization", "Bearer token");
const post = (path: string, body: unknown = {}) =>
  request(app).post(path).set("Authorization", "Bearer token").send(body as object);
const patch = (path: string, body: unknown) =>
  request(app).patch(path).set("Authorization", "Bearer token").send(body as object);
const remove = (path: string) => request(app).delete(path).set("Authorization", "Bearer token");

const profile = (over = {}) => ({
  id: USER,
  display_name: "Ana",
  bio: null,
  avatar_color: null,
  created_at: "2026-10-30T00:00:00Z",
  updated_at: "2026-10-30T00:00:00Z",
  ...over,
});
const otherProfile = { id: OTHER, display_name: "Ben", avatar_color: "#22c55e" };
const group = (over = {}) => ({
  id: GROUP,
  name: "Study",
  color: null,
  position: 0,
  created_at: "2026-10-30T00:00:00Z",
  ...over,
});

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  for (const key of Object.keys(results)) delete results[key];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/me/profile", () => {
  it("returns the existing profile", async () => {
    results.profiles = [{ data: profile() }];
    const res = await get("/api/me/profile");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(profile());
  });

  it("creates a missing profile from the account name", async () => {
    results.profiles = [{ data: null }, { data: profile() }];
    expect((await get("/api/me/profile")).body).toMatchObject({ display_name: "Ana" });
    expect(called("profiles", "insert")[0]).toEqual([{ id: USER, display_name: "Ana" }]);
  });

  it("re-reads after a concurrent insert wins", async () => {
    results.profiles = [{ data: null }, { error: { code: "23505" } }, { data: profile() }];
    expect((await get("/api/me/profile")).status).toBe(200);
    expect(called("profiles", "maybeSingle")).toHaveLength(1);
    expect(called("profiles", "single")).toHaveLength(2);
  });

  it("needs a session", async () => {
    expect((await request(app).get("/api/me/profile")).status).toBe(401);
  });
});

describe("PATCH /api/me/profile", () => {
  it("writes only the fields that were sent, and clears an empty bio", async () => {
    results.profiles = [{ data: profile() }, { data: profile({ display_name: "Ana", bio: null }) }];
    const res = await patch("/api/me/profile", { display_name: "  Ana  ", bio: "", avatar_color: null, id: THIRD });

    expect(res.status).toBe(200);
    expect(called("profiles", "update")).toEqual([
      [{ updated_at: expect.any(String), display_name: "Ana", bio: null, avatar_color: null }],
    ]);
  });

  it.each([[{}], [{ display_name: "   " }], [{ bio: "x".repeat(281) }], [{ avatar_color: "red" }]])(
    "answers 400 for %j without writing",
    async (body) => {
      expect((await patch("/api/me/profile", body)).status).toBe(400);
      expect(calls.profiles).toBeUndefined();
    },
  );
});

describe("GET /api/me/following and /api/me/followers", () => {
  it("lists followed people with is_following from the viewer's side", async () => {
    results.follows = [{ data: [{ followee_id: OTHER }] }, { data: [{ followee_id: OTHER }] }];
    results.profiles = [{ data: [otherProfile] }];

    const res = await get("/api/me/following");
    expect(res.body.users).toEqual([{ ...otherProfile, is_following: true }]);
    expect(called("follows", "eq")).toContainEqual(["follower_id", USER]);
  });

  it("lists followers, marking whether the viewer follows them back", async () => {
    results.follows = [{ data: [{ follower_id: OTHER }] }, { data: [] }];
    results.profiles = [{ data: [otherProfile] }];

    const res = await get("/api/me/followers");
    expect(res.body.users).toEqual([{ ...otherProfile, is_following: false }]);
    expect(called("follows", "eq")).toContainEqual(["followee_id", USER]);
  });

  it("needs a session", async () => {
    expect((await request(app).get("/api/me/following")).status).toBe(401);
    expect((await request(app).get("/api/me/followers")).status).toBe(401);
  });
});

describe("GET /api/me/participants", () => {
  it("returns nobody when the user has no rooms", async () => {
    results.rooms = [{ data: [] }];
    results.room_participants = [{ data: [] }];

    expect((await get("/api/me/participants")).body).toEqual({ participants: [] });
    expect(called("rooms", "in")).toEqual([]);
  });

  it("leaves deleted rooms out of the people graph", async () => {
    results.rooms = [{ data: [{ id: "r1" }] }, { data: [{ id: "r1", status: "deleted" }] }];
    results.room_participants = [{ data: [{ room_id: "r1" }] }];

    expect((await get("/api/me/participants")).body).toEqual({ participants: [] });
    // The participant lookup never runs for a room the user can no longer see.
    expect(called("room_participants", "in")).toEqual([]);
  });

  it("aggregates people across rooms, live people first", async () => {
    const live = new Date().toISOString();
    results.rooms = [
      { data: [{ id: "r1" }] },
      { data: [{ id: "r1", status: "running" }] },
    ];
    results.room_participants = [
      { data: [{ room_id: "r1" }] },
      {
        data: [
          { room_id: "r1", user_id: OTHER, last_seen_at: "2020-01-01T00:00:00Z" },
          { room_id: "r1", user_id: THIRD, last_seen_at: live },
          { room_id: "r1", user_id: THIRD, last_seen_at: live },
        ],
      },
    ];
    results.profiles = [
      {
        data: [
          otherProfile,
          { id: THIRD, display_name: "Cy", avatar_color: null },
        ],
      },
    ];

    const res = await get("/api/me/participants");
    expect(res.status).toBe(200);
    expect(res.body.participants).toEqual([
      expect.objectContaining({ user_id: THIRD, display_name: "Cy", live: true, shared_rooms: 1 }),
      expect.objectContaining({ user_id: OTHER, display_name: "Ben", live: false, shared_rooms: 1 }),
    ]);
    expect(called("room_participants", "neq")).toContainEqual(["user_id", USER]);
  });

  it("needs a session", async () => {
    expect((await request(app).get("/api/me/participants")).status).toBe(401);
  });
});

describe("GET /api/me/invites", () => {
  it("returns both directions with room titles", async () => {
    const received = {
      id: GROUP,
      room_id: "r1",
      inviter_id: OTHER,
      invitee_id: USER,
      status: "pending",
      created_at: "2026-10-30T00:00:00Z",
      responded_at: null,
    };
    const sent = { ...received, id: THIRD, inviter_id: USER, invitee_id: OTHER };

    results.room_invites = [{ data: [received] }, { data: [sent] }];
    results.rooms = [{ data: [{ id: "r1", title: "Paper club" }] }];
    results.profiles = [{ data: [otherProfile, profile()] }, { data: [otherProfile, profile()] }];
    results.follows = [{ data: [{ followee_id: OTHER }] }, { data: [{ followee_id: OTHER }] }];

    const res = await get("/api/me/invites");
    expect(res.status).toBe(200);
    expect(res.body.received[0]).toMatchObject({
      id: GROUP,
      room_title: "Paper club",
      from: { id: OTHER, is_following: true },
      to: { id: USER, is_following: false },
    });
    expect(res.body.sent[0]).toMatchObject({ id: THIRD, from: { id: USER }, to: { id: OTHER } });
  });

  it("hides a deleted room from the invitee, but keeps it for its owner", async () => {
    const received = {
      id: GROUP,
      room_id: "r1",
      inviter_id: OTHER,
      invitee_id: USER,
      status: "pending",
      created_at: "2026-10-30T00:00:00Z",
      responded_at: null,
    };
    const sent = { ...received, id: THIRD, room_id: "r2", inviter_id: USER, invitee_id: OTHER };

    results.room_invites = [{ data: [received] }, { data: [sent] }];
    results.rooms = [
      {
        data: [
          { id: "r1", title: "Their deleted room", status: "deleted" },
          { id: "r2", title: "My deleted room", status: "deleted" },
        ],
      },
    ];
    results.profiles = [{ data: [otherProfile, profile()] }, { data: [otherProfile, profile()] }];

    const res = await get("/api/me/invites");
    expect(res.body.received).toEqual([]);
    expect(res.body.sent.map((invite: { id: string }) => invite.id)).toEqual([THIRD]);
  });

  it("returns empty lists when there are no invites", async () => {
    results.room_invites = [{ data: [] }, { data: [] }];
    results.follows = [{ data: [] }, { data: [] }];

    expect((await get("/api/me/invites")).body).toEqual({ received: [], sent: [] });
  });

  it("needs a session", async () => {
    expect((await request(app).get("/api/me/invites")).status).toBe(401);
  });
});

describe("GET /api/groups", () => {
  it("lists the user's groups in order, counting only live rooms", async () => {
    results.room_groups = [
      {
        data: [
          group({ id: GROUP, name: "Study", position: 1 }),
          group({ id: THIRD, name: "Later", position: 2 }),
        ],
      },
    ];
    results.room_group_items = [{ data: [{ group_id: GROUP }, { group_id: GROUP }, { group_id: THIRD }] }];

    const res = await get("/api/groups");
    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([
      expect.objectContaining({ id: GROUP, name: "Study", room_count: 2 }),
      expect.objectContaining({ id: THIRD, name: "Later", room_count: 1 }),
    ]);
    expect(called("room_groups", "eq")).toContainEqual(["owner_id", USER]);
    expect(called("room_group_items", "neq")).toContainEqual(["rooms.status", "deleted"]);
  });

  it("answers 401 without a session", async () => {
    expect((await request(app).get("/api/groups")).status).toBe(401);
  });
});

describe("POST /api/groups", () => {
  it("creates a group owned by the caller", async () => {
    results.room_groups = [{ data: group({ name: "Study", color: "#3b82f6" }) }];
    const res = await post("/api/groups", { name: "  Study  ", color: "#3b82f6" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Study", room_count: 0 });
    expect(called("room_groups", "insert")).toEqual([
      [{ owner_id: USER, name: "Study", color: "#3b82f6", position: 0 }],
    ]);
  });

  it("answers 409 for a name the user already has", async () => {
    results.room_groups = [{ error: { code: "23505", message: "duplicate" } }];
    const res = await post("/api/groups", { name: "Study" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("You already have a group with that name");
  });

  it.each([[{}], [{ name: "   " }], [{ name: "x".repeat(61) }], [{ name: "a", color: "#0f0" }]])(
    "answers 400 for %j",
    async (body) => {
      expect((await post("/api/groups", body)).status).toBe(400);
      expect(calls.room_groups).toBeUndefined();
    },
  );
});

describe("PATCH /api/groups/:id", () => {
  it("updates only the fields sent, scoped to the owner", async () => {
    results.room_groups = [{ data: group({ name: "Renamed" }) }];
    results.rooms = [{ data: [] }];

    const res = await patch(`/api/groups/${GROUP}`, { name: "  Renamed  ", color: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Renamed", room_count: 0 });
    expect(called("room_groups", "update")).toEqual([
      [{ updated_at: expect.any(String), name: "Renamed", color: null }],
    ]);
    expect(called("room_groups", "eq")).toEqual([
      ["id", GROUP],
      ["owner_id", USER],
    ]);
  });

  it("answers 404 for a group the caller doesn't own", async () => {
    results.room_groups = [{ data: null }];
    expect((await patch(`/api/groups/${GROUP}`, { name: "Stolen" })).status).toBe(404);
  });

  it("answers 409 when renaming onto an existing group", async () => {
    results.room_groups = [{ error: { code: "23505", message: "duplicate" } }];
    expect((await patch(`/api/groups/${GROUP}`, { name: "Study" })).status).toBe(409);
  });

  it("answers 400 for an empty change", async () => {
    expect((await patch(`/api/groups/${GROUP}`, {})).status).toBe(400);
    expect(calls.room_groups).toBeUndefined();
  });
});

describe("DELETE /api/groups/:id", () => {
  it("deletes an owned group and replies 204", async () => {
    results.room_groups = [{ data: { id: GROUP } }];
    expect((await remove(`/api/groups/${GROUP}`)).status).toBe(204);
    expect(called("room_groups", "delete")).toHaveLength(1);
    expect(called("room_groups", "eq")).toEqual([
      ["id", GROUP],
      ["owner_id", USER],
    ]);
  });

  it("answers 404 when nothing was deleted", async () => {
    results.room_groups = [{ data: null }];
    expect((await remove(`/api/groups/${GROUP}`)).status).toBe(404);
  });
});

describe("GET /api/users/search", () => {
  it("searches display names, escapes wildcards and marks follows", async () => {
    results.profiles = [{ data: [otherProfile] }];
    results.follows = [{ data: [{ followee_id: OTHER }] }];

    const res = await get("/api/users/search", { q: "  be%  " });
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([{ ...otherProfile, is_following: true }]);
    expect(called("profiles", "ilike")).toEqual([["display_name", "%be\\%%"]]);
    expect(called("profiles", "neq")).toEqual([["id", USER]]);
  });

  it("needs a non-empty query", async () => {
    expect((await get("/api/users/search", { q: "   " })).status).toBe(400);
    expect(calls.profiles).toBeUndefined();
  });

  it("needs a session", async () => {
    expect((await request(app).get("/api/users/search?q=ben")).status).toBe(401);
  });
});

describe("POST and DELETE /api/users/:id/follow", () => {
  it("follows another user", async () => {
    results.profiles = [{ data: { id: OTHER } }];
    results.follows = [{ data: null }];

    const res = await post(`/api/users/${OTHER}/follow`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: OTHER, following: true });
    expect(called("follows", "upsert")).toEqual([
      [{ follower_id: USER, followee_id: OTHER }, { onConflict: "follower_id,followee_id" }],
    ]);
  });

  it("unfollows idempotently", async () => {
    const res = await remove(`/api/users/${OTHER}/follow`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: OTHER, following: false });
    expect(called("follows", "delete")).toHaveLength(1);
    expect(called("follows", "eq")).toEqual([
      ["follower_id", USER],
      ["followee_id", OTHER],
    ]);
  });

  it("refuses following yourself", async () => {
    expect((await post(`/api/users/${USER}/follow`)).status).toBe(400);
    expect(calls.profiles).toBeUndefined();
  });

  it("answers 404 for an unknown user", async () => {
    results.profiles = [{ data: null }];
    expect((await post(`/api/users/${OTHER}/follow`)).status).toBe(404);
  });

  it("answers 400 for a malformed id", async () => {
    expect((await post("/api/users/not-a-uuid/follow")).status).toBe(400);
    expect((await remove("/api/users/not-a-uuid/follow")).status).toBe(400);
  });

  it("needs a session", async () => {
    expect((await request(app).post(`/api/users/${OTHER}/follow`)).status).toBe(401);
  });
});
