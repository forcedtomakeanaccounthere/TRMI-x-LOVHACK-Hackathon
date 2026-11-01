import { describe, expect, it } from "vitest";
import { draftContent } from "./notebook";
import type { Annotation } from "./types";

const mark = (quote: string): Extract<Annotation, { kind: "highlight" | "underline" }> => ({
  id: "m1",
  doc: "doc1",
  block: "b4",
  kind: "highlight",
  start: 0,
  end: quote.length,
  quote,
  color: "#facc15",
  author: { id: "u1", name: "Ana", color: "#ef4444" },
  at: "2026-11-01T00:00:00Z",
});

describe("draftContent", () => {
  it("writes the recap as sections, linking quotes the group highlighted to their source", () => {
    const content = draftContent(
      {
        one_line_summary: "Encoders measure motion.",
        key_points: ["Incremental vs absolute", " "],
        what_the_group_cared_about: [
          { quote: "outputs a unique binary code", who: ["Ana"], why: "No reference point needed" },
          { quote: "never highlighted", who: [], why: "" },
        ],
        disagreements: [],
        open_questions: ["Which is cheaper?"],
        next_steps: [],
      },
      [mark("Absolute encoders: outputs a unique binary code for each angle")],
    );
    const types = content.map((n) => n.type);
    expect(types).toEqual([
      "heading",
      "paragraph",
      "heading",
      "bulletList",
      "heading",
      "sourceQuote",
      "paragraph",
      "blockquote",
      "heading",
      "bulletList",
    ]);
    expect(content[5]!.attrs).toMatchObject({ doc: "doc1", block: "b4", author: "Ana" });
    expect(content[3]!.content).toHaveLength(1); // the blank key point is left out
    expect(JSON.stringify(content)).not.toContain('"text":""'); // ProseMirror refuses empty text
  });
});
