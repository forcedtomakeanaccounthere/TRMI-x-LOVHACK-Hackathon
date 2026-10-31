import { ANSWER_WITHHELD, NOTHING_NEW } from "@linkroom/shared";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callAi, resetState, state, supabaseMock } from "../support/ask";

process.env.ASK_RATE_LIMIT = "1000";
process.env.ASK_ROOM_RATE_LIMIT = "1000";

vi.mock("../../src/lib/supabase", () => supabaseMock());
vi.mock("../../src/lib/ai", () => ({ callAi: (...args: unknown[]) => callAi(...args) }));

const { createApp } = await import("../../src/app");
const app = createApp();
const post = (path: string, body: object = {}) => request(app).post(`/api/rooms/room0001/${path}`).send(body);
const HIGHLIGHT_ID = "00000000-0000-4000-8000-0000000000aa";
const ROOM = {
  kind: "link",
  title: "Paper",
  status: "running",
  content_text: null,
  content_html: '<p data-block="b0">Before.</p><p data-block="b1">Attention matters.</p><p data-block="b2">After.</p><p data-block="b3">Far.</p>',
};

beforeEach(() => {
  resetState();
  state.results.rooms = [{ data: ROOM }];
  callAi.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/rooms/:id/catchup", () => {
  it("recaps what happened since the reader left", async () => {
    state.results.highlights = [{ data: [{ author_name: "Priya", block_id: "b1", quote: "Attention" }] }];
    state.results.comments = [{ data: [] }];
    callAi.mockResolvedValue({ summary: "Priya highlighted attention.", key_points: [], active_people: ["Priya"] });
    const res = await post("catchup", { since: "2026-10-31T10:00:00Z" });
    expect(res.status).toBe(200);
    expect(res.body.summary).toBe("Priya highlighted attention.");
    expect(callAi.mock.calls[0]!.slice(0, 2)).toEqual([
      "/catchup",
      { title: "Paper", highlights: [{ author_name: "Priya", block_id: "b1", quote: "Attention" }], comments: [] },
    ]);
  });

  it("keeps the newest items when there are too many, in time order", async () => {
    // The query reads newest first; the route puts them back in time order.
    state.results.highlights = [{ data: [{ author_name: "B", block_id: "b2", quote: "newer" }, { author_name: "A", block_id: "b1", quote: "older" }] }];
    state.results.comments = [{ data: [] }];
    callAi.mockResolvedValue({ summary: "s", key_points: [], active_people: [] });
    await post("catchup", { since: "2026-10-31T10:00:00Z" });
    const sent = callAi.mock.calls[0]![1] as { highlights: { quote: string }[] };
    expect(sent.highlights.map((h) => h.quote)).toEqual(["older", "newer"]);
  });

  it("says nothing is new without calling the AI", async () => {
    state.results.highlights = [{ data: [] }];
    state.results.comments = [{ data: [] }];
    const res = await post("catchup", { since: "2026-10-31T10:00:00Z" });
    expect(res.body).toEqual({ summary: NOTHING_NEW, key_points: [], active_people: [] });
    expect(callAi).not.toHaveBeenCalled();
  });

  it("needs a valid time", async () => {
    expect((await post("catchup", { since: "yesterday" })).status).toBe(400);
  });
});

describe("POST /api/rooms/:id/explain", () => {
  beforeEach(() => {
    state.results.highlights = [{ data: { block_id: "b1", quote: "Attention matters." } }];
  });

  it("explains the highlight with one block on each side and saves it for the room", async () => {
    callAi.mockResolvedValue({ explanation: "It means focus.", withheld: false });
    const res = await post("explain", { highlight_id: HIGHLIGHT_ID, level: "hinglish", name: "Arun" });
    expect(res.status).toBe(201);
    expect(callAi.mock.calls[0]!.slice(0, 2)).toEqual([
      "/explain",
      { quote: "Attention matters.", context: ["Before.", "Attention matters.", "After."], level: "hinglish" },
    ]);
    expect(state.inserts.ai_messages).toEqual([
      {
        room_id: "room0001",
        kind: "explain",
        asked_by: "Arun",
        question: 'Explain: "Attention matters."',
        answer: "It means focus.",
        found_in_document: true,
        citations: [{ quote: "Attention matters.", block_ids: ["b1"], page: null, start_sec: null, end_sec: null }],
      },
    ]);
  });

  it("saves our own text for a withheld explanation", async () => {
    callAi.mockResolvedValue({ explanation: "model text", withheld: true });
    await post("explain", { highlight_id: HIGHLIGHT_ID });
    expect(state.inserts.ai_messages![0]).toMatchObject({ answer: ANSWER_WITHHELD, found_in_document: false, citations: [] });
  });

  it("answers 404 for a highlight that isn't in this room", async () => {
    state.results.highlights = [{ data: null }];
    expect((await post("explain", { highlight_id: HIGHLIGHT_ID })).status).toBe(404);
    expect(callAi).not.toHaveBeenCalled();
  });
});

describe("POST /api/rooms/:id/quiz", () => {
  it("sends chunks spread over the room and returns the quiz", async () => {
    state.results.chunks = [{ data: Array.from({ length: 24 }, (_, i) => ({ block_ids: [`b${i}`], content: `c${i}` })) }];
    const quiz = { questions: [{ question: "Q?", options: ["a", "b"], answer_index: 0, explanation: "e", source_blocks: ["b0"] }] };
    callAi.mockResolvedValue(quiz);
    const res = await post("quiz");
    expect(res.body).toEqual(quiz);
    const sent = (callAi.mock.calls[0]![1] as { chunks: { block_ids: string[] }[] }).chunks;
    expect(sent.map((c) => c.block_ids[0])).toEqual(["b0", "b2", "b4", "b6", "b8", "b10", "b12", "b14", "b16", "b18", "b20", "b22"]);
  });

  it("answers 409 before the room has chunks", async () => {
    state.results.chunks = [{ data: [] }];
    expect((await post("quiz")).status).toBe(409);
  });
});
