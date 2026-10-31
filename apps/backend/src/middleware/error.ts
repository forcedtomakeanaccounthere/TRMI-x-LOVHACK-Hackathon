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

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "PDF must be 20 MB or smaller" });
    } else {
      res.status(400).json({ error: 'Upload a single PDF in the "file" field' });
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
