import { describe, expect, it } from "vitest";
import { summaryToMarkdown, summaryToPlainText } from "../../src/lib/summary-export";
import type { RoomSummary } from "@linkroom/shared";

const mockSummary: RoomSummary = {
  overview: "This is a detailed summary overview for the room.",
  sections: [
    {
      heading: "Section One",
      points: [
        { text: "Point A with important data", source_blocks: ["b1"] },
        { text: "Point B with more evidence", source_blocks: ["b2"] },
      ],
    },
    {
      heading: "Section Two",
      points: [{ text: "Point C final conclusion", source_blocks: ["b3"] }],
    },
  ],
  key_terms: [
    { term: "LinkRoom", meaning: "Multiplayer reader for the internet", source_blocks: ["b1"] },
  ],
};

describe("Summary Exporter (lib/summary-export.ts)", () => {
  it("formats RoomSummary into clean Markdown", () => {
    const md = summaryToMarkdown("Sample Paper Deck", mockSummary);
    expect(md).toContain("# Sample Paper Deck");
    expect(md).toContain("## Overview");
    expect(md).toContain("This is a detailed summary overview");
    expect(md).toContain("## Section One");
    expect(md).toContain("- Point A with important data");
    expect(md).toContain("## Key Terms");
    expect(md).toContain("- **LinkRoom**: Multiplayer reader for the internet");
  });

  it("formats RoomSummary into clean plain text", () => {
    const txt = summaryToPlainText("Sample Paper Deck", mockSummary);
    expect(txt).toContain("SAMPLE PAPER DECK");
    expect(txt).toContain("OVERVIEW:");
    expect(txt).toContain("SECTION ONE:");
    expect(txt).toContain("* Point A with important data");
    expect(txt).toContain("KEY TERMS:");
    expect(txt).toContain("* LinkRoom: Multiplayer reader for the internet");
  });
});
