import { afterEach, describe, expect, it, vi } from "vitest";

async function loadEnv(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  return import("../../src/env");
}

const SUPABASE = {
  SUPABASE_URL: "https://abc.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};
const PRODUCTION = { NODE_ENV: "production", ...SUPABASE, AI_INTERNAL_TOKEN: "secret" };

afterEach(() => vi.unstubAllEnvs());

describe("env", () => {
  it("applies defaults in development without Supabase", async () => {
    const { env, webOrigin } = await loadEnv({
      NODE_ENV: "development",
      SUPABASE_URL: undefined,
      SUPABASE_ANON_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      WEB_ORIGIN: undefined,
      API_PUBLIC_URL: undefined,
      AUTH_RATE_LIMIT: undefined,
    });
    expect(env.SERVER_PORT).toBe(4000);
    expect(env.API_PUBLIC_URL).toBe("http://localhost:4000");
    expect(env.AUTH_RATE_LIMIT).toBe(10);
    expect(webOrigin).toBe("http://localhost:3000");
  });

  it("fails fast in production when Supabase keys are missing", async () => {
    await expect(
      loadEnv({ NODE_ENV: "production", SUPABASE_URL: undefined, SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: undefined }),
    ).rejects.toThrow(/SUPABASE_URL is required in production[\s\S]*SUPABASE_ANON_KEY[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("boots in production when Supabase keys and the AI token are set", async () => {
    const { env } = await loadEnv(PRODUCTION);
    expect(env.SUPABASE_URL).toBe(SUPABASE.SUPABASE_URL);
    expect(env.AI_INTERNAL_TOKEN).toBe("secret");
  });

  it("fails fast in production without the AI token, and allows none in development", async () => {
    await expect(loadEnv({ ...PRODUCTION, AI_INTERNAL_TOKEN: "" })).rejects.toThrow(
      /AI_INTERNAL_TOKEN is required in production/,
    );
    const { env } = await loadEnv({ NODE_ENV: "development", AI_INTERNAL_TOKEN: undefined });
    expect(env.AI_INTERNAL_TOKEN).toBeUndefined();
  });

  it("redirects to the first WEB_ORIGIN entry", async () => {
    const { webOrigin } = await loadEnv({ WEB_ORIGIN: " https://linkroom.app , http://localhost:3000" });
    expect(webOrigin).toBe("https://linkroom.app");
  });

  it("rejects an invalid API_PUBLIC_URL and AUTH_RATE_LIMIT", async () => {
    await expect(loadEnv({ API_PUBLIC_URL: "not a url" })).rejects.toThrow();
    await expect(loadEnv({ API_PUBLIC_URL: undefined, AUTH_RATE_LIMIT: "0" })).rejects.toThrow();
  });
});
