import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { DashboardResponse, RoomStatus } from "@linkroom/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBackend, type Backend } from "../support/backend-process";
import { uniqueEmail } from "../support/supabase";

// The dashboard as two people use it, against the production build over HTTP.

type Session = { access_token: string; user: { id: string } };

describe("dashboard user stories (production build)", () => {
  let be: Backend;
  let host: Session;
  let friend: Session;

  async function account(label: string): Promise<Session> {
    const email = uniqueEmail(`dashboard.${label}`);
    const password = randomBytes(12).toString("base64url");
    expect((await be.post("/api/auth/signup", { email, password, name: label })).status).toBe(201);
    await be.clickVerificationLink(email);
    const res = await be.post("/api/auth/login", { email, password });
    expect(res.status).toBe(200);
    return (await res.json()) as Session;
  }

  async function createRoom(title: string) {
    const res = await be.post("/api/rooms/text", { title, text: "para one\n\npara two" }, host.access_token);
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  const dashboard = async (who: Session, query = "") => {
    const res = await be.get(`/api/rooms/mine${query}`, who.access_token);
    expect(res.status).toBe(200);
    return (await res.json()) as DashboardResponse;
  };

  const setStatus = (who: Session, id: string, status: RoomStatus) =>
    fetch(`${be.api}/api/rooms/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${who.access_token}` },
      body: JSON.stringify({ status }),
    });

  beforeAll(async () => {
    be = await startBackend({ AUTH_RATE_LIMIT: "100" });
    host = await account("host");
    friend = await account("friend");
  });
  afterAll(() => be?.stop());

  it("a new user starts with an empty dashboard", async () => {
    const fresh = await account("fresh");
    expect(await dashboard(fresh)).toEqual({ rooms: [], total: 0 });
  });

  it("host and friend: create → join → read → close → archive → delete → restore", async () => {
    // 1. The host creates a room; it shows as running on their dashboard.
    const id = await createRoom("Study group notes");
    const [created] = (await dashboard(host, "?q=study")).rooms;
    expect(created).toMatchObject({ id, status: "running", role: "owner" });

    // 2. The friend joins with the code and now has the room too.
    expect(await (await be.post(`/api/rooms/${id}/join`, {}, friend.access_token)).json()).toEqual({
      id,
      status: "running",
    });
    const [joined] = (await dashboard(friend, "?role=member")).rooms.filter((r) => r.id === id);
    expect(joined).toMatchObject({ role: "member", title: "Study group notes" });
    expect(joined?.last_opened_at).toBeTruthy();

    // 3. The friend can't close someone else's room.
    expect((await setStatus(friend, id, "closed")).status).toBe(404);

    // 4. The host closes it. Status filters move it, for both of them.
    expect((await setStatus(host, id, "closed")).status).toBe(200);
    expect((await dashboard(host, "?status=running&q=study")).rooms).toEqual([]);
    expect((await dashboard(friend, "?status=closed")).rooms.map((r) => r.id)).toContain(id);

    // 5. Archived rooms stay readable but take no recaps.
    expect((await setStatus(host, id, "archived")).status).toBe(200);
    expect((await be.post(`/api/rooms/${id}/join`, {}, friend.access_token)).status).toBe(200);
    expect((await be.post(`/api/rooms/${id}/recap`, {})).status).toBe(409);

    // 6. Deleted: gone for the friend, and from the host's default view, but kept in the host's bin.
    expect((await setStatus(host, id, "deleted")).status).toBe(200);
    expect((await dashboard(friend)).rooms.map((r) => r.id)).not.toContain(id);
    expect((await be.post(`/api/rooms/${id}/join`, {}, friend.access_token)).status).toBe(404);
    expect((await dashboard(host, "?q=study")).rooms).toEqual([]);
    expect((await dashboard(host, "?status=deleted&q=study")).rooms.map((r) => r.id)).toEqual([id]);

    // 7. A guest with the old link finds nothing.
    const guest = createClient(be.supabase.url, be.supabase.anonKey, { auth: { persistSession: false } });
    expect((await guest.from("rooms").select("id").eq("id", id)).data).toEqual([]);

    // 8. Restoring brings it back for everyone.
    expect((await setStatus(host, id, "closed")).status).toBe(200);
    expect((await guest.from("rooms").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await dashboard(friend)).rooms.map((r) => r.id)).toContain(id);
  });

  it("host: searches, filters and pages through many rooms", async () => {
    const tag = randomBytes(4).toString("hex");
    const a = await createRoom(`${tag} alpha`);
    const b = await createRoom(`${tag} beta`);
    const c = await createRoom(`${tag} gamma`);
    await setStatus(host, c, "archived");

    const all = await dashboard(host, `?q=${tag}&sort=title`);
    expect(all.total).toBe(3);
    expect(all.rooms.map((r) => r.id)).toEqual([a, b, c]);

    expect((await dashboard(host, `?q=${tag}&status=archived`)).rooms.map((r) => r.id)).toEqual([c]);
    expect((await dashboard(host, `?q=${tag}&kind=pdf`)).total).toBe(0);

    const page = await dashboard(host, `?q=${tag}&sort=title&limit=1&offset=1`);
    expect(page).toMatchObject({ total: 3 });
    expect(page.rooms.map((r) => r.id)).toEqual([b]);
  });

  it("is closed to anyone without a session", async () => {
    expect((await be.get("/api/rooms/mine")).status).toBe(401);
    expect((await be.post("/api/rooms/anything/join", {})).status).toBe(401);
    expect((await fetch(`${be.api}/api/rooms/anything/status`, { method: "PATCH" })).status).toBe(401);
  });
});
