import type { ErrorRequestHandler, RequestHandler } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found" });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof MulterError) {
    // POST /api/rooms/pdf takes only PDFs; POST /api/rooms/file takes any supported document.
    const what = req.path.endsWith("/pdf") ? "PDF" : "file";
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: `${what === "PDF" ? "PDF" : "File"} must be 20 MB or smaller` });
    } else {
      res.status(400).json({ error: `Upload a single ${what} in the "file" field` });
    }
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues.map((i) => i.message).join(", ") });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
