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

// Anon-key client for user auth calls (sign up, sign in, verify, refresh).
// A fresh client per call: sign-in stores the session on the client, so sharing
// one would leak sessions between requests.
export function supabaseAuth() {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
