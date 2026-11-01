import { randomBytes } from "node:crypto";
import { ArtifactBody } from "@linkroom/shared";
import { createClient } from "@supabase/supabase-js";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeAi, type FakeAi } from "../support/fake-ai";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

// Studio artifacts against the real local Supabase. Rooms are really indexed (through the fake apps/ai),
// so summaries come from room_ai as they would in production.

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
  const email = uniqueEmail("artifacts-owner");
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

beforeEach(() => {
  ai.reset();
});

const auth = { get headers() { return { Authorization: `Bearer ${owner.access_token}` }; } };

async function indexedRoom(title: string, text: string) {
  const res = await request(app).post("/api/rooms/text").set(auth.headers).send({ title, text });
  expect(res.status).toBe(201);
  const id = res.body.id as string;
  await vi.waitFor(async () => expect((await supabase.aiState(id))?.status).toBe("ready"), { timeout: 10_000, interval: 100 });
  return id;
}
const make = (roomId: string, kind: string, sources: string[], headers: Record<string, string> = {}) =>
  request(app).post(`/api/rooms/${roomId}/artifacts`).set(headers).send({ kind, sources });

describe("Studio artifacts", () => {
  let main: string;
  let attached: string;

  beforeAll(async () => {
    main = await indexedRoom("Biology", "Cells divide by mitosis. Each daughter cell gets a copy of the DNA.");
    attached = await indexedRoom("Chemistry", "Atoms bond by sharing electrons. Ionic bonds transfer them.");
    expect(
      (await request(app).post(`/api/rooms/${main}/sources`).set(auth.headers).send({ source_room_id: attached })).status,
    ).toBe(201);
  });

  it.each(["quiz", "flashcards", "mindmap", "infographic"])(
    "story: a guest makes a %s from the room and its attached source",
    async (kind) => {
      const res = await make(main, kind, [main, attached]);
      expect(res.status).toBe(200);
      expect(res.body.kind).toBe(kind);
      expect(ArtifactBody.safeParse(res.body).success).toBe(true);
      // Both documents' text went to apps/ai, in the order chosen.
      const sent = ai.calls("/study")[0]!.body as { kind: string; documents: { id: string; title: string; text: string }[] };
      expect(sent.kind).toBe(kind);
      expect(sent.documents.map((d) => d.title)).toEqual(["Biology", "Chemistry"]);
      expect(sent.documents[1]!.text).toContain("Atoms bond");
    },
  );

  it("story: the mind map arrives as a tree", async () => {
    const res = await make(main, "mindmap", [main]);
    expect(res.body.root).toEqual({
      label: "Root",
      children: [{ label: "Child A", children: [{ label: "Grandchild" }] }, { label: "Child B" }],
    });
  });

  it("story: a summary is built from the saved room summaries, with no AI call", async () => {
    const res = await make(main, "summary", [main, attached]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "summary", overview: "Biology: Overview of Biology\n\nChemistry: Overview of Chemistry" });
    expect(res.body.sections[0].heading).toBe("Biology · Main ideas");
    expect(ai.calls("/study")).toHaveLength(0);
  });

  it("story: each artifact is recorded in the AI history", async () => {
    await make(main, "flashcards", [main]);
    const db = createClient(supabase.url, supabase.serviceRoleKey, { auth: { persistSession: false } });
    const { data } = await db.from("ai_queries").select("kind, prompt").eq("room_id", main).eq("prompt", "flashcards");
    expect(data).toEqual(expect.arrayContaining([{ kind: "artifact", prompt: "flashcards" }]));
  });

  it("refuses a source that isn't in the room", async () => {
    const stranger = await indexedRoom("Other", "Unrelated text here.");
    const res = await make(main, "quiz", [main, stranger]);
    expect(res.status).toBe(404);
    expect(ai.calls("/study")).toHaveLength(0);
  });

  it("answers 409 for a summary before the AI has read the room", async () => {
    ai.handlers["/summary"] = () => ({ status: 502, body: { detail: "busy" } }); // indexing leaves no summary
    const res0 = await request(app).post("/api/rooms/text").set(auth.headers).send({ title: "Fresh", text: "Brand new text." });
    const fresh = res0.body.id as string;
    await vi.waitFor(async () => expect(["ready", "failed"]).toContain((await supabase.aiState(fresh))?.status), { timeout: 10_000 });
    const res = await make(fresh, "summary", [fresh]);
    expect(res.status).toBe(409);
  });

  it("makes one artifact per room at a time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = ai.handlers["/study"]!;
    ai.handlers["/study"] = (body) => gate.then(() => slow(body));
    const first = make(main, "quiz", [main]).then((r) => r);
    await vi.waitFor(() => expect(ai.calls("/study")).toHaveLength(1));
    const second = await make(main, "quiz", [main]);
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });

  it("story: a viewer can't make artifacts, a removed guest can't either, and a closed room is read only", async () => {
    const room = await indexedRoom("Locked", "Some text to study.");
    const guestId = `guest-${randomBytes(5).toString("hex")}`;
    const guest = { "X-Guest-Id": guestId, "X-Guest-Key": randomBytes(16).toString("hex") };
    const olivia = { id: owner.user.id, name: "Olivia", color: "#ef4444" };
    const event = (payload: object) => ({ id: `e${randomBytes(4).toString("hex")}`, at: new Date().toISOString(), actor: olivia, ...payload });

    // Guests are viewers here.
    await request(app).post(`/api/rooms/${room}/events`).set(auth.headers).send({ events: [event({ type: "settings.update", patch: { guestRole: "viewer" } })] });
    const asViewer = await make(room, "quiz", [room], guest);
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.error).toBe("Your role can't make artifacts");

    await request(app).post(`/api/rooms/${room}/events`).set(auth.headers).send({ events: [event({ type: "member.kick", member: guestId, name: "Gus" })] });
    const kicked = await make(room, "quiz", [room], guest);
    expect(kicked.status).toBe(403);
    expect(kicked.body.error).toBe("You were removed from this room.");

    await request(app).patch(`/api/rooms/${room}`).set(auth.headers).send({ status: "closed" });
    const closed = await make(room, "quiz", [room], auth.headers);
    expect(closed.status).toBe(409);
    expect(closed.body.error).toBe("This room is read only");
  });
});
