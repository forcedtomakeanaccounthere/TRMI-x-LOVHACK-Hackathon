import express from "express";
import multer from "multer";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/error";

// Tiny upload routes with a 10-byte limit, so upload errors can be checked without Supabase. The
// router mount matches the real app, since the message depends on the path.
const router = express.Router();
const upload = multer({ limits: { fileSize: 10, files: 1 } }).single("file");
router.post("/pdf", upload, (_req, res) => {
  res.sendStatus(204);
});
router.post("/file", upload, (_req, res) => {
  res.sendStatus(204);
});
const app = express();
app.use("/api/rooms", router);
app.use(errorHandler);

describe("errorHandler with uploads", () => {
  it("turns a file over the size limit into a 413", async () => {
    const res = await request(app).post("/api/rooms/pdf").attach("file", Buffer.alloc(11), "big.pdf");
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "PDF must be 20 MB or smaller" });
  });

  it("turns a file in the wrong field into a 400", async () => {
    const res = await request(app).post("/api/rooms/pdf").attach("other", Buffer.alloc(1), "a.pdf");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Upload a single PDF in the "file" field' });
  });

  it("talks about a file, not a PDF, on the general upload route", async () => {
    const big = await request(app).post("/api/rooms/file").attach("file", Buffer.alloc(11), "big.docx");
    expect(big.status).toBe(413);
    expect(big.body).toEqual({ error: "File must be 20 MB or smaller" });

    const wrong = await request(app).post("/api/rooms/file").attach("other", Buffer.alloc(1), "a.md");
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({ error: 'Upload a single file in the "file" field' });
  });

  it("lets a file within the limit through", async () => {
    const res = await request(app).post("/api/rooms/pdf").attach("file", Buffer.alloc(10), "ok.pdf");
    expect(res.status).toBe(204);
  });
});
