import type { AiMessage } from "@linkroom/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import { ask, backendQuestion, toCitations } from "./ai";
import type { DocContent } from "./types";

const doc = (id: string, title = id): DocContent => ({
  id,
  kind: "link",
  title,
  source_url: null,
  content_html: null,
  pdf_url: null,
  status: "running",
  created_by: null,
  summary: null,
  ai_status: "ready",
});

const message = (answer: string, citations: AiMessage["citations"] = [], found = true): AiMessage => ({
  id: "00000000-0000-4000-8000-000000000000",
  room_id: "r",
  kind: "ask",
  asked_by: null,
  question: "q",
  answer,
  found_in_document: found,
  citations,
  created_at: "2026-11-01T00:00:00Z",
});

const cite = (quote: string, block_ids: string[], page: number | null = null) => ({
  quote,
  block_ids,
  page,
  start_sec: null,
  end_sec: null,
});

describe("backendQuestion", () => {
  it("adds the passage and the previous question as context", () => {
    const q = backendQuestion({
      question: "Why?",
      quote: "  The   sky is blue. ",
      history: [
        { role: "user", text: "What colour is the sky?" },
        { role: "ai", text: "Blue." },
      ],
    });
    expect(q).toBe('Why?\n\nAbout this passage: "The sky is blue."\n\nEarlier question: "What colour is the sky?"');
  });

  it("stays within the backend's 500 characters", () => {
    expect(backendQuestion({ question: "Explain", quote: "x".repeat(2000) }).length).toBeLessThanOrEqual(500);
    expect(backendQuestion({ question: "y".repeat(800) })).toHaveLength(500);
  });
});

describe("toCitations", () => {
  it("jumps to the first cited block, or the cited PDF page, and skips citations with neither", () => {
    const m = message("a", [cite("one", ["b3", "b4"]), cite("two", [], 7), cite("three", [])]);
    expect(toCitations("doc1", m)).toEqual([
      { doc: "doc1", block: "b3", quote: "one" },
      { doc: "doc1", block: "p7", quote: "two" },
    ]);
  });
});

describe("ask", () => {
  const spy = vi.spyOn(api, "ask");
  // Every call must be stubbed: an unstubbed one would reach for a real backend.
  beforeEach(() => {
    spy.mockReset();
    spy.mockImplementation(async () => {
      throw new Error("unexpected call to the backend");
    });
  });

  it("asks the backend about the chosen document, not the room it was opened from", async () => {
    spy.mockResolvedValue(message("From the attachment.", [cite("q", ["b1"])]));
    const answer = await ask({ question: "What?", sources: ["attached"], name: "Ana" }, [doc("attached")], ["main", "attached"]);
    expect(spy).toHaveBeenCalledWith("attached", { question: "What?", name: "Ana" });
    expect(answer).toEqual({
      text: "From the attachment.",
      citations: [{ doc: "attached", block: "b1", quote: "q" }],
      preview: false,
    });
  });

  it("asks each chosen document and labels the answers, leading with the ones that found it", async () => {
    spy.mockImplementation(async (id) =>
      id === "a" ? message("Not in here.", [], false) : message("Here it is.", [cite("q", ["b2"])]),
    );
    const answer = await ask({ question: "Where?", sources: ["a", "b"] }, [doc("a", "Alpha"), doc("b", "Beta")], ["a", "b"]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(answer.text).toBe("**Beta**\nHere it is.\n\n**Alpha**\nNot in here.");
    expect(answer.citations).toEqual([{ doc: "b", block: "b2", quote: "q" }]);
  });

  it("passes a refusal on, so the thread can say why", async () => {
    spy.mockImplementation(async () => {
      throw new ApiError("The AI is still reading this room. Try again in a moment.", 409);
    });
    await expect(ask({ question: "Hi", sources: ["a"] }, [doc("a")], ["a"])).rejects.toThrow(/still reading/);
  });

  it("keeps lens snapshots and documents the backend doesn't have in the labelled preview", async () => {
    const lens = await ask({ question: "What is this?", sources: ["a"], image: "data:image/jpeg;base64,x" }, [doc("a")], ["a"]);
    const demo = await ask({ question: "What?", sources: ["demo"] }, [doc("demo")], []);
    expect(spy).not.toHaveBeenCalled();
    expect(lens.preview).toBe(true);
    expect(demo.preview).toBe(true);
  });
});
