import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeAi, type FakeAi } from "../support/fake-ai";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

// Attached sources (room_attachments) against the real local Supabase.

let supabase: TestSupabase;
let ai: FakeAi;
let app: Express;

type Session = { access_token: string; user: { id: string } };
let owner: Session;
let max: Session;
let eve: Session;

async function session(label: string, name: string): Promise<Session> {
  const email = uniqueEmail(label);
  const password = randomBytes(12).toString("base64url");
  await request(app).post("/api/auth/signup").send({ email, password, name });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  return (await request(app).post("/api/auth/login").send({ email, password })).body as Session;
}

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
  owner = await session("sources-owner", "Olivia");
  max = await session("sources-max", "Max");
  eve = await session("sources-eve", "Eve");
});

afterAll(async () => {
  await ai.stop();
  await supabase.close();
});

const auth = (s: Session) => ({ Authorization: `Bearer ${s.access_token}` });
async function room(by: Session, title: string) {
  const res = await request(app).post("/api/rooms/text").set(auth(by)).send({ title, text: `${title} body` });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const attach = (by: Session, roomId: string, sourceId: string) =>
  request(app).post(`/api/rooms/${roomId}/sources`).set(auth(by)).send({ source_room_id: sourceId });
const detach = (by: Session, roomId: string, sourceId: string) =>
  request(app).delete(`/api/rooms/${roomId}/sources/${sourceId}`).set(auth(by));
const list = (roomId: string) => request(app).get(`/api/rooms/${roomId}/sources`);
const setRole = (roomId: string, member: Session, role: string) =>
  request(app)
    .post(`/api/rooms/${roomId}/events`)
    .set(auth(owner))
    .send({
      events: [
        {
          id: `r${randomBytes(4).toString("hex")}`,
          at: new Date().toISOString(),
          actor: { id: owner.user.id, name: "Olivia", color: "#ef4444" },
          type: "role.set",
          member: member.user.id,
          name: "M",
          role,
        },
      ],
    });

describe("attached sources", () => {
  it("story: Olivia attaches two documents; anyone sees them in order, with kind and title", async () => {
    const id = await room(owner, "Main");
    const a = await room(owner, "Chapter A");
    const b = await room(max, "Chapter B"); // someone else's room can be attached too
    expect((await attach(owner, id, a)).status).toBe(201);
    const second = await attach(owner, id, b);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ id: b, kind: "link", title: "Chapter B", position: 1, added_by: owner.user.id, added_by_name: "Olivia" });

    const res = await list(id);
    expect(res.status).toBe(200);
    expect(res.body.sources.map((s: { id: string }) => s.id)).toEqual([a, b]);
  });

  it("story: attaching the same document twice changes nothing", async () => {
    const id = await room(owner, "Main");
    const a = await room(owner, "A");
    expect((await attach(owner, id, a)).status).toBe(201);
    const again = await attach(owner, id, a);
    expect(again.status).toBe(200);
    expect((await list(id)).body.sources).toHaveLength(1);
  });

  it("story: a viewer, a removed member and a guest can't attach", async () => {
    const id = await room(owner, "Main");
    const a = await room(owner, "A");
    await setRole(id, max, "viewer");
    const byViewer = await attach(max, id, a);
    expect(byViewer.status).toBe(403);
    expect(byViewer.body.error).toBe("Your role can't add sources");

    await request(app)
      .post(`/api/rooms/${id}/events`)
      .set(auth(owner))
      .send({
        events: [
          {
            id: `k${randomBytes(4).toString("hex")}`,
            at: new Date().toISOString(),
            actor: { id: owner.user.id, name: "Olivia", color: "#ef4444" },
            type: "member.kick",
            member: eve.user.id,
            name: "Eve",
          },
        ],
      });
    expect((await attach(eve, id, a)).body.error).toBe("You were removed from this room.");
    expect((await request(app).post(`/api/rooms/${id}/sources`).send({ source_room_id: a })).status).toBe(401);
  });

  it("refuses the room itself, a missing or deleted document, and a 21st source", async () => {
    const id = await room(owner, "Main");
    expect((await attach(owner, id, id)).status).toBe(400);
    expect((await attach(owner, id, "nope0000")).status).toBe(404);
    const gone = await room(owner, "Gone");
    await request(app).delete(`/api/rooms/${gone}`).set(auth(owner));
    expect((await attach(owner, id, gone)).status).toBe(404);

    for (let i = 0; i < 20; i++) expect((await attach(owner, id, await room(owner, `S${i}`))).status).toBe(201);
    const full = await attach(owner, id, await room(owner, "One too many"));
    expect(full.status).toBe(409);
    expect(full.body.error).toBe("A room can have up to 20 sources");
  });

  it("story: whoever attached it can remove it; another editor can't; an admin can", async () => {
    const id = await room(owner, "Main");
    const a = await room(max, "Max's notes");
    const b = await room(max, "Max's slides");
    expect((await attach(max, id, a)).status).toBe(201);
    expect((await attach(max, id, b)).status).toBe(201);
    expect((await detach(eve, id, a)).status).toBe(403);
    expect((await detach(max, id, a)).status).toBe(200);
    await setRole(id, eve, "admin");
    expect((await detach(eve, id, b)).status).toBe(200);
    expect((await list(id)).body.sources).toEqual([]);
    expect((await detach(owner, id, b)).status).toBe(404);
  });

  it("story: a deleted source drops out of the list; a hard-deleted one is gone from the table", async () => {
    const id = await room(owner, "Main");
    const a = await room(owner, "A");
    const b = await room(owner, "B");
    await attach(owner, id, a);
    await attach(owner, id, b);
    await request(app).delete(`/api/rooms/${a}`).set(auth(owner)); // soft delete
    expect((await list(id)).body.sources.map((s: { id: string }) => s.id)).toEqual([b]);

    const db = createClient(supabase.url, supabase.serviceRoleKey, { auth: { persistSession: false } });
    await db.from("rooms").delete().eq("id", b);
    expect((await db.from("room_attachments").select("source_room_id").eq("room_id", id)).data).toEqual([
      { source_room_id: a },
    ]);
  });

  it("story: a closed room takes no new sources", async () => {
    const id = await room(owner, "Main");
    const a = await room(owner, "A");
    await request(app).patch(`/api/rooms/${id}`).set(auth(owner)).send({ status: "closed" });
    const res = await attach(owner, id, a);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("This room is read only");
  });
});
