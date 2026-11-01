import type { AiMessage } from "@linkroom/shared";
import { api, API_URL, ApiError, type AskRequest } from "@/lib/api";
import { getFreshSession } from "@/lib/session";
import type { ArtifactBody, ArtifactKind, Citation, DocContent, MindNode } from "./types";

// AI calls go to the backend endpoints proposed in CHECKLIST.md. Until those exist (404) or when the
// backend can't be reached, the room still answers in the browser: the passages that best match the
// question, and artifacts built from each document's AI summary or outline. Those results are marked
// `preview` and say so wherever they're shown.

export type Block = {
  doc: string;
  block: string;
  text: string;
  heading: boolean;
};

const STOP = new Set(
  "a an and are as at be but by can do does for from has have how i if in into is it its of on or so that the their them then there these this to was what when where which who why will with you your about".split(
    " ",
  ),
);

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));

// Text blocks of a document: from its HTML, or for PDFs from the pages already rendered on screen.
export function blocksOf(doc: DocContent): Block[] {
  if (typeof window === "undefined") return [];
  const out: Block[] = [];
  if (doc.content_html) {
    const parsed = new DOMParser().parseFromString(doc.content_html, "text/html");
    parsed.querySelectorAll<HTMLElement>("[data-block]").forEach((el) => {
      const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text)
        out.push({
          doc: doc.id,
          block: el.dataset.block!,
          text,
          heading: /^H[1-6]$/.test(el.tagName),
        });
    });
  } else {
    document.querySelectorAll<HTMLElement>(`[data-doc="${CSS.escape(doc.id)}"] [data-block]`).forEach((el) => {
      const text = el.querySelector(".textLayer")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text)
        out.push({
          doc: doc.id,
          block: el.dataset.block!,
          text,
          heading: false,
        });
    });
  }
  return out;
}

export function search(blocks: Block[], query: string, k = 3): Block[] {
  const terms = new Set(words(query));
  if (terms.size === 0) return blocks.slice(0, k);
  return blocks
    .map((b) => {
      const bw = words(b.text);
      const hits = bw.filter((w) => terms.has(w)).length;
      return { b, score: hits / Math.sqrt(bw.length + 4) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.b);
}

const clip = (text: string, n = 260) => (text.length > n ? `${text.slice(0, n).replace(/\s+\S*$/, "")}…` : text);

export type Answer = { text: string; citations: Citation[]; preview: boolean };

// A question falls back to the browser preview only when the backend can't be reached (a network
// error) or has no /ask (404). Any answer it does give, a 502/503 from the AI service included, is
// shown as the reason, so "AI features aren't set up" isn't hidden behind "not connected yet".
function unreachable(err: unknown) {
  return !(err instanceof ApiError) || err.status === 404;
}

// What POST /api/rooms/:id/ask gets: the question (up to 500 characters), plus the passage an AI box
// is about, its earlier turns and a lens snapshot as their own fields, so follow-ups and "explain
// this" keep their context and a snapshot reaches a vision model.
const ASK_MAX = 500;
export function backendBody(req: AskRequest): Parameters<typeof api.ask>[1] {
  const history = req.history?.filter((m) => m.text.trim()).slice(-8);
  return {
    question: req.question.trim().slice(0, ASK_MAX),
    ...(req.name && { name: req.name }),
    ...(req.quote?.trim() && { quote: req.quote }),
    ...(history?.length && { history }),
    ...(req.image && { image: req.image }),
  };
}

// The backend cites block ids; the first one is where the citation jumps.
export function toCitations(doc: string, message: Pick<AiMessage, "citations">): Citation[] {
  return message.citations.flatMap((c) => {
    const block = c.block_ids[0] ?? (c.page ? `p${c.page}` : null);
    return block ? [{ doc, block, quote: c.quote }] : [];
  });
}

// Asks the backend about each chosen document that is a backend room (`remote`), one call per
// document, and joins the answers. A lens snapshot or a selected passage goes only to the first one
// (the document it was taken from), so it isn't asked of every source. What the backend
// can't answer (the demo room's bundled documents, the backend being down) gets the browser preview
// below, marked as such.
export async function ask(req: AskRequest, docs: DocContent[], remote: string[]): Promise<Answer> {
  const backendDocs = req.sources.filter((id) => remote.includes(id));
  // A snapshot or a selected passage belongs to the document it was taken from (the box's, first):
  // asking the other sources about it only adds "not in this document" answers.
  const targets = req.image || req.quote?.trim() ? backendDocs.slice(0, 1) : backendDocs;
  if (targets.length > 0) {
    const body = backendBody(req);
    const results = await Promise.allSettled(targets.map((id) => api.ask(id, body)));
    const answered = results.flatMap((r, i) => (r.status === "fulfilled" ? [{ id: targets[i]!, message: r.value }] : []));
    const failed = results.flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []));
    if (failed.length === 0 || answered.length > 0) {
      const titles = new Map(docs.map((d) => [d.id, d.title]));
      // With several documents, lead with the ones whose text answered the question.
      const ordered = [...answered].sort((a, b) => Number(b.message.found_in_document) - Number(a.message.found_in_document));
      const text =
        ordered.length === 1
          ? ordered[0]!.message.answer
          : ordered.map(({ id, message }) => `**${titles.get(id) ?? "Source"}**\n${message.answer}`).join("\n\n");
      const note = failed.length
        ? `\n\n(${failed.length === 1 ? "One source" : `${failed.length} sources`} couldn't answer: ${
            failed[0] instanceof Error ? failed[0].message : "try again"
          })`
        : "";
      return {
        text: text + note,
        citations: ordered.flatMap(({ id, message }) => toCitations(id, message)),
        preview: false,
      };
    }
    if (!failed.every(unreachable)) throw failed.find((e) => !unreachable(e));
  }

  if (req.image) {
    return {
      text: "The AI lens couldn't reach the backend, so this snapshot wasn't read. It's saved in this box: ask again once the AI is back.",
      citations: [],
      preview: true,
    };
  }
  // Documents the backend doesn't have (the demo room's) were never sent; for the rest, it failed.
  const why = targets.length ? "Couldn't reach the AI server" : "The AI only answers about documents saved on the server";
  const blocks = docs.filter((d) => req.sources.includes(d.id)).flatMap(blocksOf);
  const found = search(blocks, `${req.question} ${req.quote ?? ""}`);
  if (found.length === 0) {
    return {
      text: `${why}, and nothing in the chosen sources matches those words.`,
      citations: [],
      preview: true,
    };
  }
  const titles = new Map(docs.map((d) => [d.id, d.title]));
  return {
    text: [
      `${why}, so here are the passages that match best:`,
      ...found.map((b) => `“${clip(b.text)}” — ${titles.get(b.doc) ?? "source"}`),
    ].join("\n\n"),
    citations: found.map((b) => ({
      doc: b.doc,
      block: b.block,
      quote: clip(b.text, 120),
    })),
    preview: true,
  };
}

// --- Artifacts ---

export const ARTIFACT_META: Record<ArtifactKind, { label: string; blurb: string }> = {
  summary: { label: "Summary", blurb: "The argument in sections" },
  quiz: { label: "Quiz", blurb: "Check what stuck" },
  flashcards: { label: "Flashcards", blurb: "Terms to remember" },
  mindmap: { label: "Mind map", blurb: "How ideas connect" },
  infographic: { label: "Infographic", blurb: "One page, at a glance" },
};

function looksLike(kind: ArtifactKind, body: unknown): body is ArtifactBody {
  return !!body && typeof body === "object" && (body as { kind?: string }).kind === kind;
}

type Outline = {
  title: string;
  overview: string;
  sections: { heading: string; points: string[] }[];
  terms: { term: string; meaning: string }[];
};

// One outline per source: the backend's AI summary when it's ready, else headings and sentences.
function outlineOf(doc: DocContent): Outline {
  if (doc.summary) {
    return {
      title: doc.title,
      overview: doc.summary.overview,
      sections: doc.summary.sections.map((s) => ({
        heading: s.heading,
        points: s.points.map((p) => p.text),
      })),
      terms: doc.summary.key_terms.map((t) => ({
        term: t.term,
        meaning: t.meaning,
      })),
    };
  }
  const blocks = blocksOf(doc);
  const sections: Outline["sections"] = [];
  let current: Outline["sections"][number] = { heading: doc.title, points: [] };
  for (const b of blocks) {
    if (b.heading) {
      if (current.points.length) sections.push(current);
      current = { heading: clip(b.text, 70), points: [] };
    } else {
      const sentence = b.text.split(/(?<=[.!?])\s+/)[0] ?? b.text;
      if (sentence.length > 30) current.points.push(clip(sentence, 180));
    }
  }
  if (current.points.length) sections.push(current);
  const trimmed = sections.slice(0, 6).map((s) => ({ ...s, points: s.points.slice(0, 4) }));
  const terms = trimmed.flatMap((s) => s.points.slice(0, 1).map((p) => ({ term: s.heading, meaning: p }))).slice(0, 8);
  return {
    title: doc.title,
    overview: trimmed[0]?.points[0] ?? "",
    sections: trimmed,
    terms,
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function buildLocally(kind: ArtifactKind, docs: DocContent[]): ArtifactBody {
  const outlines = docs.map(outlineOf);
  const sections = outlines.flatMap((o) => o.sections);
  const points = sections.flatMap((s) => s.points.map((p) => ({ heading: s.heading, point: p })));

  switch (kind) {
    case "summary":
      return {
        kind,
        overview:
          outlines
            .map((o) => o.overview)
            .filter(Boolean)
            .join(" ") || "Not enough text in these sources yet.",
        sections: sections.slice(0, 8),
      };
    case "flashcards": {
      const cards = outlines.flatMap((o) => o.terms).map((t) => ({ front: t.term, back: t.meaning }));
      const fill = points.map((p) => ({ front: p.heading, back: p.point }));
      return {
        kind,
        cards: (cards.length >= 4 ? cards : [...cards, ...fill]).slice(0, 12),
      };
    }
    case "quiz": {
      const pool = points.slice(0, 24);
      const questions = pool.slice(0, 6).map((p, i) => {
        const wrong = shuffle(
          pool.filter((o) => o.heading !== p.heading),
          i + 7,
        )
          .slice(0, 3)
          .map((o) => o.point);
        const options = shuffle([p.point, ...wrong], i + 3);
        return {
          q: `Which point does the source make under “${p.heading}”?`,
          options,
          answer: options.indexOf(p.point),
          why: `It's from “${p.heading}”.`,
        };
      });
      return { kind, questions: questions.filter((q) => q.options.length > 1) };
    }
    case "mindmap":
      return {
        kind,
        root: {
          label: docs.length === 1 ? docs[0]!.title : "This room",
          children: outlines.map<MindNode>((o) => ({
            label: o.title,
            children: o.sections.slice(0, 5).map((s) => ({
              label: s.heading,
              children: s.points.slice(0, 3).map((p) => ({ label: clip(p, 60) })),
            })),
          })),
        },
      };
    case "infographic": {
      const wordCount = docs.flatMap(blocksOf).reduce((n, b) => n + b.text.split(/\s+/).length, 0);
      return {
        kind,
        headline: outlines[0]?.overview ? clip(outlines[0].overview, 140) : (docs[0]?.title ?? "This room"),
        stats: [
          {
            value: String(docs.length),
            label: docs.length === 1 ? "source" : "sources",
          },
          { value: String(sections.length), label: "sections" },
          {
            value: wordCount > 999 ? `${Math.round(wordCount / 100) / 10}k` : String(wordCount),
            label: "words",
          },
          {
            value: `${Math.max(1, Math.round(wordCount / 230))} min`,
            label: "to read",
          },
        ],
        steps: sections.slice(0, 5).map((s) => ({ title: s.heading, text: s.points[0] ?? "" })),
      };
    }
  }
}

// The backend makes an artifact only from the room and documents attached to it (room_attachments).
// Documents added in the workspace live in its ledger, so they're attached here first; attaching
// one twice changes nothing. A refusal (the room's source limit, a role that can't add sources) is
// passed on as it is, so its reason is shown rather than a later "not in this room".
async function attachSources(roomId: string, ids: string[], token: string) {
  const others = ids.filter((id) => id !== roomId);
  const results = await Promise.allSettled(others.map((id) => api.attachSource(roomId, id, token)));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}

// `remote`: every chosen document is a backend room. When one isn't (the demo room's bundled
// documents, a `yt:` video not yet processed) the artifact is built in the browser and marked
// preview. Backend rooms never fall back to that cut-up text, which hid why the backend wasn't
// answering: any failure, a refusal, an AI error or the server being unreachable, is passed on so
// its reason is shown.
export async function generate(
  roomId: string,
  kind: ArtifactKind,
  docs: DocContent[],
  remote = true,
): Promise<{ body: ArtifactBody; preview: boolean }> {
  if (remote) {
    try {
      const sources = docs.map((d) => d.id);
      // Signed out: only the room itself is in scope, and the backend says so if more was chosen.
      const token = (await getFreshSession().catch(() => null))?.access_token;
      if (token) await attachSources(roomId, sources, token);
      const body = await api.generateArtifact(roomId, { kind, sources }, token);
      if (looksLike(kind, body)) return { body, preview: false };
      throw new Error("The AI's answer couldn't be shown. Try again.");
    } catch (err) {
      if (err instanceof TypeError) {
        // fetch failed: the server is down or asleep, the address is wrong, or it refused this site
        // (CORS: WEB_ORIGIN on the backend must list the frontend's address).
        throw new Error(`Couldn't reach the server at ${API_URL}. Check that the backend is running and allows this site.`);
      }
      throw err;
    }
  }
  return { body: buildLocally(kind, docs), preview: true };
}

export function artifactToMarkdown(title: string, body: ArtifactBody): string {
  const lines = [`# ${title}`, ""];
  switch (body.kind) {
    case "summary":
      lines.push(body.overview, "");
      for (const s of body.sections) lines.push(`## ${s.heading}`, ...s.points.map((p) => `- ${p}`), "");
      break;
    case "quiz":
      body.questions.forEach((q, i) => {
        lines.push(
          `${i + 1}. ${q.q}`,
          ...q.options.map((o, j) => `   ${j === q.answer ? "**" : ""}${"ABCD"[j]}. ${o}${j === q.answer ? "**" : ""}`),
          "",
        );
      });
      break;
    case "flashcards":
      for (const c of body.cards) lines.push(`**${c.front}**`, c.back, "");
      break;
    case "mindmap": {
      const walk = (n: MindNode, depth: number) => {
        lines.push(`${"  ".repeat(depth)}- ${n.label}`);
        n.children?.forEach((c) => walk(c, depth + 1));
      };
      walk(body.root, 0);
      break;
    }
    case "infographic":
      lines.push(`> ${body.headline}`, "", ...body.stats.map((s) => `- **${s.value}** ${s.label}`), "");
      body.steps.forEach((s, i) => lines.push(`${i + 1}. **${s.title}** — ${s.text}`));
      break;
  }
  return lines.join("\n");
}

export function downloadText(name: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: name,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSafe = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} _.-]+/gu, "")
    .trim()
    .slice(0, 80) || "linkroom";
