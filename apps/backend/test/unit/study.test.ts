import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const USER = "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f";
const OTHER = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";
const SET = "33333333-3333-4333-8333-333333333333";

type Result = { data?: unknown; error?: unknown };
type Call = [method: string, ...args: unknown[]];

// Stand-in for the Supabase query builder: records chained calls per table and resolves to the next
// result queued for that table.
const calls: Record<string, Call[]> = {};
const results: Record<string, Result[]> = {};

function table(name: string) {
  const log = (calls[name] ??= []);
  const builder: Record<string, unknown> = {
    then: (resolve: (r: Result) => unknown) => resolve({ data: [], error: null, ...results[name]?.shift() }),
  };
  for (const method of ["select", "eq", "neq", "in", "or", "order", "limit", "maybeSingle", "single", "insert", "delete"]) {
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
const app = createApp();

const called = (name: string, method: string) => (calls[name] ?? []).filter(([m]) => m === method).map(([, ...a]) => a);
const auth = (req: request.Test) => req.set("Authorization", "Bearer token");

const room = (id: string, over = {}) => ({
  id,
  kind: "link",
  title: `Room ${id}`,
  created_by: USER,
  status: "running",
  last_activity_at: "2026-10-30T00:00:00Z",
  ...over,
});
const text = (id: string, over = {}) => ({
  id,
  title: `Room ${id}`,
  content_html: `<p data-block="b0">Text of ${id}</p>`,
  content_text: null,
  ...over,
});
const quiz = {
  kind: "quiz",
  title: "Quiz",
  questions: [{ question: "Q?", options: ["a", "b"], answer_index: 0, explanation: "e", source_id: "roomA" }],
};

let fetchSpy: MockInstance<typeof fetch>;
const aiCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).endsWith("/study"));
const aiBody = () => JSON.parse(String(aiCalls()[0]![1]!.body)) as { kind: string; documents: { id: string; text: string }[]; count: number };

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  for (const key of Object.keys(results)) delete results[key];
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(quiz));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const create = (body: object) => auth(request(app).post("/api/study")).send(body);
const saved = (over = {}) => ({
  data: { id: SET, kind: "quiz", title: "Quiz", room_ids: ["roomA"], focus: null, created_at: "2026-10-31T00:00:00Z", ...over },
});

describe("GET /api/study/sources", () => {
  it("lists rooms the user created or joined, without deleted ones", async () => {
    results.room_participants = [{ data: [{ room_id: "roomB" }] }];
    results.rooms = [{ data: [room("roomA"), room("roomB", { created_by: OTHER })] }];
    const res = await auth(request(app).get("/api/study/sources"));
    expect(res.status).toBe(200);
    expect(res.body.sources.map((s: { id: string; role: string }) => [s.id, s.role])).toEqual([
      ["roomA", "owner"],
      ["roomB", "member"],
    ]);
    expect(called("rooms", "or")).toEqual([[`created_by.eq.${USER},id.in.("roomB")`]]);
    expect(called("rooms", "neq")).toEqual([["status", "deleted"]]);
  });

  it("limits to one of the user's projects, and 404s on someone else's", async () => {
    results.room_groups = [{ data: { id: GROUP } }];
    results.rooms = [{ data: [room("roomA")] }];
    expect((await auth(request(app).get("/api/study/sources").query({ group_id: GROUP }))).status).toBe(200);
    expect(called("rooms", "eq")).toContainEqual(["room_group_items.group_id", GROUP]);

    results.room_groups = [{ data: null }];
    expect((await auth(request(app).get("/api/study/sources").query({ group_id: GROUP }))).status).toBe(404);
  });

  it("needs a signed-in user", async () => {
    expect((await request(app).get("/api/study/sources")).status).toBe(401);
  });
});

describe("POST /api/study", () => {
  it("rejects a body that picks no documents, or both ways at once", async () => {
    expect((await create({ kind: "quiz" })).status).toBe(400);
    expect((await create({ kind: "quiz", all: true, room_ids: ["roomA"] })).status).toBe(400);
    expect((await create({ kind: "quiz", room_ids: ["roomA"], group_id: GROUP })).status).toBe(400);
    expect((await create({ kind: "essay", all: true })).status).toBe(400);
    expect(aiCalls()).toEqual([]);
  });

  it("uses every document with all: true and saves the set", async () => {
    results.study_sets = [{ data: null }, saved({ room_ids: ["roomA", "roomB"] })];
    results.room_participants = [{ data: [] }];
    results.rooms = [
      { data: [room("roomA"), room("roomB")] },
      { data: [text("roomB", { content_text: "PDF text", content_html: null }), text("roomA")] },
    ];

    const res = await create({ kind: "quiz", all: true, count: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(quiz);
    expect(aiBody()).toMatchObject({
      kind: "quiz",
      count: 5,
      documents: [
        { id: "roomA", text: "Text of roomA" },
        { id: "roomB", text: "PDF text" },
      ],
    });
    expect(called("study_sets", "insert")[0]![0]).toMatchObject({ user_id: USER, kind: "quiz", room_ids: ["roomA", "roomB"] });
  });

  it("uses only the picked documents the user can reach", async () => {
    results.study_sets = [{ data: null }, saved()];
    results.rooms = [{ data: [room("roomA"), room("roomB", { created_by: OTHER })] }, { data: [text("roomA"), text("roomB")] }];
    results.room_participants = [{ data: [{ room_id: "roomB" }] }];
    fetchSpy.mockImplementationOnce(async () => Response.json({ kind: "flashcards", title: "t", cards: [] }));
    expect((await create({ kind: "flashcards", room_ids: ["roomA", "roomB"] })).status).toBe(201);
    expect(aiBody().documents.map((d) => d.id)).toEqual(["roomA", "roomB"]);
  });

  it("404s when a picked room is someone else's or deleted, before calling the AI", async () => {
    results.study_sets = [{ data: null }];
    results.rooms = [{ data: [room("roomA"), room("roomB", { created_by: OTHER })] }];
    results.room_participants = [{ data: [] }];
    expect((await create({ kind: "quiz", room_ids: ["roomA", "roomB"] })).status).toBe(404);

    results.study_sets = [{ data: null }];
    results.rooms = [{ data: [room("roomA", { status: "deleted" })] }];
    results.room_participants = [{ data: [] }];
    expect((await create({ kind: "quiz", room_ids: ["roomA"] })).status).toBe(404);
    expect(aiCalls()).toEqual([]);
  });

  it("answers 422 when there is nothing to study", async () => {
    results.study_sets = [{ data: null }];
    results.room_participants = [{ data: [] }];
    results.rooms = [{ data: [] }];
    expect((await create({ kind: "quiz", all: true })).status).toBe(422);

    results.study_sets = [{ data: null }];
    results.room_participants = [{ data: [] }];
    results.rooms = [{ data: [room("roomA")] }, { data: [text("roomA", { content_html: "" })] }];
    expect((await create({ kind: "quiz", all: true })).status).toBe(422);
    expect(aiCalls()).toEqual([]);
  });

  it("answers 429 with Retry-After right after the last set", async () => {
    results.study_sets = [{ data: { created_at: new Date(Date.now() - 2000).toISOString() } }];
    const res = await create({ kind: "quiz", all: true });
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(7);
    expect(aiCalls()).toEqual([]);
  });

  it("answers 502 when the AI returns another kind or fails, and saves nothing", async () => {
    results.study_sets = [{ data: null }];
    results.room_participants = [{ data: [] }];
    results.rooms = [{ data: [room("roomA")] }, { data: [text("roomA")] }];
    fetchSpy.mockImplementationOnce(async () =>
      Response.json({ kind: "flashcards", title: "t", cards: [] }),
    );
    expect((await create({ kind: "quiz", all: true })).status).toBe(502);
    expect(called("study_sets", "insert")).toEqual([]);
  });
});

describe("study set history", () => {
  it("lists, reads and deletes only the user's own sets", async () => {
    results.study_sets = [{ data: [saved().data] }];
    const list = await auth(request(app).get("/api/study"));
    expect(list.status).toBe(200);
    expect(list.body.sets).toHaveLength(1);
    expect(called("study_sets", "eq")).toContainEqual(["user_id", USER]);

    results.study_sets = [{ data: { ...saved().data, data: quiz } }];
    expect((await auth(request(app).get(`/api/study/${SET}`))).body.data).toEqual(quiz);

    results.study_sets = [{ data: null }];
    expect((await auth(request(app).get(`/api/study/${SET}`))).status).toBe(404);

    results.study_sets = [{ data: { id: SET } }];
    expect((await auth(request(app).delete(`/api/study/${SET}`))).status).toBe(204);
    results.study_sets = [{ data: null }];
    expect((await auth(request(app).delete(`/api/study/${SET}`))).status).toBe(404);
  });

  it("rejects an id that isn't a uuid", async () => {
    expect((await auth(request(app).get("/api/study/nope"))).status).toBe(400);
  });
});
