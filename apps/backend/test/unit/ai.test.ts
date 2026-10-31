import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.stubEnv("AI_SERVICE_URL", "http://ai.test");
vi.stubEnv("AI_INTERNAL_TOKEN", "secret");
const { callAi } = await import("../../src/lib/ai");

const Reply = z.object({ ok: z.boolean() });
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

describe("callAi", () => {
  it("posts JSON with the internal token and a request id, and returns the parsed reply", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await expect(callAi("/recap", { a: 1 }, Reply, 1000)).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://ai.test/recap");
    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Internal-Token"]).toBe("secret");
    expect(headers["X-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(init!.body).toBe('{"a":1}');
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["the service is unreachable", () => fetchMock.mockRejectedValue(new TypeError("fetch failed")), 502],
    ["the request times out", () => fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError")), 502],
    ["every provider failed", () => fetchMock.mockResolvedValue(json({ detail: "All AI providers failed" }, 502)), 502],
    ["the token is wrong", () => fetchMock.mockResolvedValue(json({ detail: "Unauthorized" }, 401)), 502],
    ["no provider is configured", () => fetchMock.mockResolvedValue(json({ detail: "no key" }, 503)), 503],
    ["the reply has the wrong shape", () => fetchMock.mockResolvedValue(json({ ok: "yes" })), 502],
    ["the reply isn't JSON", () => fetchMock.mockResolvedValue(new Response("<html>")), 502],
  ])("answers a friendly error when %s", async (_name, arrange, status) => {
    arrange();
    const err = await callAi("/recap", {}, Reply, 1000).catch((e: unknown) => e);
    expect(err).toMatchObject({ status });
    expect((err as Error).message).not.toMatch(/providers|Unauthorized|key/);
    expect(console.error).toHaveBeenCalled();
  });
});
