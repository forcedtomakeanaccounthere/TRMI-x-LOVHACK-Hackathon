import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "./types";
import { syncRequest } from "./use-room-channel";

const ev = (id: string) => ({ id }) as LedgerEvent;

describe("syncRequest", () => {
  it("lists the ids held, so peers can tell which events differ even when the counts match", () => {
    expect(syncRequest("me", [ev("a"), ev("b")], { to: "you", reply: true })).toEqual({
      from: "me",
      ids: ["a", "b"],
      to: "you",
      reply: true,
    });
  });

  it("asks for everything when the list wouldn't fit in one message", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ev(`event-${i}`));
    expect(syncRequest("me", many).ids).toBeNull();
  });
});
