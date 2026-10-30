import { describe, expect, it } from "vitest";
import {
  AuthSession,
  CreateLinkRoomRequest,
  CreateTextRoomRequest,
  LoginRequest,
  NewComment,
  RefreshRequest,
  ResendVerificationRequest,
  Room,
  SignupRequest,
} from "../src";

describe("SignupRequest", () => {
  const valid = { email: "priya@example.com", password: "x".repeat(8), name: "Priya" };

  it("accepts a valid signup", () => {
    expect(SignupRequest.parse(valid)).toEqual(valid);
  });

  it("trims and lowercases the email and trims the name", () => {
    expect(SignupRequest.parse({ ...valid, email: "  Priya@Example.COM ", name: "  Priya  " })).toMatchObject({
      email: "priya@example.com",
      name: "Priya",
    });
  });

  it("does not trim the password", () => {
    expect(SignupRequest.parse({ ...valid, password: "  spaced  " }).password).toBe("  spaced  ");
  });

  it.each([
    ["email is not an email", { email: "priya" }],
    ["password is 7 chars", { password: "x".repeat(7) }],
    ["password is over 72 chars (bcrypt limit)", { password: "x".repeat(73) }],
    ["name is blank", { name: "   " }],
    ["name is over 40 chars", { name: "x".repeat(41) }],
  ])("rejects when %s", (_case, patch) => {
    expect(SignupRequest.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("gives a readable password message", () => {
    const result = SignupRequest.safeParse({ ...valid, password: "short" });
    expect(result.error?.issues[0]?.message).toBe("Password must be at least 8 characters");
  });

  it.each(["email", "password", "name"])("requires %s", (field) => {
    const body: Record<string, string> = { ...valid };
    delete body[field];
    expect(SignupRequest.safeParse(body).success).toBe(false);
  });
});

describe("LoginRequest", () => {
  it("accepts any non-empty password so old passwords still log in", () => {
    expect(LoginRequest.parse({ email: "A@b.co", password: "x" })).toEqual({ email: "a@b.co", password: "x" });
  });

  it("rejects an empty password", () => {
    expect(LoginRequest.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("other auth requests", () => {
  it("ResendVerificationRequest normalises the email", () => {
    expect(ResendVerificationRequest.parse({ email: " X@Y.io" })).toEqual({ email: "x@y.io" });
  });

  it("RefreshRequest needs a token", () => {
    expect(RefreshRequest.safeParse({ refresh_token: "" }).success).toBe(false);
    expect(RefreshRequest.parse({ refresh_token: "abc" })).toEqual({ refresh_token: "abc" });
  });
});

describe("AuthSession", () => {
  const session = {
    access_token: "a",
    refresh_token: "r",
    expires_at: 1_800_000_000,
    user: { id: "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f", email: "a@b.co", name: "A" },
  };

  it("accepts the shape the backend returns", () => {
    expect(AuthSession.parse(session)).toEqual(session);
  });

  it("rejects a non-uuid user id", () => {
    expect(AuthSession.safeParse({ ...session, user: { ...session.user, id: "1" } }).success).toBe(false);
  });
});

describe("room contracts", () => {
  it("Room carries created_by (nullable for rooms made before auth)", () => {
    const room = {
      id: "abcd1234",
      kind: "link",
      source_url: null,
      title: null,
      content_html: null,
      pdf_path: null,
      created_by: null,
      created_at: "2026-10-30T00:00:00Z",
    };
    expect(Room.parse(room)).toEqual(room);
    expect(Room.safeParse({ ...room, created_by: "not-a-uuid" }).success).toBe(false);
  });

  it("CreateLinkRoomRequest needs a URL", () => {
    expect(CreateLinkRoomRequest.safeParse({ url: "not a url" }).success).toBe(false);
  });

  it("CreateTextRoomRequest limits title and text", () => {
    expect(CreateTextRoomRequest.safeParse({ text: "" }).success).toBe(false);
    expect(CreateTextRoomRequest.safeParse({ text: "x", title: "t".repeat(201) }).success).toBe(false);
  });

  it("NewComment limits the body to 2000 chars", () => {
    const comment = {
      room_id: "abcd1234",
      highlight_id: "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f",
      author_name: "Priya",
      author_color: "#3b82f6",
      body: "x".repeat(2000),
    };
    expect(NewComment.safeParse(comment).success).toBe(true);
    expect(NewComment.safeParse({ ...comment, body: "x".repeat(2001) }).success).toBe(false);
  });
});
