import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake Supabase whose insert resolves only when the test says so.
let finishInsert: (() => void) | null = null;
// The insert starts once the key's hash is ready, so tests wait for it before finishing it.
const finishWhenStarted = async () => {
  await vi.waitFor(() => expect(finishInsert).not.toBeNull());
  finishInsert!();
  finishInsert = null;
};
const rpc = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      insert: () =>
        new Promise<{ error: null }>((resolve) => {
          finishInsert = () => resolve({ error: null });
        }),
    }),
    rpc,
  }),
}));

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
} as Storage;

const { removeKeyFor, removeSavedHighlight, saveHighlight } = await import("./docs");

const mark = {
  id: "h1",
  doc: "room1",
  block: "b0",
  kind: "highlight" as const,
  start: 0,
  end: 4,
  quote: "word",
  color: "#facc15",
  author: { id: "u1", name: "Ana", color: "#facc15" },
  at: "2026-11-01T00:00:00Z",
};

describe("removeSavedHighlight", () => {
  beforeEach(() => {
    store.clear();
    rpc.mockReset();
  });

  it("waits for a pending insert before removing the row", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const saved = saveHighlight(mark);
    const removed = removeSavedHighlight("h1", "room1");
    await vi.waitFor(() => expect(finishInsert).not.toBeNull());
    expect(rpc).not.toHaveBeenCalled();
    await finishWhenStarted();
    await saved;
    await removed;
    expect(rpc).toHaveBeenCalledWith("remove_highlight", expect.objectContaining({ p_id: "h1", p_room: "room1" }));
    expect(removeKeyFor("h1")).toBeNull();
  });

  it("keeps the key when nothing was removed, so a later erase can try again", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const saved = saveHighlight(mark);
    await finishWhenStarted();
    await saved;
    await removeSavedHighlight("h1", "room1");
    expect(removeKeyFor("h1")).not.toBeNull();
  });
});
