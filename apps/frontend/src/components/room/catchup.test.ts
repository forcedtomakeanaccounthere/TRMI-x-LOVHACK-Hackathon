import { describe, expect, it } from "vitest";
import { buildCatchup } from "./catchup";
import type { Actor, LedgerEvent, LedgerPayload } from "./types";

const ME = { id: "me", name: "Arnav Ranjan", color: "#ef4444" };
const ANA: Actor = { id: "ana", name: "Ana", color: "#3b82f6" };
const RAVI: Actor = { id: "ravi", name: "Ravi", color: "#22c55e" };
let n = 0;
const ev = (actor: Actor, at: string, payload: LedgerPayload) => ({ ...payload, id: `e${++n}`, at, actor }) as LedgerEvent;
const T = (h: number) => `2026-11-01T${String(h).padStart(2, "0")}:00:00.000Z`;
const SINCE = T(10);
const UNTIL = T(20);

const highlight = (actor: Actor, at: string, id: string, quote = "edge detection") =>
  ev(actor, at, {
    type: "annot.add",
    annotation: { id, doc: "d1", block: "b2", kind: "highlight", start: 0, end: 4, quote, color: "#facc15", author: actor, at },
  });
const note = (actor: Actor, at: string, id: string, body: string) =>
  ev(actor, at, { type: "annot.add", annotation: { id, doc: "d1", block: "b3", kind: "note", x: 1, y: 0, body, color: "#facc15", author: actor, at } });
const chat = (actor: Actor, at: string, id: string, text: string, reply_to?: string) =>
  ev(actor, at, { type: "chat", message: { id, text, author: actor, at, ...(reply_to && { reply_to }) } });

describe("buildCatchup", () => {
  it("lists what others did between the last visit and this one", () => {
    const c = buildCatchup(
      [
        highlight(ANA, T(9), "old"), // before the last visit
        highlight(ANA, T(11), "h1"),
        highlight(ME as Actor, T(12), "mine"), // my own
        note(RAVI, T(12), "n1", "Is FFT 1D only?"),
        chat(ANA, T(13), "m1", "Look at slide 4"),
        highlight(RAVI, T(21), "live"), // after this visit began
      ],
      ME,
      SINCE,
      UNTIL,
    )!;
    expect(c.highlights.map((h) => h.id)).toEqual(["h1"]);
    expect(c.comments.map((x) => x.body)).toEqual(["Is FFT 1D only?"]);
    expect(c.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(c.people.map((p) => p.id).sort()).toEqual(["ana", "ravi"]);
  });

  it("is null when nobody else did anything", () => {
    expect(buildCatchup([highlight(ME as Actor, T(11), "mine"), highlight(ANA, T(9), "old")], ME, SINCE, UNTIL)).toBeNull();
  });

  it("leaves out what was removed later, and shows a comment's latest text", () => {
    const c = buildCatchup(
      [
        highlight(ANA, T(11), "gone"),
        ev(ANA, T(12), { type: "annot.remove", annotation_id: "gone" }),
        note(RAVI, T(11), "n1", "first"),
        ev(ANA, T(13), { type: "note.edit", annotation_id: "n1", body: "edited" }),
      ],
      ME,
      SINCE,
      UNTIL,
    )!;
    expect(c.highlights).toEqual([]);
    expect(c.comments.map((x) => x.body)).toEqual(["edited"]);
  });

  it("marks messages that @mention you or answer you, until you reply", () => {
    const c = buildCatchup(
      [
        chat(ME as Actor, T(9), "q", "Who has the slides?"),
        chat(ANA, T(11), "a1", "@Arnav Ranjan can you check this?"),
        chat(RAVI, T(12), "a2", "I do", "q"), // answers my message
        chat(RAVI, T(13), "a3", "Nice work everyone"),
        chat(ANA, T(14), "a4", "@Arnav Ranjan and this one"),
        chat(ME as Actor, T(15), "r", "On it", "a4"), // already answered (during the last visit's end)
      ],
      ME,
      SINCE,
      UNTIL,
    )!;
    expect(c.waiting.map((m) => m.id)).toEqual(["a1", "a2"]);
  });
});
