import {
  ParticipantsResponse,
  Profile,
  UpdateProfileRequest,
  UsersResponse,
  type MeParticipant,
} from "@linkroom/shared";
import { Router } from "express";
import { inviteViews, isLive, profilesByIds, userSummaries } from "../lib/dashboard";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middleware/auth";
import { listRooms, MAX_PARTICIPATION } from "./rooms";

export const meRouter = Router();

// GET /api/me/rooms: the dashboard room list (search, filters, people and counts).
meRouter.get("/rooms", requireAuth, listRooms);

// The profile row is created with the account, but make one for older accounts just in case.
async function ensureProfile(user: { id: string; name: string }) {
  const db = supabaseAdmin();
  const { data, error } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: insertError } = await db
    .from("profiles")
    .insert({ id: user.id, display_name: user.name || "Reader" })
    .select("*")
    .single();
  if (!insertError) return created;
  if (insertError.code !== "23505") throw insertError;

  const { data: raced, error: rereadError } = await db.from("profiles").select("*").eq("id", user.id).single();
  if (rereadError) throw rereadError;
  return raced;
}

// GET /api/me/profile
meRouter.get("/profile", requireAuth, async (req, res) => {
  res.json(Profile.parse(await ensureProfile(req.user!)));
});

// PATCH /api/me/profile  { display_name?, bio?, avatar_color? }
meRouter.patch("/profile", requireAuth, async (req, res) => {
  const body = UpdateProfileRequest.parse(req.body);
  await ensureProfile(req.user!);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.display_name !== undefined) patch.display_name = body.display_name;
  if (body.bio !== undefined) patch.bio = body.bio || null;
  if (body.avatar_color !== undefined) patch.avatar_color = body.avatar_color;

  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .update(patch)
    .eq("id", req.user!.id)
    .select("*")
    .single();
  if (error) throw error;

  res.json(Profile.parse(data));
});

// People the user follows, and people who follow them. Both include is_following from the user's side.
async function followList(column: "follower_id" | "followee_id", userId: string) {
  const db = supabaseAdmin();
  const other = column === "follower_id" ? "followee_id" : "follower_id";
  const { data, error } = await db
    .from("follows")
    .select(other)
    .eq(column, userId)
    .order("created_at", { ascending: false })
    .limit(MAX_PARTICIPATION);
  if (error) throw error;

  const ids = (data as Record<string, string>[]).map((row) => row[other]!);
  return userSummaries(db, ids, userId);
}

// GET /api/me/following
meRouter.get("/following", requireAuth, async (req, res) => {
  res.json({ users: await followList("follower_id", req.user!.id) } satisfies UsersResponse);
});

// GET /api/me/followers
meRouter.get("/followers", requireAuth, async (req, res) => {
  res.json({ users: await followList("followee_id", req.user!.id) } satisfies UsersResponse);
});

// GET /api/me/participants: everyone who shares a room with the user, most recently seen first.
meRouter.get("/participants", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const db = supabaseAdmin();

  const [owned, joined] = await Promise.all([
    db.from("rooms").select("id").eq("created_by", userId).limit(MAX_PARTICIPATION),
    db.from("room_participants").select("room_id").eq("user_id", userId).limit(MAX_PARTICIPATION),
  ]);
  if (owned.error) throw owned.error;
  if (joined.error) throw joined.error;

  const roomIds = [...new Set([...owned.data, ...joined.data].map((row) => ("room_id" in row ? row.room_id : row.id)))];
  if (!roomIds.length) {
    res.json({ participants: [] } satisfies ParticipantsResponse);
    return;
  }

  // Deleted rooms are invisible, so they don't connect people on the dashboard either.
  const { data: rooms, error: roomsError } = await db.from("rooms").select("id, status").in("id", roomIds);
  if (roomsError) throw roomsError;
  const visible = rooms.filter((room) => room.status !== "deleted").map((room) => room.id as string);
  if (!visible.length) {
    res.json({ participants: [] } satisfies ParticipantsResponse);
    return;
  }

  const { data, error } = await db
    .from("room_participants")
    .select("room_id, user_id, last_seen_at")
    .in("room_id", visible)
    .neq("user_id", userId);
  if (error) throw error;

  const rows = data as { room_id: string; user_id: string; last_seen_at: string }[];
  const profiles = await profilesByIds(db, [...new Set(rows.map((row) => row.user_id))]);
  const people = new Map<string, { last_seen_at: string; live: boolean; rooms: Set<string> }>();

  for (const row of rows) {
    const person = people.get(row.user_id) ?? { last_seen_at: row.last_seen_at, live: false, rooms: new Set() };
    person.rooms.add(row.room_id);
    if (Date.parse(row.last_seen_at) > Date.parse(person.last_seen_at)) person.last_seen_at = row.last_seen_at;
    person.live ||= isLive(row.last_seen_at);
    people.set(row.user_id, person);
  }

  const participants = [...people.entries()]
    .flatMap(([id, person]): MeParticipant[] => {
      const profile = profiles.get(id);
      if (!profile) return [];
      return [
        {
          user_id: id,
          display_name: profile.display_name,
          avatar_color: profile.avatar_color,
          last_seen_at: person.last_seen_at,
          live: person.live,
          shared_rooms: person.rooms.size,
        },
      ];
    })
    .sort((a, b) => Number(b.live) - Number(a.live) || Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at));

  res.json({ participants } satisfies ParticipantsResponse);
});

// GET /api/me/invites: pending and past invites in both directions.
meRouter.get("/invites", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const db = supabaseAdmin();
  const select = "id, room_id, inviter_id, invitee_id, status, created_at, responded_at";

  const [received, sent] = await Promise.all([
    db.from("room_invites").select(select).eq("invitee_id", userId).order("created_at", { ascending: false }),
    db.from("room_invites").select(select).eq("inviter_id", userId).order("created_at", { ascending: false }),
  ]);
  if (received.error) throw received.error;
  if (sent.error) throw sent.error;

  const rows = [...received.data, ...sent.data];
  const roomIds = [...new Set(rows.map((row) => row.room_id as string))];
  const titles = new Map<string, string | null>();
  const deleted = new Set<string>();
  if (roomIds.length) {
    const { data, error } = await db.from("rooms").select("id, title, status").in("id", roomIds);
    if (error) throw error;
    for (const room of data) {
      titles.set(room.id as string, room.title as string | null);
      if (room.status === "deleted") deleted.add(room.id as string);
    }
  }

  // A deleted room is visible to its owner only, so an invite to one can't reveal its title.
  const visibleReceived = received.data.filter((row) => !deleted.has(row.room_id as string));

  const [receivedViews, sentViews] = await Promise.all([
    inviteViews(db, visibleReceived, titles, userId),
    inviteViews(db, sent.data, titles, userId),
  ]);
  res.json({ received: receivedViews, sent: sentViews });
});
