import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sweepCount = 0;
let sweepError: Error | null = null;

vi.mock("../../src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    rpc: async () => {
      sweepCount++;
      if (sweepError) throw sweepError;
      return { data: [], error: null };
    },
    channel: () => ({
      send: async () => "ok",
    }),
    removeChannel: async () => {},
  }),
}));

const { startLifecycleWorker, stopLifecycleWorker } = await import(
  "../../src/services/lifecycle"
);

describe("Lifecycle Worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sweepCount = 0;
    sweepError = null;
    stopLifecycleWorker();
  });

  afterEach(() => {
    stopLifecycleWorker();
    vi.useRealTimers();
  });

  it("runs an initial sweep and sets up recurring intervals", async () => {
    const stop = startLifecycleWorker(10_000);

    // Initial sweep should have triggered
    expect(sweepCount).toBe(1);

    // Advance by 1 interval
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweepCount).toBe(2);

    // Advance by another interval
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweepCount).toBe(3);

    stop();

    // Advancing timer after stop should not trigger any more sweeps
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sweepCount).toBe(3);
  });

  it("catches and recovers from sweep errors without terminating", async () => {
    sweepError = new Error("Temporary DB failure");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    startLifecycleWorker(5_000);
    expect(sweepCount).toBe(1);

    // Next tick
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sweepCount).toBe(2);

    // Recover
    sweepError = null;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sweepCount).toBe(3);

    consoleSpy.mockRestore();
  });
});
