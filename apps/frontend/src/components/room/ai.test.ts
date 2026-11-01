import type { AiMessage } from "@linkroom/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import { ask, backendBody, generate, toCitations } from "./ai";

vi.mock("@/lib/session", () => ({
  getFreshSession: async () => ({ access_token: "token", expires_at: 9e9 }),
}));
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

describe("backendBody", () => {
  it("sends the passage, the earlier turns and the snapshot as their own fields", () => {
    expect(
      backendBody({
        question: "  Why? ",
        sources: ["a"],
        quote: "The sky is blue.",
        history: [
          { role: "user", text: "What colour is the sky?" },
          { role: "ai", text: " " },
          { role: "ai", text: "Blue." },
        ],
        image: "data:image/jpeg;base64,x",
        name: "Ana",
      }),
    ).toEqual({
      question: "Why?",
      name: "Ana",
      quote: "The sky is blue.",
      history: [
        { role: "user", text: "What colour is the sky?" },
        { role: "ai", text: "Blue." },
      ],
      image: "data:image/jpeg;base64,x",
    });
  });

  it("keeps the question within the backend's 500 characters and leaves out empty fields", () => {
    expect(backendBody({ question: "y".repeat(800), sources: ["a"], quote: " ", history: [] })).toEqual({
      question: "y".repeat(500),
    });
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

  it("shows the backend's reason when the AI service fails, instead of the preview", async () => {
    spy.mockRejectedValue(new ApiError("AI features aren't set up on this server yet.", 503));
    await expect(ask({ question: "Hi", sources: ["a"] }, [doc("a")], ["a"])).rejects.toThrow(/aren't set up/);
    spy.mockRejectedValue(new ApiError("The AI couldn't answer right now. Try again in a moment.", 502));
    await expect(ask({ question: "Hi", sources: ["a"] }, [doc("a")], ["a"])).rejects.toThrow(/couldn't answer/);
  });

  it("falls back to the preview only when the backend can't be reached", async () => {
    spy.mockRejectedValue(new TypeError("Failed to fetch"));
    const answer = await ask({ question: "Hi", sources: ["a"] }, [doc("a")], ["a"]);
    expect(answer.preview).toBe(true);
    expect(answer.text).toMatch(/Couldn't reach the AI server/);
  });

  it("sends a lens snapshot to the backend, for the document it was taken from only", async () => {
    spy.mockResolvedValue(message("A diagram of joint angles."));
    const image = "data:image/jpeg;base64,x";
    const answer = await ask({ question: "What is this?", sources: ["a", "b"], image }, [doc("a"), doc("b")], ["a", "b"]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("a", { question: "What is this?", image });
    expect(answer).toEqual({ text: "A diagram of joint angles.", citations: [], preview: false });
  });

  it("asks only the box's own document about a selected passage", async () => {
    spy.mockResolvedValue(message("It splits the signal by frequency."));
    await ask({ question: "Explain this", sources: ["a", "b"], quote: "FFT for frequency content" }, [doc("a"), doc("b")], ["a", "b"]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe("a");
  });

  it("passes on a refusal of the snapshot, such as no vision model", async () => {
    spy.mockRejectedValue(new ApiError("This server's AI can't read images yet.", 422));
    await expect(
      ask({ question: "What?", sources: ["a"], image: "data:image/jpeg;base64,x" }, [doc("a")], ["a"]),
    ).rejects.toThrow(/can't read images/);
  });

  it("keeps a snapshot the backend can't be reached for, and documents it doesn't have, in the labelled preview", async () => {
    spy.mockRejectedValue(new ApiError("Not found", 404));
    const lens = await ask({ question: "What is this?", sources: ["a"], image: "data:image/jpeg;base64,x" }, [doc("a")], ["a"]);
    const demo = await ask({ question: "What?", sources: ["demo"] }, [doc("demo")], []);
    expect(lens.preview).toBe(true);
    expect(lens.text).toMatch(/saved in this box/);
    expect(demo.preview).toBe(true);
    expect(demo.text).not.toMatch(/Couldn't reach/);
  });
});

describe("generate", () => {
  const attach = vi.spyOn(api, "attachSource");
  const make = vi.spyOn(api, "generateArtifact");
  const cards = { kind: "flashcards", cards: [{ front: "What is an encoder?", back: "A sensor that measures motion." }] };
  beforeEach(() => {
    attach.mockReset();
    make.mockReset();
    attach.mockResolvedValue({});
  });

  it("attaches the other chosen documents to the room, then asks the backend", async () => {
    make.mockResolvedValue(cards);
    const result = await generate("main", "flashcards", [doc("main"), doc("other")]);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith("main", "other", "token");
    expect(make).toHaveBeenCalledWith("main", { kind: "flashcards", sources: ["main", "other"] }, "token");
    expect(result).toEqual({ body: cards, preview: false });
  });

  it("passes on a refused attachment instead of asking for the artifact", async () => {
    attach.mockRejectedValue(new ApiError("A room can have up to 20 sources", 409));
    await expect(generate("main", "flashcards", [doc("main"), doc("other")])).rejects.toThrow(/up to 20 sources/);
    expect(make).not.toHaveBeenCalled();
  });

  it("shows the backend's refusal or AI failure instead of a browser preview", async () => {
    make.mockRejectedValue(new ApiError("Some of the chosen sources aren't in this room", 404));
    await expect(generate("main", "flashcards", [doc("main")])).rejects.toThrow(/aren't in this room/);
    make.mockRejectedValue(new ApiError("The AI couldn't answer right now. Try again in a moment.", 502));
    await expect(generate("main", "flashcards", [doc("main")])).rejects.toThrow(/couldn't answer/);
  });

  it("says the server couldn't be reached instead of building a preview for a real room", async () => {
    make.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(generate("main", "flashcards", [doc("main")])).rejects.toThrow(/Couldn't reach the server at/);
  });

  it("builds a browser preview only for the demo room", async () => {
    expect((await generate("demo", "flashcards", [doc("demo")], false)).preview).toBe(true);
    expect(make).not.toHaveBeenCalled();
  });
});
