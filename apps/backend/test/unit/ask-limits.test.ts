import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callAi, resetState, state, supabaseMock } from "../support/ask";

process.env.ASK_RATE_LIMIT = "5";
process.env.ASK_ROOM_RATE_LIMIT = "3";

vi.mock("../../src/lib/supabase", () => supabaseMock());
vi.mock("../../src/lib/ai", () => ({ callAi: (...args: unknown[]) => callAi(...args) }));

const { createApp } = await import("../../src/app");
const app = createApp();

const ask = (room: string) => request(app).post(`/api/rooms/${room}/ask`).send({ question: "Why?" });

beforeEach(() => {
  resetState();
  // Every request reads the room and its AI state; nothing matches, so no AI answer is needed.
  state.results.rooms = Array.from({ length: 10 }, () => ({ data: { status: "running" } }));
  state.results.room_ai = Array.from({ length: 10 }, () => ({
    data: [
      { room_id: "roomAAAA", status: "ready" },
      { room_id: "roomBBBB", status: "ready" },
    ],
  }));
  callAi.mockImplementation(async (path: string) => (path === "/moderate" ? { flagged: [] } : { model: "m", vectors: [[1]] }));
});

describe("POST /api/rooms/:id/ask rate limits", () => {
  it("limits questions per room across everyone, then per person", async () => {
    for (let i = 0; i < 3; i++) expect((await ask("roomAAAA")).status).toBe(201);
    const limited = await ask("roomAAAA");
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/in this room/);

    // Another room has its own allowance, until this person's own limit (5 a minute, counting the refused one) is reached.
    expect((await ask("roomBBBB")).status).toBe(201);
    const personal = await ask("roomBBBB");
    expect(personal.status).toBe(429);
    expect(personal.body.error).toMatch(/from you/);
  });
});
