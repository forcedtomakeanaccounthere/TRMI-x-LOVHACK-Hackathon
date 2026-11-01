import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeAi, type FakeAi } from "../support/fake-ai";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

// CHECKLIST "Notes as comments": a comment box on the page is a comment with no highlight, and it
// reaches the recap like any other comment.

let supabase: TestSupabase;
let ai: FakeAi;
let app: Express;
let token: string;

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
    AI_SERVICE_URL: ai.url,
    AI_INTERNAL_TOKEN: ai.token,
  });
  const { createApp } = await import("../../src/app");
  app = createApp();

  const email = uniqueEmail("notes-owner");
  const password = randomBytes(12).toString("base64url");
  await request(app).post("/api/auth/signup").send({ email, password, name: "Owner" });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  token = (await request(app).post("/api/auth/login").send({ email, password })).body.access_token as string;
});

afterAll(async () => {
  await ai.stop();
  await supabase.close();
});

describe("notes as comments", () => {
  const browser = () => createClient(supabase.url, supabase.anonKey, { auth: { persistSession: false } });

  it("a guest's note with no highlight is saved and reaches the owner's recap", async () => {
    const created = await request(app)
      .post("/api/rooms/text")
      .set({ Authorization: `Bearer ${token}` })
      .send({ title: "Notes room", text: "Photosynthesis turns light into chemical energy." });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // A recap needs at least one highlight; the note itself is not attached to it.
    const guest = browser();
    const mark = await guest.from("highlights").insert({
      room_id: id,
      author_name: "Guest",
      author_color: "#00ff00",
      block_id: "b0",
      start_offset: 0,
      end_offset: 14,
      quote: "Photosynthesis",
    });
    expect(mark.error).toBeNull();
    const note = await guest
      .from("comments")
      .insert({ room_id: id, highlight_id: null, author_name: "Guest", author_color: "#00ff00", body: "Review chapter 2" })
      .select("highlight_id")
      .single();
    expect(note.error).toBeNull();
    expect(note.data).toEqual({ highlight_id: null });

    ai.requests.length = 0;
    const recap = await request(app).post(`/api/rooms/${id}/recap`).send({ name: "Owner" });
    expect(recap.status).toBe(200);

    const sent = ai.calls("/recap")[0]!.body as { comments: { highlight_id: string | null; body: string }[] };
    expect(sent.comments).toEqual([expect.objectContaining({ highlight_id: null, body: "Review chapter 2" })]);
    expect(recap.body.key_points).toContain("Review chapter 2");
  });
});
