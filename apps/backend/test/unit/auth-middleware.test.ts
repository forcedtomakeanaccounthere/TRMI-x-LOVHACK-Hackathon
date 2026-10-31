import type { User } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
// A plain function (not a spy) lets a test simulate a network failure: Vitest reports
// rejections from a spy's implementation as test errors even when the caller handles them.
let getUserOverride: ((token: string) => Promise<unknown>) | null = null;
vi.mock("../../src/lib/supabase", () => ({
  supabaseAdmin: () => ({ auth: { getUser: (token: string) => (getUserOverride ?? getUser)(token) } }),
}));

const { optionalAuth, requireAuth, toAuthUser } = await import("../../src/middleware/auth");

const baseUser = {
  id: "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f",
  email: "abhishek@example.com",
  email_confirmed_at: "2026-10-30T00:00:00Z",
  user_metadata: { name: "abhishek" },
} as unknown as User;

const reqWith = (authorization?: string) => ({ headers: { authorization } }) as unknown as Request;
const res = {} as Response;

// Express 5 forwards rejected promises to the error handler, so the middleware throws.
async function run(handler: typeof requireAuth, req: Request) {
  const next = vi.fn() as unknown as NextFunction;
  await handler(req, res, next);
  return next;
}

beforeEach(() => {
  getUser.mockReset();
  getUserOverride = null;
});

describe("toAuthUser", () => {
  it("uses the name from user metadata", () => {
    expect(toAuthUser(baseUser)).toEqual({ id: baseUser.id, email: "abhishek@example.com", name: "abhishek" });
  });

  it("falls back to the email local part when there is no name", () => {
    expect(toAuthUser({ ...baseUser, user_metadata: {} }).name).toBe("abhishek");
    expect(toAuthUser({ ...baseUser, user_metadata: { name: 42 } }).name).toBe("abhishek");
  });
});

describe("requireAuth", () => {
  it.each([undefined, "", "Basic abc", "Bearer ", "bearer abc"])("rejects header %j with 401", async (header) => {
    await expect(run(requireAuth, reqWith(header))).rejects.toMatchObject({ status: 401 });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects a token Supabase does not accept", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("bad jwt") });
    await expect(run(requireAuth, reqWith("Bearer nope"))).rejects.toMatchObject({ status: 401 });
    expect(getUser).toHaveBeenCalledWith("nope");
  });

  it("rejects a user whose email is not verified with 403", async () => {
    getUser.mockResolvedValue({ data: { user: { ...baseUser, email_confirmed_at: null } }, error: null });
    await expect(run(requireAuth, reqWith("Bearer tok"))).rejects.toMatchObject({
      status: 403,
      message: "Please verify your email first",
    });
  });

  it("sets req.user and req.accessToken for a verified user", async () => {
    getUser.mockResolvedValue({ data: { user: baseUser }, error: null });
    const req = reqWith("Bearer tok");
    const next = await run(requireAuth, req);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual({ id: baseUser.id, email: "abhishek@example.com", name: "abhishek" });
    expect(req.accessToken).toBe("tok");
  });
});

describe("optionalAuth", () => {
  it("continues without a user when there is no token", async () => {
    const req = reqWith();
    expect(await run(optionalAuth, req)).toHaveBeenCalledOnce();
    expect(req.user).toBeUndefined();
  });

  it("continues without a user when Supabase is unreachable", async () => {
    getUserOverride = () => Promise.reject(new Error("network down"));
    const req = reqWith("Bearer tok");
    expect(await run(optionalAuth, req)).toHaveBeenCalledOnce();
    expect(req.user).toBeUndefined();
  });

  it("ignores unverified users", async () => {
    getUser.mockResolvedValue({ data: { user: { ...baseUser, email_confirmed_at: null } }, error: null });
    const req = reqWith("Bearer tok");
    await run(optionalAuth, req);
    expect(req.user).toBeUndefined();
  });

  it("sets req.user for a verified user", async () => {
    getUser.mockResolvedValue({ data: { user: baseUser }, error: null });
    const req = reqWith("Bearer tok");
    await run(optionalAuth, req);
    expect(req.user?.id).toBe(baseUser.id);
  });
});
