import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeAi, type FakeAi } from "../support/fake-ai";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

// POST /api/rooms/:id/ask with the room workspace's context, against the real local Supabase: rooms
// are really indexed (chunks and embeddings through the fake apps/ai) and searched with match_chunks.

let supabase: TestSupabase;
let ai: FakeAi;
let app: Express;
type Session = { access_token: string; user: { id: string } };
let owner: Session;

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
    ASK_RATE_LIMIT: "1000",
    ASK_ROOM_RATE_LIMIT: "1000",
    AI_SERVICE_URL: ai.url,
    AI_INTERNAL_TOKEN: ai.token,
  });
  const { createApp } = await import("../../src/app");
  app = createApp();
  const email = uniqueEmail("ask-owner");
  const password = randomBytes(12).toString("base64url");
  await request(app).post("/api/auth/signup").send({ email, password, name: "Olivia" });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  owner = (await request(app).post("/api/auth/login").send({ email, password })).body as Session;
});

afterAll(async () => {
  await ai.stop();
  await supabase.close();
});

beforeEach(() => ai.reset());

const auth = () => ({ Authorization: `Bearer ${owner.access_token}` });
const admin = () => createClient(supabase.url, supabase.serviceRoleKey, { auth: { persistSession: false } });
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

async function indexedRoom(title: string, text: string) {
  const res = await request(app).post("/api/rooms/text").set(auth()).send({ title, text });
  expect(res.status).toBe(201);
  const id = res.body.id as string;
  await vi.waitFor(async () => expect((await supabase.aiState(id))?.status).toBe("ready"), { timeout: 10_000, interval: 100 });
  return id;
}
const ask = (roomId: string, body: object, headers: Record<string, string> = {}) =>
  request(app).post(`/api/rooms/${roomId}/ask`).set(headers).send(body);
type SentAnswer = { question: string; chunks: { content: string }[]; quote: string | null; history: unknown[]; image: string | null };
const sentAnswer = () => ai.calls("/answer").at(-1)!.body as SentAnswer;

describe("asking across a room's documents", () => {
  let bio: string;
  let chem: string;

  beforeAll(async () => {
    bio = await indexedRoom("Biology", "Photosynthesis turns sunlight into chemical energy in plants.");
    chem = await indexedRoom("Chemistry", "Photosynthesis also matters in chemistry: light drives the reaction.");
    expect((await request(app).post(`/api/rooms/${bio}/sources`).set(auth()).send({ source_room_id: chem })).status).toBe(201);
  });

  it("story: the old request ({ question }) still answers from the room alone, as before", async () => {
    const res = await ask(bio, { question: "What is photosynthesis?" });
    expect(res.status).toBe(201);
    expect(res.body.found_in_document).toBe(true);
    expect(sentAnswer().chunks.every((c) => c.content.includes("sunlight"))).toBe(true);
    // One document: citations don't name it.
    expect(res.body.citations[0]).not.toHaveProperty("room_id");
  });

  it("story: a guest asks the room and its attached source; each citation says which document", async () => {
    const res = await ask(bio, { question: "What is photosynthesis?", sources: [bio, chem], name: "Gus" });
    expect(res.status).toBe(201);
    const sent = sentAnswer();
    expect(sent.chunks.some((c) => c.content.includes("sunlight"))).toBe(true);
    expect(sent.chunks.some((c) => c.content.includes("chemistry"))).toBe(true);
    const rooms = (res.body.citations as { room_id: string }[]).map((c) => c.room_id);
    expect(new Set(rooms)).toEqual(new Set([bio, chem]));
    // Saved for everyone in the room, on the room the question was asked in.
    const { data } = await admin().from("ai_messages").select("room_id, asked_by").eq("id", res.body.id).single();
    expect(data).toEqual({ room_id: bio, asked_by: "Gus" });
  });

  it("story: asking only the attached source still says which document each citation is from", async () => {
    const res = await ask(bio, { question: "What is photosynthesis?", sources: [chem] });
    expect(res.status).toBe(201);
    expect(res.body.citations.length).toBeGreaterThan(0);
    for (const citation of res.body.citations as { room_id?: string }[]) expect(citation.room_id).toBe(chem);
  });

  it("story: an AI box's passage and earlier turns reach apps/ai", async () => {
    await ask(bio, {
      question: "Explain this line",
      sources: [bio],
      quote: "turns sunlight into chemical energy",
      history: [{ role: "user", text: "What do plants need?" }],
    });
    expect(sentAnswer()).toMatchObject({
      quote: "turns sunlight into chemical energy",
      history: [{ role: "user", text: "What do plants need?" }],
    });
  });

  it("story: an AI-lens snapshot goes to apps/ai, and its answer is kept without citations", async () => {
    ai.handlers["/answer"] = () => ({ answer: "A diagram of a leaf.", found_in_document: false, citations: [], withheld: false });
    const res = await ask(bio, { question: "What is in this picture?", image: JPEG });
    expect(res.status).toBe(201);
    expect(sentAnswer().image).toBe(JPEG);
    expect(res.body).toMatchObject({ answer: "A diagram of a leaf.", found_in_document: false, citations: [] });
  });

  it("story: without a vision model, a snapshot question gets a clear 422", async () => {
    ai.handlers["/answer"] = () => ({ status: 501, body: { detail: "no vision model" } });
    const res = await ask(bio, { question: "What is in this picture?", image: JPEG });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/vision model/);
  });

  it("refuses a source that isn't in the room, before calling the AI", async () => {
    const stranger = await indexedRoom("Stranger", "Unrelated words entirely.");
    ai.reset();
    const res = await ask(bio, { question: "Anything?", sources: [bio, stranger] });
    expect(res.status).toBe(404);
    expect(ai.calls("/moderate")).toHaveLength(0);
  });

  it("story: a source still being read is skipped; with none ready the answer is 409", async () => {
    const db = admin();
    await db.from("room_ai").update({ status: "indexing" }).eq("room_id", chem);
    try {
      const res = await ask(bio, { question: "What is photosynthesis?", sources: [bio, chem] });
      expect(res.status).toBe(201);
      expect(sentAnswer().chunks.every((c) => !c.content.includes("chemistry"))).toBe(true);
      const none = await ask(bio, { question: "What is photosynthesis?", sources: [chem] });
      expect(none.status).toBe(409);
      expect(none.body.error).toMatch(/still reading/);
    } finally {
      await db.from("room_ai").update({ status: "ready" }).eq("room_id", chem);
    }
  });

  it("refuses a question moderation flags", async () => {
    ai.handlers["/moderate"] = () => ({ flagged: ["hate_and_discrimination"] });
    const res = await ask(bio, { question: "Something hateful", sources: [bio, chem] });
    expect(res.status).toBe(422);
    expect(ai.calls("/answer")).toHaveLength(0);
  });

  it("story: viewers can't use the AI when the room says so, and a removed guest can't ask", async () => {
    const room = await indexedRoom("Strict", "Some text about cells.");
    const olivia = { id: owner.user.id, name: "Olivia", color: "#ef4444" };
    const event = (payload: object) => ({ id: `e${randomBytes(4).toString("hex")}`, at: new Date().toISOString(), actor: olivia, ...payload });
    await request(app)
      .post(`/api/rooms/${room}/events`)
      .set(auth())
      .send({ events: [event({ type: "settings.update", patch: { guestRole: "viewer", viewersUseAi: false } })] });
    const anon = await ask(room, { question: "What about cells?" });
    expect(anon.status).toBe(403);
    expect(anon.body.error).toBe("Your role can't use the AI");
    expect((await ask(room, { question: "What about cells?" }, auth())).status).toBe(201); // the owner still can

    const guestId = `guest-${randomBytes(5).toString("hex")}`;
    await request(app).post(`/api/rooms/${room}/events`).set(auth()).send({ events: [event({ type: "member.kick", member: guestId, name: "Gus" })] });
    const kicked = await ask(room, { question: "Let me in?" }, { "X-Guest-Id": guestId, "X-Guest-Key": randomBytes(16).toString("hex") });
    expect(kicked.status).toBe(403);
    expect(kicked.body.error).toBe("You were removed from this room.");
  });
});
