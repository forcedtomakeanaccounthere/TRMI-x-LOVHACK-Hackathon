import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { ApiError } from "@/lib/api";
import { fromB64, NotebookSync, toB64 } from "./notebook-sync";
import type { NotebookMessage } from "./use-room-channel";

// Two or three browsers' notebooks wired through a fake room channel, with saves recorded.

type Peer = { id: string; doc: Y.Doc; sync: NotebookSync; saves: string[] };

function room(saveImpl?: (update: string) => Promise<void>) {
  const peers: Peer[] = [];
  const deliver = (from: string, message: NotebookMessage, to?: string) => {
    for (const p of peers) if (p.id !== from && (!to || to === p.id)) p.sync.receive(message);
  };
  const join = (id: string) => {
    const doc = new Y.Doc();
    const saves: string[] = [];
    const sync = new NotebookSync(
      doc,
      {
        broadcast: (update, to) => deliver(id, { type: "update", update }, to),
        request: (sv) => deliver(id, { type: "request", from: id, sv }),
        save: async (update) => {
          saves.push(update);
          await saveImpl?.(update);
        },
        onSaveError: (err) => !(err instanceof ApiError && err.status < 500),
      },
      100,
    );
    const peer = { id, doc, sync, saves };
    peers.push(peer);
    return peer;
  };
  return { join };
}

const text = (doc: Y.Doc) => doc.getText("t").toString();

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("NotebookSync", () => {
  it("sends each edit to the others at once, and both end with everyone's text", () => {
    const r = room();
    const a = r.join("a");
    const b = r.join("b");
    a.doc.getText("t").insert(0, "Hello");
    b.doc.getText("t").insert(5, " world");
    expect(text(a.doc)).toBe("Hello world");
    expect(text(b.doc)).toBe("Hello world");
  });

  it("saves local edits in one merged batch after a pause, and not edits from others", async () => {
    const r = room();
    const a = r.join("a");
    const b = r.join("b");
    a.doc.getText("t").insert(0, "a");
    a.doc.getText("t").insert(1, "b");
    expect(a.saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(a.saves).toHaveLength(1);
    expect(b.saves).toHaveLength(0);
    const saved = new Y.Doc();
    Y.applyUpdate(saved, fromB64(a.saves[0]!));
    expect(saved.getText("t").toString()).toBe("ab");
  });

  it("loads the saved notebook, then gets newer edits from people already here", () => {
    const r = room();
    const a = r.join("a");
    a.doc.getText("t").insert(0, "saved");
    const savedState = toB64(Y.encodeStateAsUpdate(a.doc));
    a.doc.getText("t").insert(5, " + unsaved");
    const c = r.join("c");
    c.sync.load(savedState);
    expect(text(c.doc)).toBe("saved + unsaved");
  });

  it("retries a failed save later, and drops one the server refused", async () => {
    let fail: Error | null = new Error("offline");
    const r = room(async () => {
      if (fail) throw fail;
    });
    const a = r.join("a");
    a.doc.getText("t").insert(0, "x");
    await vi.advanceTimersByTimeAsync(150);
    expect(a.saves).toHaveLength(1);
    fail = null;
    await vi.advanceTimersByTimeAsync(5_100);
    expect(a.saves).toHaveLength(2); // the same edit, sent again

    fail = new ApiError("Your role can't write in the notebook", 403);
    a.doc.getText("t").insert(1, "y");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(a.saves).toHaveLength(3); // tried once, not again
  });

  it("saves what's left when closed", async () => {
    const r = room();
    const a = r.join("a");
    a.doc.getText("t").insert(0, "bye");
    a.sync.destroy();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.saves).toHaveLength(1);
  });
});
