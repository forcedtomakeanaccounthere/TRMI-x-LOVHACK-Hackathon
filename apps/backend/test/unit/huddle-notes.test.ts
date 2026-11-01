import { describe, expect, it } from "vitest";
import { focusAt, resolveNotes, type FocusRecord } from "../../src/lib/huddle-notes";

describe("focusAt", () => {
  const t0 = new Date("2026-11-01T10:00:00Z");
  const t1 = new Date("2026-11-01T10:00:10Z");
  const t2 = new Date("2026-11-01T10:00:20Z");
  const t3 = new Date("2026-11-01T10:00:30Z");

  it("selects majority focus among member focus at or before segment end_at", () => {
    const segment = {
      speaker_id: "alice",
      end_at: t2,
      doc: "doc-speaker",
      block: "b0",
    };

    const history: FocusRecord[] = [
      { member_id: "bob", doc: "doc-A", block: "b1", at: t1 },
      { member_id: "charlie", doc: "doc-A", block: "b1", at: t1 },
      { member_id: "dave", doc: "doc-B", block: "b2", at: t1 },
    ];

    const result = focusAt(segment, history);
    expect(result).toEqual({ doc: "doc-A", block: "b1" });
  });

  it("falls back to speaker focus on tie", () => {
    const segment = {
      speaker_id: "alice",
      end_at: t2,
      doc: "doc-speaker",
      block: "b9",
    };

    const history: FocusRecord[] = [
      { member_id: "bob", doc: "doc-A", block: "b1", at: t1 },
      { member_id: "charlie", doc: "doc-B", block: "b2", at: t1 },
    ];

    const result = focusAt(segment, history);
    expect(result).toEqual({ doc: "doc-speaker", block: "b9" });
  });

  it("falls back to speaker focus when no member focus history exists", () => {
    const segment = {
      speaker_id: "alice",
      end_at: t2,
      doc: "doc-speaker",
      block: "b9",
    };

    const result = focusAt(segment, []);
    expect(result).toEqual({ doc: "doc-speaker", block: "b9" });
  });

  it("returns null when no member focus exists and speaker has no focus", () => {
    const segment = {
      speaker_id: "alice",
      end_at: t2,
      doc: null,
      block: null,
    };

    const result = focusAt(segment, []);
    expect(result).toBeNull();
  });

  it("ignores focus changes after segment end_at and uses latest prior focus per member", () => {
    const segment = {
      speaker_id: "alice",
      end_at: t2,
      doc: "doc-speaker",
      block: "b0",
    };

    const history: FocusRecord[] = [
      // Bob moved from B to A before t2
      { member_id: "bob", doc: "doc-B", block: "b2", at: t0 },
      { member_id: "bob", doc: "doc-A", block: "b1", at: t1 },
      // Charlie looked at A before t2
      { member_id: "charlie", doc: "doc-A", block: "b1", at: t1 },
      // Dave moved to C after t2 -> should be ignored
      { member_id: "dave", doc: "doc-B", block: "b2", at: t1 },
      { member_id: "dave", doc: "doc-C", block: "b3", at: t3 },
    ];

    // Bob: A:b1, Charlie: A:b1, Dave: B:b2 -> A:b1 has 2 votes vs 1
    const result = focusAt(segment, history);
    expect(result).toEqual({ doc: "doc-A", block: "b1" });
  });
});

describe("resolveNotes", () => {
  const segments = [
    { id: "s1", start_at: "2026-11-01T10:00:00Z", anchor: { doc: "doc1", block: "b1" } },
    { id: "s2", start_at: "2026-11-01T10:00:15Z", anchor: { doc: "doc1", block: "b1" } },
    { id: "s3", start_at: "2026-11-01T10:00:30Z", anchor: { doc: "doc2", block: "b5" } },
  ];

  it("drops bad/unknown segment ids and drops points with none left", () => {
    const raw = {
      summary: "Meeting summary",
      key_points: [
        { text: "Good point", segment_ids: ["s1", "unknown_1"] },
        { text: "Orphan point", segment_ids: ["unknown_2", "unknown_3"] },
      ],
      decisions: [],
      action_items: [],
      open_questions: [],
    };

    const notes = resolveNotes(raw, segments);
    expect(notes.key_points).toHaveLength(1);
    expect(notes.key_points[0]!.text).toBe("Good point");
    expect(notes.key_points[0]!.segment_ids).toEqual(["s1"]);
    expect(notes.key_points[0]!.at).toBe("2026-11-01T10:00:00Z");
  });

  it("picks the most common anchor and sets at to first cited segment start_at", () => {
    const raw = {
      summary: "Meeting summary",
      key_points: [
        {
          text: "Decided on architecture",
          segment_ids: ["s3", "s1", "s2"], // s1: doc1:b1, s2: doc1:b1, s3: doc2:b5
        },
      ],
      decisions: [],
      action_items: [
        {
          text: "Write migrations",
          owner: "Alice",
          segment_ids: ["s3"],
        },
      ],
      open_questions: [],
    };

    const notes = resolveNotes(raw, segments);
    expect(notes.key_points[0]!.anchor).toEqual({ doc: "doc1", block: "b1" });
    // First cited segment by time is s1 (10:00:00Z)
    expect(notes.key_points[0]!.at).toBe("2026-11-01T10:00:00Z");

    expect(notes.action_items[0]!.anchor).toEqual({ doc: "doc2", block: "b5" });
    expect(notes.action_items[0]!.owner).toBe("Alice");
    expect(notes.action_items[0]!.at).toBe("2026-11-01T10:00:30Z");
  });
});
