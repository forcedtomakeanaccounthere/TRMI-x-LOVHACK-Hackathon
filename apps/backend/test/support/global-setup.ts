import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import type { LocalSupabase } from "./supabase";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

declare module "vitest" {
  export interface ProvidedContext {
    supabase: LocalSupabase;
  }
}

// Integration and e2e tests run against the real local Supabase started by `npm run supabase:start`.
// Its URLs and keys come from `supabase status`, so nothing has to be copied into an env file.
export default function setup(project: TestProject) {
  let status: Record<string, string>;
  try {
    const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: ROOT, stdio: "pipe" });
    status = JSON.parse(out.toString());
  } catch {
    throw new Error("Local Supabase is not running. Start it with `npm run supabase:start` (needs Docker).");
  }

  project.provide("supabase", {
    url: status.API_URL!,
    anonKey: status.ANON_KEY!,
    serviceRoleKey: status.SERVICE_ROLE_KEY!,
    dbUrl: status.DB_URL!,
    mailUrl: status.MAILPIT_URL ?? status.INBUCKET_URL!,
  });
}
