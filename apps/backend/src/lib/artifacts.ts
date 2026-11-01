import type { ArtifactBody, MindNode, RoomSummary, StudyData, StudyMindMapData } from "@linkroom/shared";

// Studio artifacts (POST /api/rooms/:id/artifacts) in the shape the room workspace renders
// (ArtifactBody, apps/frontend/src/components/room/types.ts). Quizzes, flashcards, mind maps and
// infographics come from apps/ai /study; summaries from the rooms' saved AI summaries.

const MAX_DEPTH = 6;

/** A mind map's flat node list as a tree. Nodes whose parent is missing are left out, and cycles end. */
export function mindMapTree(data: StudyMindMapData): MindNode {
  const root = data.nodes.find((node) => node.parent_id === null);
  if (!root) return { label: data.title || "Mind map" };
  const children = new Map<string, StudyMindMapData["nodes"]>();
  for (const node of data.nodes) {
    if (node.parent_id === null || node.id === root.id) continue;
    (children.get(node.parent_id) ?? children.set(node.parent_id, []).get(node.parent_id)!).push(node);
  }
  const seen = new Set<string>();
  const build = (node: StudyMindMapData["nodes"][number], depth: number): MindNode => {
    seen.add(node.id);
    const kids = depth < MAX_DEPTH ? (children.get(node.id) ?? []).filter((kid) => !seen.has(kid.id)) : [];
    const built = kids.map((kid) => build(kid, depth + 1));
    return built.length ? { label: node.label, children: built } : { label: node.label };
  };
  return build(root, 0);
}

export function studyToArtifact(data: StudyData): ArtifactBody {
  switch (data.kind) {
    case "quiz":
      return {
        kind: "quiz",
        questions: data.questions.map((q) => ({ q: q.question, options: q.options, answer: q.answer_index, why: q.explanation })),
      };
    case "flashcards":
      return { kind: "flashcards", cards: data.cards.map(({ front, back }) => ({ front, back })) };
    case "mindmap":
      return { kind: "mindmap", root: mindMapTree(data) };
    case "infographic":
      return {
        kind: "infographic",
        headline: data.title,
        stats: data.stats.map(({ value, label }) => ({ value, label })),
        steps: [
          ...data.sections.map((section) => ({ title: section.heading, text: section.points.join(" ") })),
          ...(data.key_takeaway ? [{ title: "Key takeaway", text: data.key_takeaway }] : []),
        ],
      };
  }
}

/**
 * One summary from several rooms' saved summaries, in the order given. With more than one, each
 * section's heading names its document.
 */
export function summariesToArtifact(summaries: { title: string; summary: RoomSummary }[]): ArtifactBody {
  const several = summaries.length > 1;
  return {
    kind: "summary",
    overview: summaries
      .map(({ title, summary }) => (several ? `${title}: ${summary.overview}` : summary.overview))
      .filter(Boolean)
      .join("\n\n"),
    sections: summaries.flatMap(({ title, summary }) =>
      summary.sections.map((section) => ({
        heading: several ? `${title} · ${section.heading}` : section.heading,
        points: section.points.map((point) => point.text),
      })),
    ),
  };
}
