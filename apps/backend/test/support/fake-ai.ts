import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for apps/ai over real HTTP, for integration and e2e tests: canned, deterministic replies
// to every endpoint the backend calls, and a record of each request so tests can check what was sent.
// Point the backend at it with AI_SERVICE_URL = fake.url (and AI_INTERNAL_TOKEN = fake.token).

export type FakeAiRequest = { path: string; body: unknown; token: string | undefined };
type Body = Record<string, unknown>;
export type FakeAiHandler = (body: Body) => unknown | { status: number; body: unknown };

const EMBEDDING_DIM = 1024; // the vector column in supabase/migrations/0011_chunks.sql

// The same text always gets the same unit vector, so search results don't change between runs.
function vectorFor(text: string): number[] {
  let seed = 0;
  for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const v = Array.from({ length: EMBEDDING_DIM }, (_, i) => Math.sin(seed + i * 0.37));
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

const firstWords = (text: string, n = 6) => text.split(/\s+/).filter(Boolean).slice(0, n).join(" ");

export const DEFAULT_HANDLERS: Record<string, FakeAiHandler> = {
  "/moderate": () => ({ flagged: [] }),
  "/embed": (body) => ({ model: "fake-embed", vectors: (body.texts as string[]).map(vectorFor) }),
  "/summary": (body) => {
    const chunks = body.chunks as { content: string; block_ids: string[] }[];
    return {
      overview: `Overview of ${String(body.title)}`,
      sections: [
        {
          heading: "Main ideas",
          points: chunks.slice(0, 3).map((c) => ({ text: firstWords(c.content), source_blocks: c.block_ids.slice(0, 1) })),
        },
      ],
      key_terms: [],
    };
  },
  "/recap": (body) => {
    const comments = body.comments as { body: string }[];
    return {
      one_line_summary: "Fake recap",
      key_points: comments.map((c) => c.body),
      what_the_group_cared_about: [],
      disagreements: [],
      open_questions: [],
      next_steps: [],
    };
  },
  // Cites every chunk it was sent, quoting each one's first words.
  "/answer": (body) => {
    const chunks = (body.chunks as { content: string }[]) ?? [];
    return {
      answer: chunks.length ? `Answer from ${chunks.length} chunk(s)` : "Answer from the image",
      found_in_document: chunks.length > 0,
      citations: chunks.map((c, i) => ({ chunk: i + 1, quote: firstWords(c.content, 3) })),
      withheld: false,
    };
  },
  "/study": (body) => {
    const docs = body.documents as { id: string; title: string }[];
    const source = docs[0]?.id ?? null;
    switch (body.kind) {
      case "quiz":
        return {
          kind: "quiz",
          title: "Fake quiz",
          questions: [
            { question: "Q1?", options: ["a", "b", "c", "d"], answer_index: 2, explanation: "Because c.", source_id: source },
          ],
        };
      case "flashcards":
        return { kind: "flashcards", title: "Fake cards", cards: [{ front: "Term", back: "Meaning", source_id: source }] };
      case "mindmap":
        return {
          kind: "mindmap",
          title: "Fake map",
          nodes: [
            { id: "n1", label: "Root", parent_id: null, source_id: null },
            { id: "n2", label: "Child A", parent_id: "n1", source_id: source },
            { id: "n3", label: "Grandchild", parent_id: "n2", source_id: source },
            { id: "n4", label: "Child B", parent_id: "n1", source_id: source },
            { id: "n5", label: "Orphan", parent_id: "missing", source_id: source },
          ],
        };
      default:
        return {
          kind: "infographic",
          title: "Fake infographic",
          subtitle: "Sub",
          stats: [{ label: "Docs", value: String(docs.length), source_id: null }],
          sections: [{ heading: "Step one", points: ["Do this", "then that"], source_id: source }],
          key_takeaway: "Takeaway",
        };
    }
  },
};

async function readJson(req: IncomingMessage): Promise<Body> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  const text = Buffer.concat(parts).toString("utf8");
  return text ? (JSON.parse(text) as Body) : {};
}

export async function startFakeAi() {
  const requests: FakeAiRequest[] = [];
  const handlers: Record<string, FakeAiHandler> = { ...DEFAULT_HANDLERS };
  const token = "fake-ai-token";

  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = req.url ?? "/";
      const body = await readJson(req);
      requests.push({ path, body, token: req.headers["x-internal-token"] as string | undefined });
      const handler = handlers[path];
      let status = 200;
      let reply: unknown = { detail: "not found" };
      if (!handler) status = 404;
      else {
        reply = handler(body);
        if (reply && typeof reply === "object" && "status" in reply && "body" in reply) {
          status = (reply as { status: number }).status;
          reply = (reply as { body: unknown }).body;
        }
      }
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    })().catch((err: unknown) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    token,
    requests,
    handlers,
    // The requests made to one endpoint, oldest first.
    calls: (path: string) => requests.filter((r) => r.path === path),
    reset: () => {
      requests.length = 0;
      for (const key of Object.keys(handlers)) delete handlers[key];
      Object.assign(handlers, DEFAULT_HANDLERS);
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeAi = Awaited<ReturnType<typeof startFakeAi>>;
