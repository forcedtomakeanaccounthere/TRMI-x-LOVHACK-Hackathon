import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
};

describe("api.auth", () => {
  it("signup posts JSON without a token", async () => {
    await api.auth.signup({ email: "a@b.co", password: "x".repeat(8), name: "A" });
    const { url, init, headers } = lastCall();

    expect(url).toBe("http://localhost:4000/api/auth/signup");
    expect(init.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.has("Authorization")).toBe(false);
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.co", password: "x".repeat(8), name: "A" });
  });

  it("login returns the session", async () => {
    const session = { access_token: "a", refresh_token: "r", expires_at: 1, user: { id: "u", email: "e", name: "n" } };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }));

    await expect(api.auth.login({ email: "a@b.co", password: "x" })).resolves.toEqual(session);
    expect(lastCall().url).toBe("http://localhost:4000/api/auth/login");
  });

  it("surfaces the backend error message", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Please verify your email first" }), { status: 403 }),
    );
    await expect(api.auth.login({ email: "a@b.co", password: "x" })).rejects.toThrow(
      "Please verify your email first",
    );
  });

  it("exposes the HTTP status on the error", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Please verify your email first" }), { status: 403 }),
    );
    const err = await api.auth.login({ email: "a@b.co", password: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
  });

  it("falls back to the status code when the body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("Bad gateway", { status: 502 }));
    await expect(api.auth.refresh("r")).rejects.toThrow("Request failed (502)");
  });

  it("me sends the bearer token", async () => {
    await api.auth.me("tok");
    const { url, init, headers } = lastCall();
    expect(url).toBe("http://localhost:4000/api/auth/me");
    expect(init.method).toBe("GET");
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("logout sends the bearer token and ignores the empty reply", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.auth.logout("tok")).resolves.toBeUndefined();
    expect(lastCall().headers.get("Authorization")).toBe("Bearer tok");
  });

  it("logout rejects when the backend could not revoke the session", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Could not log out. Please try again." }), { status: 502 }),
    );
    await expect(api.auth.logout("tok")).rejects.toThrow("Could not log out. Please try again.");
  });

  it("logout rejects an expired token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }));
    await expect(api.auth.logout("tok")).rejects.toThrow("Not authenticated");
  });

  it("resendVerification posts the email", async () => {
    await api.auth.resendVerification("a@b.co");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ email: "a@b.co" });
  });
});

describe("room creation", () => {
  it("createTextRoom keeps Content-Type and adds the token", async () => {
    await api.createTextRoom({ text: "hi" }, "tok");
    const { url, headers } = lastCall();
    expect(url).toBe("http://localhost:4000/api/rooms/text");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("createPdfRoom sends multipart form data with the token", async () => {
    await api.createPdfRoom(new File(["%PDF"], "paper.pdf", { type: "application/pdf" }), "tok");
    const { init, headers } = lastCall();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
    expect(headers.get("Authorization")).toBe("Bearer tok");
    // The browser must set the multipart boundary itself.
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("recap needs no token", async () => {
    await api.recap("abcd1234");
    expect(lastCall().url).toBe("http://localhost:4000/api/rooms/abcd1234/recap");
    expect(lastCall().headers.has("Authorization")).toBe(false);
  });

  it("recap sends the name to show as the author", async () => {
    await api.recap("abcd1234", "Priya");
    expect(lastCall().init.method).toBe("POST");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ name: "Priya" });
  });
});

describe("api dashboard", () => {
  it("myRooms sends only the filters that are set, with the token", async () => {
    await api.myRooms({ status: "deleted", limit: 100, q: undefined }, "tok");
    const { url, init, headers } = lastCall();

    expect(url).toBe("http://localhost:4000/api/me/rooms?status=deleted&limit=100");
    expect(init.method).toBe("GET");
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("joinRoom posts to the room's join route", async () => {
    await api.joinRoom("x7Kp2qLm", "tok");
    const { url, init } = lastCall();
    expect(url).toBe("http://localhost:4000/api/rooms/x7Kp2qLm/join");
    expect(init.method).toBe("POST");
  });

  it("updateRoom sends a JSON PATCH to the room", async () => {
    await api.updateRoom("x7Kp2qLm", { status: "archived" }, "tok");
    const { url, init, headers } = lastCall();
    expect(url).toBe("http://localhost:4000/api/rooms/x7Kp2qLm");
    expect(init.method).toBe("PATCH");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ status: "archived" });
  });

  it("deleteRoom sends a DELETE to the room", async () => {
    await api.deleteRoom("x7Kp2qLm", "tok");
    const { url, init, headers } = lastCall();
    expect(url).toBe("http://localhost:4000/api/rooms/x7Kp2qLm");
    expect(init.method).toBe("DELETE");
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("restoreRoom posts to the room's restore route", async () => {
    await api.restoreRoom("x7Kp2qLm", "tok");
    const { url, init } = lastCall();
    expect(url).toBe("http://localhost:4000/api/rooms/x7Kp2qLm/restore");
    expect(init.method).toBe("POST");
  });
});
