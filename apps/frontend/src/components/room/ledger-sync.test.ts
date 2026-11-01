import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { LedgerSync } from "./ledger-sync";
import type { LedgerEvent } from "./types";

const actor = (id: string) => ({ id, name: id, color: "#ef4444" });
const ev = (id: string, who = "me") =>
  ({ id, at: "2026-11-01T10:00:00.000Z", actor: actor(who), type: "chat", message: { id: `m-${id}`, text: "hi", author: actor(who), at: "2026-11-01T10:00:00.000Z" } }) as LedgerEvent;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("LedgerSync", () => {
  it("loads every page of saved events, without their seq", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ events: [{ ...ev("a"), seq: 1 }, { ...ev("b"), seq: 2 }], next: 2 })
      .mockResolvedValueOnce({ events: [{ ...ev("c"), seq: 3 }], next: null });
    const sync = new LedgerSync({ list, post: vi.fn() });
    const events = await sync.load();
    expect(events.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(list.mock.calls.map(([after]) => after)).toEqual([0, 2]);
    expect(events[0]).not.toHaveProperty("seq");
  });

  it("saves new events, and backfills only its own events the server lacks", async () => {
    const post = vi.fn().mockResolvedValue({ accepted: [], rejected: [] });
    const sync = new LedgerSync({ list: vi.fn(), post });
    sync.backfill([ev("saved"), ev("unsaved"), ev("theirs", "ana")], [ev("saved")], "me");
    await vi.advanceTimersByTimeAsync(0);
    expect(post.mock.calls[0]![0].map((e: LedgerEvent) => e.id)).toEqual(["unsaved"]);
  });

  it("retries when the server can't be reached, and drops a batch it refuses", async () => {
    const onRejected = vi.fn();
    const post = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ accepted: ["x"], rejected: [] })
      .mockRejectedValueOnce(new ApiError("You were removed from this room.", 403));
    const sync = new LedgerSync({ list: vi.fn(), post, onRejected });
    sync.push([ev("x")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(post).toHaveBeenCalledTimes(2);
    sync.push([ev("y")]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenCalledTimes(3);
    expect(onRejected).toHaveBeenCalledWith([{ id: "y", reason: "You were removed from this room." }]);
  });
});
