import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/rooms/:id/original against a stubbed Supabase: which bucket and path get signed, under
// which download name, and which rooms have nothing to download.

let room: Record<string, unknown> | null = null;
let signError: unknown = null;
const signed: { bucket: string; path: string; ttl: number; download: unknown }[] = [];

vi.mock("../../src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: room, error: null }) }) }),
    }),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number, options: { download?: unknown }) => {
          signed.push({ bucket, path, ttl, download: options.download });
          return signError
            ? { data: null, error: signError }
            : { data: { signedUrl: `http://storage.test/${bucket}/${path}?token=t` }, error: null };
        },
      }),
    },
    auth: { getUser: async () => ({ data: { user: null }, error: new Error("no session") }) },
  }),
}));

const { createApp } = await import("../../src/app");
const app = createApp();
const original = (id = "room0001") => request(app).get(`/api/rooms/${id}/original`);

beforeEach(() => {
  room = null;
  signError = null;
  signed.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/rooms/:id/original", () => {
  it("signs a file room's original in the private bucket, downloading under its own name", async () => {
    room = { kind: "file", status: "running", pdf_path: null, source_meta: { format: "docx", file_name: "Notes.docx" } };
    const res = await original();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "http://storage.test/files/room0001.docx?token=t", file_name: "Notes.docx", expires_in: 300 });
    expect(signed).toEqual([{ bucket: "files", path: "room0001.docx", ttl: 300, download: "Notes.docx" }]);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("signs a PDF room's file in the pdfs bucket", async () => {
    room = { kind: "pdf", status: "archived", pdf_path: "room0001.pdf", source_meta: { format: "pdf", file_name: "Paper.pdf" } };
    const res = await original();
    expect(res.status).toBe(200);
    expect(signed[0]).toMatchObject({ bucket: "pdfs", path: "room0001.pdf", download: "Paper.pdf" });
  });

  it("falls back to the stored path for an old PDF room without a file name", async () => {
    room = { kind: "pdf", status: "running", pdf_path: "room0001.pdf", source_meta: null };
    expect((await original()).body.file_name).toBe("room0001.pdf");
  });

  it.each([
    ["link", { kind: "link", status: "running", pdf_path: null, source_meta: null }],
    ["text", { kind: "text", status: "running", pdf_path: null, source_meta: null }],
    ["youtube", { kind: "youtube", status: "running", pdf_path: null, source_meta: { format: "youtube" } }],
  ])("has nothing to download for a %s room", async (_kind, row) => {
    room = row;
    const res = await original();
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("This room has no original file");
    expect(signed).toEqual([]);
  });

  it("treats a deleted or unknown room as not found", async () => {
    room = { kind: "file", status: "deleted", pdf_path: null, source_meta: { format: "docx", file_name: "a.docx" } };
    expect((await original()).status).toBe(404);
    room = null;
    expect((await original()).status).toBe(404);
    expect(signed).toEqual([]);
  });

  it("answers 404 when the stored file is missing", async () => {
    room = { kind: "file", status: "running", pdf_path: null, source_meta: { format: "md", file_name: "a.md" } };
    signError = new Error("Object not found");
    const res = await original();
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("The original file isn't available");
  });
});
