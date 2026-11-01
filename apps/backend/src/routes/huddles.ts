import {
  CreateHuddleRequest,
  InviteHuddleRequest,
  type HuddleJoinResponse,
  type HuddleMemberSummary,
  type HuddleSummary,
  type ListHuddlesResponse,
} from "@linkroom/shared";
import type { Request, RequestHandler, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { nanoid } from "nanoid";
import { env } from "../env";
import {
  canEndHuddle,
  canInviteToHuddle,
  canStartHuddle,
  closeIfEmpty,
  huddleAccess,
  livekitRoomName,
  pingHuddles,
  type HuddleMemberRow,
  type HuddleRow,
} from "../lib/huddles";
import { assertReader, claimGuest, roomAccess, type Access } from "../lib/ledger";
import { closeRoom, isLiveKitConfigured, mintToken, participantCount, removeFromRoom } from "../lib/livekit";
import { supabaseAdmin } from "../lib/supabase";
import { optionalAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

// Voice huddles (supabase/migrations/0028_huddles.sql): room-wide and private calls with LiveKit audio.
// Registered on the rooms router. Private-huddle content never goes into room_events.

const huddlesPerIp = rateLimit({
  windowMs: 60_000,
  limit: env.HUDDLE_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many huddle requests. Try again in a minute." },
});

const ensureLiveKit: RequestHandler = (_req, _res, next) => {
  if (!isLiveKitConfigured()) {
    throw new HttpError(503, "Voice huddles aren't set up");
  }
  next();
};

function getCallerName(access: Access, req: Request): string {
  return (
    access.member?.name ||
    (req.user as { user_metadata?: { name?: string } } | undefined)?.user_metadata?.name ||
    (req.user?.email ? req.user.email.split("@")[0]! : null) ||
    (access.identity?.signedIn ? "Someone" : "Guest")
  );
}

function toHuddleSummary(huddle: HuddleRow, members?: HuddleMemberRow[]): HuddleSummary {
  return {
    id: huddle.id,
    room_id: huddle.room_id,
    livekit_room: huddle.livekit_room,
    audience: huddle.audience,
    created_by: huddle.created_by,
    created_by_name: huddle.created_by_name,
    started_at: huddle.started_at,
    ended_at: huddle.ended_at,
    notes_status: huddle.notes_status,
    notes_error: huddle.notes_error,
    members: members?.map(
      (m): HuddleMemberSummary => ({
        member_id: m.member_id,
        name: m.name,
        invited_by: m.invited_by,
        invited_at: m.invited_at,
        joined_at: m.joined_at,
        left_at: m.left_at,
      }),
    ),
  };
}

export function huddlesRoutes(router: Router) {
  // GET /api/rooms/:id/huddles: open + last 10 ended huddles visible to caller.
  router.get("/:id/huddles", ensureLiveKit, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const access = await roomAccess(id, req);
    assertReader(access);

    const db = supabaseAdmin();
    const { data: openRows, error: openErr } = await db
      .from("huddles")
      .select("*")
      .eq("room_id", id)
      .is("ended_at", null)
      .order("started_at", { ascending: false });
    if (openErr) throw openErr;

    // Run closeIfEmpty on stale open huddles
    const openHuddles = (openRows ?? []) as HuddleRow[];
    for (const h of openHuddles) {
      const closed = await closeIfEmpty(h);
      if (closed) h.ended_at = new Date().toISOString();
    }

    const { data: endedRows, error: endedErr } = await db
      .from("huddles")
      .select("*")
      .eq("room_id", id)
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(10);
    if (endedErr) throw endedErr;

    const allHuddles = [
      ...openHuddles.filter((h) => !h.ended_at),
      ...openHuddles.filter((h) => Boolean(h.ended_at)),
      ...((endedRows ?? []) as HuddleRow[]),
    ];
    // Deduplicate in case an open huddle was closed above and also returned in endedRows
    const seen = new Set<string>();
    const uniqueHuddles: HuddleRow[] = [];
    for (const h of allHuddles) {
      if (!seen.has(h.id)) {
        seen.add(h.id);
        uniqueHuddles.push(h);
      }
    }

    const huddleIds = uniqueHuddles.map((h) => h.id);
    const membersByHuddle = new Map<string, HuddleMemberRow[]>();
    if (huddleIds.length) {
      const { data: memberRows, error: mErr } = await db
        .from("huddle_members")
        .select("*")
        .in("huddle_id", huddleIds);
      if (mErr) throw mErr;
      for (const m of (memberRows ?? []) as HuddleMemberRow[]) {
        const list = membersByHuddle.get(m.huddle_id) ?? [];
        list.push(m);
        membersByHuddle.set(m.huddle_id, list);
      }
    }

    const visible: HuddleSummary[] = [];
    for (const h of uniqueHuddles) {
      const members = membersByHuddle.get(h.id) ?? [];
      if (h.audience === "all") {
        visible.push(toHuddleSummary(h, members));
      } else if (access.identity && members.some((m) => m.member_id === access.identity!.id)) {
        visible.push(toHuddleSummary(h, members));
      }
    }

    res.json({ huddles: visible } satisfies ListHuddlesResponse);
  });

  // POST /api/rooms/:id/huddles: create huddle (returns existing open for "all").
  router.post("/:id/huddles", ensureLiveKit, huddlesPerIp, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const body = CreateHuddleRequest.parse(req.body ?? {});
    const access = await roomAccess(id, req);
    if (!access.identity) {
      throw new HttpError(401, "Sign in, or send your guest id and key (X-Guest-Id, X-Guest-Key).");
    }
    if (!canStartHuddle(access.role, body.audience)) {
      throw new HttpError(403, "Only editors and above can start a private huddle.");
    }

    const callerName = getCallerName(access, req);
    await claimGuest(access, callerName);

    const db = supabaseAdmin();

    if (body.audience === "all") {
      const { data: existing, error: existingErr } = await db
        .from("huddles")
        .select("*")
        .eq("room_id", id)
        .eq("audience", "all")
        .is("ended_at", null)
        .maybeSingle();
      if (existingErr) throw existingErr;

      if (existing) {
        await db.from("huddle_members").upsert(
          {
            huddle_id: existing.id,
            member_id: access.identity.id,
            name: callerName,
            joined_at: new Date().toISOString(),
            left_at: null,
          },
          { onConflict: "huddle_id,member_id" },
        );
        const token = await mintToken(access.identity, callerName, access.role, existing.livekit_room);
        const { data: memberRows } = await db.from("huddle_members").select("*").eq("huddle_id", existing.id);
        return res.status(201).json({
          huddle: toHuddleSummary(existing as HuddleRow, (memberRows ?? []) as HuddleMemberRow[]),
          livekit: { url: env.LIVEKIT_URL!, token },
        } satisfies HuddleJoinResponse);
      }

      const huddleId = `h_${nanoid(12)}`;
      const livekitRoom = livekitRoomName(id, huddleId);
      const { data: created, error: createErr } = await db
        .from("huddles")
        .insert({
          id: huddleId,
          room_id: id,
          livekit_room: livekitRoom,
          audience: "all",
          created_by: access.identity.id,
          created_by_name: callerName,
          started_at: new Date().toISOString(),
          notes_status: "none",
        })
        .select()
        .single();
      if (createErr) {
        // Handle race where another user created the open "all" huddle concurrently
        const { data: raced } = await db
          .from("huddles")
          .select("*")
          .eq("room_id", id)
          .eq("audience", "all")
          .is("ended_at", null)
          .maybeSingle();
        if (raced) {
          await db.from("huddle_members").upsert(
            {
              huddle_id: raced.id,
              member_id: access.identity.id,
              name: callerName,
              joined_at: new Date().toISOString(),
              left_at: null,
            },
            { onConflict: "huddle_id,member_id" },
          );
          const token = await mintToken(access.identity, callerName, access.role, raced.livekit_room);
          const { data: memberRows } = await db.from("huddle_members").select("*").eq("huddle_id", raced.id);
          return res.status(201).json({
            huddle: toHuddleSummary(raced as HuddleRow, (memberRows ?? []) as HuddleMemberRow[]),
            livekit: { url: env.LIVEKIT_URL!, token },
          } satisfies HuddleJoinResponse);
        }
        throw createErr;
      }

      const memberRow: HuddleMemberRow = {
        huddle_id: huddleId,
        member_id: access.identity.id,
        name: callerName,
        invited_by: null,
        invited_at: new Date().toISOString(),
        joined_at: new Date().toISOString(),
        left_at: null,
      };
      await db.from("huddle_members").insert(memberRow);
      const token = await mintToken(access.identity, callerName, access.role, livekitRoom);
      await pingHuddles(id);

      return res.status(201).json({
        huddle: toHuddleSummary(created as HuddleRow, [memberRow]),
        livekit: { url: env.LIVEKIT_URL!, token },
      } satisfies HuddleJoinResponse);
    }

    // Private huddle: validate invitees
    const { data: memberRows, error: memberErr } = await db
      .from("room_members")
      .select("member_id, name, kicked_at")
      .eq("room_id", id)
      .in("member_id", body.members);
    if (memberErr) throw memberErr;

    const validMembersMap = new Map((memberRows ?? []).map((m) => [m.member_id, m]));
    for (const memberId of body.members) {
      if (memberId === access.ownerId) continue;
      const m = validMembersMap.get(memberId);
      if (!m || m.kicked_at) {
        throw new HttpError(400, `Member ${memberId} is not a valid participant in this room.`);
      }
    }

    const huddleId = `h_${nanoid(12)}`;
    const livekitRoom = livekitRoomName(id, huddleId);
    const { data: created, error: createErr } = await db
      .from("huddles")
      .insert({
        id: huddleId,
        room_id: id,
        livekit_room: livekitRoom,
        audience: "private",
        created_by: access.identity.id,
        created_by_name: callerName,
        started_at: new Date().toISOString(),
        notes_status: "none",
      })
      .select()
      .single();
    if (createErr) throw createErr;

    const creatorRow: HuddleMemberRow = {
      huddle_id: huddleId,
      member_id: access.identity.id,
      name: callerName,
      invited_by: null,
      invited_at: new Date().toISOString(),
      joined_at: new Date().toISOString(),
      left_at: null,
    };
    const nowIso = new Date().toISOString();
    const inviteRows: HuddleMemberRow[] = body.members
      .filter((mId) => mId !== access.identity!.id)
      .map((memberId) => ({
        huddle_id: huddleId,
        member_id: memberId,
        name: validMembersMap.get(memberId)?.name || (memberId === access.ownerId ? "Owner" : "Member"),
        invited_by: access.identity!.id,
        invited_at: nowIso,
        joined_at: null,
        left_at: null,
      }));

    await db.from("huddle_members").insert([creatorRow, ...inviteRows]);
    const token = await mintToken(access.identity, callerName, access.role, livekitRoom);
    await pingHuddles(id);

    return res.status(201).json({
      huddle: toHuddleSummary(created as HuddleRow, [creatorRow, ...inviteRows]),
      livekit: { url: env.LIVEKIT_URL!, token },
    } satisfies HuddleJoinResponse);
  });

  // POST /api/rooms/:id/huddles/:hid/join: records joined_at and mints token.
  router.post("/:id/huddles/:hid/join", ensureLiveKit, huddlesPerIp, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const { access, huddle } = await huddleAccess(id, hid, req);
    if (huddle.ended_at) {
      throw new HttpError(400, "Huddle has already ended.");
    }

    const callerName = getCallerName(access, req);
    await claimGuest(access, callerName);

    const db = supabaseAdmin();
    const nowIso = new Date().toISOString();

    if (huddle.audience === "all") {
      await db.from("huddle_members").upsert(
        {
          huddle_id: huddle.id,
          member_id: access.identity!.id,
          name: callerName,
          joined_at: nowIso,
          left_at: null,
        },
        { onConflict: "huddle_id,member_id" },
      );
    } else {
      await db
        .from("huddle_members")
        .update({ joined_at: nowIso, left_at: null })
        .eq("huddle_id", huddle.id)
        .eq("member_id", access.identity!.id);
    }

    const token = await mintToken(access.identity!, callerName, access.role, huddle.livekit_room);
    const { data: memberRows } = await db.from("huddle_members").select("*").eq("huddle_id", huddle.id);
    await pingHuddles(id);

    res.json({
      huddle: toHuddleSummary(huddle, (memberRows ?? []) as HuddleMemberRow[]),
      livekit: { url: env.LIVEKIT_URL!, token },
    } satisfies HuddleJoinResponse);
  });

  // POST /api/rooms/:id/huddles/:hid/leave: sets left_at; closes if empty.
  router.post("/:id/huddles/:hid/leave", ensureLiveKit, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const { access, huddle } = await huddleAccess(id, hid, req);

    const db = supabaseAdmin();
    await db
      .from("huddle_members")
      .update({ left_at: new Date().toISOString() })
      .eq("huddle_id", huddle.id)
      .eq("member_id", access.identity!.id);

    const count = await participantCount(huddle.livekit_room);
    if (count === 0 && !huddle.ended_at) {
      await db
        .from("huddles")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", huddle.id)
        .is("ended_at", null);
      await closeRoom(huddle.livekit_room);
    }

    await pingHuddles(id);
    res.json({ ok: true });
  });

  // POST /api/rooms/:id/huddles/:hid/invite: adds members to a private huddle.
  router.post("/:id/huddles/:hid/invite", ensureLiveKit, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const body = InviteHuddleRequest.parse(req.body ?? {});
    const { access, huddle } = await huddleAccess(id, hid, req);

    if (huddle.ended_at) {
      throw new HttpError(400, "Huddle has already ended.");
    }
    if (huddle.audience !== "private") {
      throw new HttpError(400, "Cannot invite members to a room-wide huddle.");
    }
    if (!canInviteToHuddle(access.role, huddle.audience)) {
      throw new HttpError(403, "Only editors and above can invite members.");
    }

    const db = supabaseAdmin();
    const { data: memberRows, error: memberErr } = await db
      .from("room_members")
      .select("member_id, name, kicked_at")
      .eq("room_id", id)
      .in("member_id", body.members);
    if (memberErr) throw memberErr;

    const validMembersMap = new Map((memberRows ?? []).map((m) => [m.member_id, m]));
    for (const memberId of body.members) {
      if (memberId === access.ownerId) continue;
      const m = validMembersMap.get(memberId);
      if (!m || m.kicked_at) {
        throw new HttpError(400, `Member ${memberId} is not a valid participant in this room.`);
      }
    }

    const nowIso = new Date().toISOString();
    const inviteRows = body.members.map((memberId) => ({
      huddle_id: huddle.id,
      member_id: memberId,
      name: validMembersMap.get(memberId)?.name || (memberId === access.ownerId ? "Owner" : "Member"),
      invited_by: access.identity!.id,
      invited_at: nowIso,
    }));

    await db.from("huddle_members").upsert(inviteRows, {
      onConflict: "huddle_id,member_id",
      ignoreDuplicates: true,
    });

    await pingHuddles(id);
    res.json({ ok: true });
  });

  // DELETE /api/rooms/:id/huddles/:hid/members/:memberId: un-invite -> removeFromRoom.
  router.delete("/:id/huddles/:hid/members/:memberId", ensureLiveKit, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const memberId = req.params.memberId as string;
    const { access, huddle } = await huddleAccess(id, hid, req);

    if (huddle.ended_at) {
      throw new HttpError(400, "Huddle has already ended.");
    }
    if (huddle.audience !== "private") {
      throw new HttpError(400, "Cannot uninvite from a room-wide huddle.");
    }
    if (!canInviteToHuddle(access.role, huddle.audience) && !canEndHuddle(access.identity!.id, access.role, huddle.created_by)) {
      throw new HttpError(403, "Only editors and above can remove members.");
    }

    const db = supabaseAdmin();
    await db
      .from("huddle_members")
      .delete()
      .eq("huddle_id", huddle.id)
      .eq("member_id", memberId);

    await removeFromRoom(huddle.livekit_room, memberId);
    await pingHuddles(id);
    res.json({ ok: true });
  });

  // POST /api/rooms/:id/huddles/:hid/end: ended_at, closeRoom.
  router.post("/:id/huddles/:hid/end", ensureLiveKit, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const { access, huddle } = await huddleAccess(id, hid, req);

    if (!canEndHuddle(access.identity!.id, access.role, huddle.created_by)) {
      throw new HttpError(403, "Only the creator or an admin can end this huddle.");
    }

    if (!huddle.ended_at) {
      const db = supabaseAdmin();
      await db
        .from("huddles")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", huddle.id)
        .is("ended_at", null);
      await closeRoom(huddle.livekit_room);
      await pingHuddles(id);
    }

    res.json({ ok: true });
  });
}
