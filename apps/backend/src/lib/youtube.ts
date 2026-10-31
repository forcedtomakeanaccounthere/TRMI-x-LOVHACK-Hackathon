import type { RoomSummary } from "@linkroom/shared";
import { JSDOM } from "jsdom";
import { HttpError } from "../middleware/error";

// YouTube rooms: the video's transcript, joined into readable paragraphs. Each paragraph is a t{n}
// block that keeps its time range in data-start / data-end, never in its text, so a chunk, a
// summary point or an answer can say where in the video it comes from (0010_ai_foundation.sql).

export type Segment = { start: number | null; duration: number | null; text: string };

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The 11-character id of a YouTube video link, or a 400 for anything else. */
export function videoIdOf(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(400, "That isn't a YouTube video link.");
  }
  const host = url.hostname.toLowerCase();
  let id: string | null | undefined;
  if (["http:", "https:"].includes(url.protocol) && HOSTS.has(host)) {
    id =
      host === "youtu.be"
        ? url.pathname.split("/")[1]
        : url.pathname === "/watch"
          ? url.searchParams.get("v")
          : /^\/(?:shorts|embed|live|v)\/([^/]+)/.exec(url.pathname)?.[1];
  }
  if (!id || !VIDEO_ID.test(id)) throw new HttpError(400, "That isn't a YouTube video link.");
  return id;
}

export const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

// "0:05", "12:34", "1:02:33", alone on a line or before the text.
const TIMESTAMP = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b\s*(.*)$/;

/**
 * Reads a transcript copied from YouTube's "Show transcript" panel: a timestamp line followed by
 * its text, or the timestamp and text on one line. Text with no timestamps at all is kept too, as
 * paragraphs without times.
 */
export function parsePastedTranscript(text: string): Segment[] {
  const segments: Segment[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const match = TIMESTAMP.exec(line);
    if (match) {
      const [, h, m, s, rest] = match;
      segments.push({ start: Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s), duration: null, text: rest!.trim() });
    } else if (line.trim()) {
      const last = segments.at(-1);
      if (last) last.text = `${last.text} ${line.trim()}`.trim();
      else segments.push({ start: null, duration: null, text: line.trim() });
    }
  }
  // Without any timestamp the text is one long segment: split it at blank lines instead.
  if (segments.every((s) => s.start === null)) {
    return text
      .split(/\n\s*\n/)
      .map((para) => ({ start: null, duration: null, text: para.replace(/\s+/g, " ").trim() }))
      .filter((s) => s.text);
  }
  return segments.filter((s) => s.text);
}

// A paragraph is closed at a sentence end once it is this long, and always at the hard limits.
// Automatic captions have no punctuation, so for them the time and length limits do the work.
const PARAGRAPH_MIN_SECONDS = 45;
const PARAGRAPH_MAX_SECONDS = 90;
const PARAGRAPH_MIN_CHARS = 500;
const PARAGRAPH_MAX_CHARS = 1200;
const MAX_BLOCKS = 5000;

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Joins transcript segments into <p data-block="t{n}" data-start data-end> paragraphs. The text is
 * set as text, so nothing in a transcript can become markup. Returns the HTML and the video's
 * length as far as the transcript goes.
 */
export function transcriptToHtml(segments: Segment[]) {
  const { document } = new JSDOM("<body></body>").window;
  let parts: Segment[] = [];
  let blocks = 0;
  let durationSec: number | null = null;

  const endOf = (s: Segment) => (s.start === null ? null : s.start + (s.duration ?? 0));
  const flush = () => {
    if (!parts.length || blocks >= MAX_BLOCKS) return;
    const p = document.createElement("p");
    p.setAttribute("data-block", `t${blocks++}`);
    const first = parts[0]!;
    const last = parts.at(-1)!;
    if (first.start !== null) {
      p.setAttribute("data-start", String(round(first.start)));
      // A pasted segment has no duration: it ends where the last one starts.
      p.setAttribute("data-end", String(round(Math.max(first.start, endOf(last) ?? last.start ?? first.start))));
    }
    p.textContent = parts.map((s) => s.text).join(" ");
    document.body.appendChild(p);
    parts = [];
  };

  for (const raw of segments) {
    const text = raw.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const segment = { ...raw, text };
    parts.push(segment);
    const end = endOf(segment);
    if (end !== null) durationSec = Math.max(durationSec ?? 0, end);

    const first = parts[0]!;
    const seconds = first.start !== null && end !== null ? end - first.start : 0;
    const chars = parts.reduce((n, s) => n + s.text.length + 1, 0);
    const sentenceEnd = /[.!?…।]["')\]]?$/.test(text);
    if (
      seconds >= PARAGRAPH_MAX_SECONDS ||
      chars >= PARAGRAPH_MAX_CHARS ||
      (sentenceEnd && (seconds >= PARAGRAPH_MIN_SECONDS || chars >= PARAGRAPH_MIN_CHARS))
    ) {
      flush();
    }
  }
  flush();
  return { html: document.body.innerHTML, durationSec: durationSec === null ? null : round(durationSec) };
}

const OEMBED_TIMEOUT_MS = 5000;

/** The video's title from YouTube's oEmbed endpoint, or null when it can't be had in time. */
export async function fetchVideoTitle(videoId: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(videoId))}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) });
    if (!res.ok) return null;
    const title = ((await res.json()) as { title?: unknown }).title;
    return typeof title === "string" && title.trim() ? title.trim().slice(0, 300) : null;
  } catch {
    return null;
  }
}

/**
 * The detailed doc a YouTube room shows, written from its summary: the overview, each section's
 * heading and points, then the key terms. Every paragraph is a b{n} block whose data-source lists
 * the transcript blocks (t{n}) it comes from, so a reader can jump to that moment of the video.
 * Text is set as text, so nothing the model wrote can become markup.
 */
export function summaryToDocHtml(summary: RoomSummary) {
  const { document } = new JSDOM("<body></body>").window;
  let n = 0;
  const add = (tag: string, text: string, sources: string[] = [], parent: Element = document.body) => {
    if (!text.trim()) return null;
    const el = document.createElement(tag);
    el.setAttribute("data-block", `b${n++}`);
    const transcript = sources.filter((id) => /^t\d+$/.test(id));
    if (transcript.length) el.setAttribute("data-source", transcript.join(","));
    el.textContent = text.trim();
    parent.appendChild(el);
    return el;
  };

  add("p", summary.overview); // about the whole video, so no single moment
  for (const section of summary.sections) {
    add("h2", section.heading);
    for (const point of section.points) add("p", point.text, point.source_blocks);
  }
  if (summary.key_terms.length) {
    add("h2", "Key terms");
    const list = document.createElement("ul");
    document.body.appendChild(list);
    for (const term of summary.key_terms) add("li", `${term.term}: ${term.meaning}`, term.source_blocks, list);
  }
  return document.body.innerHTML;
}
