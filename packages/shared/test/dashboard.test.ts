import { describe, expect, it } from "vitest";
import { DashboardQuery, DashboardResponse, RoomStatus, RoomStatusResponse, UpdateRoomStatusRequest } from "../src";

describe("RoomStatus", () => {
  it.each(["running", "closed", "archived", "deleted"])("accepts %s", (status) => {
    expect(RoomStatus.parse(status)).toBe(status);
  });

  it("rejects anything else", () => {
    expect(RoomStatus.safeParse("paused").success).toBe(false);
    expect(RoomStatus.safeParse("RUNNING").success).toBe(false);
  });
});

describe("DashboardQuery", () => {
  it("applies defaults and leaves filters unset", () => {
    expect(DashboardQuery.parse({})).toEqual({ sort: "newest", limit: 50, offset: 0 });
  });

  it("reads numbers from query strings", () => {
    expect(DashboardQuery.parse({ limit: "10", offset: "30" })).toMatchObject({ limit: 10, offset: 30 });
  });

  it("trims the search", () => {
    expect(DashboardQuery.parse({ q: "  paper  " }).q).toBe("paper");
  });

  it.each([
    [{ limit: "0" }],
    [{ limit: "101" }],
    [{ limit: "1.5" }],
    [{ limit: "many" }],
    [{ offset: "-1" }],
    [{ status: "paused" }],
    [{ kind: "video" }],
    [{ role: "admin" }],
    [{ sort: "random" }],
    [{ q: "x".repeat(201) }],
  ])("rejects %j", (query) => {
    expect(DashboardQuery.safeParse(query).success).toBe(false);
  });
});

describe("UpdateRoomStatusRequest", () => {
  it("drops unknown fields", () => {
    expect(UpdateRoomStatusRequest.parse({ status: "closed", created_by: "someone" })).toEqual({ status: "closed" });
  });

  it("needs a status", () => {
    expect(UpdateRoomStatusRequest.safeParse({}).success).toBe(false);
  });
});

describe("response contracts", () => {
  it("accepts a page of rooms", () => {
    const room = {
      id: "room0001",
      kind: "pdf",
      source_url: null,
      title: null,
      status: "closed",
      role: "member",
      created_at: "2026-10-30T00:00:00Z",
      last_opened_at: null,
      highlight_count: 0,
      comment_count: 0,
    };
    expect(DashboardResponse.parse({ rooms: [room], total: 1 }).rooms[0]).toEqual(room);
  });

  it("rejects an unknown role", () => {
    const room = { role: "admin" };
    expect(DashboardResponse.safeParse({ rooms: [room], total: 1 }).success).toBe(false);
  });

  it("describes a status change", () => {
    expect(RoomStatusResponse.parse({ id: "a", status: "deleted" })).toEqual({ id: "a", status: "deleted" });
  });
});
