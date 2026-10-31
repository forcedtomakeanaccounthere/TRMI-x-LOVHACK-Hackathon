import type { InviteStatus, RoomInvite, RoomParticipant, UserSummary } from "@linkroom/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

// A participant counts as "live now" while their last heartbeat is this recent. POST /api/rooms/:id/join
// doubles as the heartbeat, so the dashboard never has to subscribe to every room.
export const LIVE_WINDOW_MS = 2 * 60 * 1000;

export const isLive = (lastSeenAt: string) => Date.parse(lastSeenAt) >= Date.now() - LIVE_WINDOW_MS;

// A % or _ in a search is the literal character, not a wildcard.
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

// Supabase returns at most this many rows per request (max_rows in supabase/config.toml).
const PAGE_SIZE = 1000;
// Keeps a list of ids short enough to fit in a request URL.
const CHUNK_SIZE = 200;

// Reads every page of a query. `page` must sort on something unique, or rows can repeat or go missing.
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
) {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

// Runs a query over a long list of ids, a chunk at a time.
export async function inChunks<T>(ids: string[], run: (chunk: string[]) => Promise<T[]>) {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) chunks.push(ids.slice(i, i + CHUNK_SIZE));
  return (await Promise.all(chunks.map(run))).flat();
}

type ProfileRow = { id: string; display_name: string; avatar_color: string | null };

export async function profilesByIds(db: SupabaseClient, ids: string[]) {
  if (!ids.length) return new Map<string, ProfileRow>();
  const rows = await inChunks(ids, async (chunk) => {
    const { data, error } = await db.from("profiles").select("id, display_name, avatar_color").in("id", chunk);
    if (error) throw error;
    return data as ProfileRow[];
  });
  return new Map(rows.map((profile) => [profile.id, profile]));
}

export async function followedIds(db: SupabaseClient, userId: string) {
  const rows = await fetchAll<{ followee_id: string }>((from, to) =>
    db.from("follows").select("followee_id").eq("follower_id", userId).order("followee_id").range(from, to),
  );
  return new Set(rows.map((row) => row.followee_id));
}

// Shapes profiles into the user summaries the dashboard shows, from the viewer's side.
export async function userSummaries(db: SupabaseClient, ids: string[], viewerId: string) {
  const [profiles, following] = await Promise.all([profilesByIds(db, ids), followedIds(db, viewerId)]);
  return ids.flatMap((id): UserSummary[] => {
    const profile = profiles.get(id);
    if (!profile) return [];
    return [{ ...profile, is_following: following.has(id) }];
  });
}

export type ParticipantBlock = {
  people: RoomParticipant[];
  participant_count: number;
  live_count: number;
};

const EMPTY_BLOCK: ParticipantBlock = { people: [], participant_count: 0, live_count: 0 };

// One query for the people in a page of rooms, then one for their profiles.
export async function participantBlocks(db: SupabaseClient, roomIds: string[]) {
  const blocks = new Map<string, ParticipantBlock>();
  if (!roomIds.length) return blocks;

  const rows = await fetchAll<{ room_id: string; user_id: string; joined_at: string; last_seen_at: string }>(
    (from, to) =>
      db
        .from("room_participants")
        .select("room_id, user_id, joined_at, last_seen_at")
        .in("room_id", roomIds)
        .order("last_seen_at", { ascending: false })
        .order("room_id")
        .order("user_id")
        .range(from, to),
  );
  const profiles = await profilesByIds(db, [...new Set(rows.map((row) => row.user_id))]);

  for (const row of rows) {
    const profile = profiles.get(row.user_id);
    if (!profile) continue; // the account was deleted between the two queries
    const block = blocks.get(row.room_id) ?? { people: [], participant_count: 0, live_count: 0 };
    block.participant_count += 1;
    if (isLive(row.last_seen_at)) block.live_count += 1;
    if (block.people.length < 5) {
      block.people.push({
        user_id: row.user_id,
        display_name: profile.display_name,
        avatar_color: profile.avatar_color,
        joined_at: row.joined_at,
        last_seen_at: row.last_seen_at,
        live: isLive(row.last_seen_at),
      });
    }
    blocks.set(row.room_id, block);
  }

  return blocks;
}

export const blockFor = (blocks: Map<string, ParticipantBlock>, roomId: string) =>
  blocks.get(roomId) ?? EMPTY_BLOCK;

export type InviteRow = {
  id: string;
  room_id: string;
  inviter_id: string;
  invitee_id: string;
  status: InviteStatus;
  created_at: string;
  responded_at: string | null;
};

// Adds the room title and both profile summaries to invite rows, with one profile query in total.
export async function inviteViews(
  db: SupabaseClient,
  rows: InviteRow[],
  roomTitles: Map<string, string | null>,
  viewerId: string,
) {
  const ids = [...new Set(rows.flatMap((row) => [row.inviter_id, row.invitee_id]))];
  const users = await userSummaries(db, ids, viewerId);
  const byId = new Map(users.map((user) => [user.id, user]));

  return rows.flatMap((row): RoomInvite[] => {
    const from = byId.get(row.inviter_id);
    const to = byId.get(row.invitee_id);
    if (!from || !to) return []; // a deleted account's invite is not shown
    return [
      {
        id: row.id,
        room_id: row.room_id,
        room_title: roomTitles.get(row.room_id) ?? null,
        from,
        to,
        status: row.status,
        created_at: row.created_at,
        responded_at: row.responded_at,
      },
    ];
  });
}
