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
      ev({
        type: "annot.add",
        annotation: {
          id: "a1",
          doc: "d1",
          block: "b1",
          kind: "note",
          x: 0,
          y: 0,
          body: "",
          color: "#fff",
          author: ana,
          at: "x",
        },
      }),
      ev({ type: "doc.remove", doc_id: "d1" }),
      ev({ type: "doc.remove", doc_id: "room1" }),
    ];
    const state = reduceLedger(primary, events);
    expect(state.docs.map((d) => d.id)).toEqual(["room1"]);
    expect(state.annotations).toEqual([]);
  });

  it("applies note edits, threads, kicks and settings", () => {
    const state = reduceLedger(primary, [
      ev({
        type: "annot.add",
        annotation: {
          id: "a1",
          doc: "room1",
          block: "b1",
          kind: "note",
          x: 0,
          y: 0,
          body: "",
          color: "#fff",
          author: ana,
          at: "x",
        },
      }),
      ev({ type: "note.edit", annotation_id: "a1", body: "Good point" }),
      ev({
        type: "thread.ask",
        thread: "room",
        message: { id: "q", role: "user", text: "Why?", author: ana, at: "x", sources: ["room1"] },
      }),
      ev({ type: "member.kick", member: "guest-1", name: "Bo" }),
      ev({ type: "settings.update", patch: { allowGuests: false } }),
    ]);
    expect(state.annotations[0]).toMatchObject({ body: "Good point" });
    expect(state.threads.room).toHaveLength(1);
    expect(state.kicked).toEqual({ "guest-1": "Bo" });
    expect(state.settings).toEqual({ ...DEFAULT_SETTINGS, allowGuests: false });
  });
});

describe("moving boxes, replies and reactions", () => {
  const note = {
    id: "n1",
    doc: "room1",
    block: "b2",
    kind: "note" as const,
    x: 1,
    y: 0.2,
    body: "hi",
    color: "#fff",
    author: ana,
    at: "x",
  };

  it("places a dragged comment exactly where it was dropped", () => {
    const state = reduceLedger(primary, [
      ev({ type: "annot.add", annotation: note }),
      ev({ type: "annot.move", annotation_id: "n1", x: 0.4, y: 1.5 }),
    ]);
    expect(state.annotations[0]).toMatchObject({ x: 0.4, y: 1.5, moved: true });
  });

  it("remembers who else edited or moved a comment", () => {
    const bo = { id: "u-bo", name: "Bo", color: "#14b8a6" };
    const state = reduceLedger(primary, [
      ev({ type: "annot.add", annotation: note }),
      { ...ev({ type: "note.edit", annotation_id: "n1", body: "better" }), actor: bo },
      { ...ev({ type: "annot.move", annotation_id: "n1", x: 0.1, y: 0.1 }), actor: bo },
    ]);
    expect(state.annotations[0]).toMatchObject({ body: "better", edited_by: bo, moved_by: bo });
  });

  it("ignores a move for marks that are not comments or AI boxes", () => {
    const hl = {
      id: "h1",
      doc: "room1",
      block: "b2",
      kind: "highlight" as const,
      start: 0,
      end: 4,
      quote: "Text",
      color: "#fff",
      author: ana,
      at: "x",
    };
    const state = reduceLedger(primary, [
      ev({ type: "annot.add", annotation: hl }),
      ev({ type: "annot.move", annotation_id: "h1", x: 9, y: 9 }),
    ]);
    expect(state.annotations[0]).not.toHaveProperty("moved");
  });

  it("toggles a reaction per person: the second tap takes it back", () => {
    const bo = { id: "u-bo", name: "Bo", color: "#14b8a6" };
    const react = (actor: typeof ana) => ({ ...ev({ type: "chat.react", message_id: "m1", emoji: "🔥" }), actor });
    const once = reduceLedger(primary, [react(ana), react(bo)]);
    expect(once.reactions.m1!["🔥"]!.map((a) => a.name)).toEqual(["Ana", "Bo"]);
    const undone = reduceLedger(primary, [react(ana), react(bo), react(ana), react(bo)]);
    expect(undone.reactions.m1).toEqual({});
  });

  it("keeps who a chat message replies to", () => {
    const state = reduceLedger(primary, [
      ev({ type: "chat", message: { id: "m2", text: "agreed", author: ana, at: "x", reply_to: "m1" } }),
    ]);
    expect(state.chat[0]!.reply_to).toBe("m1");
  });
});

describe("roles", () => {
  const base = { roles: {}, settings: DEFAULT_SETTINGS };

  it("makes the creator the owner and uses the defaults for everyone else", () => {
    expect(roleOf({ id: "u-ana", signedIn: true }, "u-ana", base)).toBe("owner");
    expect(
      roleOf({ id: "guest-1", signedIn: false }, "u-ana", {
        ...base,
        settings: { ...DEFAULT_SETTINGS, guestRole: "viewer" },
      }),
    ).toBe("viewer");
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
