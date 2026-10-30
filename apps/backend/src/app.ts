import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./env";
import { errorHandler, notFound } from "./middleware/error";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { roomsRouter } from "./routes/rooms";

export function createApp() {
  const app = express();

  // Behind a host proxy (Render, Railway, ...) so rate limits see the real client IP.
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN.split(",") }));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.use("/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/rooms", roomsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
