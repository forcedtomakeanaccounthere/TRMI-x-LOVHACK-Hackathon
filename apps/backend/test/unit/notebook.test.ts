import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// GET/POST /api/rooms/:id/notebook against an in-memory room_notebooks table: updates are merged into
// one saved Yjs document, a write that lost a race is merged again, and roles are checked.

type Row = { state: string; version: number };
let room: Record<string, unknown> | null = null;
let settings: Record<string, unknown> | null = null;
const notebooks = new Map<string, Row>();
let raceOnce = false; // the next conditional update finds the version changed

function table(name: string) {
  const filters: Record<string, unknown> = {};
  let patch: Partial<Row> | null = null;
  const run = async () => {
    if (name === "rooms") return { data: room, error: null };
    if (name === "room_settings") return { data: settings, error: null };
    if (name !== "room_notebooks") return { data: null, error: null };
    const row = notebooks.get(filters.room_id as string);
    if (!patch) return { data: row ?? null, error: null };
    if (raceOnce || !row || ("version" in filters && row.version !== filters.version)) {
      raceOnce = false;
      return { data: [], error: null };
    }
    notebooks.set(filters.room_id as string, { ...row, ...patch } as Row);
    return { data: [{ room_id: filters.room_id }], error: null };
  };
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    maybeSingle: run,
    then: (resolve: (r: unknown) => unknown) => run().then(resolve),
    update: (values: Partial<Row>) => {
      patch = values;
      return builder;
    },
    insert: async (values: { room_id: string; state: string }) => {
      if (notebooks.has(values.room_id)) return { error: { code: "23505" } };
      notebooks.set(values.room_id, { state: values.state, version: 1 });
      return { error: null };
    },
  };
  return builder;
}

vi.mock("../../src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: table,
    auth: { getUser: async () => ({ data: { user: null }, error: new Error("no session") }) },
  }),
}));

const { createApp } = await import("../../src/app");
const app = createApp();

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
// A Yjs update that inserts `text` into the notebook's "default" fragment as a new paragraph.
function edit(text: string) {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment("default").insert(0, [paragraph]);
  return b64(Y.encodeStateAsUpdate(doc));
}
function textOf(state: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(state, "base64")));
  return doc.getXmlFragment("default").toString();
}
const post = (update: string, id = "room0001") => request(app).post(`/api/rooms/${id}/notebook`).send({ update });

beforeEach(() => {
  room = { status: "running", created_by: null };
  settings = null; // defaults: guests allowed, as editors
  notebooks.clear();
  raceOnce = false;
});

describe("POST /api/rooms/:id/notebook", () => {
  it("saves the first change, then merges later ones into the same document", async () => {
    expect((await post(edit("First line"))).status).toBe(204);
    expect((await post(edit("Second line"))).status).toBe(204);
    const saved = notebooks.get("room0001")!;
    expect(saved.version).toBe(2);
    expect(textOf(saved.state)).toContain("First line");
    expect(textOf(saved.state)).toContain("Second line");
  });

  it("merges again when another write landed between its read and its write", async () => {
    await post(edit("One"));
    raceOnce = true;
    expect((await post(edit("Two"))).status).toBe(204);
    expect(textOf(notebooks.get("room0001")!.state)).toContain("Two");
  });

  it("refuses something that isn't a Yjs update, and viewers", async () => {
    expect((await post("bm90IHlqcw==")).status).toBe(400);
    expect((await post("not base64!")).status).toBe(400);
    settings = { allow_guests: true, guest_role: "viewer", member_role: "editor", viewers_use_ai: true };
    expect((await post(edit("Hi"))).status).toBe(403);
    expect(notebooks.size).toBe(0);
  });

  it("refuses changes to a read-only room", async () => {
    room = { status: "archived", created_by: null };
    expect((await post(edit("Hi"))).status).toBe(409);
  });
});

describe("GET /api/rooms/:id/notebook", () => {
  it("returns the saved document, or null before anyone wrote", async () => {
    expect((await request(app).get("/api/rooms/room0001/notebook")).body).toEqual({ state: null });
    await post(edit("Hello"));
    const res = await request(app).get("/api/rooms/room0001/notebook");
    expect(textOf(res.body.state)).toContain("Hello");
  });
});
