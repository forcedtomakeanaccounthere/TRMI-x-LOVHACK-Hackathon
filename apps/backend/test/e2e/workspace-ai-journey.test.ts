import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBackend, type Backend } from "../support/backend-process";
import { startFakeAi, type FakeAi } from "../support/fake-ai";
import { makeDocx } from "../support/files";
import { uniqueEmail } from "../support/supabase";

// A study group's afternoon in a room workspace, against the production build: the owner uploads
// notes and attaches them to the room, a guest asks across both documents, makes Studio artifacts,
// and downloads the original file.

type Session = { access_token: string; user: { id: string } };

describe("Room workspace AI E2E journey", () => {
  let be: Backend;
  let ai: FakeAi;

  beforeAll(async () => {
    ai = await startFakeAi();
    be = await startBackend({ AI_SERVICE_URL: ai.url, AI_INTERNAL_TOKEN: ai.token });
  });

  afterAll(async () => {
    await be?.stop();
    await ai?.stop();
  });

  const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${be.api}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  async function waitReady(roomId: string) {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const state = await be.supabase.aiState(roomId);
      if (state?.status === "ready") return;
      if (Date.now() > deadline) throw new Error(`room ${roomId} never finished indexing (${state?.status})`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  it("upload, attach, ask across documents, make artifacts, download the original", async () => {
    // 1. Olivia signs up and makes a room, then uploads her lecture notes as a second room.
    const email = uniqueEmail("workspace.e2e.owner");
    const password = randomBytes(12).toString("base64url");
    expect((await be.post("/api/auth/signup", { email, password, name: "Olivia" })).status).toBe(201);
    await be.clickVerificationLink(email);
    const olivia = (await (await be.post("/api/auth/login", { email, password })).json()) as Session;
    const auth = { Authorization: `Bearer ${olivia.access_token}` };

    const main = (await (await json("/api/rooms/text", { title: "Biology", text: "Photosynthesis turns sunlight into energy." }, auth)).json()) as { id: string };
    const form = new FormData();
    const docx = await makeDocx(["Photosynthesis in chemistry: light drives the reaction."]);
    form.append("file", new Blob([new Uint8Array(docx)]), "Lecture notes.docx");
    const notesRes = await be.postForm("/api/rooms/file", form, olivia.access_token);
    expect(notesRes.status).toBe(201);
    const notes = (await notesRes.json()) as { id: string };
    await waitReady(main.id);
    await waitReady(notes.id);

    // 2. She attaches the notes to the room; anyone opening the room sees both.
    expect((await json(`/api/rooms/${main.id}/sources`, { source_room_id: notes.id }, auth)).status).toBe(201);
    const sources = (await (await be.get(`/api/rooms/${main.id}/sources`)).json()) as { sources: { id: string; title: string }[] };
    expect(sources.sources).toEqual([expect.objectContaining({ id: notes.id, title: "Lecture notes.docx" })]);

    // 3. A guest asks across both documents: the answer cites each.
    const asked = await json(`/api/rooms/${main.id}/ask`, { question: "What is photosynthesis?", sources: [main.id, notes.id], name: "Gus" });
    expect(asked.status).toBe(201);
    const answer = (await asked.json()) as { citations: { room_id: string }[] };
    expect(new Set(answer.citations.map((c) => c.room_id))).toEqual(new Set([main.id, notes.id]));

    // 4. The guest makes a quiz and a summary in Studio.
    const quiz = await json(`/api/rooms/${main.id}/artifacts`, { kind: "quiz", sources: [main.id, notes.id] });
    expect(quiz.status).toBe(200);
    expect(await quiz.json()).toMatchObject({ kind: "quiz", questions: [{ q: "Q1?", answer: 2 }] });
    const summary = await json(`/api/rooms/${main.id}/artifacts`, { kind: "summary", sources: [main.id, notes.id] });
    expect(await summary.json()).toMatchObject({ kind: "summary", overview: expect.stringContaining("Biology: Overview of Biology") });

    // 5. The guest downloads the notes' original file.
    const original = (await (await be.get(`/api/rooms/${notes.id}/original`)).json()) as { url: string; file_name: string };
    expect(original.file_name).toBe("Lecture notes.docx");
    const file = await fetch(original.url);
    expect(Buffer.from(await file.arrayBuffer()).equals(docx)).toBe(true);
  });
});
