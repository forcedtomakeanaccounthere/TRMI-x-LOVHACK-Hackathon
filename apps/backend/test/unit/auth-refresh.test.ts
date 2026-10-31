import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { isRejectedRefreshToken } from "../../src/routes/auth";

// /api/auth/refresh answers 401 only for these, which makes the frontend forget the session.
describe("isRejectedRefreshToken", () => {
  it.each([
    ["an unknown refresh token", new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found")],
    ["a reused refresh token", new AuthApiError("Invalid Refresh Token: Already Used", 400, "refresh_token_already_used")],
    ["an expired session", new AuthApiError("Session expired", 403, "session_expired")],
    ["a revoked session", new AuthSessionMissingError()],
  ])("rejects %s", (_, error) => {
    expect(isRejectedRefreshToken(error)).toBe(true);
  });

  it.each([
    ["Auth being unreachable", new AuthRetryableFetchError("fetch failed", 0)],
    ["a 5xx from Auth", new AuthRetryableFetchError("Bad gateway", 502)],
    ["a rate limit", new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit")],
    ["an unreadable response", new AuthUnknownError("Unexpected token <", null)],
  ])("treats %s as temporary", (_, error) => {
    expect(isRejectedRefreshToken(error)).toBe(false);
  });
});
