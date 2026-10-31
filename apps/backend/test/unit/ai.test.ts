import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.stubEnv("AI_SERVICE_URL", "http://ai.test");
vi.stubEnv("AI_INTERNAL_TOKEN", "secret");
const { callAi } = await import("../../src/lib/ai");
const { HttpError } = await import("../../src/middleware/error");

const Reply = z.object({ ok: z.boolean() });
const fetchMock = vi.fn<typeof fetch>();
// What Node's fetch throws when it can't connect, or when the connection drops after sending.
const connectError = (code: string) =>
  new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
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

  it("retries once when the connection was refused, with the same request id and deadline", async () => {
    fetchMock.mockRejectedValueOnce(connectError("ECONNREFUSED")).mockResolvedValueOnce(json({ ok: true }));

    await expect(callAi("/recap", {}, Reply, 1000)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const ids = fetchMock.mock.calls.map(([, init]) => (init!.headers as Record<string, string>)["X-Request-Id"]);
    expect(ids[0]).toBe(ids[1]);
    expect(fetchMock.mock.calls[0]![1]!.signal).toBe(fetchMock.mock.calls[1]![1]!.signal);
  });

  it("retries when every address of a host refused (an AggregateError cause)", async () => {
    const cause = new AggregateError([Object.assign(new Error(), { code: "ECONNREFUSED" })]);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause })).mockResolvedValueOnce(json({ ok: true }));
    await expect(callAi("/recap", {}, Reply, 1000)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the one retry", async () => {
    fetchMock.mockRejectedValue(connectError("ECONNREFUSED"));
    await expect(callAi("/recap", {}, Reply, 1000)).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["UND_ERR_SOCKET", "ECONNRESET"])(
    "doesn't retry a connection that dropped after the request went out (%s)",
    async (code) => {
      fetchMock.mockRejectedValue(connectError(code));
      await expect(callAi("/recap", {}, Reply, 1000)).rejects.toMatchObject({ status: 502 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("doesn't retry once the deadline has passed", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))),
    );
    await expect(callAi("/recap", {}, Reply, 20)).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't retry an error the AI service answered with", async () => {
    fetchMock.mockResolvedValue(json({ detail: "All AI providers failed" }, 502));
    await expect(callAi("/recap", {}, Reply, 1000)).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("turns a status apps/ai answers with into the error given for it", async () => {
    fetchMock.mockResolvedValue(json({ detail: "Question refused by moderation" }, 400));
    const refused = new HttpError(422, "That question can't be asked here.");
    await expect(callAi("/answer", {}, Reply, 1000, { 400: refused })).rejects.toBe(refused);
    fetchMock.mockResolvedValue(json({ detail: "x" }, 500));
    await expect(callAi("/answer", {}, Reply, 1000, { 400: refused })).rejects.toMatchObject({ status: 502 });
  });
});
