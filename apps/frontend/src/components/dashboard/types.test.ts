import type { DashboardRoom } from "@linkroom/shared";
import { describe, expect, it } from "vitest";
import { fromApiRoom } from "./types";

const room = (patch: Partial<DashboardRoom> = {}): DashboardRoom => ({
  id: "x7Kp2qLm",
  kind: "link",
  source_url: "https://en.wikipedia.org/wiki/Internet",
  title: "Internet",
  status: "running",
  role: "owner",
  group_id: null,
  created_at: "2026-10-20T10:00:00.000Z",
  last_activity_at: "2026-10-30T18:00:00.000Z",
  last_opened_at: "2026-10-30T18:00:00.000Z",
  highlight_count: 7,
  comment_count: 3,
  participant_count: 1,
  live_count: 0,
  people: [],
  ...patch,
});

describe("fromApiRoom", () => {
  it("keeps counts and role, and leaves a running room open-ended on the calendar", () => {
    const view = fromApiRoom(room());
    expect(view.counts).toEqual({ attachments: 1, highlights: 7, comments: 3, ai_queries: 0 });
    expect(view.role).toBe("owner");
    expect(view.closed_at).toBeNull();
    expect(view.last_activity_at).toBe("2026-10-30T18:00:00.000Z");
  });

  it("ends a closed or archived room at its last activity", () => {
    expect(fromApiRoom(room({ status: "closed" })).closed_at).toBe("2026-10-30T18:00:00.000Z");
    expect(fromApiRoom(room({ status: "archived", last_opened_at: null })).closed_at).toBe("2026-10-20T10:00:00.000Z");
  });

  it("names untitled rooms and marks deleted ones", () => {
    const view = fromApiRoom(room({ title: "  ", status: "deleted" }));
    expect(view.title).toBe("Untitled room");
    expect(view.deleted_at).not.toBeNull();
  });
});
