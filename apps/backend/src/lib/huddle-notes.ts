import {
  HuddleNotesData,
  type HuddleNotePoint,
  type HuddleNotePointData,
  type HuddleNotes,
} from "@linkroom/shared";
import { HttpError } from "../middleware/error";
import { callAi } from "./ai";
import { pingHuddles } from "./huddles";
import { roomScope } from "./sources";
import { supabaseAdmin } from "./supabase";

// In-process set of huddles currently generating notes
const running = new Set<string>();

const HUDDLE_NOTES_TIMEOUT_MS = 120_000;

export type FocusRecord = {
  member_id: string;
  doc: string;
  block: string;
  at: string | Date;
};

export type SegmentFocusInput = {
  speaker_id?: string;
  end_at: string | Date;
  doc?: string | null;
  block?: string | null;
};

/**
 * Computes the anchor for a segment.
 * Majority {doc, block} among all huddle members' latest focus at the segment's end_at;
 * tie or none -> the speaker's own doc/block.
 */
export function focusAt(
  segment: SegmentFocusInput,
  focusHistory: FocusRecord[],
): { doc: string; block: string } | null {
  const endMs = new Date(segment.end_at).getTime();

  // Find the latest focus for each member at or before segment.end_at
  const latestByMember = new Map<string, { doc: string; block: string; atMs: number }>();
  for (const f of focusHistory) {
    const fAtMs = new Date(f.at).getTime();
    if (fAtMs <= endMs) {
      const existing = latestByMember.get(f.member_id);
      if (!existing || fAtMs > existing.atMs) {
        latestByMember.set(f.member_id, { doc: f.doc, block: f.block, atMs: fAtMs });
      }
    }
  }

  const speakerFocus = segment.doc && segment.block ? { doc: segment.doc, block: segment.block } : null;

  if (latestByMember.size === 0) {
    return speakerFocus;
  }

  // Count occurrences of each {doc, block}
  const counts = new Map<string, { doc: string; block: string; count: number }>();
  for (const item of latestByMember.values()) {
    const key = `${item.doc}:${item.block}`;
    const curr = counts.get(key);
    if (curr) {
      curr.count++;
    } else {
      counts.set(key, { doc: item.doc, block: item.block, count: 1 });
    }
  }

  let maxCount = 0;
  let topItems: Array<{ doc: string; block: string }> = [];
  for (const item of counts.values()) {
    if (item.count > maxCount) {
      maxCount = item.count;
      topItems = [{ doc: item.doc, block: item.block }];
    } else if (item.count === maxCount) {
      topItems.push({ doc: item.doc, block: item.block });
    }
  }

  // Majority check: strictly one top item with highest count
  if (topItems.length === 1 && topItems[0]) {
    return topItems[0];
  }

  // Tie -> fallback to speaker focus
  return speakerFocus;
}

export type SegmentInfo = {
  id: string;
  start_at: string;
  anchor: { doc: string; block: string } | null;
};

/**
 * Validates and resolves raw notes returned by AI:
 * - Drops unknown segment ids.
 * - Drops points with none left.
 * - Each point's anchor = most common anchor of its cited segments.
 * - Each point's at = first cited segment's start_at.
 */
export function resolveNotes(
  rawNotes: HuddleNotesData,
  segments: SegmentInfo[],
): HuddleNotes {
  const segmentMap = new Map<string, SegmentInfo>(segments.map((s) => [s.id, s]));

  const resolvePointList = (points: HuddleNotePointData[]): HuddleNotePoint[] => {
    const resolved: HuddleNotePoint[] = [];

    for (const point of points) {
      const validSids = point.segment_ids.filter((id) => segmentMap.has(id));
      if (validSids.length === 0) continue;

      const citedSegments = validSids.map((id) => segmentMap.get(id)!);
      // Sort cited segments by start_at ascending to find the earliest
      citedSegments.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
      const at = citedSegments[0]!.start_at;

      // Find most common anchor among cited segments
      const anchorCounts = new Map<
        string,
        { anchor: { doc: string; block: string }; count: number; firstIndex: number }
      >();
      for (let i = 0; i < citedSegments.length; i++) {
        const anc = citedSegments[i]!.anchor;
        if (anc) {
          const key = `${anc.doc}:${anc.block}`;
          const existing = anchorCounts.get(key);
          if (existing) {
            existing.count++;
          } else {
            anchorCounts.set(key, { anchor: anc, count: 1, firstIndex: i });
          }
        }
      }

      let bestAnchor: { doc: string; block: string } | null = null;
      let maxCount = 0;
      let earliestIdx = Infinity;
      for (const item of anchorCounts.values()) {
        if (item.count > maxCount || (item.count === maxCount && item.firstIndex < earliestIdx)) {
          maxCount = item.count;
          earliestIdx = item.firstIndex;
          bestAnchor = item.anchor;
        }
      }

      resolved.push({
        text: point.text,
        owner: point.owner ?? undefined,
        segment_ids: validSids,
        anchor: bestAnchor,
        at,
      });
    }

    return resolved;
  };

  return {
    summary: rawNotes.summary,
    key_points: resolvePointList(rawNotes.key_points),
    decisions: resolvePointList(rawNotes.decisions),
    action_items: resolvePointList(rawNotes.action_items),
    open_questions: resolvePointList(rawNotes.open_questions),
  };
}

/**
 * Background runner to generate notes for a huddle.
 */
export async function processNotes(huddleId: string): Promise<void> {
  if (running.has(huddleId)) return;
  running.add(huddleId);

  const db = supabaseAdmin();
  let roomId: string | null = null;

  try {
    const { data: huddle, error: hErr } = await db
      .from("huddles")
      .select("*")
      .eq("id", huddleId)
      .maybeSingle();
    if (hErr) throw hErr;
    if (!huddle) return;
    roomId = huddle.room_id;

    const { error: genErr } = await db
      .from("huddles")
      .update({ notes_status: "generating", notes_error: null })
      .eq("id", huddleId);
    if (genErr) throw genErr;
    await pingHuddles(huddle.room_id);

    const { data: roomRow, error: roomErr } = await db
      .from("rooms")
      .select("title")
      .eq("id", huddle.room_id)
      .maybeSingle();
    if (roomErr) throw roomErr;
    const roomTitle = (roomRow?.title?.trim() || "Voice huddle").slice(0, 300);

    const { data: segRows, error: sErr } = await db
      .from("huddle_segments")
      .select("id, speaker_id, speaker_name, text, start_at, end_at, doc, block, seq")
      .eq("huddle_id", huddleId)
      .order("seq", { ascending: true });
    if (sErr) throw sErr;

    const { data: focusRows, error: fErr } = await db
      .from("huddle_focus")
      .select("member_id, doc, block, at")
      .eq("huddle_id", huddleId)
      .order("at", { ascending: true });
    if (fErr) throw fErr;

    // Cap ~800 segments, ~60k chars, most recent kept
    let rawSegments = (segRows ?? []).slice(-800);
    let charCount = 0;
    const keptSegments: typeof rawSegments = [];
    for (let i = rawSegments.length - 1; i >= 0; i--) {
      const s = rawSegments[i];
      if (!s) continue;
      if (charCount + s.text.length > 60_000 && keptSegments.length > 0) break;
      charCount += s.text.length;
      keptSegments.unshift(s);
    }
    rawSegments = keptSegments;

    if (rawSegments.length === 0) {
      const emptyNotes: HuddleNotes = {
        summary: "No captions were recorded for this huddle.",
        key_points: [],
        decisions: [],
        action_items: [],
        open_questions: [],
      };
      const { data: latestNote, error: verErr } = await db
        .from("huddle_notes")
        .select("version")
        .eq("huddle_id", huddleId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (verErr) throw verErr;

      const nextVersion = (latestNote?.version ?? 0) + 1;
      const { error: insErr } = await db.from("huddle_notes").insert({
        huddle_id: huddleId,
        version: nextVersion,
        notes: emptyNotes,
      });
      if (insErr) throw insErr;

      const { error: readyErr } = await db
        .from("huddles")
        .update({ notes_status: "ready", notes_error: null })
        .eq("id", huddleId);
      if (readyErr) throw readyErr;
      await pingHuddles(huddle.room_id);
      return;
    }

    const focusHistory = (focusRows ?? []) as FocusRecord[];
    const segmentsWithAnchors = rawSegments.map((s) => ({
      id: s.id,
      speaker: s.speaker_name,
      text: s.text,
      start_at: s.start_at,
      anchor: focusAt(s, focusHistory),
    }));

    // Excerpts for anchored blocks from roomScope documents
    const allowedDocs = new Set(await roomScope(huddle.room_id, null));
    const anchoredBlocksByDoc = new Map<string, Set<string>>();
    for (const s of segmentsWithAnchors) {
      if (s.anchor && allowedDocs.has(s.anchor.doc)) {
        const set = anchoredBlocksByDoc.get(s.anchor.doc) ?? new Set<string>();
        set.add(s.anchor.block);
        anchoredBlocksByDoc.set(s.anchor.doc, set);
      }
    }

    const blockMap = new Map<string, string>();
    for (const [docId, blocksSet] of anchoredBlocksByDoc.entries()) {
      const blockArr = Array.from(blocksSet);
      const { data: chunkRows, error: cErr } = await db
        .from("chunks")
        .select("block_ids, content")
        .eq("room_id", docId)
        .overlaps("block_ids", blockArr);
      if (cErr) {
        console.warn(`[huddle-notes] Failed to load chunks for doc ${docId}:`, cErr);
        continue;
      }
      for (const chunk of chunkRows ?? []) {
        for (const b of (chunk.block_ids as string[])) {
          if (blocksSet.has(b)) {
            const key = `${docId}:${b}`;
            if (!blockMap.has(key)) {
              blockMap.set(key, (chunk.content as string).slice(0, 1500));
            }
          }
        }
      }
    }

    const aiSegments = segmentsWithAnchors.map((s) => ({
      id: s.id,
      speaker: s.speaker.slice(0, 40),
      text: s.text,
      block_key: s.anchor ? `${s.anchor.doc}:${s.anchor.block}` : null,
    }));

    const aiBlocks = Array.from(blockMap.entries())
      .slice(0, 200)
      .map(([key, excerpt]) => ({ key, excerpt }));

    const rawNotes = await callAi(
      "/huddle-notes",
      {
        title: roomTitle,
        segments: aiSegments,
        blocks: aiBlocks,
      },
      HuddleNotesData,
      HUDDLE_NOTES_TIMEOUT_MS,
    );

    const resolved = resolveNotes(rawNotes, segmentsWithAnchors);

    const { data: latestNote, error: verErr } = await db
      .from("huddle_notes")
      .select("version")
      .eq("huddle_id", huddleId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (verErr) throw verErr;

    const nextVersion = (latestNote?.version ?? 0) + 1;
    const { error: insErr } = await db.from("huddle_notes").insert({
      huddle_id: huddleId,
      version: nextVersion,
      notes: resolved,
    });
    if (insErr) throw insErr;

    const { error: readyErr } = await db
      .from("huddles")
      .update({ notes_status: "ready", notes_error: null })
      .eq("id", huddleId);
    if (readyErr) throw readyErr;
    await pingHuddles(huddle.room_id);
  } catch (err) {
    console.error(`[huddle-notes] Failed for huddle ${huddleId}:`, err);
    const msg =
      err instanceof HttpError
        ? err.message
        : "The AI couldn't write notes right now. Try again in a moment.";
    const { error: failErr } = await db
      .from("huddles")
      .update({ notes_status: "failed", notes_error: msg.slice(0, 500) })
      .eq("id", huddleId);
    if (failErr) {
      console.error(`[huddle-notes] Failed to update notes_status to failed for ${huddleId}:`, failErr);
    }
    if (roomId) {
      await pingHuddles(roomId);
    }
  } finally {
    running.delete(huddleId);
  }
}

/**
 * Starts notes generation for a huddle in the background. Never throws.
 */
export function startNotes(huddleId: string): void {
  void processNotes(huddleId).catch((err: unknown) => {
    console.error(`[huddle-notes] Unexpected error in startNotes(${huddleId}):`, err);
  });
}
