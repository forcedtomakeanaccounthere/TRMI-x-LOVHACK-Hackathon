import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f";
const OTHER = "11111111-1111-4111-8111-111111111111";

type Result = { data?: unknown; error?: unknown; count?: number };
type Call = [method: string, ...args: unknown[]];

// A stand-in for the Supabase query builder: records each chained call on its table, then
// resolves to the next result queued for that table.
const calls: Record<string, Call[]> = {};
const results: Record<string, Result[]> = {};

function table(name: string) {
  const log = (calls[name] ??= []);
  const builder: Record<string, unknown> = {
    then: (resolve: (r: Result) => unknown) => resolve({ data: [], error: null, count: 0, ...results[name]?.shift() }),
  };
  for (const method of ["select", "eq", "neq", "or", "ilike", "order", "range", "limit", "maybeSingle", "single", "update", "upsert"]) {
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
const roomRow = (over = {}) => ({
  id: "room0001",
  kind: "link",
  source_url: null,
  title: "A room",
  status: "running",
  created_by: USER,
  created_at: "2026-10-30T00:00:00Z",
  highlights: [{ count: 3 }],
  comments: [{ count: 2 }],
  ...over,
});

const mine = (query: Record<string, string> = {}) =>
  request(app).get("/api/rooms/mine").query(query).set("Authorization", "Bearer token");

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  for (const key of Object.keys(results)) delete results[key];
  results.room_visits = [{ data: [] }];
  results.rooms = [{ data: [], count: 0 }];
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

describe("GET /api/rooms/mine", () => {
  it("hides deleted rooms unless asked, and pages by limit and offset", async () => {
    expect((await mine()).status).toBe(200);
    expect(called("rooms", "neq")).toEqual([["status", "deleted"]]);
    expect(called("rooms", "range")).toEqual([[0, 49]]);

    await mine({ status: "deleted", limit: "10", offset: "20" });
    expect(called("rooms", "eq")).toContainEqual(["status", "deleted"]);
    expect(called("rooms", "range")).toContainEqual([20, 29]);
  });

  it("keeps deleted rooms out of the membership half of the query, so only owners see them", async () => {
    results.room_visits = [{ data: [{ room_id: "abc", last_opened_at: "2026-10-31T00:00:00Z" }] }];
    await mine({ status: "deleted" });

    const [[filter]] = called("rooms", "or") as [[string]];
    expect(filter).toContain(`created_by.eq.${USER}`);
    expect(filter).toContain("id.in.(abc)");
    expect(filter).toContain("status.neq.deleted");
  });

  it("scopes by role", async () => {
    await mine({ role: "owner" });
    expect(called("rooms", "eq")).toContainEqual(["created_by", USER]);
    expect(called("rooms", "or")).toEqual([]);

    await mine({ role: "member" });
    const [[filter]] = called("rooms", "or") as [[string]];
    expect(filter).not.toContain(`created_by.eq.${USER}`);
  });

  it("applies search and kind only when given", async () => {
    await mine();
    expect(called("rooms", "ilike")).toEqual([]);

    await mine({ q: "  50%  ", kind: "pdf" });
    expect(called("rooms", "ilike")).toEqual([["title", "%50\\%%"]]);
    expect(called("rooms", "eq")).toContainEqual(["kind", "pdf"]);
  });

  it.each([
    ["newest", ["created_at", { ascending: false }]],
    ["oldest", ["created_at", { ascending: true }]],
    ["title", ["title", { ascending: true, nullsFirst: false }]],
  ])("sorts by %s with the id as a tiebreak", async (sort, first) => {
    await mine({ sort });
    expect(called("rooms", "order")).toEqual([first, ["id"]]);
  });

  it("shapes each row and never leaks created_by", async () => {
    results.room_visits = [{ data: [{ room_id: "joined01", last_opened_at: "2026-10-31T00:00:00Z" }] }];
    results.rooms = [
      {
        data: [
          roomRow(),
          roomRow({ id: "joined01", created_by: OTHER }),
          roomRow({ id: "orphan01", created_by: null, highlights: [], comments: [] }),
        ],
        count: 7,
      },
    ];

    const res = await mine();
    expect(res.body.total).toBe(7);
    expect(res.body.rooms[0]).toMatchObject({ role: "owner", last_opened_at: null, highlight_count: 3, comment_count: 2 });
    expect(res.body.rooms[0]).not.toHaveProperty("created_by");
    expect(res.body.rooms[0]).not.toHaveProperty("highlights");
    expect(res.body.rooms[1]).toMatchObject({ role: "member", last_opened_at: "2026-10-31T00:00:00Z" });
    expect(res.body.rooms[2]).toMatchObject({ role: "member", highlight_count: 0, comment_count: 0 });
  });

  it.each([
    ["status", { status: "paused" }],
    ["kind", { kind: "video" }],
    ["role", { role: "admin" }],
    ["sort", { sort: "random" }],
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

  it("answers 500 when the visit history can't be read", async () => {
    results.room_visits = [{ error: new Error("boom") }];
    expect((await mine()).status).toBe(500);
    expect(calls.rooms).toBeUndefined();
  });
});

describe("POST /api/rooms/:id/join", () => {
  const join = () => request(app).post("/api/rooms/room0001/join").set("Authorization", "Bearer token");

  it("records the visit for the logged-in user", async () => {
    results.rooms = [{ data: { id: "room0001", status: "archived" } }];

    const res = await join();
    expect(res.body).toEqual({ id: "room0001", status: "archived" });
    expect(called("room_visits", "upsert")[0]?.[0]).toMatchObject({ room_id: "room0001", user_id: USER });
  });

  it.each([
    ["unknown", null],
    ["deleted", { id: "room0001", status: "deleted" }],
  ])("answers 404 for a %s room without recording a visit", async (_, data) => {
    results.rooms = [{ data }];
    expect((await join()).status).toBe(404);
    expect(calls.room_visits).toBeUndefined();
  });
});

describe("PATCH /api/rooms/:id/status", () => {
  const patch = (body: unknown) =>
    request(app).patch("/api/rooms/room0001/status").set("Authorization", "Bearer token").send(body as object);

  it("only ever updates a room the caller owns", async () => {
    results.rooms = [{ data: { id: "room0001", status: "closed" } }];

    expect((await patch({ status: "closed" })).body).toEqual({ id: "room0001", status: "closed" });
    expect(called("rooms", "eq")).toEqual([
      ["id", "room0001"],
      ["created_by", USER],
    ]);
    expect(called("rooms", "update")).toEqual([[{ status: "closed" }]]);
  });

  it("answers 404 when nothing matched", async () => {
    results.rooms = [{ data: null }];
    expect((await patch({ status: "closed" })).status).toBe(404);
  });

  it("writes nothing but the status", async () => {
    results.rooms = [{ data: { id: "room0001", status: "closed" } }];
    await patch({ status: "closed", created_by: OTHER, title: "Hijacked" });
    expect(called("rooms", "update")).toEqual([[{ status: "closed" }]]);
  });

  it("answers 400 for a missing or unknown status", async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ status: "paused" })).status).toBe(400);
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
