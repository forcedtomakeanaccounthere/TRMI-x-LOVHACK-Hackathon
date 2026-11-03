import timings from "./timings.json";
import { SCENES, type Scene } from "./scenes";
import { FPS } from "./theme";

// One source of truth for when everything happens: scene lengths come from the voiceover
// clips (scripts/timings.py writes timings.json), so re-recording the voice re-times the video.
export const VO_DELAY = 0.45; // seconds of picture before each scene's voice starts
const DEFAULT_TAIL = 0.75;

type T = { dur: number; sentences: { text: string; start: number; end: number }[] };
export const TIMINGS = timings as Record<string, T>;

export const f = (s: number) => Math.round(s * FPS);

export type Placed = Scene & { from: number; dur: number; voDur: number };

export const PLACED: Placed[] = (() => {
  let at = 0;
  return SCENES.map((s) => {
    const voDur = TIMINGS[s.id]!.dur;
    const dur = f(VO_DELAY + voDur + (s.tail ?? DEFAULT_TAIL));
    const p = { ...s, from: at, dur, voDur };
    at += dur;
    return p;
  });
})();

export const TOTAL = PLACED.reduce((n, s) => n + s.dur, 0);

// Frame (within the scene) for a time on the voice clock.
export const voF = (s: number) => f(VO_DELAY + s);

// Caption chunks: each sentence split into pieces of at most `max` words, timed in proportion
// to their length inside the sentence's measured window.
export type Chunk = { text: string; from: number; to: number };
export function captionsFor(id: string, max = 9): Chunk[] {
  const out: Chunk[] = [];
  for (const s of TIMINGS[id]!.sentences) {
    const words = s.text.split(/\s+/);
    const n = Math.ceil(words.length / max);
    const per = Math.ceil(words.length / n);
    const parts: string[] = [];
    for (let i = 0; i < words.length; i += per) parts.push(words.slice(i, i + per).join(" "));
    const total = parts.reduce((a, p) => a + p.length, 0);
    let t = s.start;
    for (const p of parts) {
      const d = ((s.end - s.start) * p.length) / total;
      out.push({ text: p, from: voF(t), to: voF(t + d) });
      t += d;
    }
  }
  return out;
}
