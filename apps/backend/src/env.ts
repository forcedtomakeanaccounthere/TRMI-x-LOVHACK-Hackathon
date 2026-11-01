import { z } from "zod";

// An empty value in .env (`SMTP_HOST=`) means "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const Env = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    SERVER_PORT: z.coerce.number().default(4000),
    WEB_ORIGIN: z.string().default("http://localhost:3000"),
    // Public URL of this backend; email verification links point here.
    API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
    AI_SERVICE_URL: z.string().url().default("http://localhost:8000"),
    // Shared secret sent to apps/ai as X-Internal-Token. Required in production.
    AI_INTERNAL_TOKEN: z.string().optional(),
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    // Requests per IP per 15 min across signup, login and resend-verification.
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
    // Questions per minute to POST /api/rooms/:id/ask: per IP, and per room across everyone.
    ASK_RATE_LIMIT: z.coerce.number().int().positive().default(10),
    ASK_ROOM_RATE_LIMIT: z.coerce.number().int().positive().default(30),
    // How long a GET /api/rooms/:id/original download link works, in seconds.
    ORIGINAL_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    // Headless Chromium processes the link-import fallback may run at once (lib/scraper-browser.ts).
    PLAYWRIGHT_MAX_BROWSERS: z.coerce.number().int().positive().default(2),
    // SMTP server for the verification emails (sent with nodemailer). Required in production.
    // In development it defaults to the local Supabase inbox, Mailpit (see supabase/config.toml).
    SMTP_HOST: optional(z.string()),
    SMTP_PORT: optional(z.coerce.number().int().positive()),
    SMTP_USER: optional(z.string()),
    SMTP_PASS: optional(z.string()),
    // Sender, e.g. `LinkRoom <you@gmail.com>`. Defaults to SMTP_USER.
    MAIL_FROM: optional(z.string()),
  })
  .superRefine((env, ctx) => {
    // In dev the server boots without Supabase so /health works; in production fail fast.
    if (env.NODE_ENV !== "production") return;
    for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "AI_INTERNAL_TOKEN", "SMTP_HOST"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required in production` });
    }
  });

export const env = Env.parse(process.env);

export const webOrigins = env.WEB_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);

// First entry of WEB_ORIGIN is the frontend we redirect users back to.
export const webOrigin = webOrigins[0] ?? env.WEB_ORIGIN;
