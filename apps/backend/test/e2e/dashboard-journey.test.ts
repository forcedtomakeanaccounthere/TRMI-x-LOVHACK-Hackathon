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
    const res = await be.get(`/api/me/rooms${query}`, who.access_token);
    expect(res.status).toBe(200);
    return (await res.json()) as DashboardResponse;
  };

  const update = (who: Session, id: string, body: object) =>
    fetch(`${be.api}/api/rooms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${who.access_token}` },
      body: JSON.stringify(body),
    });
  const setStatus = (who: Session, id: string, status: RoomStatus) => update(who, id, { status });
  const remove = (who: Session, id: string) =>
    fetch(`${be.api}/api/rooms/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${who.access_token}` },
    });
  const restore = (who: Session, id: string) =>
    fetch(`${be.api}/api/rooms/${id}/restore`, {
      method: "POST",
      headers: { Authorization: `Bearer ${who.access_token}` },
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

  it("host and friend: create → join → read → pause → close → archive → delete → restore", async () => {
    // 1. The host creates a room; it shows as running on their dashboard, with the host on it.
    const id = await createRoom("Study group notes");
    const [created] = (await dashboard(host, "?q=study")).rooms;
    expect(created).toMatchObject({ id, status: "running", role: "owner", participant_count: 0, live_count: 0 });

    // 2. The friend joins with the code and now has the room too.
    expect(await (await be.post(`/api/rooms/${id}/join`, {}, friend.access_token)).json()).toEqual({
      id,
      status: "running",
    });
    const [joined] = (await dashboard(friend, "?role=member")).rooms.filter((r) => r.id === id);
    expect(joined).toMatchObject({ role: "member", title: "Study group notes", participant_count: 1, live_count: 1 });
    expect(joined?.last_opened_at).toBeTruthy();
    expect(joined?.people.map((person) => person.display_name)).toContain("friend");

    // 3. The friend can't change someone else's room.
    expect((await setStatus(friend, id, "closed")).status).toBe(404);

    // 4. The host pauses it: status filters move it, for both of them.
    expect((await setStatus(host, id, "paused")).status).toBe(200);
    expect((await dashboard(host, "?status=running&q=study")).rooms).toEqual([]);
    expect((await dashboard(friend, "?status=paused")).rooms.map((r) => r.id)).toContain(id);

    // 5. Closing it ends new highlights and comments; joining still works to read.
    expect((await setStatus(host, id, "closed")).status).toBe(200);
    expect((await be.post(`/api/rooms/${id}/join`, {}, friend.access_token)).status).toBe(200);

    // 6. Archived rooms stay readable but take no recaps.
    expect((await setStatus(host, id, "archived")).status).toBe(200);
    expect((await be.post(`/api/rooms/${id}/recap`, {})).status).toBe(409);

    // 7. Deleted: gone for the friend, and from the host's default view, but kept in the host's bin.
    expect((await remove(host, id)).status).toBe(200);
    expect((await dashboard(friend)).rooms.map((r) => r.id)).not.toContain(id);
    expect((await be.post(`/api/rooms/${id}/join`, {}, friend.access_token)).status).toBe(404);
    expect((await dashboard(host, "?q=study")).rooms).toEqual([]);
    expect((await dashboard(host, "?status=deleted&q=study")).rooms.map((r) => r.id)).toEqual([id]);

    // 8. A guest with the old link finds nothing.
    const guest = createClient(be.supabase.url, be.supabase.anonKey, { auth: { persistSession: false } });
    expect((await guest.from("rooms").select("id").eq("id", id)).data).toEqual([]);

    // 9. Restoring brings it back for everyone, running again.
    expect((await restore(host, id)).status).toBe(200);
    expect((await guest.from("rooms").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await dashboard(friend)).rooms.map((r) => r.id)).toContain(id);
    expect((await dashboard(host, "?q=study")).rooms[0]).toMatchObject({ status: "running" });
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

  it("host: groups, profile, follows and people work over HTTP", async () => {
    const group = await be.post("/api/groups", { name: "Study" }, host.access_token);
    expect(group.status).toBe(201);
    const groupId = ((await group.json()) as { id: string }).id;

    const room = await createRoom("Grouped e2e");
    expect((await update(host, room, { group_id: groupId })).status).toBe(200);
    expect(((await dashboard(host, `?group_id=${groupId}`)).rooms.map((r) => r.id))).toContain(room);

    expect((await be.get("/api/me/profile", host.access_token)).status).toBe(200);
    const profile = await fetch(`${be.api}/api/me/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.access_token}` },
      body: JSON.stringify({ display_name: "Host", avatar_color: "#3b82f6" }),
    });
    expect(((await profile.json()) as { display_name: string }).display_name).toBe("Host");

    const search = await be.get("/api/users/search?q=friend", host.access_token);
    const users = ((await search.json()) as { users: { id: string }[] }).users;
    expect(users.map((user) => user.id)).toContain(friend.user.id);
    expect((await be.post(`/api/users/${friend.user.id}/follow`, {}, host.access_token)).status).toBe(200);
    expect((await be.get("/api/me/following", host.access_token)).status).toBe(200);
    expect((await be.get("/api/me/followers", friend.access_token)).status).toBe(200);

    const participants = await be.get("/api/me/participants", host.access_token);
    expect(((await participants.json()) as { participants: { user_id: string }[] }).participants.map((p) => p.user_id)).toContain(
      friend.user.id,
    );

    const invite = await be.post(`/api/rooms/${room}/invites`, { user_id: friend.user.id }, host.access_token);
    expect(invite.status).toBe(201);
    expect((await be.get("/api/me/invites", friend.access_token)).status).toBe(200);
  });

  it("guest in a browser: can highlight a running room, but not a paused one", async () => {
    const id = await createRoom("Paused for a guest");
    const guest = createClient(be.supabase.url, be.supabase.anonKey, { auth: { persistSession: false } });
    const highlight = {
      room_id: id,
      author_name: "Guest",
      author_color: "#00ff00",
      block_id: "b0",
      start_offset: 0,
      end_offset: 4,
      quote: "para",
    };

    expect((await guest.from("highlights").insert(highlight)).error).toBeNull();
    expect((await setStatus(host, id, "paused")).status).toBe(200);
    expect((await guest.from("highlights").insert(highlight)).error?.code).toBe("42501");

    expect((await setStatus(host, id, "running")).status).toBe(200);
    expect((await guest.from("highlights").insert(highlight)).error).toBeNull();
    expect((await dashboard(host, "?q=Paused for a guest")).rooms[0]).toMatchObject({ highlight_count: 2 });

    const top = await be.get(`/api/rooms/${id}/top-members`, friend.access_token);
    expect(top.status).toBe(200);
    expect(await top.json()).toEqual({
      members: [{ name: "Guest", color: "#00ff00", highlight_count: 2, comment_count: 0, activity: 2 }],
    });
  });

  it("friend: an invite follows the room through delete and restore", async () => {
    const id = await createRoom("Invited e2e");
    expect((await be.post(`/api/rooms/${id}/invites`, { user_id: friend.user.id }, host.access_token)).status).toBe(201);
    expect((await be.post(`/api/rooms/${id}/invites`, { user_id: friend.user.id }, host.access_token)).status).toBe(409);

    type Invites = { received: { room_id: string }[]; sent: { room_id: string }[] };
    const invites = async (who: Session) =>
      (await (await be.get("/api/me/invites", who.access_token)).json()) as Invites;
    expect((await invites(friend)).received.map((invite) => invite.room_id)).toContain(id);

    expect((await remove(host, id)).status).toBe(200);
    expect((await invites(friend)).received.map((invite) => invite.room_id)).not.toContain(id);
    expect((await invites(host)).sent.map((invite) => invite.room_id)).toContain(id);

    expect((await restore(host, id)).status).toBe(200);
    expect((await invites(friend)).received.map((invite) => invite.room_id)).toContain(id);
  });

  it("host: deleting a group leaves its rooms, and unfollowing sticks", async () => {
    const groupRes = await be.post("/api/groups", { name: "Short-lived" }, host.access_token);
    const groupId = ((await groupRes.json()) as { id: string }).id;
    const room = await createRoom("Outlives its group");
    expect((await update(host, room, { group_id: groupId })).status).toBe(200);

    const send = (path: string) =>
      fetch(`${be.api}${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${host.access_token}` } });
    expect((await send(`/api/groups/${groupId}`)).status).toBe(204);
    expect((await dashboard(host, "?q=Outlives")).rooms[0]).toMatchObject({ id: room, group_id: null });

    expect((await be.post(`/api/users/${friend.user.id}/follow`, {}, host.access_token)).status).toBe(200);
    expect((await send(`/api/users/${friend.user.id}/follow`)).status).toBe(200);
    const following = (await (await be.get("/api/me/following", host.access_token)).json()) as { users: { id: string }[] };
    expect(following.users.map((user) => user.id)).not.toContain(friend.user.id);
  });

  it("is closed to anyone without a session", async () => {
    expect((await be.get("/api/me/rooms")).status).toBe(401);
    expect((await be.get("/api/me/participants")).status).toBe(401);
    expect((await be.get("/api/groups")).status).toBe(401);
    expect((await be.get("/api/users/search?q=a")).status).toBe(401);
    expect((await be.post("/api/rooms/anything/join", {})).status).toBe(401);
    expect((await fetch(`${be.api}/api/rooms/anything`, { method: "PATCH" })).status).toBe(401);
    expect((await fetch(`${be.api}/api/rooms/anything`, { method: "DELETE" })).status).toBe(401);
    expect((await be.post("/api/rooms/anything/restore", {})).status).toBe(401);
    expect((await be.post("/api/rooms/anything/invites", {})).status).toBe(401);
    expect((await be.post("/api/groups", {})).status).toBe(401);
    expect((await be.get("/api/me/following")).status).toBe(401);
    expect((await be.get("/api/me/followers")).status).toBe(401);
    expect((await be.get("/api/me/profile")).status).toBe(401);
    expect((await be.get("/api/me/invites")).status).toBe(401);
    expect((await be.get("/api/rooms/anything/top-members")).status).toBe(401);
  });
});
