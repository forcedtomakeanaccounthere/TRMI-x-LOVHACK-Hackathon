import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { env } from "./env";
import { errorHandler, notFound } from "./middleware/error";
import { openApiDocument } from "./openapi";
import { authRouter } from "./routes/auth";
import { groupsRouter } from "./routes/groups";
import { healthRouter } from "./routes/health";
import { meRouter } from "./routes/me";
import { roomsRouter } from "./routes/rooms";
import { studyRouter } from "./routes/study";
import { usersRouter } from "./routes/users";

// Every API router, by mount path. test/unit/openapi.test.ts checks each route is documented.
export const apiRouters = {
  "/health": healthRouter,
  "/api/auth": authRouter,
  "/api/me": meRouter,
  "/api/rooms": roomsRouter,
  "/api/groups": groupsRouter,
  "/api/study": studyRouter,
  "/api/users": usersRouter,
};

export function createApp() {
  const app = express();

  // Behind a host proxy (Render, Railway, ...) so rate limits see the real client IP.
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN.split(",") }));
  app.use(express.json({ limit: "1mb" }));
  if (env.NODE_ENV !== "test") app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  for (const [path, router] of Object.entries(apiRouters)) app.use(path, router);

  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
