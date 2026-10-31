import express from "express";
import multer from "multer";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/error";

// A tiny upload route with a 10-byte limit, so upload errors can be checked without Supabase.
const app = express();
app.post("/upload", multer({ limits: { fileSize: 10, files: 1 } }).single("file"), (_req, res) => {
  res.sendStatus(204);
});
app.use(errorHandler);

describe("errorHandler with uploads", () => {
  it("turns a file over the size limit into a 413", async () => {
    const res = await request(app).post("/upload").attach("file", Buffer.alloc(11), "big.pdf");
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "PDF must be 20 MB or smaller" });
  });

  it("turns a file in the wrong field into a 400", async () => {
    const res = await request(app).post("/upload").attach("other", Buffer.alloc(1), "a.pdf");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Upload a single PDF in the "file" field' });
  });

  it("lets a file within the limit through", async () => {
    const res = await request(app).post("/upload").attach("file", Buffer.alloc(10), "ok.pdf");
    expect(res.status).toBe(204);
  });
});
