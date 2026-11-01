import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../src/middleware/error";

type Result = { data?: unknown; error?: unknown };

// Records what reaches Supabase, per table, and answers with queued results.
const calls: Record<string, unknown[][]> = {};
const writes: string[] = []; // every call in order, across tables
const results: Record<string, Result[]> = {};

// Writes to room_ai (upserts) answer from "room_ai:upsert", so they don't take the results queued
// for reads of the same table.
function table(name: string) {
  const log = (calls[name] ??= []);
  let key = name;
  const builder: Record<string, unknown> = {
    then: (resolve: (r: Result) => unknown) => resolve({ data: null, error: null, ...results[key]?.shift() }),
  };
  for (const method of ["select", "eq", "single", "maybeSingle", "delete", "insert", "upsert", "update", "in", "neq", "gt", "order", "limit", "lt"]) {
    builder[method] = (...args: unknown[]) => {
      log.push([method, ...args]);
      writes.push(`${name}.${method}`);
      if (method === "upsert") key = `${name}:upsert`;
      return builder;
    };
  }
  return builder;
}

vi.mock("../../src/lib/supabase", () => ({ supabaseAdmin: () => ({ from: table }) }));

const callAi = vi.fn();
vi.mock("../../src/lib/ai", () => ({ callAi: (...args: unknown[]) => callAi(...args) }));

const {
  EMBED_BATCH,
  EMBED_CONCURRENCY,
  indexRoom,
  markFailed,
  RESUME_BATCH,
  restartStuckIndexing,
  resumeIndexing,
  STALE_SUMMARIZING_MS,
  STALE_WAITING_MS,
  startIndexing,
  startIndexingIfWaiting,
} = await import("../../src/lib/ai-jobs");

const called = (name: string, method: string) => (calls[name] ?? []).filter(([m]) => m === method).map(([, ...a]) => a);
const statuses = () => called("room_ai", "upsert").map(([row]) => (row as { status: string }).status);
const inserted = () => called("chunks", "insert").flatMap(([rows]) => rows as Record<string, unknown>[]);

// A room whose HTML has `n` paragraphs of 1,605 characters, past the chunk target: one chunk each.
const roomWith = (n: number) => ({
  kind: "link",
  content_text: null,
  content_html: Array.from({ length: n }, (_, i) => `<p data-block="b${i}">${String(i).padStart(4, "0")} ${"x".repeat(1600)}</p>`).join(""),
});

const vectorsFor = (body: { texts: string[] }) => ({
  model: "embed-model",
  vectors: body.texts.map((_, i) => [i, 0.5]),
});

const SUMMARY = {
  overview: "Overview",
  sections: [{ heading: "Part", points: [{ text: "Point", source_blocks: ["b0"] }] }],
  key_terms: [],
};

// apps/ai: vectors for /embed, the summary for /summary.
const fakeAi = async (path: string, body: { texts: string[] }) => (path === "/embed" ? vectorsFor(body) : SUMMARY);

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  writes.length = 0;
  for (const key of Object.keys(results)) delete results[key];
  callAi.mockReset();
  callAi.mockImplementation(fakeAi);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("indexRoom", () => {
  it("chunks the room, embeds the chunks in batches and saves them with their vectors", async () => {
    results.rooms = [{ data: roomWith(EMBED_BATCH + 6) }];

    expect(await indexRoom("room0001")).toEqual({ chunks: EMBED_BATCH + 6, embedded: true, summarized: true });

    // Two /embed calls (a full batch, then the rest, as passages), then /summary.
    expect(callAi.mock.calls.map(([path]) => path)).toEqual(["/embed", "/embed", "/summary"]);
    const [path, body, , timeout] = callAi.mock.calls[0]!;
    expect(path).toBe("/embed");
    expect(body.input_type).toBe("passage");
    expect(body.texts).toHaveLength(EMBED_BATCH);
    expect(callAi.mock.calls[1]![1].texts).toHaveLength(6);
    expect(timeout).toBeGreaterThan(0);

    // The room's old chunks are replaced.
    expect(called("chunks", "delete")).toHaveLength(1);
    expect(calls.chunks!.findIndex(([m]) => m === "delete")).toBeLessThan(calls.chunks!.findIndex(([m]) => m === "insert"));
    const rows = inserted();
    expect(rows).toHaveLength(EMBED_BATCH + 6);
    expect(rows[0]).toMatchObject({ room_id: "room0001", idx: 0, block_ids: ["b0"], embedding: [0, 0.5], embedding_model: "embed-model" });
    // The second batch's first chunk gets the second batch's first vector.
    expect(rows[EMBED_BATCH]).toMatchObject({ idx: EMBED_BATCH, embedding: [0, 0.5] });
    expect(rows[EMBED_BATCH + 1]).toMatchObject({ embedding: [1, 0.5] });

    expect(statuses()).toEqual(["indexing", "summarizing", "ready"]);
  });

  it("saves the chunks without vectors when embeddings fail, so keyword search still works", async () => {
    results.rooms = [{ data: roomWith(EMBED_BATCH + 1) }];
    // The first batch works, the second fails: no vectors at all rather than a mix.
    callAi
      .mockImplementationOnce(fakeAi)
      .mockRejectedValueOnce(new HttpError(502, "The AI couldn't answer right now."));

    expect(await indexRoom("room0001")).toEqual({ chunks: EMBED_BATCH + 1, embedded: false, summarized: true });
    expect(inserted().every((row) => row.embedding === null && row.embedding_model === null)).toBe(true);
    expect(statuses()).toEqual(["indexing", "summarizing", "ready"]);
  });

  it("refuses vectors that don't match the chunks", async () => {
    results.rooms = [{ data: roomWith(2) }];
    callAi.mockResolvedValueOnce({ model: "m", vectors: [[1]] }); // one vector for two chunks
    expect(await indexRoom("room0001")).toEqual({ chunks: 2, embedded: false, summarized: true });
    expect(inserted().every((row) => row.embedding === null)).toBe(true);
  });

  it("doesn't mix vectors from two models", async () => {
    results.rooms = [{ data: roomWith(EMBED_BATCH + 1) }];
    callAi
      .mockImplementationOnce(fakeAi)
      .mockImplementationOnce(async (_p: string, body: { texts: string[] }) => ({ ...vectorsFor(body), model: "other" }));
    expect((await indexRoom("room0001")).embedded).toBe(false);
  });

  it("indexes a PDF room from its extracted text", async () => {
    results.rooms = [{ data: { kind: "pdf", content_html: null, content_text: "[Page 1] Hello\n\n[Page 2] World" } }];
    await indexRoom("room0001");
    expect(inserted()).toEqual([
      expect.objectContaining({ content: "Hello\n\nWorld", block_ids: ["p1", "p2"], page: 1 }),
    ]);
  });

  it("saves nothing and calls no AI for a room without text, and is still ready", async () => {
    results.rooms = [{ data: { kind: "pdf", content_html: null, content_text: null } }];
    expect(await indexRoom("room0001")).toEqual({ chunks: 0, embedded: false, summarized: false });
    expect(callAi).not.toHaveBeenCalled();
    expect(called("chunks", "insert")).toEqual([]);
    expect(statuses()).toEqual(["indexing", "ready"]);
    expect(called("room_ai", "upsert").at(-1)![0]).toMatchObject({ status: "ready", summary: null });
  });

  it("inserts many chunks in several requests", async () => {
    results.rooms = [{ data: roomWith(250) }];
    await indexRoom("room0001");
    expect(called("chunks", "insert").map(([rows]) => (rows as unknown[]).length)).toEqual([100, 100, 50]);
  });

  it("throws when the chunks can't be saved", async () => {
    results.rooms = [{ data: roomWith(1) }];
    results.chunks = [{ error: null }, { error: new Error("insert failed") }];
    await expect(indexRoom("room0001")).rejects.toThrow("insert failed");
    expect(statuses()).toEqual(["indexing"]);
  });

  it("runs once at a time per room", async () => {
    results.rooms = [{ data: roomWith(1) }, { data: roomWith(1) }];
    const [first, second] = await Promise.all([indexRoom("room0001"), indexRoom("room0001")]);
    expect(first.chunks).toBe(1);
    expect(second.chunks).toBe(0);
    expect(called("chunks", "insert")).toHaveLength(1);
  });
});

describe("the detailed summary", () => {
  it("sends the room's title and chunks to /summary and saves the summary with status ready", async () => {
    results.rooms = [{ data: { ...roomWith(2), title: "My doc" } }];
    expect((await indexRoom("room0001")).summarized).toBe(true);

    const [, body, schema, timeout] = callAi.mock.calls.find(([path]) => path === "/summary")!;
    expect(body.title).toBe("My doc");
    expect(body.chunks).toEqual([
      { block_ids: ["b0"], content: expect.stringMatching(/^0000 x+$/), heading_path: [], page: null },
      { block_ids: ["b1"], content: expect.stringMatching(/^0001 x+$/), heading_path: [], page: null },
    ]);
    expect(schema).toBeDefined();
    expect(timeout).toBe(600_000);
    expect(called("room_ai", "upsert").at(-1)![0]).toEqual({
      room_id: "room0001",
      status: "ready",
      error: null,
      summary: SUMMARY,
    });
  });

  it("keeps a room ready (searchable) when its summary can't be made, with the reason", async () => {
    results.rooms = [{ data: roomWith(1) }];
    callAi.mockImplementation(async (path: string, body: { texts: string[] }) => {
      if (path === "/summary") throw new HttpError(502, "The AI couldn't answer right now.");
      return vectorsFor(body);
    });

    expect(await indexRoom("room0001")).toEqual({ chunks: 1, embedded: true, summarized: false });
    expect(inserted()).toHaveLength(1);
    expect(called("room_ai", "upsert").at(-1)![0]).toEqual({
      room_id: "room0001",
      status: "ready",
      error: "The summary couldn't be made. The AI couldn't answer right now.",
      summary: null,
    });
  });

  it("doesn't touch a saved summary while indexing", async () => {
    results.rooms = [{ data: roomWith(1) }];
    await indexRoom("room0001");
    const [indexing, summarizing] = called("room_ai", "upsert").map(([row]) => row as Record<string, unknown>);
    expect(indexing).not.toHaveProperty("summary");
    expect(summarizing).not.toHaveProperty("summary");
  });

  it("cuts long headings to what apps/ai accepts", async () => {
    const long = "H".repeat(800);
    results.rooms = [{ data: { kind: "link", content_text: null, content_html: `<h1 data-block="b0">${long}</h1><p data-block="b1">Text</p>` } }];
    await indexRoom("room0001");
    const [chunk] = callAi.mock.calls.find(([path]) => path === "/summary")![1].chunks;
    expect(chunk.heading_path).toEqual(["H".repeat(500)]);
    // The saved chunk keeps the whole heading.
    expect(inserted()[0]!.heading_path).toEqual([long]);
  });

  it("cuts a long title to what apps/ai accepts", async () => {
    results.rooms = [{ data: { ...roomWith(1), title: "t".repeat(400) } }];
    await indexRoom("room0001");
    expect(callAi.mock.calls.find(([path]) => path === "/summary")![1].title).toHaveLength(300);
  });
});

describe("startIndexing and markFailed", () => {
  it("records a failure in room_ai with a short reason and never throws", async () => {
    results.rooms = [{ error: new Error("room read failed: secret details") }];
    startIndexing("room0001");
    await vi.waitFor(() => expect(statuses()).toEqual(["indexing", "failed"]));
    const [row] = called("room_ai", "upsert").at(-1)!;
    expect(row).toEqual({ room_id: "room0001", status: "failed", error: "Indexing failed" });
  });

  it("keeps an HttpError's message, which is written for people", async () => {
    await markFailed("room0001", new HttpError(502, "The AI couldn't answer right now."));
    expect(called("room_ai", "upsert")[0]![0]).toMatchObject({ error: "The AI couldn't answer right now." });
  });

  it("swallows a failure to record the failure", async () => {
    results["room_ai:upsert"] = [{ error: new Error("database down") }];
    await expect(markFailed("room0001", new Error("x"))).resolves.toBeUndefined();
  });
});

describe("resumeIndexing", () => {
  it("indexes every waiting room, a batch at a time until none are left, skipping deleted rooms", async () => {
    results.room_ai = [
      { data: [{ room_id: "room0001" }, { room_id: "room0002" }] },
      { data: [{ room_id: "room0003" }] },
      { data: [] },
    ];
    results.rooms = [{ data: roomWith(1) }, { data: roomWith(1) }, { data: roomWith(1) }];

    expect(await resumeIndexing()).toBe(3);

    const reads = calls.room_ai!.filter(([m]) => m !== "upsert");
    expect(reads.slice(0, 7)).toEqual([
      ["select", "room_id, rooms!inner(status)"],
      ["in", "status", ["pending", "indexing", "summarizing"]],
      ["neq", "rooms.status", "deleted"],
      ["gt", "room_id", ""],
      ["order", "room_id"],
      ["limit", RESUME_BATCH],
      ["select", "room_id, rooms!inner(status)"],
    ]);
    // Each batch starts after the last room of the one before, so the reads always move on.
    expect(called("room_ai", "gt")).toEqual([
      ["room_id", ""],
      ["room_id", "room0002"],
      ["room_id", "room0003"],
    ]);
    expect(called("rooms", "eq")).toEqual([
      ["id", "room0001"],
      ["id", "room0002"],
      ["id", "room0003"],
    ]);
    expect(called("chunks", "insert")).toHaveLength(3);
  });

  it("marks a room that fails and goes on to the next", async () => {
    results.room_ai = [{ data: [{ room_id: "room0001" }, { room_id: "room0002" }] }, { data: [] }];
    results.rooms = [{ error: new Error("gone") }, { data: roomWith(1) }];

    expect(await resumeIndexing()).toBe(2);
    expect(statuses()).toEqual(["indexing", "failed", "indexing", "summarizing", "ready"]);
  });

  it("does nothing when no room is waiting", async () => {
    results.room_ai = [{ data: [] }];
    expect(await resumeIndexing()).toBe(0);
    expect(calls.rooms).toBeUndefined();
  });

  it("throws when the waiting rooms can't be read", async () => {
    results.room_ai = [{ error: new Error("database down") }];
    await expect(resumeIndexing()).rejects.toThrow("database down");
  });
});

describe("embedding in parallel", () => {
  it("keeps several /embed requests in flight and the vectors in chunk order", async () => {
    const n = EMBED_BATCH * (EMBED_CONCURRENCY + 1) + 3;
    results.rooms = [{ data: roomWith(n) }];
    let inFlight = 0;
    let peak = 0;
    callAi.mockImplementation(async (path: string, body: { texts: string[] }) => {
      if (path !== "/embed") return SUMMARY;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      // Each vector carries its chunk's number (the text starts with it), to check the order.
      return { model: "embed-model", vectors: body.texts.map((t) => [Number(/(\d{4}) x/.exec(t)![1]), 0]) };
    });

    expect(await indexRoom("room0001")).toEqual({ chunks: n, embedded: true, summarized: true });
    expect(peak).toBe(EMBED_CONCURRENCY);
    expect(inserted().map((row) => (row.embedding as number[])[0])).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it("stops sending batches once one fails, and saves the chunks without vectors", async () => {
    results.rooms = [{ data: roomWith(EMBED_BATCH * 10) }];
    callAi.mockImplementation(async (path: string) => {
      if (path === "/embed") throw new HttpError(502, "down");
      return SUMMARY;
    });

    expect((await indexRoom("room0001")).embedded).toBe(false);
    expect(callAi.mock.calls.filter(([path]) => path === "/embed").length).toBe(EMBED_CONCURRENCY);
    expect(inserted().every((row) => row.embedding === null)).toBe(true);
  });
});

describe("restartStuckIndexing", () => {
  const now = Date.parse("2026-11-01T10:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("indexes again rooms left waiting, giving a summary more time", async () => {
    results.room_ai = [
      {
        data: [
          { room_id: "stuck0001", status: "pending", updated_at: ago(STALE_WAITING_MS + 1) },
          { room_id: "stuck0002", status: "indexing", updated_at: ago(STALE_WAITING_MS + 1) },
          { room_id: "slow00001", status: "summarizing", updated_at: ago(STALE_WAITING_MS + 1) },
          { room_id: "stuck0003", status: "summarizing", updated_at: ago(STALE_SUMMARIZING_MS + 1) },
        ],
      },
    ];
    results.rooms = [{ data: roomWith(1) }, { data: roomWith(1) }, { data: roomWith(1) }];

    expect(await restartStuckIndexing(now)).toBe(3);
    expect(called("rooms", "eq").map(([, id]) => id)).toEqual(["stuck0001", "stuck0002", "stuck0003"]);
    // Only rooms whose row hasn't changed since the cutoff are read.
    expect(called("room_ai", "lt")).toEqual([["updated_at", ago(STALE_WAITING_MS)]]);
  });

  it("does nothing when no room is stuck", async () => {
    results.room_ai = [{ data: [] }];
    expect(await restartStuckIndexing(now)).toBe(0);
    expect(callAi).not.toHaveBeenCalled();
  });
});

describe("startIndexingIfWaiting (a restored room)", () => {
  it.each(["pending", "indexing", "summarizing"])("indexes a room still %s", async (status) => {
    results.room_ai = [{ data: { status } }];
    results.rooms = [{ data: roomWith(1) }];
    startIndexingIfWaiting("room0001");
    await vi.waitFor(() => expect(statuses()).toEqual(["indexing", "summarizing", "ready"]));
  });

  it.each([["ready"], ["failed"], [null]])("leaves a room whose state is %s alone", async (status) => {
    results.room_ai = [{ data: status ? { status } : null }];
    startIndexingIfWaiting("room0001");
    await vi.waitFor(() => expect(called("room_ai", "maybeSingle")).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.rooms).toBeUndefined();
    expect(statuses()).toEqual([]);
  });

  it("records a failure and never throws", async () => {
    results.room_ai = [{ error: new Error("database down") }];
    startIndexingIfWaiting("room0001");
    await vi.waitFor(() => expect(statuses()).toEqual(["failed"]));
  });
});

describe("indexRoom for a YouTube room", () => {
  const TRANSCRIPT = '<p data-block="t0" data-start="0" data-end="30.5">Hello and welcome to the talk</p>';

  beforeEach(() => {
    results.rooms = [{ data: { kind: "youtube", title: "Talk", content_html: "<p>shown</p>", content_text: null } }];
    results.room_sources = [{ data: { data: { kind: "transcript", html: TRANSCRIPT } } }];
    callAi.mockImplementation(async (path: string, body: { texts: string[] }) =>
      path === "/embed"
        ? vectorsFor(body)
        : { overview: "About the talk", sections: [{ heading: "Start", points: [{ text: "It opens", source_blocks: ["t0"] }] }], key_terms: [] },
    );
  });

  it("chunks the transcript with its times, not the page it shows", async () => {
    await indexRoom("room0001");
    expect(inserted()).toEqual([expect.objectContaining({ block_ids: ["t0"], start_sec: 0, end_sec: 30.5 })]);
  });

  it("writes the detailed doc into content_html before the room is ready", async () => {
    await indexRoom("room0001");
    const [[update]] = called("rooms", "update") as [[{ content_html: string }]];
    expect(update.content_html).toBe(
      '<p data-block="b0">About the talk</p><h2 data-block="b1">Start</h2><p data-block="b2" data-source="t0">It opens</p>',
    );
    expect(writes.indexOf("rooms.update")).toBeLessThan(writes.lastIndexOf("room_ai.upsert"));
    expect(statuses().at(-1)).toBe("ready");
  });

  it("keeps the transcript as the page when no summary can be made", async () => {
    callAi.mockImplementation(async (path: string, body: { texts: string[] }) => {
      if (path === "/embed") return vectorsFor(body);
      throw new HttpError(502, "down");
    });
    await indexRoom("room0001");
    expect(called("rooms", "update")).toEqual([]);
    expect(statuses().at(-1)).toBe("ready");
  });
});
