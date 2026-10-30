import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

let client: SupabaseClient | null = null;

// Service-role client: server only, bypasses RLS.
export function supabaseAdmin() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  client ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return client;
}
