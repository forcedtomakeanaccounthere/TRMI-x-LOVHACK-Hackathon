import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectSupabase, uniqueEmail, type TestSupabase } from "../support/supabase";

let supabase: TestSupabase;
let app: Express;

const PASSWORD = randomBytes(12).toString("base64url");

type Session = { access_token: string; user: { id: string } };
let ana: Session;
let ben: Session;

async function session(label: string) {
  const email = uniqueEmail(`dash-${label}`);
  await request(app).post("/api/auth/signup").send({ email, password: PASSWORD, name: label });
  const link = new URL(await supabase.verificationLink(email));
  await request(app).get(`${link.pathname}${link.search}`);
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body as Session;
}

const admin = () => createClient(supabase.url, supabase.serviceRoleKey, { auth: { persistSession: false } });
const auth = (s: Session) => ({ Authorization: `Bearer ${s.access_token}` });
const get = (s: Session, path: string) => request(app).get(path).set(auth(s));
const post = (s: Session, path: string, body: object = {}) => request(app).post(path).set(auth(s)).send(body);
const patch = (s: Session, path: string, body: object) => request(app).patch(path).set(auth(s)).send(body);
const remove = (s: Session, path: string) => request(app).delete(path).set(auth(s));

async function createRoom(title: string) {
  const res = await post(ana, "/api/rooms/text", { title, text: "text" });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

beforeAll(async () => {
  supabase = await connectSupabase();
  Object.assign(process.env, {
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    API_PUBLIC_URL: "http://127.0.0.1:4000",
    WEB_ORIGIN: "http://web.test",
    AUTH_RATE_LIMIT: "1000",
  });
  const { createApp } = await import("../../src/app");
  app = createApp();
  ana = await session("ana");
  ben = await session("ben");
});

afterAll(() => supabase?.close());

describe("profile", () => {
  it("needs a session", async () => {
    expect((await request(app).get("/api/me/profile")).status).toBe(401);
  });

  it("creates a profile from the signup name", async () => {
    const res = await get(ana, "/api/me/profile");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ana.user.id, display_name: "ana", bio: null, avatar_color: null });
  });

  it("updates the profile and trims what it stores", async () => {
    const res = await patch(ana, "/api/me/profile", {
      display_name: "  Ana  ",
      bio: "  Reads papers  ",
      avatar_color: "#3b82f6",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ display_name: "Ana", bio: "Reads papers", avatar_color: "#3b82f6" });

    // An empty bio clears it.
    expect((await patch(ana, "/api/me/profile", { bio: "" })).body.bio).toBeNull();
  });

  it("rejects bad input", async () => {
    expect((await patch(ana, "/api/me/profile", {})).status).toBe(400);
    expect((await patch(ana, "/api/me/profile", { display_name: "   " })).status).toBe(400);
    expect((await patch(ana, "/api/me/profile", { bio: "x".repeat(281) })).status).toBe(400);
    expect((await patch(ana, "/api/me/profile", { avatar_color: "red" })).status).toBe(400);
  });
});

describe("groups", () => {
  it("needs a session and starts empty", async () => {
    expect((await request(app).get("/api/groups")).status).toBe(401);
    expect((await get(ana, "/api/groups")).body).toEqual({ groups: [] });
  });

  it("creates, lists and orders groups, and refuses duplicate names", async () => {
    const later = await post(ana, "/api/groups", { name: "Later", position: 2 });
    const earlier = await post(ana, "/api/groups", { name: "Earlier", color: "#22c55e", position: 1 });
    expect(later.status).toBe(201);
    expect(earlier.status).toBe(201);

    const { groups } = (await get(ana, "/api/groups")).body;
    expect(groups.map((group: { name: string }) => group.name)).toEqual(["Earlier", "Later"]);
    expect(groups[0]).toMatchObject({ color: "#22c55e", room_count: 0 });

    expect((await post(ana, "/api/groups", { name: "Earlier" })).status).toBe(409);
  });

  it("renames and recolours a group, but only its owner may", async () => {
    const { id } = (await post(ana, "/api/groups", { name: "Rename me" })).body;

    const res = await patch(ana, `/api/groups/${id}`, { name: "Renamed", color: null });
    expect(res.body).toMatchObject({ id, name: "Renamed", color: null });

    expect((await patch(ben, `/api/groups/${id}`, { name: "Stolen" })).status).toBe(404);
    expect((await remove(ben, `/api/groups/${id}`)).status).toBe(404);
    expect((await patch(ana, `/api/groups/${id}`, {})).status).toBe(400);
  });

  it("counts rooms and leaves them unfiled when the group is deleted", async () => {
    const { id } = (await post(ana, "/api/groups", { name: "To delete" })).body;
    const room = await createRoom("Filed room");
    expect((await patch(ana, `/api/rooms/${room}`, { group_id: id })).status).toBe(200);

    const [group] = (await get(ana, "/api/groups")).body.groups.filter((g: { id: string }) => g.id === id);
    expect(group.room_count).toBe(1);

    expect((await remove(ana, `/api/groups/${id}`)).status).toBe(204);
    const [roomAgain] = (await get(ana, "/api/me/rooms").query({ q: "Filed room" })).body.rooms;
    expect(roomAgain.group_id).toBeNull();
  });
});

describe("projects (groups of rooms)", () => {
  it("refuses every project route without a session", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect((await request(app).post("/api/groups").send({ name: "Nope" })).status).toBe(401);
    expect((await request(app).patch(`/api/groups/${id}`).send({ name: "Nope" })).status).toBe(401);
    expect((await request(app).delete(`/api/groups/${id}`)).status).toBe(401);
    expect((await request(app).patch("/api/rooms/anything").send({ group_id: id })).status).toBe(401);
  });

  it("lists a project's rooms for its owner, and keeps the project private from members", async () => {
    const cara = await session("cara");
    const { id } = (await post(ana, "/api/groups", { name: "Mindlax", color: "#22c55e" })).body;
    const room = await createRoom("Project room");
    await createRoom("Unfiled room");
    expect((await patch(ana, `/api/rooms/${room}`, { group_id: id })).status).toBe(200);
    expect((await post(cara, `/api/rooms/${room}/join`)).status).toBe(200);

    const filed = (await get(ana, "/api/me/rooms").query({ group_id: id })).body;
    expect(filed.rooms.map((r: { id: string }) => r.id)).toEqual([room]);
    expect(filed.rooms[0].group_id).toBe(id);

    const [seenByMember] = (await get(cara, "/api/me/rooms").query({ q: "Project room" })).body.rooms;
    expect(seenByMember).toMatchObject({ id: room, role: "member", group_id: null });
    expect((await get(cara, "/api/me/rooms").query({ group_id: id })).body).toEqual({ rooms: [], total: 0 });
  });

  it("moves a room out of its project", async () => {
    const { id } = (await post(ana, "/api/groups", { name: "Moved from" })).body;
    const room = await createRoom("Moved room");
    await patch(ana, `/api/rooms/${room}`, { group_id: id });

    expect((await patch(ana, `/api/rooms/${room}`, { group_id: null })).body.group_id).toBeNull();
    expect((await get(ana, "/api/me/rooms").query({ group_id: id })).body.total).toBe(0);
  });

  it("won't let a member file someone else's room", async () => {
    const dev = await session("dev");
    const { id } = (await post(dev, "/api/groups", { name: "Dev's" })).body;
    const room = await createRoom("Not Dev's");
    await post(dev, `/api/rooms/${room}/join`);

    expect((await patch(dev, `/api/rooms/${room}`, { group_id: id })).status).toBe(404);
  });
});

describe("follows", () => {
  it("searches people, excluding the caller", async () => {
    const res = await get(ana, "/api/users/search").query({ q: "ben" });
    expect(res.status).toBe(200);
    expect(res.body.users).toContainEqual(expect.objectContaining({ id: ben.user.id, display_name: "ben", is_following: false }));

    const self = await get(ana, "/api/users/search").query({ q: "ana" });
    expect(self.body.users.map((user: { id: string }) => user.id)).not.toContain(ana.user.id);
  });

  it("follows, lists and unfollows", async () => {
    expect((await post(ana, `/api/users/${ben.user.id}/follow`)).body).toEqual({ id: ben.user.id, following: true });
    // Following twice is harmless.
    expect((await post(ana, `/api/users/${ben.user.id}/follow`)).status).toBe(200);

    expect((await get(ana, "/api/me/following")).body.users).toContainEqual(
      expect.objectContaining({ id: ben.user.id, is_following: true }),
    );
    expect((await get(ben, "/api/me/followers")).body.users).toContainEqual(
      expect.objectContaining({ id: ana.user.id, is_following: false }),
    );
    const search = (await get(ana, "/api/users/search").query({ q: "ben" })).body.users as { id: string; is_following: boolean }[];
    expect(search.find((user) => user.id === ben.user.id)?.is_following).toBe(true);

    expect((await remove(ana, `/api/users/${ben.user.id}/follow`)).body).toEqual({
      id: ben.user.id,
      following: false,
    });
    expect((await get(ana, "/api/me/following")).body.users).toEqual([]);
  });

  it("refuses following yourself or someone unknown", async () => {
    expect((await post(ana, `/api/users/${ana.user.id}/follow`)).status).toBe(400);
    expect((await post(ana, "/api/users/11111111-1111-4111-8111-111111111111/follow")).status).toBe(404);
    expect((await post(ana, "/api/users/not-a-uuid/follow")).status).toBe(400);
  });
});

describe("participants", () => {
  it("lists the people who share a room, most recently seen first", async () => {
    const room = await createRoom("Shared room");
    expect((await post(ana, `/api/rooms/${room}/join`)).status).toBe(200);
    expect((await post(ben, `/api/rooms/${room}/join`)).status).toBe(200);

    const forAna = await get(ana, "/api/me/participants");
    expect(forAna.status).toBe(200);
    const guest = forAna.body.participants.find((person: { user_id: string }) => person.user_id === ben.user.id);
    expect(guest).toMatchObject({ display_name: "ben", live: true, shared_rooms: 1 });

    const forBen = await get(ben, "/api/me/participants");
    expect(forBen.body.participants.map((person: { user_id: string }) => person.user_id)).toContain(ana.user.id);
  });

  it("needs a session", async () => {
    expect((await request(app).get("/api/me/participants")).status).toBe(401);
  });
});

describe("invites", () => {
  it("invites a user, and shows the invite on both dashboards", async () => {
    const room = await createRoom("Invite room");
    const res = await post(ana, `/api/rooms/${room}/invites`, { user_id: ben.user.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      room_id: room,
      room_title: "Invite room",
      status: "pending",
      from: { id: ana.user.id },
      to: { id: ben.user.id },
    });

    expect((await get(ana, "/api/me/invites")).body.sent.map((invite: { room_id: string }) => invite.room_id)).toContain(room);
    expect((await get(ben, "/api/me/invites")).body.received.map((invite: { room_id: string }) => invite.room_id)).toContain(room);

    // The same pending invite is not created twice.
    expect((await post(ana, `/api/rooms/${room}/invites`, { user_id: ben.user.id })).status).toBe(409);
  });

  it("won't invite someone already in the room, the owner, or a stranger", async () => {
    const room = await createRoom("Already here");
    expect((await post(ben, `/api/rooms/${room}/join`)).status).toBe(200);

    expect((await post(ana, `/api/rooms/${room}/invites`, { user_id: ben.user.id })).status).toBe(409);
    expect((await post(ana, `/api/rooms/${room}/invites`, { user_id: ana.user.id })).status).toBe(400);
    expect((await post(ana, `/api/rooms/${room}/invites`, { user_id: "11111111-1111-4111-8111-111111111111" })).status).toBe(404);
  });

  it("only the owner may invite", async () => {
    const room = await createRoom("Owner only");
    expect((await post(ben, `/api/rooms/${room}/invites`, { user_id: ben.user.id })).status).toBe(404);
  });

  it("hides a deleted room from the invitee until it is restored", async () => {
    const room = await createRoom("Invite then delete");
    expect((await post(ana, `/api/rooms/${room}/invites`, { user_id: ben.user.id })).status).toBe(201);
    const invitedTo = async (s: Session, box: "received" | "sent") =>
      (await get(s, "/api/me/invites")).body[box].map((invite: { room_id: string }) => invite.room_id);

    expect((await remove(ana, `/api/rooms/${room}`)).status).toBe(200);
    expect(await invitedTo(ben, "received")).not.toContain(room);
    expect(await invitedTo(ana, "sent")).toContain(room);
    expect((await post(ana, `/api/rooms/${room}/invites`, { user_id: ben.user.id })).status).toBe(404);

    expect((await post(ana, `/api/rooms/${room}/restore`)).status).toBe(200);
    expect(await invitedTo(ben, "received")).toContain(room);
  });

  it("allows a new invite once the last one is no longer pending", async () => {
    const room = await createRoom("Invite again");
    const { id } = (await post(ana, `/api/rooms/${room}/invites`, { user_id: ben.user.id })).body;

    await admin().from("room_invites").update({ status: "revoked" }).eq("id", id);
    expect((await post(ana, `/api/rooms/${room}/invites`, { user_id: ben.user.id })).status).toBe(201);
  });
});

describe("privacy and clean-up", () => {
  it("never exposes an email address through people search", async () => {
    const res = await get(ana, "/api/users/search").query({ q: "ben" });
    expect(JSON.stringify(res.body)).not.toContain("@");
  });

  it("treats wildcards in a people search as plain text", async () => {
    expect((await get(ana, "/api/users/search").query({ q: "%" })).body.users).toEqual([]);
    expect((await get(ana, "/api/users/search").query({ q: "_en" })).body.users).toEqual([]);
  });

  it("keeps each person's groups to themselves, and leaves deleted rooms out of the count", async () => {
    const { id } = (await post(ana, "/api/groups", { name: "Counted" })).body;
    const kept = await createRoom("Kept in group");
    const gone = await createRoom("Deleted from group");
    await patch(ana, `/api/rooms/${kept}`, { group_id: id });
    await patch(ana, `/api/rooms/${gone}`, { group_id: id });
    await remove(ana, `/api/rooms/${gone}`);

    const count = (await get(ana, "/api/groups")).body.groups.find((g: { id: string }) => g.id === id).room_count;
    expect(count).toBe(1);
    expect((await get(ben, "/api/groups")).body.groups.map((g: { id: string }) => g.id)).not.toContain(id);
  });

  it("stops a deleted room from connecting people", async () => {
    const stranger = await session("stranger");
    const room = await createRoom("Only link");
    await post(stranger, `/api/rooms/${room}/join`);
    const people = async () =>
      (await get(ana, "/api/me/participants")).body.participants.map((p: { user_id: string }) => p.user_id);

    expect(await people()).toContain(stranger.user.id);
    await remove(ana, `/api/rooms/${room}`);
    expect(await people()).not.toContain(stranger.user.id);
  });

  it("counts every room two people share", async () => {
    const pal = await session("pal");
    for (const title of ["Shared one", "Shared two"]) {
      await post(pal, `/api/rooms/${await createRoom(title)}/join`);
    }

    const { participants } = (await get(ana, "/api/me/participants")).body;
    const found = participants.find((p: { user_id: string }) => p.user_id === pal.user.id);
    expect(found).toMatchObject({ shared_rooms: 2, live: true });
  });

  it("removes an account from every list when it is deleted", async () => {
    const leaver = await session("leaver");
    const room = await createRoom("Leaver room");
    await post(leaver, `/api/rooms/${room}/join`);
    await post(ana, `/api/users/${leaver.user.id}/follow`);
    await post(leaver, `/api/users/${ana.user.id}/follow`);

    expect((await admin().auth.admin.deleteUser(leaver.user.id)).error).toBeNull();

    const ids = (users: { id: string }[]) => users.map((user) => user.id);
    expect(ids((await get(ana, "/api/me/following")).body.users)).not.toContain(leaver.user.id);
    expect(ids((await get(ana, "/api/me/followers")).body.users)).not.toContain(leaver.user.id);
    const [roomAfter] = (await get(ana, "/api/me/rooms").query({ q: "Leaver room" })).body.rooms;
    expect(roomAfter).toMatchObject({ participant_count: 0, people: [] });
  });
});
