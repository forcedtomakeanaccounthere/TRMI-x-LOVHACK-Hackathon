import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./env";
import { errorHandler, notFound } from "./middleware/error";
import { healthRouter } from "./routes/health";
import { roomsRouter } from "./routes/rooms";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN.split(",") }));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.use("/health", healthRouter);
  app.use("/api/rooms", roomsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
