import { describe, expect, it } from "vitest";
import {
  AuthSession,
  RecapRequest,
  CreateLinkRoomRequest,
  CreateTextRoomRequest,
  LoginRequest,
  NewHighlight,
  NewComment,
  RefreshRequest,
  ResendVerificationRequest,
  Room,
  SignupRequest,
} from "../src";

describe("SignupRequest", () => {
  const valid = { email: "abhishek@example.com", password: "x".repeat(8), name: "abhishek" };

  it("accepts a valid signup", () => {
    expect(SignupRequest.parse(valid)).toEqual(valid);
  });

  it("trims and lowercases the email and trims the name", () => {
    expect(SignupRequest.parse({ ...valid, email: "  abhishek@Example.COM ", name: "  abhishek  " })).toMatchObject({
      email: "abhishek@example.com",
      name: "abhishek",
    });
  });

  it("does not trim the password", () => {
    expect(SignupRequest.parse({ ...valid, password: "  spaced  " }).password).toBe("  spaced  ");
  });

  it.each([
    ["email is not an email", { email: "abhishek" }],
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

  describe("NewHighlight (matches the database checks)", () => {
    const highlight = {
      room_id: "abcd1234",
      block_id: "b3",
      start_offset: 4,
      end_offset: 10,
      quote: "x".repeat(1000),
      author_name: "abhishek",
      author_color: "#3b82f6",
    };

    it("accepts a quote of up to 1000 chars", () => {
      expect(NewHighlight.safeParse(highlight).success).toBe(true);
    });

    it("rejects a quote over 1000 chars", () => {
      expect(NewHighlight.safeParse({ ...highlight, quote: "x".repeat(1001) }).success).toBe(false);
    });

    it("accepts an empty range but rejects end before start", () => {
      expect(NewHighlight.safeParse({ ...highlight, end_offset: 4 }).success).toBe(true);
      const result = NewHighlight.safeParse({ ...highlight, end_offset: 3 });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["end_offset"]);
    });

    it("rejects an author name over 40 chars", () => {
      expect(NewHighlight.safeParse({ ...highlight, author_name: "x".repeat(41) }).success).toBe(false);
    });

    it.each(["b0", "b12", "p1", "p999999"])("accepts the block id %s", (block_id) => {
      expect(NewHighlight.safeParse({ ...highlight, block_id }).success).toBe(true);
    });

    it.each(["", "b", "x1", "B1", "b1 ", "b-1", "p1234567"])("rejects the block id %j", (block_id) => {
      expect(NewHighlight.safeParse({ ...highlight, block_id }).success).toBe(false);
    });

    it.each(["#0f0", "red", "#3b82f6; x: y", "url(x)"])("rejects the colour %j", (author_color) => {
      expect(NewHighlight.safeParse({ ...highlight, author_color }).success).toBe(false);
    });

    it("rejects a blank author name", () => {
      expect(NewHighlight.safeParse({ ...highlight, author_name: "   " }).success).toBe(false);
    });
  });

  describe("NewComment (matches the database checks)", () => {
    const comment = {
      room_id: "abcd1234",
      highlight_id: "8b0f7d2e-1c3a-4f5b-9d6e-7a8b9c0d1e2f",
      author_name: "abhishek",
      author_color: "#3b82f6",
      body: "x".repeat(2000),
    };

    it("limits the body to 2000 chars", () => {
      expect(NewComment.safeParse(comment).success).toBe(true);
      expect(NewComment.safeParse({ ...comment, body: "x".repeat(2001) }).success).toBe(false);
    });

    it("rejects a body of only whitespace", () => {
      expect(NewComment.safeParse({ ...comment, body: " \n\t " }).success).toBe(false);
    });
  });
});

describe("RecapRequest", () => {
  it("trims the name and allows up to 40 characters", () => {
    expect(RecapRequest.parse({ name: "  Priya " })).toEqual({ name: "Priya" });
    expect(RecapRequest.parse({ name: "x".repeat(40) }).name).toHaveLength(40);
    expect(RecapRequest.safeParse({ name: "x".repeat(41) }).success).toBe(false);
  });

  it("treats a missing or blank name as none", () => {
    expect(RecapRequest.parse({})).toEqual({ name: undefined });
    expect(RecapRequest.parse({ name: " \n\t " })).toEqual({ name: undefined });
  });
});
