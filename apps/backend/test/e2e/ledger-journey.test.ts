import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBackend, type Backend } from "../support/backend-process";
import { startFakeAi, type FakeAi } from "../support/fake-ai";
import { uniqueEmail } from "../support/supabase";

// One study session in a room workspace, end to end against the production build: the owner sets the
// room up, a classmate and a guest take part, roles change, someone is removed, and a browser that
// arrives last rebuilds the whole room from the ledger.

type Session = { access_token: string; user: { id: string } };

describe("Room workspace ledger E2E journey", () => {
  let be: Backend;
  let ai: FakeAi;

  async function account(label: string, name: string): Promise<Session> {
    const email = uniqueEmail(`ledger.e2e.${label}`);
    const password = randomBytes(12).toString("base64url");
    expect((await be.post("/api/auth/signup", { email, password, name })).status).toBe(201);
    await be.clickVerificationLink(email);
    const res = await be.post("/api/auth/login", { email, password });
    expect(res.status).toBe(200);
    return (await res.json()) as Session;
  }

  beforeAll(async () => {
    ai = await startFakeAi();
    be = await startBackend({ AI_SERVICE_URL: ai.url, AI_INTERNAL_TOKEN: ai.token });
  });

  afterAll(async () => {
    await be?.stop();
    await ai?.stop();
  });

  it("owner, member and guest share a room; roles and removals hold; a late browser replays it", async () => {
    const olivia = await account("owner", "Olivia");
    const max = await account("member", "Max");
    const guestId = `guest-${randomBytes(5).toString("hex")}`;
    const guestKey = randomBytes(16).toString("hex");

    const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
      fetch(`${be.api}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const as = {
      olivia: { Authorization: `Bearer ${olivia.access_token}` },
      max: { Authorization: `Bearer ${max.access_token}` },
      gus: { "X-Guest-Id": guestId, "X-Guest-Key": guestKey },
    };
    const who = {
      olivia: { id: olivia.user.id, name: "Olivia", color: "#ef4444" },
      max: { id: max.user.id, name: "Max", color: "#22c55e" },
      gus: { id: guestId, name: "Gus", color: "#3b82f6" },
    };
    let n = 0;
    const ev = <P extends object>(actor: (typeof who)[keyof typeof who], payload: P) => ({
      id: `j${Date.now()}_${++n}`,
      at: new Date(Date.UTC(2026, 10, 1, 9, 0, n)).toISOString(),
      actor,
      ...payload,
    });
    const send = async (as_: Record<string, string>, events: object[]) => {
      const res = await call("POST", `/api/rooms/${roomId}/events`, as_, { events });
      return { status: res.status, body: (await res.json()) as { accepted: string[]; rejected: { reason: string }[] } };
    };

    // 1. Olivia makes a room.
    const created = await call("POST", "/api/rooms/text", as.olivia, { title: "Biology", text: "Cells divide by mitosis." });
    expect(created.status).toBe(201);
    const roomId = ((await created.json()) as { id: string }).id;

    // 2. Everyone takes part: a highlight, a note, a question and its answer, discussion.
    const highlight = ev(who.max, {
      type: "annot.add",
      annotation: { id: "max-mark", doc: roomId, block: "b0", author: who.max, at: "2026-11-01T09:00:00Z", kind: "highlight", start: 0, end: 5, quote: "Cells", color: "#facc15" },
    });
    expect((await send(as.max, [highlight])).body.rejected).toEqual([]);
    const note = ev(who.gus, {
      type: "annot.add",
      annotation: { id: "gus-note", doc: roomId, block: "b0", author: who.gus, at: "2026-11-01T09:00:00Z", kind: "note", x: 0.4, y: 0.6, body: "Exam topic", color: "#38bdf8" },
    });
    const ask = ev(who.gus, {
      type: "thread.ask",
      thread: "room",
      message: { id: "q1", role: "user", text: "What is mitosis?", author: who.gus, at: "2026-11-01T09:00:00Z", sources: [roomId] },
    });
    const answer = ev(who.gus, {
      type: "thread.answer",
      thread: "room",
      message: { id: "a1", role: "ai", text: "Cell division.", at: "2026-11-01T09:00:01Z", reply_to: "q1", citations: [{ doc: roomId, block: "b0", quote: "Cells divide" }], preview: false },
    });
    expect((await send(as.gus, [note, ask, answer])).body.accepted).toHaveLength(3);
    expect((await send(as.olivia, [ev(who.olivia, { type: "chat", message: { id: "c1", text: "Nice work", author: who.olivia, at: "2026-11-01T09:00:02Z" } })])).body.rejected).toEqual([]);

    // 3. Olivia makes Max a viewer: his next mark is refused, his chat isn't.
    await send(as.olivia, [ev(who.olivia, { type: "role.set", member: who.max.id, name: "Max", role: "viewer" })]);
    const maxTries = await send(as.max, [
      ev(who.max, { type: "annot.add", annotation: { ...highlight.annotation, id: "max-mark-2" } }),
      ev(who.max, { type: "chat", message: { id: "c2", text: "ok", author: who.max, at: "2026-11-01T09:00:03Z" } }),
    ]);
    expect(maxTries.body.rejected.map((r) => r.reason)).toEqual(["Your role can't annotate"]);

    // 4. Max (viewer) can't remove Gus's note; Olivia removes Gus from the room.
    expect((await send(as.max, [ev(who.max, { type: "annot.remove", annotation_id: "gus-note" })])).body.rejected[0]!.reason).toBe(
      "Only its author or an admin can remove this",
    );
    await send(as.olivia, [ev(who.olivia, { type: "member.kick", member: guestId, name: "Gus" })]);
    expect((await send(as.gus, [ev(who.gus, { type: "chat", message: { id: "c3", text: "hey", author: who.gus, at: "2026-11-01T09:00:04Z" } })])).status).toBe(403);
    expect((await call("GET", `/api/rooms/${roomId}/events`, as.gus)).status).toBe(403);
    // Gus can't come back under a new key with the same id.
    expect((await call("GET", `/api/rooms/${roomId}/events`, { ...as.gus, "X-Guest-Key": randomBytes(16).toString("hex") })).status).toBe(403);

    // 5. A browser opening the room last rebuilds it: every accepted event, in order, nothing refused.
    const replay = (await (await call("GET", `/api/rooms/${roomId}/events`, {})).json()) as { events: { type: string; id: string }[] };
    expect(replay.events.map((e) => e.type)).toEqual([
      "annot.add",
      "annot.add",
      "thread.ask",
      "thread.answer",
      "chat",
      "role.set",
      "chat",
      "member.kick",
    ]);
    const members = (await (await call("GET", `/api/rooms/${roomId}/members`, as.olivia)).json()) as {
      members: { member_id: string; role: string | null; kicked_at: string | null }[];
    };
    expect(members.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ member_id: who.max.id, role: "viewer", kicked_at: null }),
        expect.objectContaining({ member_id: guestId, kicked_at: expect.any(String) }),
      ]),
    );
  });
});
