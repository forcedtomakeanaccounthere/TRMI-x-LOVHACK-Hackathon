import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { connectSupabase } from "./supabase";

// Starts the production build (`npm run build`) as its own process, the way it is deployed,
// wired to the real local Supabase. Each call gets its own process, so its own rate-limit budget.

const DIST = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
export const WEB = "http://web.e2e";

async function freePort() {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address() as AddressInfo;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

export async function startBackend(extraEnv: Record<string, string> = {}) {
  if (!existsSync(DIST)) throw new Error("dist/index.js is missing: run `npm run build` first");

  const supabase = await connectSupabase();
  const port = await freePort();
  const api = `http://127.0.0.1:${port}`;
  let logs = "";

  const server = spawn(process.execPath, [DIST], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      SERVER_PORT: String(port),
      WEB_ORIGIN: WEB,
      API_PUBLIC_URL: api,
      SUPABASE_URL: supabase.url,
      SUPABASE_ANON_KEY: supabase.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d) => (logs += d));
  server.stderr?.on("data", (d) => (logs += d));

  const deadline = Date.now() + 15_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`backend exited early:\n${logs}`);
    if (Date.now() > deadline) throw new Error(`backend did not start:\n${logs}`);
    try {
      if ((await fetch(`${api}/health`)).ok) break;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const headers = (token?: string): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

  return {
    api,
    supabase,
    post: (path: string, body: unknown, token?: string) =>
      fetch(`${api}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers(token) },
        body: JSON.stringify(body),
      }),
    postForm: (path: string, form: FormData, token?: string) =>
      fetch(`${api}${path}`, { method: "POST", headers: headers(token), body: form }),
    get: (path: string, token?: string) => fetch(`${api}${path}`, { headers: headers(token) }),
    // Opens the link from the latest verification email without following the redirect.
    clickVerificationLink: async (email: string, count?: number) =>
      fetch(await supabase.verificationLink(email, count), { redirect: "manual" }),
    stop: async () => {
      server.kill();
      await supabase.close();
    },
  };
}

export type Backend = Awaited<ReturnType<typeof startBackend>>;
