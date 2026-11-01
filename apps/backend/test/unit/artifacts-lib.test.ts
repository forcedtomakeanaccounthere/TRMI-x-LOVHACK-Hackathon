import { ArtifactBody, StudyData } from "@linkroom/shared";
import { describe, expect, it } from "vitest";
import { mindMapTree, studyToArtifact, summariesToArtifact } from "../../src/lib/artifacts";

// apps/ai /study output and saved room summaries, turned into the room workspace's ArtifactBody.

describe("studyToArtifact", () => {
  it("maps a quiz's questions, options, answer and explanation", () => {
    const body = studyToArtifact(
      StudyData.parse({
        kind: "quiz",
        title: "Q",
        questions: [{ question: "2+2?", options: ["3", "4"], answer_index: 1, explanation: "Arithmetic.", source_id: null }],
      }),
    );
    expect(body).toEqual({ kind: "quiz", questions: [{ q: "2+2?", options: ["3", "4"], answer: 1, why: "Arithmetic." }] });
    expect(ArtifactBody.safeParse(body).success).toBe(true);
  });

  it("keeps flashcards' fronts and backs only", () => {
    const body = studyToArtifact(StudyData.parse({ kind: "flashcards", title: "F", cards: [{ front: "a", back: "b", source_id: "r1" }] }));
    expect(body).toEqual({ kind: "flashcards", cards: [{ front: "a", back: "b" }] });
  });

  it("turns an infographic's sections into steps and ends with the takeaway", () => {
    const body = studyToArtifact(
      StudyData.parse({
        kind: "infographic",
        title: "Cells",
        subtitle: "s",
        stats: [{ label: "Phases", value: "4", source_id: null }],
        sections: [{ heading: "Prophase", points: ["Chromosomes condense.", "Spindle forms."], source_id: null }],
        key_takeaway: "Division copies DNA.",
      }),
    );
    expect(body).toEqual({
      kind: "infographic",
      headline: "Cells",
      stats: [{ value: "4", label: "Phases" }],
      steps: [
        { title: "Prophase", text: "Chromosomes condense. Spindle forms." },
        { title: "Key takeaway", text: "Division copies DNA." },
      ],
    });
  });
});

describe("mindMapTree", () => {
  const node = (id: string, parent: string | null, label = id) => ({ id, label, parent_id: parent, source_id: null });

  it("builds the tree from the flat list, dropping orphans", () => {
    const tree = mindMapTree({
      kind: "mindmap",
      title: "T",
      nodes: [node("r", null, "Root"), node("a", "r"), node("b", "r"), node("a1", "a"), node("x", "missing")],
    });
    expect(tree).toEqual({ label: "Root", children: [{ label: "a", children: [{ label: "a1" }] }, { label: "b" }] });
  });

  it("stops at a cycle instead of looping forever", () => {
    const tree = mindMapTree({ kind: "mindmap", title: "T", nodes: [node("r", null), node("a", "r"), node("b", "a"), node("a", "b")] });
    expect(JSON.stringify(tree).length).toBeLessThan(500);
  });

  it("falls back to the title when there is no root", () => {
    expect(mindMapTree({ kind: "mindmap", title: "Lonely", nodes: [node("a", "b")] })).toEqual({ label: "Lonely" });
  });

  it("caps the depth", () => {
    const nodes = [node("n0", null), ...Array.from({ length: 20 }, (_, i) => node(`n${i + 1}`, `n${i}`))];
    let depth = 0;
    for (let at = mindMapTree({ kind: "mindmap", title: "T", nodes }); at.children; at = at.children[0]!) depth++;
    expect(depth).toBe(6);
  });
});

describe("summariesToArtifact", () => {
  const summary = (overview: string, heading: string) => ({
    overview,
    sections: [{ heading, points: [{ text: `${heading} point`, source_blocks: ["b0"] }] }],
    key_terms: [],
  });

  it("uses one room's summary as it is", () => {
    expect(summariesToArtifact([{ title: "Bio", summary: summary("About cells.", "Mitosis") }])).toEqual({
      kind: "summary",
      overview: "About cells.",
      sections: [{ heading: "Mitosis", points: ["Mitosis point"] }],
    });
  });

  it("names each document when joining several", () => {
    const body = summariesToArtifact([
      { title: "Bio", summary: summary("About cells.", "Mitosis") },
      { title: "Chem", summary: summary("About atoms.", "Bonds") },
    ]);
    expect(body).toMatchObject({
      overview: "Bio: About cells.\n\nChem: About atoms.",
      sections: [{ heading: "Bio · Mitosis" }, { heading: "Chem · Bonds" }],
    });
  });
});
