import { TrackSource } from "livekit-server-sdk";
import { describe, expect, it } from "vitest";
import {
  canEndHuddle,
  canInviteToHuddle,
  canPostSegments,
  canReadHuddle,
  canRefreshHuddleNotes,
  canStartHuddle,
} from "../../src/lib/huddles";
import { grantsFor, isLiveKitConfigured, mintToken } from "../../src/lib/livekit";
import { HttpError } from "../../src/middleware/error";

describe("LiveKit grantsFor", () => {
  it("grants publishing to owner, admin, and editor", () => {
    for (const role of ["owner", "admin", "editor"] as const) {
      const grant = grantsFor(role, "lr_room1_h1");
      expect(grant.roomJoin).toBe(true);
      expect(grant.room).toBe("lr_room1_h1");
      expect(grant.canSubscribe).toBe(true);
      expect(grant.canPublish).toBe(true);
      expect(grant.canPublishData).toBe(true);
      expect(grant.canPublishSources).toEqual([TrackSource.MICROPHONE]);
      expect(grant.canUpdateOwnMetadata).toBe(false);
    }
  });

  it("restricts viewer to listen-only", () => {
    const grant = grantsFor("viewer", "lr_room1_h1");
    expect(grant.roomJoin).toBe(true);
    expect(grant.room).toBe("lr_room1_h1");
    expect(grant.canSubscribe).toBe(true);
    expect(grant.canPublish).toBe(false);
    expect(grant.canPublishData).toBe(false);
    expect(grant.canPublishSources).toEqual([TrackSource.MICROPHONE]);
    expect(grant.canUpdateOwnMetadata).toBe(false);
  });
});

describe("Huddle access rules", () => {
  it("allows all participants to start a room-wide huddle, but only editors+ for private", () => {
    expect(canStartHuddle("viewer", "all")).toBe(true);
    expect(canStartHuddle("editor", "all")).toBe(true);
    expect(canStartHuddle("admin", "all")).toBe(true);
    expect(canStartHuddle("owner", "all")).toBe(true);

    expect(canStartHuddle("viewer", "private")).toBe(false);
    expect(canStartHuddle("editor", "private")).toBe(true);
    expect(canStartHuddle("admin", "private")).toBe(true);
    expect(canStartHuddle("owner", "private")).toBe(true);
  });

  it("allows inviting only on private huddles for editors+", () => {
    expect(canInviteToHuddle("viewer", "private")).toBe(false);
    expect(canInviteToHuddle("editor", "private")).toBe(true);
    expect(canInviteToHuddle("admin", "private")).toBe(true);
    expect(canInviteToHuddle("owner", "private")).toBe(true);

    expect(canInviteToHuddle("owner", "all")).toBe(false);
    expect(canInviteToHuddle("admin", "all")).toBe(false);
  });

  it("allows creator or admins/owners to end a huddle", () => {
    expect(canEndHuddle("u1", "viewer", "u1")).toBe(true);
    expect(canEndHuddle("u1", "editor", "u1")).toBe(true);
    expect(canEndHuddle("u2", "viewer", "u1")).toBe(false);
    expect(canEndHuddle("u2", "editor", "u1")).toBe(false);
    expect(canEndHuddle("u2", "admin", "u1")).toBe(true);
    expect(canEndHuddle("u2", "owner", "u1")).toBe(true);
  });

  it("checks permissions and time window for posting segments", () => {
    const now = 1_000_000;
    expect(canPostSegments("viewer", true, null, now)).toBe(false);
    expect(canPostSegments("editor", false, null, now)).toBe(false);
    expect(canPostSegments("editor", true, null, now)).toBe(true);

    // Ended 30s ago (<60s) -> allowed
    expect(canPostSegments("editor", true, new Date(now - 30_000).toISOString(), now)).toBe(true);
    // Ended 70s ago (>=60s) -> forbidden
    expect(canPostSegments("editor", true, new Date(now - 70_000).toISOString(), now)).toBe(false);
  });

  it("controls reading and refreshing notes", () => {
    expect(canReadHuddle("all", false)).toBe(true);
    expect(canReadHuddle("private", false)).toBe(false);
    expect(canReadHuddle("private", true)).toBe(true);

    const settingsWithAi = { allowGuests: true, guestRole: "editor" as const, memberRole: "editor" as const, viewersUseAi: true };
    const settingsNoAi = { allowGuests: true, guestRole: "editor" as const, memberRole: "editor" as const, viewersUseAi: false };

    expect(canRefreshHuddleNotes("editor", settingsWithAi, "all", false)).toBe(true);
    expect(canRefreshHuddleNotes("viewer", settingsWithAi, "all", false)).toBe(true);
    expect(canRefreshHuddleNotes("viewer", settingsNoAi, "all", false)).toBe(false);
    expect(canRefreshHuddleNotes("editor", settingsWithAi, "private", false)).toBe(false);
    expect(canRefreshHuddleNotes("editor", settingsWithAi, "private", true)).toBe(true);
  });
});

describe("LiveKit configuration check", () => {
  it("detects when LiveKit credentials are missing and errors appropriately", async () => {
    const origUrl = process.env.LIVEKIT_URL;
    const origKey = process.env.LIVEKIT_API_KEY;
    const origSecret = process.env.LIVEKIT_API_SECRET;

    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;

    try {
      expect(isLiveKitConfigured()).toBe(false);
      await expect(mintToken("user-1", "User 1", "editor", "lr_room_h1")).rejects.toThrowError(HttpError);
    } finally {
      if (origUrl) process.env.LIVEKIT_URL = origUrl;
      if (origKey) process.env.LIVEKIT_API_KEY = origKey;
      if (origSecret) process.env.LIVEKIT_API_SECRET = origSecret;
    }
  });
});
