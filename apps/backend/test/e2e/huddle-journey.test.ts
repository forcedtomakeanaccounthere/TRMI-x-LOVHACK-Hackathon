import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBackend, type Backend } from "../support/backend-process";
import { startFakeAi, type FakeAi } from "../support/fake-ai";
import { startFakeLiveKit, type FakeLiveKit } from "../support/fake-livekit";
import { uniqueEmail } from "../support/supabase";

type Session = { access_token: string; user: { id: string } };

type HuddleNotesData = {
  status: string;
  version: number;
  notes: {
    summary: string;
    key_points: Array<{ anchor: { doc: string; block: string } | null }>;
    decisions: Array<{ anchor: { doc: string; block: string } | null }>;
    action_items: Array<{ anchor: { doc: string; block: string } | null }>;
    open_questions: Array<{ anchor: { doc: string; block: string } | null }>;
  };
};

describe("Voice huddle E2E journey", () => {
  let be: Backend;
  let ai: FakeAi;
  let fakeLiveKit: FakeLiveKit;

  async function account(label: string, name: string): Promise<Session> {
    const email = uniqueEmail(`huddle.e2e.${label}`);
    const password = randomBytes(12).toString("base64url");
    expect((await be.post("/api/auth/signup", { email, password, name })).status).toBe(201);
    await be.clickVerificationLink(email);
    const res = await be.post("/api/auth/login", { email, password });
    expect(res.status).toBe(200);
    return (await res.json()) as Session;
  }

  beforeAll(async () => {
    ai = await startFakeAi();
    fakeLiveKit = await startFakeLiveKit();
    be = await startBackend({
      AI_SERVICE_URL: ai.url,
      AI_INTERNAL_TOKEN: ai.token,
      LIVEKIT_URL: fakeLiveKit.url,
      LIVEKIT_API_KEY: "fake-livekit-key",
      LIVEKIT_API_SECRET: "fake-livekit-secret",
    });
  });

  afterAll(async () => {
    await be?.stop();
    await ai?.stop();
    await fakeLiveKit?.stop();
  });

  it("three people join a room-wide huddle, post focus and captions, end it -> notes ready with anchors", async () => {
    const olivia = await account("owner", "Olivia");
    const max = await account("member", "Max");
    const guestId = `guest-${randomBytes(5).toString("hex")}`;
    const guestKey = randomBytes(16).toString("hex");

    const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
      fetch(`${be.api}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    const as = {
      olivia: { Authorization: `Bearer ${olivia.access_token}` },
      max: { Authorization: `Bearer ${max.access_token}` },
      gus: { "X-Guest-Id": guestId, "X-Guest-Key": guestKey },
    };

    // 1. Olivia creates a room with two paragraphs (blocks b0 and b1)
    const createRoomRes = await call("POST", "/api/rooms/text", as.olivia, {
      title: "Biology Study Session",
      text: "Cells divide by mitosis.\n\nDNA replication occurs before cell division.",
    });
    expect(createRoomRes.status).toBe(201);
    const { id: roomId } = (await createRoomRes.json()) as { id: string };

    // Max joins room ledger as editor
    await call("POST", `/api/rooms/${roomId}/events`, as.max, {
      events: [
        {
          id: `ev_${Date.now()}_1`,
          at: new Date().toISOString(),
          actor: { id: max.user.id, name: "Max", color: "#22c55e" },
          type: "chat",
          message: { id: "m1", text: "Ready to discuss", author: { id: max.user.id, name: "Max" }, at: new Date().toISOString() },
        },
      ],
    });

    // Gus joins room ledger as guest
    await call("POST", `/api/rooms/${roomId}/events`, as.gus, {
      events: [
        {
          id: `ev_${Date.now()}_2`,
          at: new Date().toISOString(),
          actor: { id: guestId, name: "Gus", color: "#3b82f6" },
          type: "chat",
          message: { id: "m2", text: "Joined as guest", author: { id: guestId, name: "Gus" }, at: new Date().toISOString() },
        },
      ],
    });

    // 2. Olivia starts a room-wide huddle
    const huddleRes = await call("POST", `/api/rooms/${roomId}/huddles`, as.olivia, {
      audience: "all",
    });
    expect(huddleRes.status).toBe(201);
    const { huddle } = (await huddleRes.json()) as { huddle: { id: string } };
    const hid = huddle.id;

    // Max and Gus join the huddle
    const maxJoin = await call("POST", `/api/rooms/${roomId}/huddles/${hid}/join`, as.max, {});
    expect(maxJoin.status).toBe(200);

    const gusJoin = await call("POST", `/api/rooms/${roomId}/huddles/${hid}/join`, as.gus, {
      name: "Gus",
    });
    expect(gusJoin.status).toBe(200);

    // 3. Post focus changes
    // Max and Gus look at block b0
    const focus1 = await call("POST", `/api/rooms/${roomId}/huddles/${hid}/focus`, as.max, {
      doc: roomId,
      block: "b0",
    });
    expect(focus1.status).toBe(200);

    const focus2 = await call("POST", `/api/rooms/${roomId}/huddles/${hid}/focus`, as.gus, {
      doc: roomId,
      block: "b0",
    });
    expect(focus2.status).toBe(200);

    // 4. Post captions (first segment while focused on b0)
    const t0 = new Date(Date.now() - 15_000).toISOString();
    const t1 = new Date(Date.now() - 10_000).toISOString();
    const seg1Res = await call("POST", `/api/rooms/${roomId}/huddles/${hid}/segments`, as.olivia, {
      segments: [
        {
          id: "seg_e2e_1",
          text: "Let us review mitosis and cell division mechanisms.",
          start_at: t0,
          end_at: t1,
          focus: { doc: roomId, block: "b0" },
        },
      ],
    });
    expect(seg1Res.status).toBe(200);

    // Later, Max and Gus move focus to block b1
    await call("POST", `/api/rooms/${roomId}/huddles/${hid}/focus`, as.max, {
      doc: roomId,
      block: "b1",
    });
    await call("POST", `/api/rooms/${roomId}/huddles/${hid}/focus`, as.gus, {
      doc: roomId,
      block: "b1",
    });

    const t2 = new Date(Date.now() - 5_000).toISOString();
    const t3 = new Date(Date.now() - 1_000).toISOString();
    const seg2Res = await call("POST", `/api/rooms/${roomId}/huddles/${hid}/segments`, as.max, {
      segments: [
        {
          id: "seg_e2e_2",
          text: "And DNA replication happens during interphase before mitosis.",
          start_at: t2,
          end_at: t3,
          focus: { doc: roomId, block: "b1" },
        },
      ],
    });
    expect(seg2Res.status).toBe(200);

    // 5. Olivia ends the huddle
    const endRes = await call("POST", `/api/rooms/${roomId}/huddles/${hid}/end`, as.olivia);
    expect(endRes.status).toBe(200);

    // 6. Notes become ready and every point's anchor is a {doc, block} someone was looking at
    let readyNotes: HuddleNotesData | undefined;
    for (let i = 0; i < 50; i++) {
      const getNotesRes = await call("GET", `/api/rooms/${roomId}/huddles/${hid}/notes`, as.olivia);
      const data = (await getNotesRes.json()) as HuddleNotesData;
      if (data.status === "ready") {
        readyNotes = data;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(readyNotes).toBeDefined();
    if (!readyNotes) throw new Error("readyNotes was not set");
    expect(readyNotes.status).toBe("ready");
    expect(readyNotes.version).toBe(1);
    expect(readyNotes.notes).toBeDefined();
    expect(readyNotes.notes.summary).toBe("Fake huddle notes summary");

    // Check all points across sections have anchors corresponding to what was viewed ({doc: roomId, block: 'b0'|'b1'})
    const allPoints = [
      ...readyNotes.notes.key_points,
      ...readyNotes.notes.decisions,
      ...readyNotes.notes.action_items,
      ...readyNotes.notes.open_questions,
    ];
    expect(allPoints.length).toBeGreaterThan(0);

    for (const point of allPoints) {
      expect(point.anchor).toBeDefined();
      if (!point.anchor) throw new Error("point anchor missing");
      expect(point.anchor.doc).toBe(roomId);
      expect(["b0", "b1"]).toContain(point.anchor.block);
    }

    const aiCalls = ai.calls("/huddle-notes");
    expect(aiCalls.length).toBeGreaterThan(0);
    expect((aiCalls[0]?.body as { title: string }).title).toBe("Biology Study Session");
  });
});
