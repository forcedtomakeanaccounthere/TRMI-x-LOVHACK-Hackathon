import { describe, expect, it } from "vitest";
import {
  CreateGroupRequest,
  DashboardQuery,
  DashboardResponse,
  RoomDetail,
  RoomStatus,
  RoomStatusResponse,
  UpdateGroupRequest,
  UpdateProfileRequest,
  UpdateRoomRequest,
  UsersQuery,
} from "../src";

describe("RoomStatus", () => {
  it.each(["running", "paused", "closed", "archived", "deleted"])("accepts %s", (status) => {
    expect(RoomStatus.parse(status)).toBe(status);
  });

  it("rejects anything else", () => {
    expect(RoomStatus.safeParse("ended").success).toBe(false);
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

  it("accepts every sort, including by last activity", () => {
    for (const sort of ["newest", "oldest", "title", "active"]) {
      expect(DashboardQuery.parse({ sort }).sort).toBe(sort);
    }
  });

  it("accepts a group filter", () => {
    const group_id = "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f";
    expect(DashboardQuery.parse({ group_id }).group_id).toBe(group_id);
  });

  it.each([
    [{ limit: "0" }],
    [{ limit: "101" }],
    [{ limit: "1.5" }],
    [{ limit: "many" }],
    [{ offset: "-1" }],
    [{ status: "ended" }],
    [{ kind: "video" }],
    [{ role: "admin" }],
    [{ sort: "random" }],
    [{ group_id: "not-a-uuid" }],
    [{ q: "x".repeat(201) }],
  ])("rejects %j", (query) => {
    expect(DashboardQuery.safeParse(query).success).toBe(false);
  });
});

describe("UpdateRoomRequest", () => {
  it("drops unknown fields", () => {
    expect(UpdateRoomRequest.parse({ status: "paused", created_by: "someone" })).toEqual({ status: "paused" });
  });

  it("accepts a status, a group move or both", () => {
    expect(UpdateRoomRequest.safeParse({ status: "closed" }).success).toBe(true);
    expect(UpdateRoomRequest.safeParse({ group_id: null }).success).toBe(true);
    expect(UpdateRoomRequest.safeParse({ status: "archived", group_id: null }).success).toBe(true);
  });

  it("needs at least one change", () => {
    expect(UpdateRoomRequest.safeParse({}).success).toBe(false);
  });

  it("never accepts deleted, which has its own endpoints", () => {
    expect(UpdateRoomRequest.safeParse({ status: "deleted" }).success).toBe(false);
  });
});

describe("groups and profiles", () => {
  it("trims a group name and limits it to 60 characters", () => {
    expect(CreateGroupRequest.parse({ name: "  Study  " }).name).toBe("Study");
    expect(CreateGroupRequest.safeParse({ name: "   " }).success).toBe(false);
    expect(CreateGroupRequest.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  });

  it("only accepts #rrggbb colours", () => {
    expect(CreateGroupRequest.safeParse({ name: "a", color: "#3b82f6" }).success).toBe(true);
    expect(CreateGroupRequest.safeParse({ name: "a", color: "#0f0" }).success).toBe(false);
  });

  it("needs a change when updating a group", () => {
    expect(UpdateGroupRequest.safeParse({}).success).toBe(false);
    expect(UpdateGroupRequest.parse({ color: null })).toEqual({ color: null });
  });

  it("limits the display name and bio", () => {
    expect(UpdateProfileRequest.parse({ display_name: "  Ana  " }).display_name).toBe("Ana");
    expect(UpdateProfileRequest.safeParse({ display_name: "x".repeat(41) }).success).toBe(false);
    expect(UpdateProfileRequest.safeParse({ bio: "x".repeat(281) }).success).toBe(false);
    expect(UpdateProfileRequest.safeParse({}).success).toBe(false);
  });
});

describe("UsersQuery", () => {
  it("needs a non-empty search and defaults the limit", () => {
    expect(UsersQuery.parse({ q: "ana" })).toEqual({ q: "ana", limit: 20 });
    expect(UsersQuery.safeParse({ q: "   " }).success).toBe(false);
    expect(UsersQuery.safeParse({ q: "a", limit: "51" }).success).toBe(false);
  });
});

describe("response contracts", () => {
  const person = {
    user_id: "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f",
    display_name: "Ana",
    avatar_color: "#3b82f6",
    joined_at: "2026-10-30T00:00:00Z",
    last_seen_at: "2026-10-30T00:10:00Z",
    live: true,
  };

  it("accepts a page of rooms with people and counts", () => {
    const room = {
      id: "room0001",
      kind: "pdf",
      source_url: null,
      title: null,
      status: "paused",
      role: "member",
      group_id: null,
      created_at: "2026-10-30T00:00:00Z",
      last_activity_at: "2026-10-30T00:10:00Z",
      last_opened_at: null,
      highlight_count: 0,
      comment_count: 0,
      participant_count: 1,
      live_count: 1,
      people: [person],
    };
    expect(DashboardResponse.parse({ rooms: [room], total: 1 }).rooms[0]).toEqual(room);
  });

  it("rejects an unknown role", () => {
    const room = { role: "admin" };
    expect(DashboardResponse.safeParse({ rooms: [room], total: 1 }).success).toBe(false);
  });

  it("describes a status change and a full room", () => {
    expect(RoomStatusResponse.parse({ id: "a", status: "deleted" })).toEqual({ id: "a", status: "deleted" });
    expect(
      RoomDetail.parse({
        id: "a",
        kind: "link",
        source_url: null,
        title: null,
        status: "deleted",
        group_id: null,
        created_at: "2026-10-30T00:00:00Z",
        last_activity_at: "2026-10-30T00:00:00Z",
        paused_at: null,
        closed_at: null,
        deleted_at: "2026-10-30T00:10:00Z",
      }).deleted_at,
    ).toBe("2026-10-30T00:10:00Z");
  });
});
