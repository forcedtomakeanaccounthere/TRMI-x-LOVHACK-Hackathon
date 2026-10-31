import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashRemoveKey, newRemoveKey } from "./docs";

describe("highlight remove keys", () => {
  it("are random and long enough for remove_highlight", () => {
    const a = newRemoveKey();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(newRemoveKey()).not.toBe(a);
  });

  it("hash to the hex SHA-256 that the database compares with", async () => {
    const key = newRemoveKey();
    expect(await hashRemoveKey(key)).toBe(createHash("sha256").update(key, "utf8").digest("hex"));
  });
});
