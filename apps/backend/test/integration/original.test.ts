import { randomBytes } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeAi, type FakeAi } from "../support/fake-ai";
import { makeDocx } from "../support/files";
import { makePdf } from "../support/pdf";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

// User stories for GET /api/rooms/:id/original against the real local Supabase Storage.

const TTL_SECONDS = 2; // short, so the expiry story runs in a few seconds

let supabase: TestSupabase;
let ai: FakeAi;
let app: Express;
let token: string;

beforeAll(async () => {
  supabase = await connectSupabase();
  ai = await startFakeAi(); // indexing runs after each upload
  Object.assign(process.env, {
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    API_PUBLIC_URL: "http://127.0.0.1:4000",
    WEB_ORIGIN: "http://web.test",
    AUTH_RATE_LIMIT: "1000",
    ORIGINAL_URL_TTL_SECONDS: String(TTL_SECONDS),
    AI_SERVICE_URL: ai.url,
    AI_INTERNAL_TOKEN: ai.token,
  });
  const { createApp } = await import("../../src/app");
  app = createApp();

  const email = uniqueEmail("original-owner");
  const password = randomBytes(12).toString("base64url");
  await request(app).post("/api/auth/signup").send({ email, password, name: "Ana" });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  token = (await request(app).post("/api/auth/login").send({ email, password })).body.access_token as string;
});

afterAll(async () => {
  await ai.stop();
  await supabase.close();
});

const auth = () => ({ Authorization: `Bearer ${token}` });
const upload = (file: Buffer, filename: string) =>
  request(app).post("/api/rooms/file").set(auth()).attach("file", file, { filename });
// Asked without a session: a guest who opened the room's link.
const original = (id: string) => request(app).get(`/api/rooms/${id}/original`);

describe("downloading a room's original file", () => {
  it("Ana uploads a DOCX; a guest gets a link that downloads the same bytes under its name", async () => {
    const docx = await makeDocx(["Chapter one"]);
    const created = await upload(docx, "Lecture notes.docx");
    expect(created.status).toBe(201);

    const res = await original(created.body.id as string);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ file_name: "Lecture notes.docx", expires_in: TTL_SECONDS });

    const download = await fetch(res.body.url as string);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).equals(docx)).toBe(true);
    expect(download.headers.get("content-disposition")).toContain("Lecture%20notes.docx");
  });

  it("a PDF room gives a working link too", async () => {
    const pdf = makePdf(["Page one"]);
    const created = await upload(pdf, "paper.pdf");
    expect(created.status).toBe(201);
    const res = await original(created.body.id as string);
    expect(res.status).toBe(200);
    const download = await fetch(res.body.url as string);
    expect(Buffer.from(await download.arrayBuffer()).equals(pdf)).toBe(true);
  });

  it("a text room has no original file", async () => {
    const created = await request(app).post("/api/rooms/text").set(auth()).send({ title: "T", text: "Body" });
    expect((await original(created.body.id as string)).status).toBe(404);
  });

  it("a deleted room's file can't be downloaded", async () => {
    const created = await upload(await makeDocx(["Gone"]), "gone.docx");
    const id = created.body.id as string;
    expect((await request(app).delete(`/api/rooms/${id}`).set(auth())).status).toBe(200);
    expect((await original(id)).status).toBe(404);
  });

  it("the link stops working once it expires", async () => {
    const created = await upload(await makeDocx(["Soon gone"]), "short.docx");
    const res = await original(created.body.id as string);
    expect((await fetch(res.body.url as string)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, (TTL_SECONDS + 1.5) * 1000));
    expect((await fetch(res.body.url as string)).ok).toBe(false);
  });
});
