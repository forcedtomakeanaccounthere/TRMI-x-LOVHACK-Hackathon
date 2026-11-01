import {
  LedgerEvent,
  ListEventsQuery,
  MAX_LEDGER_EVENT_BYTES,
  PostEventsRequest,
  type ListEventsResponse,
  type PostEventsResponse,
  type RoomMember,
  type RoomMembersResponse,
} from "@linkroom/shared";
import type { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../env";
import {
  ADD_TYPE,
  assertParticipant,
  authoredRef,
  checkEvent,
  project,
  roomAccess,
  settingsToRow,
  type Access,
  type MemberRow,
  type RuleContext,
} from "../lib/ledger";
import { supabaseAdmin } from "../lib/supabase";
import { optionalAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

// The room workspace's ledger (supabase/migrations/0020_room_ledger.sql): the events every browser
// replays to build the room, and who may write which (lib/ledger.ts). Registered on the rooms router.

type EventRow = { seq: number; payload: LedgerEvent };
type Authored = keyof typeof ADD_TYPE;

// Strokes and marks arrive in bursts, so this is far above the question limit.
const eventsPerIp = rateLimit({
  windowMs: 60_000,
  limit: env.LEDGER_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many changes at once. Try again in a minute." },
});

/** Throws unless the caller may read the room's ledger: removed people and, where guests aren't allowed, guests can't. */
function assertReader(access: Access) {
  if (access.kicked) throw new HttpError(403, "You were removed from this room.");
  const isOwner = access.identity?.id === access.ownerId;
  if (!access.settings.allowGuests && !access.identity?.signedIn && !isOwner) {
    throw new HttpError(403, "This room is for signed-in members only.");
  }
}

/**
 * A guest's first write claims its id: the hash of its key is stored, and later requests must send
 * the same key. Done before anything is written, and checked again after, so two browsers racing for
 * the same id can't both win.
 */
async function claimGuest(access: Access, name: string) {
  const me = access.identity!;
  if (me.signedIn || access.member?.key_hash) return;
  const db = supabaseAdmin();
  if (!access.member) {
    const { error } = await db
      .from("room_members")
      .upsert(
        { room_id: access.roomId, member_id: me.id, name, key_hash: me.keyHash },
        { onConflict: "room_id,member_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  } else {
    const { error } = await db
      .from("room_members")
      .update({ key_hash: me.keyHash })
      .eq("room_id", access.roomId)
      .eq("member_id", me.id)
      .is("key_hash", null);
    if (error) throw error;
  }
  const { data, error } = await db
    .from("room_members")
    .select("key_hash")
    .eq("room_id", access.roomId)
    .eq("member_id", me.id)
    .single();
  if (error) throw error;
  if (data.key_hash !== me.keyHash) throw new HttpError(403, "That guest id belongs to someone else.");
}

// Who added each annotation, artifact and document the batch points at (the actor of its add event).
async function loadAuthors(roomId: string, events: LedgerEvent[]) {
  const wanted: Record<Authored, Set<string>> = { annotation: new Set(), artifact: new Set(), doc: new Set() };
  for (const event of events) {
    const ref = authoredRef(event);
    if (ref && !event.type.endsWith(".add")) wanted[ref.kind].add(ref.id);
  }
  const authors = new Map<string, string>();
  const db = supabaseAdmin();
  const paths: Record<Authored, string> = {
    annotation: "payload->annotation->>id",
    artifact: "payload->artifact->>id",
    doc: "payload->doc->>id",
  };
  await Promise.all(
    (Object.keys(wanted) as Authored[]).map(async (kind) => {
      const ids = [...wanted[kind]];
      if (!ids.length) return;
      const { data, error } = await db
        .from("room_events")
        .select("actor_id, payload")
        .eq("room_id", roomId)
        .eq("type", ADD_TYPE[kind])
        .in(paths[kind], ids)
        .order("seq");
      if (error) throw error;
      for (const row of data as { actor_id: string; payload: LedgerEvent }[]) {
        const ref = authoredRef(row.payload);
        // The first add counts: re-adding a document doesn't make it someone else's.
        if (ref && !authors.has(`${kind}:${ref.id}`)) authors.set(`${kind}:${ref.id}`, row.actor_id);
      }
    }),
  );
  return authors;
}

export function ledgerRoutes(router: Router) {
  // GET /api/rooms/:id/events?after=&limit=: the room's events in the order they were accepted.
  router.get("/:id/events", optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const { after, limit } = ListEventsQuery.parse(req.query);
    assertReader(await roomAccess(id, req));

    const { data, error } = await supabaseAdmin()
      .from("room_events")
      .select("seq, payload")
      .eq("room_id", id)
      .gt("seq", after)
      .order("seq")
      .limit(limit);
    if (error) throw error;
    const rows = data as EventRow[];
    res.json({
      events: rows.map((row) => ({ ...row.payload, seq: row.seq })),
      next: rows.length === limit ? rows.at(-1)!.seq : null,
    } satisfies ListEventsResponse);
  });

  // POST /api/rooms/:id/events  { events }: appends the caller's events. Each one is checked on its
  // own against the caller's role, in order (a role change earlier in the batch counts for the rest);
  // the ones that pass are saved and the rest are listed with the reason. An event already saved
  // (a retry) counts as accepted and isn't applied twice.
  router.post("/:id/events", eventsPerIp, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const { events: raw } = PostEventsRequest.parse(req.body ?? {});
    const access = await roomAccess(id, req);
    if (!access.identity) throw new HttpError(401, "Sign in, or send your guest id and key (X-Guest-Id, X-Guest-Key).");
    assertParticipant(access);

    const accepted: string[] = [];
    const rejected: PostEventsResponse["rejected"] = [];
    const events: LedgerEvent[] = [];
    for (const item of raw) {
      const rawId = (item as { id?: unknown })?.id;
      const label = typeof rawId === "string" ? rawId.slice(0, 64) : null;
      if (JSON.stringify(item).length > MAX_LEDGER_EVENT_BYTES) {
        rejected.push({ id: label, reason: "The event is too large" });
        continue;
      }
      const parsed = LedgerEvent.safeParse(item);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        rejected.push({ id: label, reason: `Invalid event: ${issue?.path.join(".") || "event"} ${issue?.message ?? ""}`.trim() });
        continue;
      }
      events.push(parsed.data);
    }

    const db = supabaseAdmin();
    if (events.length) await claimGuest(access, events[0]!.actor.name);

    const [existing, members, authors] = await Promise.all([
      events.length
        ? db.from("room_events").select("id").eq("room_id", id).in("id", events.map((e) => e.id))
        : Promise.resolve({ data: [], error: null }),
      db.from("room_members").select("member_id, name, role, kicked_at, key_hash").eq("room_id", id),
      loadAuthors(id, events),
    ]);
    if (existing.error) throw existing.error;
    if (members.error) throw members.error;
    const saved = new Set((existing.data as { id: string }[]).map((row) => row.id));

    const ctx: RuleContext = {
      roomId: id,
      status: access.status,
      ownerId: access.ownerId,
      me: access.identity,
      settings: access.settings,
      members: new Map((members.data as MemberRow[]).map((row) => [row.member_id, row])),
      authorOf: (kind, ref) => authors.get(`${kind}:${ref}`),
    };
    const settingsBefore = ctx.settings;
    const membersBefore = new Map(ctx.members);

    const rows: Record<string, unknown>[] = [];
    for (const event of events) {
      if (saved.has(event.id)) {
        accepted.push(event.id);
        continue;
      }
      const reason = checkEvent(event, ctx);
      if (reason) {
        rejected.push({ id: event.id, reason });
        continue;
      }
      project(event, ctx);
      const ref = authoredRef(event);
      if (ref && event.type.endsWith(".add") && !authors.has(`${ref.kind}:${ref.id}`)) {
        authors.set(`${ref.kind}:${ref.id}`, event.actor.id);
      }
      saved.add(event.id); // a duplicate id later in the same batch is a retry too
      accepted.push(event.id);
      rows.push({
        room_id: id,
        id: event.id,
        type: event.type,
        actor_id: event.actor.id,
        actor_name: event.actor.name,
        payload: event,
        at: event.at,
      });
    }

    if (rows.length) {
      const { error } = await db.from("room_events").upsert(rows, { onConflict: "room_id,id", ignoreDuplicates: true });
      if (error) throw error;

      // The writer's latest name, and every role or removal the batch changed.
      const me = access.identity;
      const latestName = (rows.at(-1)!.actor_name as string) || "Someone";
      const changed = [...ctx.members.values()].filter((row) => membersBefore.get(row.member_id) !== row);
      const memberRows = [
        { room_id: id, member_id: me.id, name: latestName },
        ...changed.map((row) => ({ room_id: id, member_id: row.member_id, name: row.name, role: row.role, kicked_at: row.kicked_at })),
      ];
      // One upsert per column set: PostgREST needs the same keys on every row.
      const { error: meError } = await db.from("room_members").upsert(memberRows[0]!, { onConflict: "room_id,member_id" });
      if (meError) throw meError;
      if (changed.length) {
        const { error: memberError } = await db
          .from("room_members")
          .upsert(memberRows.slice(1), { onConflict: "room_id,member_id" });
        if (memberError) throw memberError;
      }
      if (ctx.settings !== settingsBefore) {
        const { error: settingsError } = await db.from("room_settings").upsert(settingsToRow(id, ctx.settings));
        if (settingsError) throw settingsError;
      }
    }

    res.json({ accepted, rejected } satisfies PostEventsResponse);
  });

  // GET /api/rooms/:id/members: everyone given a role or removed, everyone who wrote, and the settings.
  router.get("/:id/members", optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const access = await roomAccess(id, req);
    assertReader(access);
    const { data, error } = await supabaseAdmin()
      .from("room_members")
      .select("member_id, name, role, kicked_at")
      .eq("room_id", id)
      .order("first_seen_at");
    if (error) throw error;
    res.json({ members: data as RoomMember[], settings: access.settings } satisfies RoomMembersResponse);
  });
}
