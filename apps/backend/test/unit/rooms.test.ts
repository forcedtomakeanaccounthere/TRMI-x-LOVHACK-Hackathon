import { describe, expect, it } from "vitest";
import { titlePattern } from "../../src/routes/rooms";

describe("titlePattern", () => {
  it("matches anywhere in the title", () => {
    expect(titlePattern("paper")).toBe("%paper%");
  });

  it("escapes LIKE wildcards and the escape character", () => {
    expect(titlePattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });
});
