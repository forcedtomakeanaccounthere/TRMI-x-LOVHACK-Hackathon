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

describe("remembered remove keys", () => {
  it("stay in this browser's storage, keyed by highlight id", async () => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;
    const { rememberRemoveKey, removeKeyFor } = await import("./docs");
    rememberRemoveKey("h1", "k1");
    expect(removeKeyFor("h1")).toBe("k1");
    expect(removeKeyFor("h2")).toBeNull();
  });
});
