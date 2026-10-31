import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roomsRouter } from "../../src/routes/rooms";
import { errorHandler } from "../../src/middleware/error";

const mockDb = {
  from: vi.fn(),
};

vi.mock("../../src/lib/supabase", () => ({
  supabaseAdmin: () => mockDb,
}));

describe("Drawings API (routes/rooms.ts)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/rooms", roomsRouter);
    app.use(errorHandler);
  });

  it("POST /api/rooms/:id/drawings creates and saves a drawing stroke", async () => {
    // readableRoom check
    mockDb.from.mockImplementation((table: string) => {
      if (table === "rooms") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "test-room", status: "running" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "drawings") {
        return {
          insert: (data: unknown) => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: "11111111-1111-1111-1111-111111111111",
                  ...(data as object),
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    const res = await request(app)
      .post("/api/rooms/test-room/drawings")
      .send({
        page_num: 1,
        author_name: "Alice",
        author_color: "#ff5500",
        path_data: {
          points: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
          width: 3,
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.page_num).toBe(1);
    expect(res.body.author_name).toBe("Alice");
    expect(res.body.author_color).toBe("#ff5500");
  });

  it("POST /api/rooms/:id/drawings rejects invalid author_color hex", async () => {
    mockDb.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "test-room", status: "running" },
            error: null,
          }),
        }),
      }),
    });

    const res = await request(app)
      .post("/api/rooms/test-room/drawings")
      .send({
        page_num: 1,
        author_name: "Alice",
        author_color: "red", // invalid color
        path_data: {
          points: [{ x: 0, y: 0 }],
          width: 2,
        },
      });

    expect(res.status).toBe(400);
  });
});
