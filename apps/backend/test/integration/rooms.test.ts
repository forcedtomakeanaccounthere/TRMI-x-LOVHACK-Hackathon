import { randomBytes } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

let supabase: TestSupabase;
let app: Express;

const PASSWORD = randomBytes(12).toString("base64url");

type Session = { access_token: string; user: { id: string } };
let owner: Session;
let guest: Session;

async function session(label: string) {
  const email = uniqueEmail(`rooms-${label}`);
  await request(app).post("/api/auth/signup").send({ email, password: PASSWORD, name: label });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body as Session;
}

const auth = (s: Session) => ({ Authorization: `Bearer ${s.access_token}` });
const mine = (s: Session, query: Record<string, string> = {}) =>
  request(app).get("/api/rooms/mine").query(query).set(auth(s));
const join = (s: Session, id: string) => request(app).post(`/api/rooms/${id}/join`).set(auth(s));
const setStatus = (s: Session, id: string, status: string) =>
  request(app).patch(`/api/rooms/${id}/status`).set(auth(s)).send({ status });

async function createRoom(title: string) {
  const res = await request(app).post("/api/rooms/text").set(auth(owner)).send({ title, text: "Some text" });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

const ids = (res: request.Response) => (res.body as { rooms: { id: string }[] }).rooms.map((r) => r.id);

beforeAll(async () => {
  supabase = await connectSupabase();
  Object.assign(process.env, {
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    API_PUBLIC_URL: "http://127.0.0.1:4000",
    WEB_ORIGIN: "http://web.test",
    AUTH_RATE_LIMIT: "1000",
  });
  const { createApp } = await import("../../src/app");
  app = createApp();
  owner = await session("owner");
  guest = await session("guest");
});

afterAll(() => supabase?.close());

describe("GET /api/rooms/mine", () => {
  it("needs a logged-in user", async () => {
    expect((await request(app).get("/api/rooms/mine")).status).toBe(401);
  });

  it("rejects an unknown filter value", async () => {
    expect((await mine(owner, { status: "paused" })).status).toBe(400);
  });

  it("lists created and joined rooms with the user's role in each", async () => {
    const id = await createRoom("Roles");

    expect(ids(await mine(guest, { q: "Roles" }))).toEqual([]);
    expect((await join(guest, id)).status).toBe(200);

    const [asGuest] = (await mine(guest, { q: "Roles" })).body.rooms;
    expect(asGuest).toMatchObject({ id, role: "member", status: "running", kind: "link", highlight_count: 0 });
    expect(asGuest.last_opened_at).toEqual(expect.any(String));

    const [asOwner] = (await mine(owner, { q: "Roles" })).body.rooms;
    expect(asOwner).toMatchObject({ id, role: "owner", last_opened_at: null });
  });

  it("filters by status, role and kind, and searches titles", async () => {
    const closed = await createRoom("Filter closed");
    const running = await createRoom("Filter running");
    await setStatus(owner, closed, "closed");

    expect(ids(await mine(owner, { q: "Filter", status: "closed" }))).toEqual([closed]);
    expect(ids(await mine(owner, { q: "filter", status: "running" }))).toEqual([running]);
    expect(ids(await mine(owner, { q: "Filter", role: "member" }))).toEqual([]);
    expect(ids(await mine(owner, { q: "Filter", kind: "pdf" }))).toEqual([]);
  });

  it("treats % and _ in a search as plain text", async () => {
    await createRoom("Plain percent");
    const literal = await createRoom("100% literal");

    expect(ids(await mine(owner, { q: "100%" }))).toEqual([literal]);
    expect(ids(await mine(owner, { q: "%percent" }))).toEqual([]);
  });

  it("sorts and pages, reporting the full total", async () => {
    const first = await createRoom("Page b");
    const second = await createRoom("Page a");

    expect(ids(await mine(owner, { q: "Page", sort: "title" }))).toEqual([second, first]);
    expect(ids(await mine(owner, { q: "Page", sort: "oldest" }))).toEqual([first, second]);

    const page = await mine(owner, { q: "Page", sort: "title", limit: "1", offset: "1" });
    expect(ids(page)).toEqual([first]);
    expect(page.body.total).toBe(2);
  });
});

describe("POST /api/rooms/:id/join", () => {
  it("needs a logged-in user", async () => {
    expect((await request(app).post("/api/rooms/nothing1/join")).status).toBe(401);
  });

  it("answers 404 for an unknown room", async () => {
    expect((await join(guest, "nothing1")).status).toBe(404);
  });

  it("lets people into a closed room to read it", async () => {
    const id = await createRoom("Closed join");
    await setStatus(owner, id, "closed");

    const res = await join(guest, id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, status: "closed" });
  });

  it("can be repeated", async () => {
    const id = await createRoom("Twice");
    await join(guest, id);
    expect((await join(guest, id)).status).toBe(200);
    expect((await mine(guest, { q: "Twice" })).body.total).toBe(1);
  });
});

describe("PATCH /api/rooms/:id/status", () => {
  it("is refused for rooms the user doesn't own, even after joining", async () => {
    const id = await createRoom("Not yours");
    await join(guest, id);

    expect((await setStatus(guest, id, "deleted")).status).toBe(404);
    expect((await supabase.room(id))?.status).toBe("running");
  });

  it("rejects an unknown status", async () => {
    const id = await createRoom("Bad status");
    expect((await setStatus(owner, id, "paused")).status).toBe(400);
  });

  it("hides a deleted room from everyone but its owner, until it is restored", async () => {
    const id = await createRoom("Trash");
    await join(guest, id);

    expect((await setStatus(owner, id, "deleted")).body).toEqual({ id, status: "deleted" });

    expect(ids(await mine(owner, { q: "Trash" }))).toEqual([]);
    expect(ids(await mine(owner, { q: "Trash", status: "deleted" }))).toEqual([id]);
    expect(ids(await mine(guest, { q: "Trash" }))).toEqual([]);
    expect(ids(await mine(guest, { q: "Trash", status: "deleted" }))).toEqual([]);
    expect((await join(guest, id)).status).toBe(404);
    expect((await request(app).post(`/api/rooms/${id}/recap`)).status).toBe(404);

    await setStatus(owner, id, "closed");
    expect(ids(await mine(guest, { q: "Trash" }))).toEqual([id]);
  });

  it("stops recaps of archived rooms", async () => {
    const id = await createRoom("Archived");
    await setStatus(owner, id, "archived");
    expect((await request(app).post(`/api/rooms/${id}/recap`)).status).toBe(409);
  });
});
