import type { AuthSession } from "@linkroom/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// session.ts keeps module state (cache, in-memory fallback, in-flight refresh), so each test loads a fresh copy.
const load = async () => {
  vi.resetModules();
  return import("./session");
};

const fetchMock = vi.fn();
let store: Map<string, string>;
let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;

const now = () => Math.floor(Date.now() / 1000);
const makeSession = (expires_at: number, token = "access"): AuthSession => ({
  access_token: token,
  refresh_token: `refresh-${token}`,
  expires_at,
  user: { id: "u", email: "a@b.co", name: "A" },
});

beforeEach(() => {
  store = new Map();
  storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("safeNext", () => {
  it.each(["/", "/r/abc123", "/login?verified=1", "/r/abc#notes"])("keeps the same-site path %s", async (next) => {
    const { safeNext } = await load();
    expect(safeNext(next)).toBe(next);
  });

  it.each([
    null,
    undefined,
    "",
    "r/abc",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/a/..//evil.example",
    "/./..//evil.example",
    "/%2e%2e//evil.example",
  ])(
    "falls back for %j",
    async (next) => {
      const { safeNext } = await load();
      expect(safeNext(next, "/home")).toBe("/home");
    },
  );
});

describe("setSession / getSession", () => {
  it("round-trips through localStorage", async () => {
    const { getSession, setSession } = await load();
    const session = makeSession(now() + 3600);
    setSession(session);
    expect(JSON.parse(store.get("linkroom-session")!)).toEqual(session);
    expect(getSession()).toEqual(session);
  });

  it("keeps the session in memory when storage is full", async () => {
    const { getSession, setSession } = await load();
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const session = makeSession(now() + 3600);
    setSession(session);
    expect(getSession()).toEqual(session);
    setSession(null);
    expect(getSession()).toBeNull();
  });

  it("keeps the session in memory when storage is blocked", async () => {
    const { getSession, setSession } = await load();
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    storage.getItem = blocked;
    storage.setItem = blocked;
    const session = makeSession(now() + 3600);
    setSession(session);
    expect(getSession()).toEqual(session);
  });
});

describe("getFreshSession", () => {
  it("returns null without a session", async () => {
    const { getFreshSession } = await load();
    await expect(getFreshSession()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a session that is not about to expire as is", async () => {
    const { getFreshSession, setSession } = await load();
    const session = makeSession(now() + 3600);
    setSession(session);
    await expect(getFreshSession()).resolves.toEqual(session);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expiring session once for concurrent callers and saves the new one", async () => {
    const { getFreshSession, getSession, setSession } = await load();
    setSession(makeSession(now() + 10, "old"));
    const fresh = makeSession(now() + 3600, "new");
    fetchMock.mockResolvedValue(new Response(JSON.stringify(fresh), { status: 200 }));

    const [a, b] = await Promise.all([getFreshSession(), getFreshSession()]);

    expect(a).toEqual(fresh);
    expect(b).toEqual(fresh);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/auth/refresh");
    expect(JSON.parse(init.body as string)).toEqual({ refresh_token: "refresh-old" });
    expect(getSession()).toEqual(fresh);
  });

  it("forgets the session when the refresh token is rejected", async () => {
    const { getFreshSession, getSession, setSession } = await load();
    setSession(makeSession(now() - 10));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Session expired. Please log in again." }), { status: 401 }),
    );

    await expect(getFreshSession()).resolves.toBeNull();
    expect(getSession()).toBeNull();
  });

  it.each([500, 503, 429])("keeps the session when the refresh fails with %i", async (status) => {
    const { getFreshSession, getSession, setSession } = await load();
    const session = makeSession(now() - 10);
    setSession(session);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Try again" }), { status }));

    await expect(getFreshSession()).rejects.toMatchObject({ status });
    expect(getSession()).toEqual(session);
  });

  describe("when the session changes while the refresh is in flight", () => {
    // Holds the refresh response until the test decides how it ends.
    function pendingRefresh() {
      let respond!: (res: Response) => void;
      fetchMock.mockReturnValue(new Promise<Response>((resolve) => (respond = resolve)));
      return respond;
    }

    it("does not undo a sign-out", async () => {
      const { getFreshSession, getSession, setSession } = await load();
      setSession(makeSession(now() - 10, "old"));
      const respond = pendingRefresh();

      const result = getFreshSession();
      setSession(null);
      respond(new Response(JSON.stringify(makeSession(now() + 3600, "new")), { status: 200 }));

      await expect(result).resolves.toBeNull();
      expect(getSession()).toBeNull();
    });

    it("keeps a newer sign-in instead of the refreshed old account", async () => {
      const { getFreshSession, getSession, setSession } = await load();
      setSession(makeSession(now() - 10, "old"));
      const respond = pendingRefresh();

      const result = getFreshSession();
      const other = makeSession(now() + 3600, "other-account");
      setSession(other);
      respond(new Response(JSON.stringify(makeSession(now() + 3600, "old-refreshed")), { status: 200 }));

      await expect(result).resolves.toEqual(other);
      expect(getSession()).toEqual(other);
    });

    it("does not let a late rejection clear a newer sign-in", async () => {
      const { getFreshSession, getSession, setSession } = await load();
      setSession(makeSession(now() - 10, "old"));
      const respond = pendingRefresh();

      const result = getFreshSession();
      const other = makeSession(now() + 3600, "other-account");
      setSession(other);
      respond(new Response(JSON.stringify({ error: "Session expired. Please log in again." }), { status: 401 }));

      await expect(result).resolves.toEqual(other);
      expect(getSession()).toEqual(other);
    });
  });
});
