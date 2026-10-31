import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts: Record<string, unknown[]> = {};
vi.mock("../../src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      insert: async (row: unknown) => {
        (inserts[table] ??= []).push(row);
        return { error: null };
      },
    }),
    auth: {
      getUser: async () => ({
        data: { user: { id: "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f", email: "a@example.com", email_confirmed_at: "2026-10-30T00:00:00Z", user_metadata: {} } },
        error: null,
      }),
    },
  }),
}));
const callAi = vi.fn();
vi.mock("../../src/lib/ai", () => ({ callAi: (...args: unknown[]) => callAi(...args) }));
const startIndexing = vi.fn();
vi.mock("../../src/lib/ai-jobs", () => ({ startIndexing: (id: string) => startIndexing(id), startIndexingIfWaiting: vi.fn() }));

const { createApp } = await import("../../src/app");
const app = createApp();
const ID = "dQw4w9WgXcQ";
const post = (body: object) => request(app).post("/api/rooms/youtube").set("Authorization", "Bearer token").send(body);

beforeEach(() => {
  for (const k of Object.keys(inserts)) delete inserts[k];
  callAi.mockReset();
  startIndexing.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ title: "Great Talk" }))); // oEmbed
});

describe("POST /api/rooms/youtube", () => {
  it("fetches the transcript, saves the room with its paragraphs and the transcript, and starts indexing", async () => {
    callAi.mockResolvedValue({ language: "en", is_generated: true, segments: [{ start: 0, duration: 4, text: "Hello all" }] });
    const res = await post({ url: `https://youtu.be/${ID}` });
    expect(res.status).toBe(201);
    expect(callAi.mock.calls[0]!.slice(0, 2)).toEqual(["/transcript", { video_id: ID }]);
    const html = '<p data-block="t0" data-start="0" data-end="4">Hello all</p>';
    expect(inserts.rooms).toEqual([
      expect.objectContaining({
        id: res.body.id,
        kind: "youtube",
        title: "Great Talk",
        source_url: `https://www.youtube.com/watch?v=${ID}`,
        content_html: html,
        source_meta: { format: "youtube", video_id: ID, language: "en", transcript: "auto", duration_sec: 4 },
      }),
    ]);
    expect(inserts.room_sources).toEqual([{ room_id: res.body.id, data: expect.objectContaining({ kind: "transcript", html }) }]);
    expect(startIndexing).toHaveBeenCalledWith(res.body.id);
  });

  it("uses a pasted transcript without calling apps/ai", async () => {
    const res = await post({ url: `https://www.youtube.com/watch?v=${ID}`, transcript: "0:00\nHi\n0:07\nThere." });
    expect(res.status).toBe(201);
    expect(callAi).not.toHaveBeenCalled();
    expect(inserts.rooms![0]).toMatchObject({ source_meta: { transcript: "pasted", language: null } });
  });

  it("asks for a pasted transcript when captions can't be fetched", async () => {
    callAi.mockImplementation(async (...args: unknown[]) => {
      throw (args[4] as Record<number, Error>)[404];
    });
    const res = await post({ url: `https://youtu.be/${ID}` });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Paste the transcript instead/);
    expect(inserts.rooms).toBeUndefined();
  });

  it("refuses a link that isn't a YouTube video", async () => {
    expect((await post({ url: "https://example.com/watch?v=abc" })).status).toBe(400);
  });
});
