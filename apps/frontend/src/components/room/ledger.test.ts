import { describe, expect, it } from "vitest";
import { can, chunkEvents, mergeEvents, reduceLedger, roleOf } from "./ledger";
import { DEFAULT_SETTINGS, type DocRef, type LedgerEvent, type LedgerPayload } from "./types";

const primary: DocRef = { id: "room1", kind: "link", title: "Room", source_url: null, format: null };
const ana = { id: "u-ana", name: "Ana", color: "#2f5bff" };
let n = 0;
const ev = (payload: LedgerPayload, at = `2026-11-01T10:00:${String(n).padStart(2, "0")}.000Z`): LedgerEvent =>
  ({ ...payload, id: `e${n++}`, at, actor: ana }) as LedgerEvent;

const doc = (id: string): DocRef => ({ id, kind: "file", title: id, source_url: null, format: "md" });

describe("mergeEvents", () => {
  it("adds new events in time order and ignores ones already seen", () => {
    const a = ev({ type: "doc.add", doc: doc("d1") }, "2026-11-01T10:00:02.000Z");
    const b = ev({ type: "doc.add", doc: doc("d2") }, "2026-11-01T10:00:01.000Z");
    const merged = mergeEvents([a], [b, a]);
    expect(merged.map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it("returns the same array when nothing is new", () => {
    const a = ev({ type: "chat", message: { id: "m", text: "hi", author: ana, at: "x" } });
    const list = [a];
    expect(mergeEvents(list, [a])).toBe(list);
  });
});

describe("reduceLedger", () => {
  it("keeps the room's own document and drops marks on removed ones", () => {
    const events = [
      ev({ type: "doc.add", doc: doc("d1") }),
      ev({ type: "annot.add", annotation: { id: "a1", doc: "d1", block: "b1", kind: "note", x: 0, y: 0, body: "", color: "#fff", author: ana, at: "x" } }),
      ev({ type: "doc.remove", doc_id: "d1" }),
      ev({ type: "doc.remove", doc_id: "room1" }),
    ];
    const state = reduceLedger(primary, events);
    expect(state.docs.map((d) => d.id)).toEqual(["room1"]);
    expect(state.annotations).toEqual([]);
  });

  it("applies note edits, threads, kicks and settings", () => {
    const state = reduceLedger(primary, [
      ev({ type: "annot.add", annotation: { id: "a1", doc: "room1", block: "b1", kind: "note", x: 0, y: 0, body: "", color: "#fff", author: ana, at: "x" } }),
      ev({ type: "note.edit", annotation_id: "a1", body: "Good point" }),
      ev({ type: "thread.ask", thread: "room", message: { id: "q", role: "user", text: "Why?", author: ana, at: "x", sources: ["room1"] } }),
      ev({ type: "member.kick", member: "guest-1", name: "Bo" }),
      ev({ type: "settings.update", patch: { allowGuests: false } }),
    ]);
    expect(state.annotations[0]).toMatchObject({ body: "Good point" });
    expect(state.threads.room).toHaveLength(1);
    expect(state.kicked).toEqual({ "guest-1": "Bo" });
    expect(state.settings).toEqual({ ...DEFAULT_SETTINGS, allowGuests: false });
  });
});

describe("roles", () => {
  const base = { roles: {}, settings: DEFAULT_SETTINGS };

  it("makes the creator the owner and uses the defaults for everyone else", () => {
    expect(roleOf({ id: "u-ana", signedIn: true }, "u-ana", base)).toBe("owner");
    expect(roleOf({ id: "guest-1", signedIn: false }, "u-ana", { ...base, settings: { ...DEFAULT_SETTINGS, guestRole: "viewer" } })).toBe("viewer");
  });

  it("never lets a role.set make someone the owner", () => {
    expect(roleOf({ id: "u-bo", signedIn: true }, "u-ana", { ...base, roles: { "u-bo": "owner" } })).toBe("editor");
  });

  it("lets admins manage editors but not other admins", () => {
    expect(can.changeRole("admin", "editor")).toBe(true);
    expect(can.changeRole("admin", "admin")).toBe(false);
    expect(can.changeRole("owner", "admin")).toBe(true);
    expect(can.changeRole("editor", "viewer")).toBe(false);
    expect(can.annotate("viewer")).toBe(false);
  });
});

describe("chunkEvents", () => {
  it("splits batches under the size limit without losing events", () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      ev({ type: "chat", message: { id: `m${i}`, text: "x".repeat(500), author: ana, at: "x" } }),
    );
    const batches = chunkEvents(events, 2000);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toHaveLength(30);
  });
});
