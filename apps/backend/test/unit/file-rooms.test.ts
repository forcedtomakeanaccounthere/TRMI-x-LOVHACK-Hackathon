import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_OFFICE } from "../../src/lib/files";
import { makeDocx, makePptx } from "../support/files";
import { makePdf } from "../support/pdf";

const USER = "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f";

// Same idea as rooms.test.ts: record what reaches Supabase, and answer with queued results.
const inserts: Record<string, unknown>[] = [];
const uploads: { bucket: string; path: string; contentType?: string }[] = [];
const removals: { bucket: string; paths: string[] }[] = [];
let insertError: unknown = null;

vi.mock("../../src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: insertError };
      },
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _body: Buffer, options: { contentType?: string }) => {
          uploads.push({ bucket, path, contentType: options.contentType });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          removals.push({ bucket, paths });
          return { error: null };
        },
      }),
    },
    auth: {
      getUser: async () => ({
        data: { user: { id: USER, email: "a@example.com", email_confirmed_at: "2026-10-30T00:00:00Z", user_metadata: {} } },
        error: null,
      }),
    },
  }),
}));

// Indexing runs in the background after a room is created; here we only check that it starts.
const startIndexing = vi.fn();
vi.mock("../../src/lib/ai-jobs", () => ({ startIndexing: (id: string) => startIndexing(id) }));

const { createApp } = await import("../../src/app");
const app = createApp();

const upload = (buf: Buffer, filename: string, contentType = "application/octet-stream") =>
  request(app)
    .post("/api/rooms/file")
    .set("Authorization", "Bearer token")
    .attach("file", buf, { filename, contentType });

beforeEach(() => {
  inserts.length = 0;
  uploads.length = 0;
  removals.length = 0;
  insertError = null;
  startIndexing.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/rooms/file", () => {
  it("makes a file room from a DOCX, keeping the original in the private bucket", async () => {
    const res = await upload(await makeDocx(["Hello room"]), "Notes.docx");
    expect(res.status).toBe(201);
    const { id } = res.body as { id: string };

    expect(uploads).toEqual([
      {
        bucket: "files",
        path: `${id}.docx`,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ]);
    expect(inserts).toEqual([
      {
        id,
        kind: "file",
        title: "Notes.docx",
        content_html: '<p data-block="b0">Hello room</p>',
        source_meta: { format: "docx", file_name: "Notes.docx" },
        created_by: USER,
      },
    ]);
    expect(startIndexing).toHaveBeenCalledWith(id);
  });

  it("makes a room from each slide of a PPTX", async () => {
    const res = await upload(await makePptx([["Intro"], ["Details"]]), "deck.pptx");
    expect(res.status).toBe(201);
    expect(uploads[0]).toMatchObject({ bucket: "files", path: expect.stringMatching(/\.pptx$/) });
    expect(inserts[0]).toMatchObject({ kind: "file", source_meta: { format: "pptx", file_name: "deck.pptx" } });
    expect(inserts[0]!.content_html).toContain('<section data-block="p2"><h2>Slide 2</h2><p>Details</p></section>');
  });

  it.each([
    ["readme.md", "# Hi\n\nThere", "md", "text/markdown"],
    ["notes.txt", "Hi\n\nThere", "txt", "text/plain"],
  ])("makes a room from %s", async (name, text, format, contentType) => {
    const res = await upload(Buffer.from(text), name, "text/plain");
    expect(res.status).toBe(201);
    expect(uploads[0]).toMatchObject({ bucket: "files", contentType });
    expect(inserts[0]).toMatchObject({ kind: "file", source_meta: { format, file_name: name } });
  });

  it("sends a PDF to the PDF viewer, like POST /api/rooms/pdf", async () => {
    const res = await upload(makePdf(["Page one"]), "paper.pdf", "application/pdf");
    expect(res.status).toBe(201);
    const { id } = res.body as { id: string };
    expect(uploads).toEqual([{ bucket: "pdfs", path: `${id}.pdf`, contentType: "application/pdf" }]);
    expect(startIndexing).toHaveBeenCalledWith(id);
    expect(inserts[0]).toMatchObject({
      kind: "pdf",
      pdf_path: `${id}.pdf`,
      content_text: "[Page 1] Page one",
      source_meta: { format: "pdf", file_name: "paper.pdf" },
    });
  });

  it("refuses an old .doc with advice, before storing anything", async () => {
    const res = await upload(Buffer.from("old binary"), "report.doc");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: LEGACY_OFFICE });
    expect(uploads).toEqual([]);
    expect(inserts).toEqual([]);
    expect(startIndexing).not.toHaveBeenCalled();
  });

  it("refuses text that isn't UTF-8", async () => {
    const res = await upload(Buffer.from("caf\xe9", "latin1"), "notes.txt");
    expect(res.status).toBe(400);
    expect(uploads).toEqual([]);
  });

  it("removes the stored file when the room can't be saved", async () => {
    insertError = new Error("database down");
    const res = await upload(Buffer.from("Some text"), "notes.txt");
    expect(res.status).toBe(500);
    expect(removals).toEqual([{ bucket: "files", paths: [uploads[0]!.path] }]);
    expect(startIndexing).not.toHaveBeenCalled();
  });

  it("answers 400 without a file", async () => {
    const res = await request(app).post("/api/rooms/file").set("Authorization", "Bearer token");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "A file is required" });
  });

  it("needs a session", async () => {
    const res = await request(app).post("/api/rooms/file").attach("file", Buffer.from("x"), "a.txt");
    expect(res.status).toBe(401);
    expect(uploads).toEqual([]);
  });
});

describe("room creation starts indexing", () => {
  it.each([
    ["/api/rooms/text", { title: "Notes", text: "Some text" }],
    ["/api/rooms/link", { url: "https://example.com/post" }],
  ])("for %s", async (path, body) => {
    if (path.endsWith("/link")) {
      const extract = await import("../../src/lib/extract");
      vi.spyOn(extract, "extractArticle").mockResolvedValueOnce({
        url: "https://example.com/post",
        title: "Post",
        html: '<p data-block="b0">Hi</p>',
      });
    }
    const res = await request(app).post(path).set("Authorization", "Bearer token").send(body);
    expect(res.status).toBe(201);
    expect(startIndexing).toHaveBeenCalledWith((res.body as { id: string }).id);
  });

  it("not when the room can't be saved", async () => {
    insertError = new Error("database down");
    const res = await request(app).post("/api/rooms/text").set("Authorization", "Bearer token").send({ text: "x" });
    expect(res.status).toBe(500);
    expect(startIndexing).not.toHaveBeenCalled();
  });
});
