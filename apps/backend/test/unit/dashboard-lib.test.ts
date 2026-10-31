import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  blockFor,
  inviteViews,
  isLive,
  likePattern,
  LIVE_WINDOW_MS,
  participantBlocks,
  type InviteRow,
} from "../../src/lib/dashboard";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

// Resolves each table to its queued rows and counts the queries, so N+1s show up.
function fakeDb(tables: Record<string, unknown[]>) {
  const queries: string[] = [];
  const db = {
    from(name: string) {
      queries.push(name);
      const builder: Record<string, unknown> = {
        then: (resolve: (r: unknown) => unknown) => resolve({ data: tables[name] ?? [], error: null }),
      };
      for (const method of ["select", "in", "eq", "order"]) builder[method] = () => builder;
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, queries };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("isLive", () => {
  it("counts a heartbeat exactly at the window's edge, and not one past it", () => {
    expect(isLive(ago(0))).toBe(true);
    expect(isLive(ago(LIVE_WINDOW_MS))).toBe(true);
    expect(isLive(ago(LIVE_WINDOW_MS + 1))).toBe(false);
  });
});

describe("likePattern", () => {
  it("escapes the LIKE wildcards and the escape character", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});

describe("participantBlocks", () => {
  const row = (user_id: string, room_id = "r1", last_seen_at = ago(0)) => ({
    room_id,
    user_id,
    joined_at: ago(60_000),
    last_seen_at,
  });
  const person = (id: string) => ({ id, display_name: id, avatar_color: null });

  it("skips both queries for an empty page", async () => {
    const { db, queries } = fakeDb({});
    expect((await participantBlocks(db, [])).size).toBe(0);
    expect(queries).toEqual([]);
  });

  it("shows five people but counts everyone, using one query per table", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const { db, queries } = fakeDb({
      room_participants: [...ids.map((id) => row(id)), row("a", "r2")],
      profiles: ids.map(person),
    });

    const blocks = await participantBlocks(db, ["r1", "r2"]);
    expect(blockFor(blocks, "r1")).toMatchObject({ participant_count: 7, live_count: 7 });
    expect(blockFor(blocks, "r1").people).toHaveLength(5);
    expect(blockFor(blocks, "r2").participant_count).toBe(1);
    expect(queries).toEqual(["room_participants", "profiles"]);
  });

  it("separates people who stopped sending heartbeats from those still here", async () => {
    const { db } = fakeDb({
      room_participants: [row("here"), row("gone", "r1", ago(LIVE_WINDOW_MS + 1))],
      profiles: [person("here"), person("gone")],
    });

    const block = blockFor(await participantBlocks(db, ["r1"]), "r1");
    expect(block).toMatchObject({ participant_count: 2, live_count: 1 });
    expect(block.people.map((p) => p.live)).toEqual([true, false]);
  });

  it("leaves out an account with no profile", async () => {
    const { db } = fakeDb({ room_participants: [row("ghost"), row("a")], profiles: [person("a")] });

    const block = blockFor(await participantBlocks(db, ["r1"]), "r1");
    expect(block.participant_count).toBe(1);
    expect(block.people.map((p) => p.user_id)).toEqual(["a"]);
  });

  it("gives a room nobody joined an empty block", async () => {
    const { db } = fakeDb({});
    expect(blockFor(await participantBlocks(db, ["r1"]), "r1")).toEqual({
      people: [],
      participant_count: 0,
      live_count: 0,
    });
  });
});

describe("inviteViews", () => {
  const invite = (over: Partial<InviteRow> = {}): InviteRow => ({
    id: "i1",
    room_id: "r1",
    inviter_id: "a",
    invitee_id: "b",
    status: "pending",
    created_at: ago(0),
    responded_at: null,
    ...over,
  });

  it("drops an invite whose account is gone, and tolerates an unknown room title", async () => {
    const { db } = fakeDb({
      profiles: [
        { id: "a", display_name: "Ana", avatar_color: null },
        { id: "b", display_name: "Ben", avatar_color: null },
      ],
      follows: [{ followee_id: "b" }],
    });

    const views = await inviteViews(db, [invite(), invite({ id: "i2", invitee_id: "gone" })], new Map(), "a");
    expect(views.map((view) => view.id)).toEqual(["i1"]);
    expect(views[0]).toMatchObject({ room_title: null, to: { id: "b", is_following: true } });
  });
});
