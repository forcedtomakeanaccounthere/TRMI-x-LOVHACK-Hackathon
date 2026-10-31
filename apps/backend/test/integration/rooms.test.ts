import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeDocx, makePptx } from "../support/files";
import { makePdf } from "../support/pdf";
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
  request(app).get("/api/me/rooms").query(query).set(auth(s));
const join = (s: Session, id: string) => request(app).post(`/api/rooms/${id}/join`).set(auth(s));
const update = (s: Session, id: string, body: object) => request(app).patch(`/api/rooms/${id}`).set(auth(s)).send(body);
const setStatus = (s: Session, id: string, status: string) => update(s, id, { status });
const remove = (s: Session, id: string) => request(app).delete(`/api/rooms/${id}`).set(auth(s));
const restore = (s: Session, id: string) => request(app).post(`/api/rooms/${id}/restore`).set(auth(s));

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

describe("GET /api/me/rooms", () => {
  it("needs a logged-in user", async () => {
    expect((await request(app).get("/api/me/rooms")).status).toBe(401);
  });

  it("rejects an unknown filter value", async () => {
    expect((await mine(owner, { status: "ended" })).status).toBe(400);
  });

  it("lists created and joined rooms with the user's role, people and counts", async () => {
    const id = await createRoom("Roles");

    expect(ids(await mine(guest, { q: "Roles" }))).toEqual([]);
    expect((await join(guest, id)).status).toBe(200);

    const [asGuest] = (await mine(guest, { q: "Roles" })).body.rooms;
    expect(asGuest).toMatchObject({
      id,
      role: "member",
      status: "running",
      kind: "link",
      highlight_count: 0,
      participant_count: 1,
      live_count: 1,
      group_id: null,
    });
    expect(asGuest.last_opened_at).toEqual(expect.any(String));
    expect(asGuest.people.map((person: { display_name: string }) => person.display_name)).toContain("guest");

    const [asOwner] = (await mine(owner, { q: "Roles" })).body.rooms;
    expect(asOwner).toMatchObject({ id, role: "owner", last_opened_at: null, participant_count: 1, live_count: 1 });
    expect(asOwner.people.map((person: { display_name: string }) => person.display_name)).toContain("guest");
  });

  it("filters by status, role, kind and group, and searches titles", async () => {
    const paused = await createRoom("Filter paused");
    const running = await createRoom("Filter running");
    expect((await setStatus(owner, paused, "paused")).status).toBe(200);

    expect(ids(await mine(owner, { q: "Filter", status: "paused" }))).toEqual([paused]);
    expect(ids(await mine(owner, { q: "filter", status: "running" }))).toEqual([running]);
    expect(ids(await mine(owner, { q: "Filter", role: "member" }))).toEqual([]);
    expect(ids(await mine(owner, { q: "Filter", kind: "pdf" }))).toEqual([]);

    const created = await request(app).post("/api/groups").set(auth(owner)).send({ name: "Filter group" });
    expect(created.status).toBe(201);
    const group_id = (created.body as { id: string }).id;
    expect((await update(owner, running, { group_id })).status).toBe(200);
    expect(ids(await mine(owner, { q: "Filter", group_id }))).toEqual([running]);
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
    expect(ids(await mine(owner, { q: "Page" }))).toEqual([second, first]);
    expect(ids(await mine(owner, { q: "Page", sort: "active" }))).toHaveLength(2);

    const page = await mine(owner, { q: "Page", sort: "title", limit: "1", offset: "1" });
    expect(ids(page)).toEqual([first]);
    expect(page.body.total).toBe(2);
  });
});

describe("what a browser with the anon key sees", () => {
  const browser = () => createClient(supabase.url, supabase.anonKey, { auth: { persistSession: false } });
  const highlight = (room_id: string) => ({
    room_id,
    author_name: "Guest",
    author_color: "#00ff00",
    block_id: "b0",
    start_offset: 0,
    end_offset: 4,
    quote: "Some",
  });

  it("counts highlights and comments on the dashboard, and records activity", async () => {
    const id = await createRoom("Counted");
    const { data, error } = await browser().from("highlights").insert(highlight(id)).select("id").single();
    expect(error).toBeNull();
    await browser()
      .from("comments")
      .insert({ room_id: id, highlight_id: data!.id, author_name: "Guest", author_color: "#00ff00", body: "Nice" });

    const [room] = (await mine(owner, { q: "Counted" })).body.rooms;
    expect(room).toMatchObject({ highlight_count: 1, comment_count: 1 });
    expect(room.last_activity_at >= room.created_at).toBe(true);
  });

  it("stops new highlights once a room closes or pauses, and allows them again when it resumes", async () => {
    const id = await createRoom("Reopen");

    for (const status of ["closed", "paused"]) {
      expect((await setStatus(owner, id, status)).status).toBe(200);
      expect((await browser().from("highlights").insert(highlight(id))).error?.code).toBe("42501");
    }

    expect((await setStatus(owner, id, "running")).status).toBe(200);
    expect((await browser().from("highlights").insert(highlight(id))).error).toBeNull();
  });

  it("stops new comments the same way, and keeps the existing ones readable", async () => {
    const id = await createRoom("Quiet");
    const { data } = await browser().from("highlights").insert(highlight(id)).select("id").single();
    const comment = { room_id: id, highlight_id: data!.id, author_name: "Guest", author_color: "#00ff00", body: "Hi" };
    expect((await browser().from("comments").insert(comment)).error).toBeNull();

    for (const status of ["paused", "closed", "archived"]) {
      expect((await setStatus(owner, id, status)).status).toBe(200);
      expect((await browser().from("comments").insert(comment)).error?.code).toBe("42501");
    }

    expect((await browser().from("comments").select("id").eq("room_id", id)).data).toHaveLength(1);
  });

  it("moves a room up the active sort when someone highlights in it", async () => {
    const tag = randomBytes(4).toString("hex");
    const quiet = await createRoom(`${tag} quiet`);
    const busy = await createRoom(`${tag} busy`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ids(await mine(owner, { q: tag, sort: "newest" }))).toEqual([busy, quiet]);

    expect((await browser().from("highlights").insert(highlight(quiet))).error).toBeNull();
    expect(ids(await mine(owner, { q: tag, sort: "active" }))).toEqual([quiet, busy]);
  });

  describe("GET /api/rooms/:id/top-members", () => {
    const top = (s: Session, id: string) => request(app).get(`/api/rooms/${id}/top-members`).set(auth(s));
    const by = (id: string, author_name: string, author_color = "#00ff00") => ({
      ...highlight(id),
      author_name,
      author_color,
    });

    it("ranks the three most active people, counting highlights and comments together", async () => {
      const id = await createRoom("Leaderboard");
      const client = browser();
      const inserted = await client
        .from("highlights")
        .insert([by(id, "Ana"), by(id, "Ben"), by(id, "Ben"), by(id, "Cal"), by(id, "Dee"), by(id, "ana ", "#0000ff")])
        .select("id");
      const highlight_id = inserted.data![0]!.id;
      await client.from("comments").insert(
        ["Cal", "Cal", "Cal"].map((author_name) => ({
          room_id: id,
          highlight_id,
          author_name,
          author_color: "#00ff00",
          body: "Hm",
        })),
      );

      const res = await top(guest, id);
      expect(res.status).toBe(200);
      expect(res.body.members.map((m: { activity: number }) => m.activity)).toEqual([4, 2, 2]);
      expect(res.body.members[0]).toMatchObject({ name: "Cal", highlight_count: 1, comment_count: 3 });
      // "Ana" and "ana " are one person, tied with Ben.
      expect(res.body.members.slice(1).map((m: { name: string }) => m.name.toLowerCase()).sort()).toEqual(["ana", "ben"]);
    });

    it("is empty for a quiet room, and 404 for an unknown or deleted one", async () => {
      const id = await createRoom("Silent");
      expect((await top(owner, id)).body).toEqual({ members: [] });
      expect((await top(owner, "nothing1")).status).toBe(404);

      await remove(owner, id);
      expect((await top(owner, id)).status).toBe(404);
    });

    it("can't be called directly from a browser", async () => {
      const { error } = await browser().rpc("room_top_members", { target_room: "nothing1" });
      expect(error?.code).toBe("42501");
    });
  });

  it("hides a deleted room's content, and brings it back on restore", async () => {
    const id = await createRoom("Vanish");
    await browser().from("highlights").insert(highlight(id));
    expect((await remove(owner, id)).status).toBe(200);

    expect((await browser().from("rooms").select("id").eq("id", id)).data).toEqual([]);
    expect((await browser().from("highlights").select("id").eq("room_id", id)).data).toEqual([]);

    expect((await restore(owner, id)).status).toBe(200);
    expect((await browser().from("rooms").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await browser().from("highlights").select("id").eq("room_id", id)).data).toHaveLength(1);
  });

  it("can't read participation, follows, profiles, groups or invites, and can't change a status", async () => {
    const id = await createRoom("Private");
    await join(guest, id);
    const browserClient = browser();

    for (const table of [
      "room_participants",
      "follows",
      "profiles",
      "room_groups",
      "room_group_items",
      "room_invites",
      "ai_queries",
    ]) {
      const { data } = await browserClient.from(table).select("*");
      expect(data, `${table} should be private`).toEqual([]);
    }

    await browserClient.from("rooms").update({ status: "deleted" }).eq("id", id);
    expect((await supabase.room(id))?.status).toBe("running");
  });
});

describe("POST /api/rooms/:id/join", () => {
  it("needs a logged-in user", async () => {
    expect((await request(app).post("/api/rooms/nothing1/join")).status).toBe(401);
  });

  it("answers 404 for an unknown room", async () => {
    expect((await join(guest, "nothing1")).status).toBe(404);
  });

  it("lets people into a closed or paused room to read it", async () => {
    const id = await createRoom("Closed join");
    await setStatus(owner, id, "closed");
    expect((await join(guest, id)).body).toEqual({ id, status: "closed" });

    await setStatus(owner, id, "paused");
    expect((await join(guest, id)).body).toEqual({ id, status: "paused" });
  });

  it("can be repeated, acting as the heartbeat", async () => {
    const id = await createRoom("Twice");
    await join(guest, id);
    expect((await join(guest, id)).status).toBe(200);
    expect((await mine(guest, { q: "Twice" })).body.total).toBe(1);
    expect((await mine(guest, { q: "Twice" })).body.rooms[0]).toMatchObject({ participant_count: 1, live_count: 1 });
  });

  it("drops out of live_count when the heartbeat stops, and a new one brings it back", async () => {
    const admin = createClient(supabase.url, supabase.serviceRoleKey, { auth: { persistSession: false } });
    const id = await createRoom("Heartbeat");
    await join(guest, id);
    const row = async () =>
      (await admin.from("room_participants").select("joined_at, last_seen_at").eq("room_id", id).single()).data!;
    const firstJoin = (await row()).joined_at;

    const stale = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    await admin.from("room_participants").update({ last_seen_at: stale }).eq("room_id", id);
    expect((await mine(guest, { q: "Heartbeat" })).body.rooms[0]).toMatchObject({ participant_count: 1, live_count: 0 });

    await join(guest, id);
    expect((await mine(guest, { q: "Heartbeat" })).body.rooms[0]).toMatchObject({ participant_count: 1, live_count: 1 });
    expect((await row()).joined_at).toBe(firstJoin);
  });
});

describe("PATCH /api/rooms/:id", () => {
  it("is refused for rooms the user doesn't own, even after joining", async () => {
    const id = await createRoom("Not yours");
    await join(guest, id);

    expect((await setStatus(guest, id, "archived")).status).toBe(404);
    expect((await supabase.room(id))?.status).toBe("running");
  });

  it("rejects an unknown status and deleting through PATCH", async () => {
    const id = await createRoom("Bad status");
    expect((await setStatus(owner, id, "ended")).status).toBe(400);
    expect((await setStatus(owner, id, "deleted")).status).toBe(400);
  });

  it("stamps pause, resume, close and archive", async () => {
    const id = await createRoom("Lifecycle");

    const paused = await setStatus(owner, id, "paused");
    expect(paused.body).toMatchObject({ status: "paused" });
    expect(paused.body.paused_at).toEqual(expect.any(String));

    const resumed = await setStatus(owner, id, "running");
    expect(resumed.body).toMatchObject({ status: "running", paused_at: null, closed_at: null, deleted_at: null });

    const closed = await setStatus(owner, id, "closed");
    expect(closed.body).toMatchObject({ status: "closed" });
    expect(closed.body.closed_at).toEqual(expect.any(String));

    expect((await setStatus(owner, id, "archived")).body).toMatchObject({ status: "archived", paused_at: null });
  });

  it("moves a room into a group the owner created, and refuses someone else's group", async () => {
    const id = await createRoom("Grouped");
    const group = await request(app).post("/api/groups").set(auth(owner)).send({ name: "Grouped group" });
    const group_id = (group.body as { id: string }).id;

    expect((await update(owner, id, { group_id })).body).toMatchObject({ group_id });
    expect((await update(owner, id, { group_id: null })).body).toMatchObject({ group_id: null });

    const other = await request(app).post("/api/groups").set(auth(guest)).send({ name: "Guest group" });
    expect((await update(owner, id, { group_id: (other.body as { id: string }).id })).status).toBe(404);
  });

  it("refuses changes to a deleted room", async () => {
    const id = await createRoom("Deleted change");
    await remove(owner, id);
    expect((await setStatus(owner, id, "running")).status).toBe(409);
  });
});

describe("DELETE /api/rooms/:id and POST /api/rooms/:id/restore", () => {
  it("hides a deleted room from everyone but its owner, until it is restored", async () => {
    const id = await createRoom("Trash");
    await join(guest, id);

    expect((await remove(owner, id)).body).toMatchObject({ id, status: "deleted" });
    expect((await remove(owner, id)).status).toBe(200); // idempotent

    expect(ids(await mine(owner, { q: "Trash" }))).toEqual([]);
    expect(ids(await mine(owner, { q: "Trash", status: "deleted" }))).toEqual([id]);
    expect(ids(await mine(guest, { q: "Trash" }))).toEqual([]);
    expect(ids(await mine(guest, { q: "Trash", status: "deleted" }))).toEqual([]);
    expect((await join(guest, id)).status).toBe(404);
    expect((await request(app).post(`/api/rooms/${id}/recap`)).status).toBe(404);

    expect((await restore(owner, id)).body).toMatchObject({ id, status: "running", deleted_at: null });
    expect(ids(await mine(guest, { q: "Trash" }))).toEqual([id]);
    expect((await restore(owner, id)).status).toBe(409);
  });

  it("takes a deleted room's PDF offline, and restores it", async () => {
    const res = await request(app)
      .post("/api/rooms/pdf")
      .set(auth(owner))
      .attach("file", makePdf(["test"]), { filename: "paper.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    const { id } = res.body as { id: string };
    const download = (bucket: string) => fetch(`${supabase.url}/storage/v1/object/public/${bucket}/${id}.pdf`);

    expect((await download("pdfs")).ok).toBe(true);

    expect((await remove(owner, id)).status).toBe(200);
    expect((await download("pdfs")).ok).toBe(false);
    expect((await download("pdfs-deleted")).ok).toBe(false);

    expect((await restore(owner, id)).status).toBe(200);
    expect((await download("pdfs")).ok).toBe(true);
  });

  it("stops recaps of archived rooms", async () => {
    const id = await createRoom("Archived");
    await setStatus(owner, id, "archived");
    expect((await request(app).post(`/api/rooms/${id}/recap`)).status).toBe(409);
  });
});

describe("POST /api/rooms/file", () => {
  const browser = () => createClient(supabase.url, supabase.anonKey, { auth: { persistSession: false } });
  const uploadFile = (file: Buffer, filename: string) =>
    request(app).post("/api/rooms/file").set(auth(owner)).attach("file", file, { filename });

  it("makes a DOCX room people can highlight, and keeps the original out of public reach", async () => {
    const res = await uploadFile(await makeDocx(["Hello from Word"]), "notes.docx");
    expect(res.status).toBe(201);
    const { id } = res.body as { id: string };

    expect(await supabase.room(id)).toMatchObject({
      kind: "file",
      title: "notes.docx",
      content_html: '<p data-block="b0">Hello from Word</p>',
      source_meta: { format: "docx", file_name: "notes.docx" },
    });
    expect((await fetch(`${supabase.url}/storage/v1/object/public/files/${id}.docx`)).ok).toBe(false);

    const { error } = await browser().from("highlights").insert({
      room_id: id,
      author_name: "Guest",
      author_color: "#00ff00",
      block_id: "b0",
      start_offset: 0,
      end_offset: 5,
      quote: "Hello",
    });
    expect(error).toBeNull();
  });

  it.each([
    ["deck.pptx", async () => makePptx([["Slide text"]]), "pptx"],
    ["readme.md", async () => Buffer.from("# Title\n\nBody"), "md"],
    ["notes.txt", async () => Buffer.from("Plain text"), "txt"],
  ])("makes a room from %s", async (filename, make, format) => {
    const res = await uploadFile(await make(), filename);
    expect(res.status).toBe(201);
    expect(await supabase.room((res.body as { id: string }).id)).toMatchObject({
      kind: "file",
      source_meta: { format, file_name: filename },
    });
  });

  it("sends a PDF to the PDF viewer", async () => {
    const res = await uploadFile(makePdf(["test"]), "paper.pdf");
    expect(res.status).toBe(201);
    const { id } = res.body as { id: string };
    expect(await supabase.room(id)).toMatchObject({ kind: "pdf", pdf_path: `${id}.pdf` });
    expect(await supabase.pdf(`${id}.pdf`)).not.toBeNull();
  });

  it("refuses an old .doc", async () => {
    const res = await uploadFile(Buffer.from("old"), "report.doc");
    expect(res.status).toBe(400);
  });
});

describe("indexing a new room (chunks for search)", () => {
  // No AI service runs in these tests, so embeddings fail and the chunks are saved for keyword search.
  const ready = async (id: string) => {
    await vi.waitFor(
      async () => {
        expect(await supabase.aiState(id)).toMatchObject({ status: "ready" });
      },
      { timeout: 10_000, interval: 100 },
    );
  };

  it("saves a room's chunks in the background, and match_chunks finds them by keyword", async () => {
    const text = [
      "Photosynthesis turns sunlight into chemical energy in plants.",
      "Mitochondria are the powerhouse of the cell.",
      "Volcanoes form where tectonic plates meet.",
    ].join("\n\n");
    const res = await request(app).post("/api/rooms/text").set(auth(owner)).send({ title: "Science", text });
    expect(res.status).toBe(201);
    const { id } = res.body as { id: string };

    await ready(id);
    // Without an AI service the summary can't be made either: the room is still ready to search.
    expect(await supabase.aiState(id)).toEqual({ status: "ready", error: expect.stringContaining("summary") });
    const chunks = await supabase.chunks(id);
    expect(chunks).toEqual([
      expect.objectContaining({ idx: 0, block_ids: ["b0", "b1", "b2"], embedding: null, embedding_model: null }),
    ]);

    expect((await supabase.matchChunks(id, "How do volcanoes form?")).map((c) => c.idx)).toEqual([0]);
    expect(await supabase.matchChunks(id, "quantum chromodynamics")).toEqual([]);
  });

  it("indexes a PDF room by page", async () => {
    const res = await request(app)
      .post("/api/rooms/pdf")
      .set(auth(owner))
      .attach("file", makePdf(["First page", "Second page"]), { filename: "paper.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    const { id } = res.body as { id: string };

    await ready(id);
    expect(await supabase.chunks(id)).toEqual([expect.objectContaining({ block_ids: ["p1", "p2"], page: 1 })]);
  });

  it("keeps chunks and AI state away from the browser", async () => {
    const id = await createRoom("Private chunks");
    await ready(id);
    const browser = createClient(supabase.url, supabase.anonKey, { auth: { persistSession: false } });

    expect((await browser.from("chunks").select().eq("room_id", id)).data).toEqual([]);
    const { error } = await browser.rpc("match_chunks", { p_room: id, p_query: "text" });
    expect(error).not.toBeNull();
    // The AI state itself is public, like the room.
    expect((await browser.from("room_ai").select("status").eq("room_id", id)).data).toEqual([{ status: "ready" }]);
  });
});

describe("POST /api/rooms/:id/ask", () => {
  // No AI service runs here: a question that matches nothing is answered without one.
  const settled = async (id: string) => {
    await vi.waitFor(
      async () => {
        expect((await supabase.aiState(id))?.status).toBe("ready");
      },
      { timeout: 10_000, interval: 100 },
    );
  };
  const ask = (id: string, body: object) => request(app).post(`/api/rooms/${id}/ask`).send(body);

  it("saves a not-found answer when the document doesn't match, and everyone can read it", async () => {
    const id = await createRoom("Ask me");
    await settled(id);

    const res = await ask(id, { question: "What about quantum chromodynamics?", name: "Guest" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      room_id: id,
      kind: "ask",
      asked_by: "Guest",
      question: "What about quantum chromodynamics?",
      found_in_document: false,
      citations: [],
    });

    const browser = createClient(supabase.url, supabase.anonKey, { auth: { persistSession: false } });
    const { data } = await browser.from("ai_messages").select("question").eq("room_id", id);
    expect(data).toEqual([{ question: "What about quantum chromodynamics?" }]);
    // Only the backend writes answers.
    const { error } = await browser
      .from("ai_messages")
      .insert({ room_id: id, question: "Q", answer: "Fake", found_in_document: true });
    expect(error).not.toBeNull();
  });

  it("asks the AI when the document matches, and reports its failure as a 502", async () => {
    const id = await createRoom("Matching");
    await settled(id);
    // createRoom's text is "Some text".
    const res = await ask(id, { question: "What does the text say?" });
    expect(res.status).toBe(502);
  });

  it("refuses an empty question, and questions in a deleted room", async () => {
    const id = await createRoom("Deleted ask");
    expect((await ask(id, { question: "  " })).status).toBe(400);
    await settled(id);
    await remove(owner, id);
    expect((await ask(id, { question: "Still there?" })).status).toBe(404);
  });
});
