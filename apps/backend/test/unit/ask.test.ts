import { ANSWER_WITHHELD, NOT_IN_DOCUMENT } from "@linkroom/shared";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../src/middleware/error";
import { callAi, resetState, state, supabaseMock } from "../support/ask";

// High limits here; ask-limits.test.ts checks the limits themselves.
process.env.ASK_RATE_LIMIT = "1000";
process.env.ASK_ROOM_RATE_LIMIT = "1000";

vi.mock("../../src/lib/supabase", () => supabaseMock());
vi.mock("../../src/lib/ai", () => ({ callAi: (...args: unknown[]) => callAi(...args) }));

const { createApp } = await import("../../src/app");
const app = createApp();

const ask = (body: object = { question: "How do plants get energy?" }) =>
  request(app).post("/api/rooms/room0001/ask").send(body);

const CHUNKS = [
  { content: "Photosynthesis turns sunlight into energy.", block_ids: ["b0", "b1"], page: null, start_sec: null, end_sec: null },
  { content: "PDF page text about cells.", block_ids: ["p3"], page: 3, start_sec: null, end_sec: null },
];

// apps/ai: a query vector, and an answer citing chunk 1 (and chunk 2 when asked).
function fakeAi({ embed = true, citations = [{ chunk: 1, quote: "turns sunlight into energy" }] } = {}) {
  callAi.mockImplementation(async (path: string) => {
    if (path === "/moderate") return { flagged: [] };
    if (path === "/embed") {
      if (!embed) throw new HttpError(502, "down");
      return { model: "m", vectors: [[0.1, 0.2]] };
    }
    return { answer: "Plants use photosynthesis.", found_in_document: true, citations, withheld: false };
  });
}

beforeEach(() => {
  resetState();
  callAi.mockReset();
  fakeAi();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/rooms/:id/ask", () => {
  it("searches with the question's embedding and words, answers from the chunks and saves the answer", async () => {
    state.matches = CHUNKS;
    fakeAi({ citations: [{ chunk: 1, quote: "turns sunlight into energy" }, { chunk: 2, quote: "about cells" }] });

    const res = await ask({ question: "  How do plants get energy?  ", name: "Priya" });
    expect(res.status).toBe(201);

    expect(callAi.mock.calls[0]!.slice(0, 2)).toEqual(["/moderate", { text: "How do plants get energy?" }]);
    expect(callAi.mock.calls[1]).toEqual(["/embed", { texts: ["How do plants get energy?"], input_type: "query" }, expect.anything(), 10_000]);
    expect(state.rpc).toEqual([
      ["match_chunks", { p_room: "room0001", p_embedding: [0.1, 0.2], p_query: "How do plants get energy?", p_k: 8 }],
    ]);
    expect(callAi.mock.calls[2]).toEqual([
      "/answer",
      { question: "How do plants get energy?", chunks: [{ content: CHUNKS[0]!.content }, { content: CHUNKS[1]!.content }] },
      expect.anything(),
      30_000,
    ]);

    const saved = {
      room_id: "room0001",
      kind: "ask",
      asked_by: "Priya",
      question: "How do plants get energy?",
      answer: "Plants use photosynthesis.",
      found_in_document: true,
      // Blocks and pages come from the chunks, never from the model.
      citations: [
        { quote: "turns sunlight into energy", block_ids: ["b0", "b1"], page: null, start_sec: null, end_sec: null },
        { quote: "about cells", block_ids: ["p3"], page: 3, start_sec: null, end_sec: null },
      ],
    };
    expect(state.inserts.ai_messages).toEqual([saved]);
    expect(res.body).toMatchObject(saved);
    expect(state.inserts.ai_queries).toEqual([expect.objectContaining({ room_id: "room0001", kind: "ask", prompt: "How do plants get energy?" })]);
  });

  it("refuses a question moderation flagged before searching, even when nothing would match, and saves nothing", async () => {
    state.matches = [];
    callAi.mockImplementation(async (path: string) => (path === "/moderate" ? { flagged: ["hate_and_discrimination"] } : {}));
    const res = await ask({ question: "something hateful" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("That question can't be asked here. Try rephrasing it.");
    expect(callAi.mock.calls.map(([path]) => path)).toEqual(["/moderate"]);
    expect(state.rpc).toEqual([]);
    expect(state.inserts.ai_messages ?? []).toEqual([]);
  });

  it("lets a question through when moderation is unavailable", async () => {
    state.matches = CHUNKS;
    fakeAi();
    const answerFor = callAi.getMockImplementation()!;
    callAi.mockImplementation(async (path: string, ...rest: unknown[]) => {
      if (path === "/moderate") throw new HttpError(502, "down");
      return answerFor(path, ...rest);
    });
    expect((await ask()).status).toBe(201);
  });

  it("saves our own message for an answer moderation withheld, never the model's text", async () => {
    state.matches = CHUNKS;
    callAi.mockImplementation(async (path: string) =>
      path === "/moderate"
        ? { flagged: [] }
        : path === "/embed"
          ? { model: "m", vectors: [[1]] }
          : { answer: "model text", found_in_document: false, citations: [], withheld: true },
    );
    const res = await ask();
    expect(res.body).toMatchObject({ answer: ANSWER_WITHHELD, found_in_document: false, citations: [] });
  });

  it("still answers by keyword when the question can't be embedded", async () => {
    state.matches = CHUNKS;
    fakeAi({ embed: false });
    const res = await ask();
    expect(res.status).toBe(201);
    expect(state.rpc[0]![1]).toMatchObject({ p_embedding: null, p_query: "How do plants get energy?" });
    expect(res.body.found_in_document).toBe(true);
  });

  it("says the document doesn't answer, without calling the AI, when nothing matches", async () => {
    state.matches = [];
    const res = await ask({ question: "What is the capital of France?" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ answer: NOT_IN_DOCUMENT, found_in_document: false, citations: [] });
    expect(callAi.mock.calls.map(([path]) => path)).toEqual(["/moderate", "/embed"]);
  });

  it("saves the AI's not-found answer as not found", async () => {
    state.matches = CHUNKS;
    callAi.mockImplementation(async (path: string) =>
      path === "/moderate" ? { flagged: [] } : path === "/embed" ? { model: "m", vectors: [[1]] } : { answer: NOT_IN_DOCUMENT, found_in_document: false, citations: [] },
    );
    const res = await ask();
    expect(res.body).toMatchObject({ answer: NOT_IN_DOCUMENT, found_in_document: false, citations: [] });
  });

  it("drops a citation of a chunk that wasn't sent, and is not found when none is left", async () => {
    state.matches = CHUNKS;
    fakeAi({ citations: [{ chunk: 7, quote: "made up" }] });
    const res = await ask();
    expect(res.body).toMatchObject({ answer: NOT_IN_DOCUMENT, found_in_document: false, citations: [] });
  });

  it("uses a signed-in caller's name when none is given", async () => {
    state.matches = [];
    await request(app).post("/api/rooms/room0001/ask").set("Authorization", "Bearer token").send({ question: "Hi?" });
    expect(state.inserts.ai_messages![0]).toMatchObject({ asked_by: "Signed In" });
  });

  it("answers 502 when the AI can't answer, and saves nothing", async () => {
    state.matches = CHUNKS;
    callAi.mockImplementation(async (path: string) => {
      if (path === "/embed") return { model: "m", vectors: [[1]] };
      throw new HttpError(502, "The AI couldn't answer right now. Try again in a moment.");
    });
    const res = await ask();
    expect(res.status).toBe(502);
    expect(state.inserts.ai_messages).toBeUndefined();
  });

  it.each([
    [{ status: "deleted" }, 404],
    [null, 404],
    [{ status: "archived" }, 409],
  ])("answers %j with %i before calling the AI", async (room, status) => {
    state.results.rooms = [{ data: room }];
    expect((await ask()).status).toBe(status);
    expect(callAi).not.toHaveBeenCalled();
  });

  it.each([null, "pending", "indexing"])("answers 409 while the room's AI state is %s", async (aiStatus) => {
    state.results.room_ai = [{ data: aiStatus ? { status: aiStatus } : null }];
    const res = await ask();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/still reading/);
    expect(callAi).not.toHaveBeenCalled();
  });

  it("answers 409 when the room's indexing failed, rather than searching missing chunks", async () => {
    state.results.room_ai = [{ data: { status: "failed" } }];
    const res = await ask();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/couldn't read this room/);
    expect(callAi).not.toHaveBeenCalled();
    expect(state.rpc).toEqual([]);
  });

  it.each(["summarizing", "ready"])("answers while the room's AI state is %s", async (aiStatus) => {
    state.results.room_ai = [{ data: { status: aiStatus } }];
    state.matches = [];
    expect((await ask()).status).toBe(201);
  });

  it.each([{}, { question: "   " }, { question: "x".repeat(501) }, { question: "ok", name: "n".repeat(41) }])(
    "answers 400 for %j",
    async (body) => {
      expect((await ask(body)).status).toBe(400);
      expect(callAi).not.toHaveBeenCalled();
    },
  );
});
