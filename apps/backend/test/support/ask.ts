import { vi } from "vitest";

// Shared stand-ins for the ask tests: a Supabase whose reads answer from queued results, whose
// match_chunks answers `matches`, and which records every insert; and a fake apps/ai.

type Result = { data?: unknown; error?: unknown };

export const state = {
  results: {} as Record<string, Result[]>,
  inserts: {} as Record<string, unknown[]>,
  rpc: [] as [string, Record<string, unknown>][],
  matches: [] as unknown[],
};

export function resetState() {
  state.results = {
    rooms: [{ data: { status: "running" } }],
    room_ai: [{ data: { status: "ready" } }],
  };
  state.inserts = {};
  state.rpc = [];
  state.matches = [];
}

function table(name: string) {
  let inserted: Record<string, unknown> | null = null;
  const builder: Record<string, unknown> = {
    then: (resolve: (r: Result) => unknown) => {
      if (inserted) {
        return resolve({ data: { id: "00000000-0000-4000-8000-000000000001", created_at: "2026-10-31T00:00:00Z", ...inserted }, error: state.results[`${name}:insert`]?.shift()?.error ?? null });
      }
      return resolve({ data: null, error: null, ...state.results[name]?.shift() });
    },
  };
  for (const method of ["select", "eq", "gt", "order", "limit", "maybeSingle", "single"]) builder[method] = () => builder;
  builder.insert = (row: Record<string, unknown>) => {
    (state.inserts[name] ??= []).push(row);
    inserted = row;
    return builder;
  };
  return builder;
}

export const supabaseMock = () => ({
  supabaseAdmin: () => ({
    from: table,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpc.push([fn, args]);
      return { data: state.matches, error: null };
    },
    auth: {
      getUser: async () => ({
        data: { user: { id: "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f", email: "a@example.com", email_confirmed_at: "2026-10-30T00:00:00Z", user_metadata: { name: "Signed In" } } },
        error: null,
      }),
    },
  }),
});

export const callAi = vi.fn();
