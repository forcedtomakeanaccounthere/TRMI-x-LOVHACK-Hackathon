import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

// Drawings are public to read and add, but only the browser holding a stroke's remove key can
// delete it (supabase/migrations/0019_drawing_remove_key.sql).

let supabase: TestSupabase;
let app: Express;
let roomId: string;

const PASSWORD = randomBytes(12).toString("base64url");
const newKey = () => randomBytes(24).toString("hex");
const hashOf = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

const stroke = (remove_key_hash?: string) => ({
  page_num: 1,
  author_name: "Ann",
  author_color: "#2563eb",
  path_data: { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], width: 2 },
  ...(remove_key_hash ? { remove_key_hash } : {}),
});

async function save(remove_key_hash?: string) {
  const res = await request(app).post(`/api/rooms/${roomId}/drawings`).send(stroke(remove_key_hash));
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

async function exists(id: string) {
  const res = await request(app).get(`/api/rooms/${roomId}/drawings`);
  return (res.body as { id: string }[]).some((d) => d.id === id);
}

const remove = (id: string, body: object) => request(app).delete(`/api/rooms/${roomId}/drawings/${id}`).send(body);

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

  const email = uniqueEmail("drawings-owner");
  await request(app).post("/api/auth/signup").send({ email, password: PASSWORD, name: "Owner" });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  const login = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  const created = await request(app)
    .post("/api/rooms/text")
    .set({ Authorization: `Bearer ${login.body.access_token}` })
    .send({ title: "Drawings", text: "Some text" });
  expect(created.status).toBe(201);
  roomId = created.body.id;
});

afterAll(() => supabase?.close());

describe("deleting a drawing", () => {
  it("is refused to anyone with only the public key", async () => {
    const id = await save(hashOf(newKey()));
    const anon = createClient(supabase.url, supabase.anonKey, { auth: { persistSession: false } });

    await anon.from("drawings").delete().eq("id", id);
    await anon.from("drawings").delete().eq("room_id", roomId);
    expect(await exists(id)).toBe(true);
  });

  it("is refused through the backend without the right key", async () => {
    const id = await save(hashOf(newKey()));

    expect((await remove(id, {})).status).toBe(400);
    expect((await remove(id, { key: newKey() })).status).toBe(404);
    expect(await exists(id)).toBe(true);
  });

  it("works with the key the stroke was saved with, once", async () => {
    const key = newKey();
    const id = await save(hashOf(key));

    expect((await remove(id, { key })).status).toBe(200);
    expect(await exists(id)).toBe(false);
    expect((await remove(id, { key })).status).toBe(404);
  });

  it("can't remove a stroke saved without a key", async () => {
    const id = await save();
    expect((await remove(id, { key: newKey() })).status).toBe(404);
    expect(await exists(id)).toBe(true);
  });

  it("works for a browser holding the key, through remove_drawing", async () => {
    const key = newKey();
    const id = await save(hashOf(key));
    const anon = createClient(supabase.url, supabase.anonKey, { auth: { persistSession: false } });

    const wrong = await anon.rpc("remove_drawing", { p_id: id, p_room: roomId, p_key: newKey() });
    expect(wrong.data).toBe(false);
    const right = await anon.rpc("remove_drawing", { p_id: id, p_room: roomId, p_key: key });
    expect(right.data).toBe(true);
    expect(await exists(id)).toBe(false);
  });
});
