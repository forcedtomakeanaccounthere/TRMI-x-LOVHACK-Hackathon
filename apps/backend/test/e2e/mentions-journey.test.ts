import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBackend, WEB, type Backend } from "../support/backend-process";
import { startFakeAi, type FakeAi } from "../support/fake-ai";
import { uniqueEmail } from "../support/supabase";

// Mentions bring people back into the room, end to end against the production build: Olivia tags
// Max while his tab is closed, so he gets an email; he follows the link back and heartbeats, so
// her next mention is a toast in the room instead of another email. A guest can tag him too, and
// his bell keeps every mention until he reads them.

type Session = { access_token: string; user: { id: string } };

describe("Mentions E2E journey", () => {
  let be: Backend;
  let ai: FakeAi;

  async function account(label: string, name: string) {
    const email = uniqueEmail(`mentions.e2e.${label}`);
    const password = randomBytes(12).toString("base64url");
    expect((await be.post("/api/auth/signup", { email, password, name })).status).toBe(201);
    await be.clickVerificationLink(email);
    const res = await be.post("/api/auth/login", { email, password });
    expect(res.status).toBe(200);
    return { email, name, ...((await res.json()) as Session) };
  }

  async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 6_000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = await read();
      if (done(v) || Date.now() > deadline) return v;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  beforeAll(async () => {
    ai = await startFakeAi();
    be = await startBackend({ AI_SERVICE_URL: ai.url, AI_INTERNAL_TOKEN: ai.token });
  });

  afterAll(async () => {
    await be?.stop();
    await ai?.stop();
  });

  it("an offline reader is emailed back in; once present, mentions are toasts; the bell keeps them", async () => {
    const olivia = await account("owner", "Olivia");
    const max = await account("member", "Max");
    const mentionMails = () =>
      be.supabase.inbox(max.email).then((mails) => mails.filter((m) => m.subject.includes("mentioned you")));

    // Olivia makes a room and shares it; Max opens it once, then closes the tab.
    const created = await be.post("/api/rooms/text", { title: "Cell biology", text: "Mitochondria make ATP." }, olivia.access_token);
    expect(created.status).toBe(201);
    const roomId = ((await created.json()) as { id: string }).id;
    expect((await be.post(`/api/rooms/${roomId}/join`, {}, max.access_token)).status).toBe(200);
    await be.supabase.setLastSeen(roomId, max.user.id, new Date(Date.now() - 30 * 60_000));

    // Her composer offers Max even though he isn't here.
    const people = (await (await be.get(`/api/notifications/rooms/${roomId}/people`)).json()) as {
      people: { id: string; name: string }[];
    };
    expect(people.people.map((p) => p.name)).toEqual(["Max", "Olivia"]);

    // She tags him in the chat: he isn't online, so the mention arrives by email.
    const tag = (author: { id: string; name: string }, eventId: string, body: string, token?: string) =>
      be.post(
        `/api/notifications/rooms/${roomId}/mentions`,
        { event_id: eventId, kind: "chat", body, author, mentions: [{ id: max.user.id, name: "Max" }] },
        token,
      );
    const first = await tag({ id: olivia.user.id, name: "Olivia" }, "chat-e2e-1", "@Max what do you think of p.2?", olivia.access_token);
    expect(await first.json()).toEqual({ notified: 1 });

    const mails = await until(mentionMails, (m) => m.length >= 1);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe("Olivia mentioned you in Cell biology");
    const link = mails[0]!.html.match(/href="([^"]+)"/)?.[1];
    expect(link).toBe(`${WEB}/r/${roomId}`);

    // He follows the link back: the room page heartbeats, which makes him present.
    expect((await be.post(`/api/rooms/${roomId}/heartbeat`, {}, max.access_token)).status).toBe(200);

    // Her next mention is a toast in the room, not another email. The toast itself is checked
    // where Realtime runs (CI starts Supabase without it).
    const listener = await be.supabase.listenForToasts(roomId);
    const toasts = (listener?.received ?? []) as { user_id: string; body: string; actor_name: string }[];

    const second = await tag({ id: olivia.user.id, name: "Olivia" }, "chat-e2e-2", "@Max welcome back", olivia.access_token);
    expect(await second.json()).toEqual({ notified: 1 });
    if (listener) {
      await until(async () => toasts.length, (n) => n > 0);
      expect(toasts).toEqual([expect.objectContaining({ user_id: max.user.id, body: "@Max welcome back", actor_name: "Olivia" })]);
    }

    // A guest in the room tags him too (guests announce without an account).
    const guest = await tag({ id: `guest-${randomBytes(4).toString("hex")}`, name: "Gus" }, "chat-e2e-3", "@Max hi from Gus");
    expect(await guest.json()).toEqual({ notified: 1 });
    if (listener) {
      await until(async () => toasts.length, (n) => n > 1);
      await listener.close();
    }

    // Only the first mention was emailed.
    await new Promise((r) => setTimeout(r, 500));
    expect(await mentionMails()).toHaveLength(1);

    // His bell has all three, newest first, until he opens it.
    const bell = async () =>
      (await (await be.get("/api/notifications", max.access_token)).json()) as {
        notifications: { actor_name: string; body: string }[];
        unread: number;
      };
    const inbox = await bell();
    expect(inbox.unread).toBe(3);
    expect(inbox.notifications.map((n) => n.actor_name)).toEqual(["Gus", "Olivia", "Olivia"]);
    expect((await be.post("/api/notifications/read", {}, max.access_token)).status).toBe(200);
    expect((await bell()).unread).toBe(0);

    // Olivia's own bell stays empty: nobody tagged her.
    const hers = (await (await be.get("/api/notifications", olivia.access_token)).json()) as { unread: number };
    expect(hers.unread).toBe(0);
  });
});
