import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../../src/middleware/error";

// Chromium never starts here: launch() waits until the test lets it go, so the slots fill up.
const launches = vi.hoisted(() => ({ count: 0, release: [] as (() => void)[] }));

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(async () => {
      launches.count++;
      await new Promise<void>((resolve) => launches.release.push(resolve));
      throw new Error("launch stopped by the test");
    }),
  },
}));

vi.mock("../../src/lib/pinned-proxy", () => ({
  startPinnedProxy: async () => ({ server: "http://127.0.0.1:1", username: "u", password: "p", close: async () => {} }),
}));

const { scrapeWithPlaywright } = await import("../../src/lib/scraper-browser");

const PUBLIC = new URL("http://93.184.215.14/"); // an IP literal, so no DNS lookup
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("browser fallback concurrency", () => {
  it("runs at most PLAYWRIGHT_MAX_BROWSERS at once, queues a few, and refuses the rest", async () => {
    // Default limit 2 browsers, 8 waiting.
    const calls = Array.from({ length: 10 }, () => scrapeWithPlaywright(PUBLIC).catch((e: unknown) => e));
    await tick();
    expect(launches.count).toBe(2);

    const refused = await scrapeWithPlaywright(PUBLIC).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).status).toBe(503);

    // Finishing one browser starts the next one waiting.
    launches.release.shift()!();
    await tick();
    await tick();
    expect(launches.count).toBe(3);

    // Drain everything; each queued call gets its turn and every slot is given back.
    while (launches.count < 10 || launches.release.length) {
      launches.release.shift()?.();
      await tick();
    }
    const results = await Promise.all(calls);
    expect(results.every((r) => r instanceof HttpError && r.status === 422)).toBe(true);
    expect(launches.count).toBe(10);

    // With the slots free again, a new call launches right away.
    const again = scrapeWithPlaywright(PUBLIC).catch((e: unknown) => e);
    await tick();
    expect(launches.count).toBe(11);
    launches.release.shift()!();
    await again;
  });
});
