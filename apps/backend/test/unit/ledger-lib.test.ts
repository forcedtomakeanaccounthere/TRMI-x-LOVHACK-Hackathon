import { DEFAULT_ROOM_SETTINGS, LedgerEvent, type Role, type RoomSettings } from "@linkroom/shared";
import { describe, expect, it } from "vitest";
import { checkEvent, hashKey, project, roleOf, type MemberRow, type RuleContext } from "../../src/lib/ledger";

// The permission rules of lib/ledger.ts, one story at a time. They must match the frontend's
// (apps/frontend/src/components/room/ledger.ts), which hides what these refuse.

const OWNER = "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f";
const MEMBER = "11111111-1c3a-4f5b-9d6e-7a8b9c0d1e2f";
const ADMIN = "22222222-1c3a-4f5b-9d6e-7a8b9c0d1e2f";
const GUEST = "guest-abcdef1234";
const AT = "2026-11-01T10:00:00.000Z";

const actor = (id: string) => ({ id, name: id.slice(0, 8), color: "#3b82f6" });
let n = 0;
const ev = (who: string, payload: Record<string, unknown>) =>
  LedgerEvent.parse({ id: `e${++n}`, at: AT, actor: actor(who), ...payload });

const highlight = (who: string, id = "a1") =>
  ev(who, {
    type: "annot.add",
    annotation: { id, doc: "room0001", block: "b0", author: actor(who), at: AT, kind: "highlight", start: 0, end: 4, quote: "text", color: "#facc15" },
  });

function ctx(me: string, opts: { roles?: Record<string, Role>; kicked?: string[]; settings?: Partial<RoomSettings>; status?: string; authors?: Record<string, string> } = {}): RuleContext {
  const members = new Map<string, MemberRow>();
  for (const [id, role] of Object.entries(opts.roles ?? {})) members.set(id, { member_id: id, name: "x", role, kicked_at: null, key_hash: null });
  for (const id of opts.kicked ?? []) {
    const row = members.get(id) ?? { member_id: id, name: "x", role: null, kicked_at: null, key_hash: null };
    members.set(id, { ...row, kicked_at: AT });
  }
  return {
    roomId: "room0001",
    status: opts.status ?? "running",
    ownerId: OWNER,
    me: { id: me, signedIn: !me.startsWith("guest-"), keyHash: null },
    settings: { ...DEFAULT_ROOM_SETTINGS, ...opts.settings },
    members,
    authorOf: (kind, id) => opts.authors?.[`${kind}:${id}`],
  };
}

describe("roleOf", () => {
  it("makes the creator the owner, whatever the ledger says", () => {
    expect(roleOf({ id: OWNER, signedIn: true }, OWNER, "viewer", DEFAULT_ROOM_SETTINGS)).toBe("owner");
  });
  it("uses a role set in the room, else the default for members or guests", () => {
    const settings = { ...DEFAULT_ROOM_SETTINGS, memberRole: "viewer" as const, guestRole: "editor" as const };
    expect(roleOf({ id: MEMBER, signedIn: true }, OWNER, "admin", settings)).toBe("admin");
    expect(roleOf({ id: MEMBER, signedIn: true }, OWNER, null, settings)).toBe("viewer");
    expect(roleOf({ id: GUEST, signedIn: false }, OWNER, null, settings)).toBe("editor");
    expect(roleOf(null, OWNER, null, settings)).toBe("editor"); // an anonymous caller is a guest
  });
  it("never lets a stored role make someone the owner", () => {
    expect(roleOf({ id: MEMBER, signedIn: true }, OWNER, "owner", DEFAULT_ROOM_SETTINGS)).toBe("editor");
  });
});

describe("checkEvent", () => {
  it("lets editors annotate, chat, ask and make artifacts", () => {
    const c = ctx(MEMBER);
    expect(checkEvent(highlight(MEMBER), c)).toBeNull();
    expect(checkEvent(ev(MEMBER, { type: "chat", message: { id: "m1", text: "Hi", author: actor(MEMBER), at: AT } }), c)).toBeNull();
    expect(
      checkEvent(ev(MEMBER, { type: "thread.ask", thread: "room", message: { id: "q1", role: "user", text: "Why?", author: actor(MEMBER), at: AT, sources: [] } }), c),
    ).toBeNull();
  });

  it("refuses an event written in someone else's name", () => {
    const forged = LedgerEvent.parse({ ...highlight(OWNER), actor: actor(MEMBER) });
    expect(checkEvent(forged, ctx(MEMBER))).toBe("An annotation's author must be you");
    expect(checkEvent(highlight(OWNER), ctx(MEMBER))).toBe("The event's actor isn't you");
  });

  it("story: a viewer can't annotate or add sources, but can still chat and (by default) ask the AI", () => {
    const c = ctx(MEMBER, { roles: { [MEMBER]: "viewer" } });
    expect(checkEvent(highlight(MEMBER), c)).toBe("Your role can't annotate");
    expect(checkEvent(ev(MEMBER, { type: "doc.add", doc: { id: "room0002", kind: "pdf", title: "B", source_url: null, format: null } }), c)).toBe(
      "Your role can't add sources",
    );
    expect(checkEvent(ev(MEMBER, { type: "chat", message: { id: "m1", text: "Hi", author: actor(MEMBER), at: AT } }), c)).toBeNull();
    const ask = ev(MEMBER, { type: "thread.ask", thread: "room", message: { id: "q1", role: "user", text: "?", author: actor(MEMBER), at: AT, sources: [] } });
    expect(checkEvent(ask, c)).toBeNull();
    expect(checkEvent(ask, ctx(MEMBER, { roles: { [MEMBER]: "viewer" }, settings: { viewersUseAi: false } }))).toBe("Your role can't use the AI");
  });

  it("story: a removed person can't write anything, not even chat", () => {
    const c = ctx(GUEST, { kicked: [GUEST] });
    expect(checkEvent(ev(GUEST, { type: "chat", message: { id: "m1", text: "Hi", author: actor(GUEST), at: AT } }), c)).toBe(
      "You were removed from this room",
    );
  });

  it("story: with guests off, guests can't write but members still can", () => {
    expect(checkEvent(highlight(GUEST), ctx(GUEST, { settings: { allowGuests: false } }))).toBe("This room is for signed-in members only");
    expect(checkEvent(highlight(MEMBER), ctx(MEMBER, { settings: { allowGuests: false } }))).toBeNull();
  });

  it("story: a closed room takes settings, roles and kicks, but no new marks", () => {
    const c = ctx(OWNER, { status: "closed" });
    expect(checkEvent(highlight(OWNER), c)).toBe("This room is read only");
    expect(checkEvent(ev(OWNER, { type: "settings.update", patch: { allowGuests: false } }), c)).toBeNull();
    expect(checkEvent(ev(OWNER, { type: "member.kick", member: GUEST, name: "G" }), c)).toBeNull();
  });

  it("only the author or an admin removes a mark or artifact; anything older (no add event) any editor", () => {
    const remove = (who: string) => ev(who, { type: "annot.remove", annotation_id: "a1" });
    const authors = { "annotation:a1": MEMBER };
    expect(checkEvent(remove(MEMBER), ctx(MEMBER, { authors }))).toBeNull();
    expect(checkEvent(remove(GUEST), ctx(GUEST, { authors }))).toBe("Only its author or an admin can remove this");
    expect(checkEvent(remove(ADMIN), ctx(ADMIN, { authors, roles: { [ADMIN]: "admin" } }))).toBeNull();
    expect(checkEvent(remove(GUEST), ctx(GUEST))).toBeNull(); // a saved highlight from before the ledger
    expect(checkEvent(remove(GUEST), ctx(GUEST, { roles: { [GUEST]: "viewer" } }))).toBe("Only its author or an admin can remove this");
    const art = (who: string) => ev(who, { type: "artifact.remove", artifact_id: "x1" });
    expect(checkEvent(art(GUEST), ctx(GUEST, { authors: { "artifact:x1": MEMBER } }))).toBe("Only its author or an admin can remove this");
  });

  it("refuses an add that reuses someone else's annotation or artifact id", () => {
    const authors = { "annotation:a1": GUEST, "artifact:x1": GUEST };
    expect(checkEvent(highlight(MEMBER, "a1"), ctx(MEMBER, { authors }))).toBe("That annotation id belongs to someone else");
    expect(checkEvent(highlight(GUEST, "a1"), ctx(GUEST, { authors }))).toBeNull(); // the author re-adding is fine
    const artifact = ev(MEMBER, {
      type: "artifact.add",
      artifact: { id: "x1", title: "T", sources: [], author: actor(MEMBER), at: AT, preview: false, body: { kind: "flashcards", cards: [] } },
    });
    expect(checkEvent(artifact, ctx(MEMBER, { authors }))).toBe("That artifact id belongs to someone else");
  });

  it("lets anyone who can annotate edit a comment or move a box, as the workspace does", () => {
    const authors = { "annotation:n1": MEMBER };
    const edit = (who: string) => ev(who, { type: "note.edit", annotation_id: "n1", body: "changed" });
    const move = (who: string) => ev(who, { type: "annot.move", annotation_id: "n1", x: 0.5, y: 0.25 });
    expect(checkEvent(edit(OWNER), ctx(OWNER, { authors }))).toBeNull();
    expect(checkEvent(move(OWNER), ctx(OWNER, { authors }))).toBeNull();
    const viewer = ctx(MEMBER, { authors, roles: { [MEMBER]: "viewer" } });
    expect(checkEvent(edit(MEMBER), viewer)).toBe("Your role can't edit comments");
    expect(checkEvent(move(MEMBER), viewer)).toBe("Your role can't move comments");
  });

  it("lets anyone taking part react, even a viewer", () => {
    const react = ev(MEMBER, { type: "chat.react", message_id: "m1", emoji: "👍" });
    expect(checkEvent(react, ctx(MEMBER, { roles: { [MEMBER]: "viewer" } }))).toBeNull();
  });

  it("keeps room notes: editors add and edit, only the author or an admin removes", () => {
    const entry = (who: string, id = "nb1") => ({ id, kind: "text", text: "Idea", quote: null, image: null, author: actor(who), at: AT });
    expect(checkEvent(ev(MEMBER, { type: "notebook.add", entry: entry(MEMBER) }), ctx(MEMBER))).toBeNull();
    expect(checkEvent(ev(MEMBER, { type: "notebook.add", entry: entry(OWNER) }), ctx(MEMBER))).toBe("A note's author must be you");
    const authors = { "notebook:nb1": MEMBER };
    expect(checkEvent(ev(OWNER, { type: "notebook.add", entry: entry(OWNER) }), ctx(OWNER, { authors }))).toBe(
      "That note id belongs to someone else",
    );
    expect(checkEvent(ev(OWNER, { type: "notebook.edit", entry_id: "nb1", text: "x" }), ctx(OWNER, { authors }))).toBeNull();
    const remove = (who: string) => ev(who, { type: "notebook.remove", entry_id: "nb1" });
    expect(checkEvent(remove(GUEST), ctx(GUEST, { authors }))).toBe("Only its author or an admin can remove this");
    expect(checkEvent(remove(MEMBER), ctx(MEMBER, { authors }))).toBeNull();
    expect(checkEvent(remove(OWNER), ctx(OWNER, { authors }))).toBeNull();
  });

  it("keeps a reply's link to the message it answers", () => {
    const reply = ev(MEMBER, { type: "chat", message: { id: "m2", text: "Yes", author: actor(MEMBER), at: AT, reply_to: "m1" } });
    expect(reply.type === "chat" && reply.message.reply_to).toBe("m1");
  });

  it("never removes the room's own document; other sources by who added them or an admin", () => {
    const remove = (who: string, doc: string) => ev(who, { type: "doc.remove", doc_id: doc });
    expect(checkEvent(remove(OWNER, "room0001"), ctx(OWNER))).toBe("The room's own document can't be removed");
    const authors = { "doc:room0002": MEMBER };
    expect(checkEvent(remove(MEMBER, "room0002"), ctx(MEMBER, { authors }))).toBeNull();
    expect(checkEvent(remove(GUEST, "room0002"), ctx(GUEST, { authors }))).toBe("Only who added it or an admin can remove this source");
    expect(checkEvent(remove(OWNER, "room0002"), ctx(OWNER, { authors }))).toBeNull();
  });

  describe("roles and kicks", () => {
    const setRole = (who: string, member: string, role: Role) => ev(who, { type: "role.set", member, name: "M", role });
    const kick = (who: string, member: string) => ev(who, { type: "member.kick", member, name: "M" });

    it("the owner makes admins and sets anyone else's role", () => {
      expect(checkEvent(setRole(OWNER, MEMBER, "admin"), ctx(OWNER))).toBeNull();
      expect(checkEvent(setRole(OWNER, GUEST, "viewer"), ctx(OWNER))).toBeNull();
    });
    it("an admin manages editors and viewers, but not other admins, the owner, or making admins", () => {
      const c = ctx(ADMIN, { roles: { [ADMIN]: "admin", [MEMBER]: "admin" } });
      expect(checkEvent(setRole(ADMIN, GUEST, "viewer"), c)).toBeNull();
      expect(checkEvent(setRole(ADMIN, GUEST, "admin"), c)).toBe("You can't give a role as high as yours");
      expect(checkEvent(setRole(ADMIN, MEMBER, "viewer"), c)).toBe("You can't change this person's role");
      expect(checkEvent(setRole(ADMIN, OWNER, "viewer"), c)).toBe("The owner's role can't change");
      expect(checkEvent(kick(ADMIN, GUEST), c)).toBeNull();
      expect(checkEvent(kick(ADMIN, MEMBER), c)).toBe("You can't remove this person");
    });
    it("an editor can't change roles, kick, or change settings", () => {
      const c = ctx(MEMBER);
      expect(checkEvent(setRole(MEMBER, GUEST, "viewer"), c)).toBe("You can't change this person's role");
      expect(checkEvent(kick(MEMBER, GUEST), c)).toBe("You can't remove this person");
      expect(checkEvent(ev(MEMBER, { type: "settings.update", patch: { guestRole: "viewer" } }), c)).toBe(
        "Only admins can change the room's settings",
      );
    });
    it("nobody removes the owner or themselves, and nobody is made owner", () => {
      expect(checkEvent(kick(OWNER, OWNER), ctx(OWNER))).toBe("That person can't be removed");
      expect(checkEvent(setRole(OWNER, MEMBER, "owner"), ctx(OWNER))).toBe("The owner's role can't change");
    });
  });
});

describe("project", () => {
  it("records roles, kicks and settings so later events in the batch see them", () => {
    const c = ctx(OWNER);
    project(ev(OWNER, { type: "role.set", member: MEMBER, name: "Sam", role: "viewer" }), c, AT);
    project(ev(OWNER, { type: "member.kick", member: GUEST, name: "Gus" }), c, AT);
    project(ev(OWNER, { type: "settings.update", patch: { viewersUseAi: false } }), c, AT);
    expect(c.members.get(MEMBER)).toMatchObject({ role: "viewer", name: "Sam", kicked_at: null });
    expect(c.members.get(GUEST)).toMatchObject({ kicked_at: AT, name: "Gus" });
    expect(c.settings.viewersUseAi).toBe(false);
    // The viewer's next mark in the same batch is refused.
    expect(checkEvent(highlight(MEMBER), { ...c, me: { id: MEMBER, signedIn: true, keyHash: null } })).toBe("Your role can't annotate");
  });
});

describe("hashKey", () => {
  it("is a stable sha256 hex digest", () => {
    expect(hashKey("secret-key-1234567")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey("a")).toBe(hashKey("a"));
    expect(hashKey("a")).not.toBe(hashKey("b"));
  });
});
