import { z } from "zod";

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
  })
  .superRefine((env, ctx) => {
    // In dev the server boots without Supabase so /health works; in production fail fast.
    if (env.NODE_ENV !== "production") return;
    for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "AI_INTERNAL_TOKEN"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required in production` });
    }
  });

export const env = Env.parse(process.env);

// First entry of WEB_ORIGIN is the frontend we redirect users back to.
export const webOrigin = (env.WEB_ORIGIN.split(",")[0] ?? env.WEB_ORIGIN).trim();
