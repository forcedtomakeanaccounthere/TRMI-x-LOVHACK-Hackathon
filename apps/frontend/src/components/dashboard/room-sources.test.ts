import { describe, expect, it } from "vitest";
import type { LedgerEvent, LedgerPayload } from "@/components/room/types";
import { foldSources, summarise } from "./room-sources";
import type { RoomView } from "./types";

const ana = { id: "u-ana", name: "Ana", color: "#2f5bff" };
let n = 0;
const ev = (payload: LedgerPayload) =>
  ({ ...payload, id: `e${n++}`, at: `2026-11-01T10:00:${String(n).padStart(2, "0")}.000Z`, actor: ana }) as LedgerEvent;
const doc = (id: string) => ({ id, kind: "pdf" as const, title: id, source_url: null, format: "pdf" as const });

const room = (id: string, patch: Partial<RoomView> = {}): RoomView => ({
  id,
  kind: "pdf",
  title: id,
  source_url: null,
  status: "running",
  role: "owner",
  group_id: null,
  color: null,
  created_at: "2026-11-01T09:00:00.000Z",
  closed_at: null,
  paused_at: null,
  last_activity_at: "2026-11-01T09:00:00.000Z",
  deleted_at: null,
  live_count: 0,
  participants: [],
  counts: { attachments: 1, highlights: 0, comments: 0, ai_queries: 0 },
  ...patch,
});

describe("foldSources", () => {
  const ledger = summarise("main", [
    ev({ type: "doc.add", doc: doc("src1") }),
    ev({ type: "doc.add", doc: doc("src2") }),
    ev({ type: "doc.add", doc: doc("gone") }),
    ev({ type: "doc.remove", doc_id: "gone" }),
    ev({
      type: "annot.add",
      annotation: {
        id: "n1",
        doc: "src1",
        block: "p1",
        kind: "note",
        x: 0,
        y: 0,
        body: "hi",
        color: "#fff",
        author: ana,
        at: "x",
      },
    }),
    ev({
      type: "thread.ask",
      thread: "room",
      message: { id: "q1", role: "user", text: "why?", author: ana, at: "x", sources: ["main"] },
    }),
  ]);

  const rooms = [
    room("main", { counts: { attachments: 1, highlights: 4, comments: 1, ai_queries: 0 } }),
    room("src1", {
      counts: { attachments: 1, highlights: 9, comments: 0, ai_queries: 0 },
      last_activity_at: "2026-11-01T12:00:00.000Z",
    }),
    room("src2", { counts: { attachments: 1, highlights: 2, comments: 0, ai_queries: 0 } }),
    room("gone"),
    room("other", { counts: { attachments: 1, highlights: 5, comments: 0, ai_queries: 0 } }),
  ];

  it("shows only the room, not the sources attached to it (removed ones included)", () => {
    const folded = foldSources(rooms, new Map([["main", ledger]]));
    expect(folded.map((r) => r.id)).toEqual(["main", "other"]);
  });

  it("adds up the room's sources: attachments, highlights, comments and AI questions", () => {
    const main = foldSources(rooms, new Map([["main", ledger]]))[0]!;
    expect(main.counts).toEqual({ attachments: 3, highlights: 15, comments: 2, ai_queries: 1 });
    expect(main.last_activity_at).toBe("2026-11-01T12:00:00.000Z");
  });

  it("leaves rooms alone when no ledger is known", () => {
    expect(foldSources(rooms, new Map()).map((r) => r.id)).toEqual(rooms.map((r) => r.id));
  });
});
