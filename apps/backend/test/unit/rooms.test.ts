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
const moves: [from: string, to: string][] = [];
let moveError: Error | null = null;
// Set by a test to sequence awaited queries (a chain's log tells reads from updates) and to
// decide update results from tracked state instead of the queue.
let gate: ((log: Call[]) => Promise<void>) | null = null;
let onUpdate: ((log: Call[]) => Result) | null = null;

function table(name: string) {
  // calls is shared so existing assertions can read the call order; log is per-chain so a
  // concurrent request can't be mistaken for this one's update.
  const shared = (calls[name] ??= []);
  const log: Call[] = [];
  const builder: Record<string, unknown> = {
    then: async (resolve: (r: Result) => unknown) => {
      if (gate) await gate(log);
      if (onUpdate && log.some(([m]) => m === "update")) return resolve(onUpdate(log));
      resolve({ data: [], error: null, count: 0, ...results[name]?.shift() });
    },
  };
  for (const method of ["select", "eq", "neq", "or", "ilike", "order", "range", "limit", "maybeSingle", "single", "update", "upsert"]) {
    builder[method] = (...args: unknown[]) => {
      log.push([method, ...args]);
      shared.push([method, ...args]);
      return builder;
    };
  }
  return builder;
}

vi.mock("../../src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: table,
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
  moves.length = 0;
  moveError = null;
  gate = null;
  onUpdate = null;
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

  const owned = (room: { status: string; pdf_path: string | null }, after = "closed") => [
    { data: room },
    { data: { id: "room0001", status: after } },
  ];

  it("only looks up rooms the caller owns", async () => {
    results.rooms = owned({ status: "running", pdf_path: null });

    expect((await patch({ status: "closed" })).body).toEqual({ id: "room0001", status: "closed" });
    expect(called("rooms", "eq").slice(0, 2)).toEqual([
      ["id", "room0001"],
      ["created_by", USER],
    ]);
    expect(called("rooms", "update")).toEqual([[{ status: "closed" }]]);
  });

  it("answers 404 when nothing matched, without updating", async () => {
    results.rooms = [{ data: null }];
    expect((await patch({ status: "closed" })).status).toBe(404);
    expect(called("rooms", "update")).toEqual([]);
  });

  it("writes nothing but the status", async () => {
    results.rooms = owned({ status: "running", pdf_path: null });
    await patch({ status: "closed", created_by: OTHER, title: "Hijacked" });
    expect(called("rooms", "update")).toEqual([[{ status: "closed" }]]);
  });

  it("moves a PDF out of the public bucket on delete, and back on restore", async () => {
    results.rooms = owned({ status: "running", pdf_path: "room0001.pdf" }, "deleted");
    await patch({ status: "deleted" });
    expect(moves).toEqual([["pdfs", "pdfs-deleted"]]);

    moves.length = 0;
    results.rooms = owned({ status: "deleted", pdf_path: "room0001.pdf" });
    await patch({ status: "closed" });
    expect(moves).toEqual([["pdfs-deleted", "pdfs"]]);
  });

  it("leaves the PDF alone when it isn't entering or leaving deleted", async () => {
    results.rooms = owned({ status: "running", pdf_path: "room0001.pdf" });
    await patch({ status: "closed" });
    results.rooms = owned({ status: "deleted", pdf_path: "room0001.pdf" }, "deleted");
    await patch({ status: "deleted" });
    expect(moves).toEqual([]);
  });

  it("keeps the status when the PDF can't be moved", async () => {
    results.rooms = owned({ status: "running", pdf_path: "room0001.pdf" }, "deleted");
    moveError = new Error("storage down");
    expect((await patch({ status: "deleted" })).status).toBe(500);
    expect(called("rooms", "update")).toEqual([]);
  });

  it("puts the PDF back when the status can't be saved", async () => {
    results.rooms = [{ data: { status: "running", pdf_path: "room0001.pdf" } }, { error: new Error("boom") }];
    expect((await patch({ status: "deleted" })).status).toBe(500);
    expect(moves).toEqual([
      ["pdfs", "pdfs-deleted"],
      ["pdfs-deleted", "pdfs"],
    ]);
  });

  it("answers 409 and undoes its move when another change got there first", async () => {
    results.rooms = [{ data: { status: "deleted", pdf_path: "room0001.pdf" } }, { data: null }];

    expect((await patch({ status: "closed" })).status).toBe(409);
    expect(called("rooms", "eq")).toContainEqual(["status", "deleted"]);
    expect(moves).toEqual([
      ["pdfs-deleted", "pdfs"],
      ["pdfs", "pdfs-deleted"],
    ]);
  });

  it("undoes the delete move when its save loses the race", async () => {
    results.rooms = [{ data: { status: "running", pdf_path: "room0001.pdf" } }, { data: null }];

    expect((await patch({ status: "deleted" })).status).toBe(409);
    expect(moves).toEqual([
      ["pdfs", "pdfs-deleted"],
      ["pdfs-deleted", "pdfs"],
    ]);
  });

  it("moves nothing public when a restore and a delete overlap on a deleted room", async () => {
    // Both requests must read `deleted` before either saves — the gate holds the saves until
    // both reads are done — and each save rechecks the status it read against stored state,
    // like the database would. Whichever order the saves land in, a deleted room's PDF never
    // ends up stranded in the public bucket.
    const stored = { status: "deleted" };
    let readsDone = 0;
    let releaseSaves: () => void = () => {};
    const savesAllowed = new Promise<void>((r) => (releaseSaves = r));
    gate = async (log) => {
      if (log.some(([m]) => m === "update")) await savesAllowed;
      else if (++readsDone === 2) releaseSaves();
    };
    onUpdate = (log) => {
      const written = (log.find(([m]) => m === "update")![1] as { status: string }).status;
      const guard = (log.find(([m, ...a]) => m === "eq" && a[0] === "status") as [string, string, string] | undefined)?.[2];
      if (guard !== stored.status) return { data: null };
      stored.status = written;
      return { data: { id: "room0001", status: written } };
    };
    results.rooms = [
      { data: { status: "deleted", pdf_path: "room0001.pdf" } },
      { data: { status: "deleted", pdf_path: "room0001.pdf" } },
    ];

    const [restore, remove] = await Promise.all([patch({ status: "closed" }), patch({ status: "deleted" })]);
    expect(restore.status).toBe(200);
    expect(restore.body).toEqual({ id: "room0001", status: "closed" });
    if (remove.status === 200) expect(remove.body).toEqual({ id: "room0001", status: "deleted" });
    else expect(remove.status).toBe(409);
    expect(moves).toEqual([["pdfs-deleted", "pdfs"]]);
    expect(stored.status).toBe("closed");
    gate = null;
    onUpdate = null;
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
