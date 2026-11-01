import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeAi, type FakeAi } from "../support/fake-ai";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

// The workspace ledger (room_events, room_members, room_settings) against the real local Supabase.

let supabase: TestSupabase;
let ai: FakeAi;
let app: Express;

type Session = { access_token: string; user: { id: string } };
let owner: Session;
let member: Session;

beforeAll(async () => {
  supabase = await connectSupabase();
  ai = await startFakeAi();
  Object.assign(process.env, {
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    API_PUBLIC_URL: "http://127.0.0.1:4000",
    WEB_ORIGIN: "http://web.test",
    AUTH_RATE_LIMIT: "1000",
    LEDGER_RATE_LIMIT: "10000",
    AI_SERVICE_URL: ai.url,
    AI_INTERNAL_TOKEN: ai.token,
  });
  const { createApp } = await import("../../src/app");
  app = createApp();
  owner = await session("ledger-owner", "Olivia");
  member = await session("ledger-member", "Max");
});

afterAll(async () => {
  await ai.stop();
  await supabase.close();
});

async function session(label: string, name: string): Promise<Session> {
  const email = uniqueEmail(label);
  const password = randomBytes(12).toString("base64url");
  await request(app).post("/api/auth/signup").send({ email, password, name });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  return (await request(app).post("/api/auth/login").send({ email, password })).body as Session;
}

async function newRoom() {
  const res = await request(app)
    .post("/api/rooms/text")
    .set({ Authorization: `Bearer ${owner.access_token}` })
    .send({ title: "Ledger room", text: "Cells divide by mitosis." });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

// A writer: an account (session) or a guest (id + key), as the browser would send them.
type Writer = { id: string; name: string; headers: Record<string, string> };
const asUser = (s: Session, name: string): Writer => ({ id: s.user.id, name, headers: { Authorization: `Bearer ${s.access_token}` } });
const asGuest = (name: string, key = randomBytes(16).toString("hex"), id = `guest-${randomBytes(5).toString("hex")}`): Writer => ({
  id,
  name,
  headers: { "X-Guest-Id": id, "X-Guest-Key": key },
});

let n = 0;
const at = () => new Date(Date.UTC(2026, 10, 1, 10, 0, 0, n)).toISOString();
const actor = (w: Writer) => ({ id: w.id, name: w.name, color: "#3b82f6" });
const event = (w: Writer, payload: Record<string, unknown>) => ({ id: `ev${Date.now()}x${++n}`, at: at(), actor: actor(w), ...payload });
const mark = (w: Writer, roomId: string, annId = `a${++n}`) =>
  event(w, {
    type: "annot.add",
    annotation: { id: annId, doc: roomId, block: "b0", author: actor(w), at: at(), kind: "highlight", start: 0, end: 5, quote: "Cells", color: "#facc15" },
  });
const chat = (w: Writer, text = "hello") => event(w, { type: "chat", message: { id: `m${++n}`, text, author: actor(w), at: at() } });

const post = (roomId: string, w: Writer | null, events: unknown[]) =>
  request(app).post(`/api/rooms/${roomId}/events`).set(w?.headers ?? {}).send({ events });
const list = (roomId: string, w: Writer | null = null, query = "") => request(app).get(`/api/rooms/${roomId}/events${query}`).set(w?.headers ?? {});

describe("the room ledger", () => {
  it("story: the owner and a guest mark and chat; a browser joining later replays it all, in order", async () => {
    const id = await newRoom();
    const olivia = asUser(owner, "Olivia");
    const gus = asGuest("Gus");
    const first = [mark(olivia, id), chat(olivia, "Look at this")];
    const second = [mark(gus, id), chat(gus, "Agreed")];
    expect((await post(id, olivia, first)).body).toEqual({ accepted: first.map((e) => e.id), rejected: [] });
    expect((await post(id, gus, second)).body.accepted).toHaveLength(2);

    const replay = await list(id); // a new, anonymous browser
    expect(replay.status).toBe(200);
    expect(replay.body.events.map((e: { id: string }) => e.id)).toEqual([...first, ...second].map((e) => e.id));
    expect(replay.body.events[0]).toMatchObject({ type: "annot.add", actor: { id: olivia.id } });
    expect(replay.body.next).toBeNull();

    // Paged by seq.
    const page = await list(id, null, "?limit=3");
    expect(page.body.events).toHaveLength(3);
    const rest = await list(id, null, `?after=${page.body.next as number}`);
    expect(rest.body.events.map((e: { id: string }) => e.id)).toEqual([second[1]!.id]);
  });

  it("story: a retried batch doesn't duplicate anything", async () => {
    const id = await newRoom();
    const olivia = asUser(owner, "Olivia");
    const batch = [mark(olivia, id), chat(olivia)];
    await post(id, olivia, batch);
    const again = await post(id, olivia, batch);
    expect(again.body).toEqual({ accepted: batch.map((e) => e.id), rejected: [] });
    expect((await list(id)).body.events).toHaveLength(2);
  });

  it("story: a guest id belongs to the browser that first used it", async () => {
    const id = await newRoom();
    const real = asGuest("Gus", "a".repeat(32));
    const impostor = asGuest("Gus", "b".repeat(32), real.id);
    expect((await post(id, real, [chat(real)])).status).toBe(200);
    const res = await post(id, impostor, [chat(impostor)]);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("That guest id belongs to someone else.");
    // The real guest keeps writing.
    expect((await post(id, real, [chat(real)])).body.accepted).toHaveLength(1);
  });

  it("story: nobody writes in someone else's name, and anonymous writes are refused", async () => {
    const id = await newRoom();
    const gus = asGuest("Gus");
    const forged = { ...chat(gus), actor: actor(asUser(owner, "Olivia")) };
    const res = await post(id, gus, [forged]);
    expect(res.body.rejected).toEqual([{ id: forged.id, reason: "The event's actor isn't you" }]);
    expect((await post(id, null, [chat(gus)])).status).toBe(401);
  });

  it("story: the owner makes Max a viewer; his marks are refused but he can still chat", async () => {
    const id = await newRoom();
    const olivia = asUser(owner, "Olivia");
    const max = asUser(member, "Max");
    expect((await post(id, olivia, [event(olivia, { type: "role.set", member: max.id, name: "Max", role: "viewer" })])).body.rejected).toEqual([]);

    const res = await post(id, max, [mark(max, id), chat(max)]);
    expect(res.body.accepted).toHaveLength(1);
    expect(res.body.rejected).toEqual([expect.objectContaining({ reason: "Your role can't annotate" })]);

    const members = await request(app).get(`/api/rooms/${id}/members`);
    expect(members.body.members).toEqual(expect.arrayContaining([expect.objectContaining({ member_id: max.id, role: "viewer", kicked_at: null })]));
    expect(members.body.members[0]).not.toHaveProperty("key_hash");
  });

  it("story: the owner removes a guest; the guest can't write or read, even after a reload", async () => {
    const id = await newRoom();
    const olivia = asUser(owner, "Olivia");
    const gus = asGuest("Gus");
    expect((await post(id, gus, [chat(gus)])).status).toBe(200);
    await post(id, olivia, [event(olivia, { type: "member.kick", member: gus.id, name: "Gus" })]);

    const write = await post(id, gus, [chat(gus, "let me back")]);
    expect(write.status).toBe(403);
    expect(write.body.error).toBe("You were removed from this room.");
    expect((await list(id, gus)).status).toBe(403);
    expect((await request(app).get(`/api/rooms/${id}/members`).set(gus.headers)).status).toBe(403);
    // Others still read the room.
    expect((await list(id)).status).toBe(200);
  });

  it("story: an admin can't demote the owner or another admin, and an editor can't change roles", async () => {
    const id = await newRoom();
    const olivia = asUser(owner, "Olivia");
    const max = asUser(member, "Max");
    const gus = asGuest("Gus");
    await post(id, olivia, [
      event(olivia, { type: "role.set", member: max.id, name: "Max", role: "admin" }),
      event(olivia, { type: "role.set", member: gus.id, name: "Gus", role: "admin" }),
    ]);
    const res = await post(id, max, [
      event(max, { type: "role.set", member: owner.user.id, name: "Olivia", role: "viewer" }),
      event(max, { type: "role.set", member: gus.id, name: "Gus", role: "viewer" }),
    ]);
    expect(res.body.rejected.map((r: { reason: string }) => r.reason)).toEqual([
      "The owner's role can't change",
      "You can't change this person's role",
    ]);

    const editor = asGuest("Eve");
    const byEditor = await post(id, editor, [event(editor, { type: "role.set", member: max.id, name: "Max", role: "viewer" })]);
    expect(byEditor.body.rejected[0].reason).toBe("You can't change this person's role");
  });

  it("story: only the author or an admin removes a mark", async () => {
    const id = await newRoom();
    const olivia = asUser(owner, "Olivia");
    const gus = asGuest("Gus");
    const eve = asGuest("Eve");
    await post(id, gus, [mark(gus, id, "gus-mark")]);
    const byEve = await post(id, eve, [event(eve, { type: "annot.remove", annotation_id: "gus-mark" })]);
    expect(byEve.body.rejected[0].reason).toBe("Only its author or an admin can remove this");
    expect((await post(id, gus, [event(gus, { type: "annot.remove", annotation_id: "gus-mark" })])).body.rejected).toEqual([]);
    await post(id, eve, [mark(eve, id, "eve-mark")]);
    expect((await post(id, olivia, [event(olivia, { type: "annot.remove", annotation_id: "eve-mark" })])).body.rejected).toEqual([]);
  });

  it("story: the owner closes the room; marks are refused but settings still change", async () => {
    const id = await newRoom();
    const olivia = asUser(owner, "Olivia");
    expect((await request(app).patch(`/api/rooms/${id}`).set(olivia.headers).send({ status: "closed" })).status).toBe(200);
    const res = await post(id, olivia, [mark(olivia, id), event(olivia, { type: "settings.update", patch: { viewersUseAi: false } })]);
    expect(res.body.rejected).toEqual([expect.objectContaining({ reason: "This room is read only" })]);
    expect((await request(app).get(`/api/rooms/${id}/members`)).body.settings.viewersUseAi).toBe(false);
  });

  it("story: with guests turned off, guests can't read or write; members still can", async () => {
    const id = await newRoom();
    const olivia = asUser(owner, "Olivia");
    const max = asUser(member, "Max");
    const gus = asGuest("Gus");
    await post(id, olivia, [event(olivia, { type: "settings.update", patch: { allowGuests: false } })]);
    expect((await post(id, gus, [chat(gus)])).status).toBe(403);
    expect((await list(id, gus)).status).toBe(403);
    expect((await list(id)).status).toBe(403); // an anonymous browser is a guest too
    expect((await post(id, max, [chat(max)])).body.accepted).toHaveLength(1);
    expect((await list(id, max)).status).toBe(200);
  });

  it("refuses an oversized event, an oversized batch, and an unknown type", async () => {
    const id = await newRoom();
    const gus = asGuest("Gus");
    const huge = event(gus, {
      type: "annot.add",
      annotation: {
        id: "big",
        doc: id,
        block: "b0",
        author: actor(gus),
        at: at(),
        kind: "ai",
        x: 0.5,
        y: 0.5,
        quote: null,
        image: `data:image/jpeg;base64,${"A".repeat(300_000)}`,
      },
    });
    const unknown = event(gus, { type: "everything.delete" });
    const res = await post(id, gus, [huge, unknown]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toEqual([
      { id: huge.id, reason: "The event is too large" },
      { id: unknown.id, reason: expect.stringContaining("Invalid event") },
    ]);
    expect((await post(id, gus, Array.from({ length: 51 }, () => chat(gus)))).status).toBe(400);
  });

  it("is append-only in the database, and goes when the room is deleted", async () => {
    const id = await newRoom();
    const olivia = asUser(owner, "Olivia");
    await post(id, olivia, [chat(olivia)]);
    const db = createClient(supabase.url, supabase.serviceRoleKey, { auth: { persistSession: false } });
    const { error } = await db.from("room_events").update({ actor_name: "Hacked" }).eq("room_id", id);
    expect(error?.message).toContain("append-only");

    // A hard delete (the lifecycle sweep) cascades to the ledger.
    expect((await db.from("rooms").delete().eq("id", id)).error).toBeNull();
    expect((await db.from("room_events").select("id").eq("room_id", id)).data).toEqual([]);
    expect((await db.from("room_members").select("member_id").eq("room_id", id)).data).toEqual([]);
  });

  it("a deleted (soft) or unknown room answers 404", async () => {
    const id = await newRoom();
    await request(app).delete(`/api/rooms/${id}`).set({ Authorization: `Bearer ${owner.access_token}` });
    expect((await list(id)).status).toBe(404);
    expect((await list("nope0000")).status).toBe(404);
  });
});
