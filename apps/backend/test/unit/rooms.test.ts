import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f";
const OTHER = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";

type Result = { data?: unknown; error?: unknown; count?: number };
type Call = [method: string, ...args: unknown[]];

// A stand-in for the Supabase query builder: records each chained call on its table, then
// resolves to the next result queued for that table.
const calls: Record<string, Call[]> = {};
const results: Record<string, Result[]> = {};
const moves: [from: string, to: string][] = [];
let moveError: Error | null = null;

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
    rpc: async (fn: string, args: unknown) => {
      (calls.rpc ??= []).push([fn, args]);
      return { data: [], error: null, ...results.rpc?.shift() };
    },
    storage: {
      from: (bucket: string) => ({
        move: async (_from: string, _to: string, options: { destinationBucket: string }) => {
          if (moveError) return { error: moveError };
          moves.push([bucket, options.destinationBucket]);
          return { error: null };
        },
      }),
    },
    auth: {
      getUser: async () => ({
        data: { user: { id: USER, email: "a@example.com", email_confirmed_at: "2026-10-30T00:00:00Z", user_metadata: {} } },
        error: null,
      }),
    },
  }),
}));

const { createApp } = await import("../../src/app");
const { titlePattern } = await import("../../src/routes/rooms");
const app = createApp();

const called = (name: string, method: string) => (calls[name] ?? []).filter(([m]) => m === method).map(([, ...a]) => a);
const detail = (over = {}) => ({
  id: "room0001",
  kind: "link",
  source_url: null,
  title: "A room",
  status: "running",
  group_id: null,
  created_at: "2026-10-30T00:00:00Z",
  last_activity_at: "2026-10-30T00:00:00Z",
  paused_at: null,
  closed_at: null,
  deleted_at: null,
  ...over,
});
const listRow = (over = {}) => ({
  id: "room0001",
  kind: "link",
  source_url: null,
  title: "A room",
  status: "running",
  group_id: null,
  created_at: "2026-10-30T00:00:00Z",
  last_activity_at: "2026-10-30T00:00:00Z",
  created_by: USER,
  highlights: [{ count: 3 }],
  comments: [{ count: 2 }],
  ...over,
});

const mine = (query: Record<string, string> = {}) =>
  request(app).get("/api/me/rooms").query(query).set("Authorization", "Bearer token");

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  for (const key of Object.keys(results)) delete results[key];
  moves.length = 0;
  moveError = null;
  results.rooms = [{ data: [] }];
  results.room_participants = [{ data: [] }];
  results.profiles = [{ data: [] }];
  results.room_groups = [{ data: { id: GROUP } }];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("titlePattern", () => {
  it("matches anywhere in the title", () => {
    expect(titlePattern("paper")).toBe("%paper%");
  });

  it("escapes LIKE wildcards and the escape character", () => {
    expect(titlePattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });
});

describe("GET /api/me/rooms", () => {
  it("hides deleted rooms unless asked, and pages by limit and offset", async () => {
    results.rooms = [
      { data: [{ id: "room0001" }] },
      { data: [], count: 0 },
      { data: [{ id: "room0001" }] },
      { data: [], count: 0 },
    ];
    expect((await mine()).status).toBe(200);
    expect(called("rooms", "neq")).toEqual([["status", "deleted"]]);
    expect(called("rooms", "range")).toEqual([[0, 49]]);

    await mine({ status: "deleted", limit: "10", offset: "20" });
    expect(called("rooms", "eq")).toContainEqual(["status", "deleted"]);
    expect(called("rooms", "range")).toContainEqual([20, 29]);
  });

  it("only lets owners see deleted rooms", async () => {
    results.rooms = [{ data: [] }, { data: [{ id: "abc" }] }];
    results.room_participants = [{ data: [{ room_id: "abc", last_seen_at: "2026-10-31T00:00:00Z" }] }];

    expect((await mine({ status: "deleted" })).body).toEqual({ rooms: [], total: 0 });
    expect((await mine({ status: "deleted", role: "member" })).body).toEqual({ rooms: [], total: 0 });
    // The member half isn't even queried, so a joined deleted room can never leak in.
    expect(called("rooms", "in")).toEqual([]);
  });

  it("scopes by role", async () => {
    results.rooms = [{ data: [{ id: "owned1" }] }, { data: [], count: 0 }];
    await mine({ role: "owner" });
    expect(called("rooms", "eq")).toContainEqual(["created_by", USER]);
    expect(called("rooms", "in")).toContainEqual(["id", ["owned1"]]);

    results.rooms = [{ data: [] }, { data: [], count: 0 }];
    results.room_participants = [{ data: [{ room_id: "joined1", last_seen_at: "2026-10-31T00:00:00Z" }] }];
    await mine({ role: "member" });
    expect(called("room_participants", "eq")).toContainEqual(["user_id", USER]);
    expect(called("rooms", "in")).toContainEqual(["id", ["joined1"]]);
  });

  it("applies search, kind and group only when given", async () => {
    results.rooms = [
      { data: [{ id: "room0001" }] },
      { data: [], count: 0 },
      { data: [{ id: "room0001" }] },
      { data: [], count: 0 },
    ];
    await mine();
    expect(called("rooms", "ilike")).toEqual([]);

    await mine({ q: "  50%  ", kind: "pdf", group_id: GROUP });
    expect(called("rooms", "ilike")).toEqual([["title", "%50\\%%"]]);
    expect(called("rooms", "eq")).toContainEqual(["kind", "pdf"]);
    expect(called("rooms", "eq")).toContainEqual(["group_id", GROUP]);
  });

  it.each([
    ["newest", ["created_at", { ascending: false }]],
    ["oldest", ["created_at", { ascending: true }]],
    ["title", ["title", { ascending: true, nullsFirst: false }]],
    ["active", ["last_activity_at", { ascending: false }]],
  ])("sorts by %s with the id as a tiebreak", async (sort, first) => {
    results.rooms = [{ data: [{ id: "room0001" }] }, { data: [], count: 0 }];
    await mine({ sort });
    expect(called("rooms", "order")).toEqual([first, ["id"]]);
  });

  it("shapes each row with the people and counts, and never leaks created_by", async () => {
    results.rooms = [
      { data: [{ id: "room0001" }, { id: "joined01" }] },
      {
        data: [
          listRow(),
          listRow({ id: "joined01", created_by: OTHER }),
          listRow({ id: "orphan01", created_by: null, highlights: [], comments: [] }),
        ],
        count: 7,
      },
    ];
    results.room_participants = [
      { data: [{ room_id: "joined01", last_seen_at: "2026-10-31T00:00:00Z" }] },
      {
        data: [
          { room_id: "room0001", user_id: OTHER, joined_at: "2026-10-31T00:00:00Z", last_seen_at: new Date().toISOString() },
          { room_id: "joined01", user_id: USER, joined_at: "2026-10-30T00:00:00Z", last_seen_at: "2020-01-01T00:00:00Z" },
        ],
      },
    ];
    results.profiles = [
      {
        data: [
          { id: OTHER, display_name: "Ana", avatar_color: "#3b82f6" },
          { id: USER, display_name: "Me", avatar_color: null },
        ],
      },
    ];

    const res = await mine();
    expect(res.body.total).toBe(7);
    expect(res.body.rooms[0]).toMatchObject({
      role: "owner",
      last_opened_at: null,
      highlight_count: 3,
      comment_count: 2,
      participant_count: 1,
      live_count: 1,
    });
    expect(res.body.rooms[0].people[0]).toMatchObject({ display_name: "Ana", live: true });
    expect(res.body.rooms[0]).not.toHaveProperty("created_by");
    expect(res.body.rooms[0]).not.toHaveProperty("highlights");
    expect(res.body.rooms[1]).toMatchObject({
      role: "member",
      last_opened_at: "2026-10-31T00:00:00Z",
      participant_count: 1,
      live_count: 0,
    });
    expect(res.body.rooms[2]).toMatchObject({ role: "member", highlight_count: 0, comment_count: 0 });
  });

  it.each([
    ["status", { status: "ended" }],
    ["kind", { kind: "video" }],
    ["role", { role: "admin" }],
    ["sort", { sort: "random" }],
    ["group_id", { group_id: "nope" }],
    ["limit", { limit: "101" }],
    ["offset", { offset: "-1" }],
  ])("answers 400 for a bad %s", async (_, query) => {
    expect((await mine(query)).status).toBe(400);
    expect(calls.rooms).toBeUndefined();
  });

  it("answers 500 without leaking the database error", async () => {
    results.rooms = [{ error: new Error("connection string with secrets") }];
    const res = await mine();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });

  it("answers 500 when the participation history can't be read", async () => {
    results.room_participants = [{ error: new Error("boom") }];
    expect((await mine()).status).toBe(500);
  });
});

describe("POST /api/rooms/:id/join", () => {
  const join = () => request(app).post("/api/rooms/room0001/join").set("Authorization", "Bearer token");

  it("records the participant and their heartbeat", async () => {
    results.rooms = [{ data: { id: "room0001", status: "archived" } }];

    const res = await join();
    expect(res.body).toEqual({ id: "room0001", status: "archived" });
    expect(called("room_participants", "upsert")[0]).toEqual([
      expect.objectContaining({ room_id: "room0001", user_id: USER, last_seen_at: expect.any(String) }),
      { onConflict: "room_id,user_id" },
    ]);
  });

  it.each([
    ["unknown", null],
    ["deleted", { id: "room0001", status: "deleted" }],
  ])("answers 404 for a %s room without recording a participant", async (_, data) => {
    results.rooms = [{ data }];
    expect((await join()).status).toBe(404);
    expect(calls.room_participants).toBeUndefined();
  });
});

describe("PATCH /api/rooms/:id", () => {
  const patch = (body: unknown) =>
    request(app).patch("/api/rooms/room0001").set("Authorization", "Bearer token").send(body as object);

  it("only looks up rooms the caller owns and writes just the change", async () => {
    results.rooms = [{ data: { status: "running" } }, { data: detail({ status: "paused" }) }];

    const res = await patch({ status: "paused", created_by: OTHER, title: "Hijacked" });
    expect(res.body).toMatchObject({ id: "room0001", status: "paused" });
    expect(called("rooms", "eq").slice(0, 2)).toEqual([
      ["id", "room0001"],
      ["created_by", USER],
    ]);
    expect(called("rooms", "update")).toEqual([[{ status: "paused" }]]);
  });

  it("moves a room into a group the caller owns", async () => {
    results.rooms = [{ data: { status: "running" } }, { data: detail({ group_id: GROUP }) }];

    expect((await patch({ group_id: GROUP })).status).toBe(200);
    expect(called("room_groups", "eq")).toContainEqual(["owner_id", USER]);
    expect(called("rooms", "update")).toEqual([[{ group_id: GROUP }]]);
  });

  it("answers 404 for a group owned by someone else, without updating", async () => {
    results.rooms = [{ data: { status: "running" } }];
    results.room_groups = [{ data: null }];

    expect((await patch({ group_id: GROUP })).status).toBe(404);
    expect(called("rooms", "update")).toEqual([]);
  });

  it("answers 404 when nothing matched", async () => {
    results.rooms = [{ data: null }];
    expect((await patch({ status: "closed" })).status).toBe(404);
    expect(called("rooms", "update")).toEqual([]);
  });

  it("answers 409 for a deleted room", async () => {
    results.rooms = [{ data: { status: "deleted" } }];
    expect((await patch({ status: "running" })).status).toBe(409);
    expect(called("rooms", "update")).toEqual([]);
  });

  // A delete landing between the read and the write must not be undone by this update.
  it("never writes over a room deleted mid-request", async () => {
    results.rooms = [{ data: { status: "running" } }, { data: null }];

    const res = await patch({ status: "paused" });
    expect(res.status).toBe(409);
    expect(called("rooms", "neq")).toContainEqual(["status", "deleted"]);
  });

  it.each([[{}], [{ status: "deleted" }], [{ status: "paused", group_id: "nope" }]])(
    "answers 400 for %j",
    async (body) => {
      expect((await patch(body)).status).toBe(400);
      expect(calls.rooms).toBeUndefined();
    },
  );
});

describe("project privacy on GET /api/me/rooms", () => {
  const joined = { data: [{ room_id: "room0001", last_seen_at: "2026-10-30T00:00:00Z" }] };

  it("doesn't show a member which of the owner's projects a room is in", async () => {
    results.rooms = [{ data: [] }, { data: [listRow({ created_by: OTHER, group_id: GROUP })], count: 1 }];
    results.room_participants = [joined, { data: [] }];

    expect((await mine()).body.rooms[0]).toMatchObject({ role: "member", group_id: null });
  });

  it("still shows the owner their project", async () => {
    results.rooms = [{ data: [{ id: "room0001" }] }, { data: [listRow({ group_id: GROUP })], count: 1 }];
    results.room_participants = [{ data: [] }, { data: [] }];

    expect((await mine()).body.rooms[0]).toMatchObject({ role: "owner", group_id: GROUP });
  });

  it("matches only owned rooms when filtering by project", async () => {
    results.rooms = [{ data: [] }];
    results.room_participants = [joined];

    expect((await mine({ group_id: GROUP })).body).toEqual({ rooms: [], total: 0 });
  });
});

describe("GET /api/rooms/:id/top-members", () => {
  const top = () => request(app).get("/api/rooms/room0001/top-members").set("Authorization", "Bearer token");

  it("adds up each person's activity, keeping the database's order", async () => {
    results.rooms = [{ data: { status: "closed" } }];
    results.rpc = [
      {
        data: [
          { name: "Ana", color: "#3b82f6", highlight_count: 4, comment_count: 1 },
          { name: "Ben", color: "#22c55e", highlight_count: 0, comment_count: 2 },
        ],
      },
    ];

    const res = await top();
    expect(res.status).toBe(200);
    expect(res.body.members).toEqual([
      { name: "Ana", color: "#3b82f6", highlight_count: 4, comment_count: 1, activity: 5 },
      { name: "Ben", color: "#22c55e", highlight_count: 0, comment_count: 2, activity: 2 },
    ]);
    expect(calls.rpc).toEqual([["room_top_members", { target_room: "room0001" }]]);
  });

  it("returns nobody for a room without activity", async () => {
    results.rooms = [{ data: { status: "running" } }];
    expect((await top()).body).toEqual({ members: [] });
  });

  it.each([[{ data: null }], [{ data: { status: "deleted" } }]])("answers 404 for %j", async (room) => {
    results.rooms = [room];
    expect((await top()).status).toBe(404);
    expect(calls.rpc).toBeUndefined();
  });

  it("reports a database failure", async () => {
    results.rooms = [{ data: { status: "running" } }];
    results.rpc = [{ data: null, error: new Error("boom") }];
    expect((await top()).status).toBe(500);
  });

  it("needs a session", async () => {
    expect((await request(app).get("/api/rooms/room0001/top-members")).status).toBe(401);
  });
});

describe("POST /api/rooms/:id/invites", () => {
  const invite = (user_id: unknown = OTHER) =>
    request(app).post("/api/rooms/room0001/invites").set("Authorization", "Bearer token").send({ user_id });
  const inviteRow = {
    id: GROUP,
    room_id: "room0001",
    inviter_id: USER,
    invitee_id: OTHER,
    status: "pending",
    created_at: "2026-10-30T00:00:00Z",
    responded_at: null,
  };
  const ownedRoom = { data: { id: "room0001", title: "A room", status: "running" } };
  const people = [
    { id: USER, display_name: "Me", avatar_color: null },
    { id: OTHER, display_name: "Ana", avatar_color: null },
  ];

  beforeEach(() => {
    results.rooms = [ownedRoom];
    results.profiles = [{ data: { id: OTHER } }, { data: people }];
    results.room_participants = [{ data: null }];
    results.room_invites = [{ data: inviteRow }];
    results.follows = [{ data: [] }];
  });

  it("invites as the caller, ignoring any inviter sent in the body", async () => {
    const res = await request(app)
      .post("/api/rooms/room0001/invites")
      .set("Authorization", "Bearer token")
      .send({ user_id: OTHER, inviter_id: OTHER });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      room_id: "room0001",
      room_title: "A room",
      status: "pending",
      from: { id: USER },
      to: { id: OTHER },
    });
    expect(called("rooms", "eq")).toContainEqual(["created_by", USER]);
    expect(called("room_invites", "insert")).toEqual([
      [{ room_id: "room0001", inviter_id: USER, invitee_id: OTHER }],
    ]);
  });

  it.each([[{ data: null }], [{ data: { id: "room0001", title: "A room", status: "deleted" } }]])(
    "answers 404 for a room that isn't invitable: %j",
    async (room) => {
      results.rooms = [room];
      expect((await invite()).status).toBe(404);
      expect(called("room_invites", "insert")).toEqual([]);
    },
  );

  it("refuses inviting yourself", async () => {
    expect((await invite(USER)).status).toBe(400);
    expect(called("room_invites", "insert")).toEqual([]);
  });

  it("answers 404 for an unknown user", async () => {
    results.profiles = [{ data: null }];
    expect((await invite()).status).toBe(404);
    expect(called("room_invites", "insert")).toEqual([]);
  });

  it("answers 409 for someone already in the room", async () => {
    results.room_participants = [{ data: { user_id: OTHER } }];
    expect((await invite()).status).toBe(409);
    expect(called("room_invites", "insert")).toEqual([]);
  });

  it("answers 409 for a second pending invite, from the unique index", async () => {
    results.room_invites = [{ data: null, error: { code: "23505" } }];
    expect((await invite()).status).toBe(409);
  });

  it("answers 400 for a malformed user id, before touching the database", async () => {
    expect((await invite("nope")).status).toBe(400);
    expect(calls.rooms).toBeUndefined();
  });

  it("needs a session", async () => {
    const res = await request(app).post("/api/rooms/room0001/invites").send({ user_id: OTHER });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/rooms/:id and POST /api/rooms/:id/restore", () => {
  const remove = () => request(app).delete("/api/rooms/room0001").set("Authorization", "Bearer token");
  const restore = () => request(app).post("/api/rooms/room0001/restore").set("Authorization", "Bearer token");
  const owned = (room: { status: string; pdf_path: string | null }, after = detail({ status: "deleted" })) => [
    { data: room },
    { data: after },
  ];

  it("moves a PDF out of the public bucket on delete, and back on restore", async () => {
    results.rooms = owned({ status: "running", pdf_path: "room0001.pdf" });
    expect((await remove()).body).toMatchObject({ status: "deleted" });
    expect(moves).toEqual([["pdfs", "pdfs-deleted"]]);

    moves.length = 0;
    results.rooms = owned({ status: "deleted", pdf_path: "room0001.pdf" }, detail({ status: "running" }));
    expect((await restore()).body).toMatchObject({ status: "running" });
    expect(moves).toEqual([["pdfs-deleted", "pdfs"]]);
  });

  it("leaves the PDF alone when deleting an already deleted room or restoring a live one", async () => {
    results.rooms = [
      { data: { status: "deleted", pdf_path: "room0001.pdf" } },
      { data: detail({ status: "deleted" }) },
    ];
    expect((await remove()).status).toBe(200);
    expect(moves).toEqual([]);

    results.rooms = [{ data: { status: "running", pdf_path: "room0001.pdf" } }];
    expect((await restore()).status).toBe(409);
    expect(moves).toEqual([]);
  });

  it("keeps the status when the PDF can't be moved", async () => {
    results.rooms = owned({ status: "running", pdf_path: "room0001.pdf" });
    moveError = new Error("storage down");
    expect((await remove()).status).toBe(500);
    expect(called("rooms", "update")).toEqual([]);
  });

  it("puts the PDF back when the status can't be saved", async () => {
    results.rooms = [{ data: { status: "running", pdf_path: "room0001.pdf" } }, { error: new Error("boom") }];
    expect((await remove()).status).toBe(500);
    expect(moves).toEqual([
      ["pdfs", "pdfs-deleted"],
      ["pdfs-deleted", "pdfs"],
    ]);
  });

  it("answers 409 and undoes its move when another change got there first", async () => {
    results.rooms = [{ data: { status: "deleted", pdf_path: "room0001.pdf" } }, { data: null }];

    expect((await restore()).status).toBe(409);
    expect(called("rooms", "eq")).toContainEqual(["status", "deleted"]);
    expect(moves).toEqual([
      ["pdfs-deleted", "pdfs"],
      ["pdfs", "pdfs-deleted"],
    ]);
  });

  it("moves nothing public when a restore and a delete overlap on a deleted room", async () => {
    // Both requests read `deleted`: the delete is idempotent and skips its move, while the restore
    // moves the PDF back at once. Only the restore's guarded save can win.
    results.rooms = [
      { data: { status: "deleted", pdf_path: "room0001.pdf" } },
      { data: { status: "deleted", pdf_path: "room0001.pdf" } },
      { data: detail({ status: "deleted" }) },
      { data: detail({ status: "running" }) },
    ];

    const [back, again] = await Promise.all([restore(), remove()]);
    expect(back.status).toBe(200);
    expect(again.status).toBe(200);
    expect(moves).toEqual([["pdfs-deleted", "pdfs"]]);
  });
});

describe("POST /api/rooms/:id/recap", () => {
  const recap = () => request(app).post("/api/rooms/room0001/recap");

  it("answers 404 for a deleted room and 409 for an archived one, before calling the AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    results.rooms = [{ data: { title: "x", content_html: "", status: "deleted" } }];
    expect((await recap()).status).toBe(404);

    results.rooms = [{ data: { title: "x", content_html: "", status: "archived" } }];
    expect((await recap()).status).toBe(409);

    const aiCalls = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith("/recap"));
    expect(aiCalls).toEqual([]);
    fetchSpy.mockRestore();
  });
});
