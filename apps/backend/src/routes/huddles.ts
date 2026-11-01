import {
  CreateHuddleRequest,
  HuddleFocusRequest,
  HuddleNotesResponse,
  HuddleTranscriptQuery,
  InviteHuddleRequest,
  JoinHuddleRequest,
  PostSegmentsRequest,
  type HuddleJoinResponse,
  type HuddleMemberSummary,
  type HuddleNotes,
  type HuddleSummary,
  type HuddleTranscriptResponse,
  type HuddleTranscriptSegment,
  type ListHuddlesResponse,
} from "@linkroom/shared";
import type { Request, RequestHandler, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { nanoid } from "nanoid";
import { env } from "../env";
import {
  canEndHuddle,
  canInviteToHuddle,
  canPostSegments,
  canRefreshHuddleNotes,
  canStartHuddle,
  closeIfEmpty,
  huddleAccess,
  livekitRoomName,
  pingHuddles,
  type HuddleMemberRow,
  type HuddleRow,
} from "../lib/huddles";
import { startNotes } from "../lib/huddle-notes";
import { assertParticipant, assertReader, claimGuest, roomAccess, type Access } from "../lib/ledger";
import {
  closeRoom,
  getLiveKitConfig,
  isLiveKitConfigured,
  mintToken,
  participantCount,
  removeFromRoom,
} from "../lib/livekit";
import { roomScope } from "../lib/sources";
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

const segmentsPerIp = rateLimit({
  windowMs: 60_000,
  limit: env.HUDDLE_SEGMENT_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many segment requests. Try again in a minute." },
});

const ensureLiveKit: RequestHandler = (_req, _res, next) => {
  if (!isLiveKitConfigured()) {
    throw new HttpError(503, "Voice huddles aren't set up");
  }
  next();
};

function getCallerName(access: Access, req: Request, requestedName?: string): string {
  if (access.member?.name) {
    return access.member.name;
  }
  if (requestedName) {
    return requestedName;
  }
  return (
    req.user?.name ||
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

export function huddlesRoutes(router: Router, limits: RequestHandler[] = []) {
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
      .limit(50);
    if (endedErr) throw endedErr;

    const stillOpen = openHuddles.filter((h) => !h.ended_at);
    const endedCandidates = [
      ...openHuddles.filter((h) => Boolean(h.ended_at)),
      ...((endedRows ?? []) as HuddleRow[]),
    ];
    const seenEnded = new Set<string>();
    const uniqueEnded: HuddleRow[] = [];
    for (const h of endedCandidates) {
      if (!seenEnded.has(h.id)) {
        seenEnded.add(h.id);
        uniqueEnded.push(h);
      }
    }

    const allHuddles = [...stillOpen, ...uniqueEnded];
    const huddleIds = allHuddles.map((h) => h.id);
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

    const isVisible = (h: HuddleRow) => {
      if (h.audience === "all") return true;
      const members = membersByHuddle.get(h.id) ?? [];
      return Boolean(access.identity && members.some((m) => m.member_id === access.identity!.id));
    };

    const visibleOpen = stillOpen.filter(isVisible).map((h) => toHuddleSummary(h, membersByHuddle.get(h.id) ?? []));
    const visibleEnded = uniqueEnded.filter(isVisible).slice(0, 10).map((h) => toHuddleSummary(h, membersByHuddle.get(h.id) ?? []));

    res.json({ huddles: [...visibleOpen, ...visibleEnded] } satisfies ListHuddlesResponse);
  });

  // POST /api/rooms/:id/huddles: create huddle (returns existing open for "all").
  router.post("/:id/huddles", ensureLiveKit, huddlesPerIp, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const body = CreateHuddleRequest.parse(req.body ?? {});
    const access = await roomAccess(id, req);
    if (!access.identity) {
      throw new HttpError(401, "Sign in, or send your guest id and key (X-Guest-Id, X-Guest-Key).");
    }
    assertParticipant(access);
    if (!canStartHuddle(access.role, body.audience)) {
      throw new HttpError(403, "Only editors and above can start a private huddle.");
    }

    const callerName = getCallerName(access, req, body.name);
    await claimGuest(access, callerName);

    const db = supabaseAdmin();
    const livekitUrl = getLiveKitConfig().url!;

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
        const { error: upsertErr } = await db.from("huddle_members").upsert(
          {
            huddle_id: existing.id,
            member_id: access.identity.id,
            name: callerName,
            joined_at: new Date().toISOString(),
            left_at: null,
          },
          { onConflict: "huddle_id,member_id" },
        );
        if (upsertErr) throw upsertErr;

        const token = await mintToken(access.identity, callerName, access.role, existing.livekit_room);
        const { data: memberRows, error: mErr } = await db.from("huddle_members").select("*").eq("huddle_id", existing.id);
        if (mErr) throw mErr;

        return res.status(201).json({
          huddle: toHuddleSummary(existing as HuddleRow, (memberRows ?? []) as HuddleMemberRow[]),
          livekit: { url: livekitUrl, token },
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
        const { data: raced, error: racedSelectErr } = await db
          .from("huddles")
          .select("*")
          .eq("room_id", id)
          .eq("audience", "all")
          .is("ended_at", null)
          .maybeSingle();
        if (racedSelectErr) throw racedSelectErr;

        if (raced) {
          const { error: racedUpsertErr } = await db.from("huddle_members").upsert(
            {
              huddle_id: raced.id,
              member_id: access.identity.id,
              name: callerName,
              joined_at: new Date().toISOString(),
              left_at: null,
            },
            { onConflict: "huddle_id,member_id" },
          );
          if (racedUpsertErr) throw racedUpsertErr;

          const token = await mintToken(access.identity, callerName, access.role, raced.livekit_room);
          const { data: memberRows, error: mErr } = await db.from("huddle_members").select("*").eq("huddle_id", raced.id);
          if (mErr) throw mErr;

          return res.status(201).json({
            huddle: toHuddleSummary(raced as HuddleRow, (memberRows ?? []) as HuddleMemberRow[]),
            livekit: { url: livekitUrl, token },
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
      const { error: mInsertErr } = await db.from("huddle_members").insert(memberRow);
      if (mInsertErr) throw mInsertErr;

      const token = await mintToken(access.identity, callerName, access.role, livekitRoom);
      await pingHuddles(id);

      return res.status(201).json({
        huddle: toHuddleSummary(created as HuddleRow, [memberRow]),
        livekit: { url: livekitUrl, token },
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

    const { error: privInsertErr } = await db.from("huddle_members").insert([creatorRow, ...inviteRows]);
    if (privInsertErr) throw privInsertErr;

    const token = await mintToken(access.identity, callerName, access.role, livekitRoom);
    await pingHuddles(id);

    return res.status(201).json({
      huddle: toHuddleSummary(created as HuddleRow, [creatorRow, ...inviteRows]),
      livekit: { url: livekitUrl, token },
    } satisfies HuddleJoinResponse);
  });

  // POST /api/rooms/:id/huddles/:hid/join: records joined_at and mints token.
  router.post("/:id/huddles/:hid/join", ensureLiveKit, huddlesPerIp, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const body = JoinHuddleRequest.parse(req.body ?? {});
    const { access, huddle } = await huddleAccess(id, hid, req);
    if (huddle.ended_at) {
      throw new HttpError(400, "Huddle has already ended.");
    }

    const callerName = getCallerName(access, req, body.name);
    await claimGuest(access, callerName);

    const db = supabaseAdmin();
    const nowIso = new Date().toISOString();

    if (huddle.audience === "all") {
      const { error: joinUpsertErr } = await db.from("huddle_members").upsert(
        {
          huddle_id: huddle.id,
          member_id: access.identity!.id,
          name: callerName,
          joined_at: nowIso,
          left_at: null,
        },
        { onConflict: "huddle_id,member_id" },
      );
      if (joinUpsertErr) throw joinUpsertErr;
    } else {
      const { error: joinUpdateErr } = await db
        .from("huddle_members")
        .update({ joined_at: nowIso, left_at: null })
        .eq("huddle_id", huddle.id)
        .eq("member_id", access.identity!.id);
      if (joinUpdateErr) throw joinUpdateErr;
    }

    const token = await mintToken(access.identity!, callerName, access.role, huddle.livekit_room);
    const { data: memberRows, error: mErr } = await db.from("huddle_members").select("*").eq("huddle_id", huddle.id);
    if (mErr) throw mErr;

    await pingHuddles(id);

    res.json({
      huddle: toHuddleSummary(huddle, (memberRows ?? []) as HuddleMemberRow[]),
      livekit: { url: getLiveKitConfig().url!, token },
    } satisfies HuddleJoinResponse);
  });

  // POST /api/rooms/:id/huddles/:hid/leave: sets left_at; closes if empty.
  router.post("/:id/huddles/:hid/leave", ensureLiveKit, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const { access, huddle } = await huddleAccess(id, hid, req);

    const db = supabaseAdmin();
    const { error: leaveErr } = await db
      .from("huddle_members")
      .update({ left_at: new Date().toISOString() })
      .eq("huddle_id", huddle.id)
      .eq("member_id", access.identity!.id);
    if (leaveErr) throw leaveErr;

    const count = await participantCount(huddle.livekit_room);
    if (count === 0 && !huddle.ended_at) {
      const { error: endErr } = await db
        .from("huddles")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", huddle.id)
        .is("ended_at", null);
      if (endErr) throw endErr;
      await closeRoom(huddle.livekit_room);
      startNotes(huddle.id);
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

    const { error: invErr } = await db.from("huddle_members").upsert(inviteRows, {
      onConflict: "huddle_id,member_id",
      ignoreDuplicates: true,
    });
    if (invErr) throw invErr;

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
    const { error: delErr } = await db
      .from("huddle_members")
      .delete()
      .eq("huddle_id", huddle.id)
      .eq("member_id", memberId);
    if (delErr) throw delErr;

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
      const { error: endErr } = await db
        .from("huddles")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", huddle.id)
        .is("ended_at", null);
      if (endErr) throw endErr;
      await closeRoom(huddle.livekit_room);
      await pingHuddles(id);
      startNotes(huddle.id);
    }

    res.json({ ok: true });
  });

  // POST /api/rooms/:id/huddles/:hid/segments: batch of final captions.
  router.post("/:id/huddles/:hid/segments", ensureLiveKit, segmentsPerIp, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const body = PostSegmentsRequest.parse(req.body ?? {});
    const { access, huddle, member } = await huddleAccess(id, hid, req);

    if (!canPostSegments(access.role, Boolean(member), huddle.ended_at)) {
      throw new HttpError(403, "You cannot post captions to this huddle.");
    }

    const callerName = getCallerName(access, req);
    const minTime = new Date(huddle.started_at).getTime();
    const maxTime = Date.now() + 5000;

    const clampTime = (iso: string): string => {
      const ms = new Date(iso).getTime();
      const clamped = Math.min(Math.max(ms, minTime), maxTime);
      return new Date(clamped).toISOString();
    };

    const allowedDocs = new Set(await roomScope(id, access.identity));
    const rows = body.segments.map((s) => {
      let doc: string | null = null;
      let block: string | null = null;
      if (s.focus && allowedDocs.has(s.focus.doc) && /^[a-z]\d{1,6}$/.test(s.focus.block)) {
        doc = s.focus.doc;
        block = s.focus.block;
      }
      const startAt = clampTime(s.start_at);
      let endAt = clampTime(s.end_at);
      if (new Date(startAt).getTime() > new Date(endAt).getTime()) {
        endAt = startAt;
      }
      return {
        huddle_id: hid,
        id: s.id,
        speaker_id: access.identity!.id,
        speaker_name: member?.name || callerName,
        text: s.text,
        start_at: startAt,
        end_at: endAt,
        doc,
        block,
      };
    });

    const db = supabaseAdmin();
    const { error: segErr } = await db
      .from("huddle_segments")
      .upsert(rows, { onConflict: "huddle_id,id", ignoreDuplicates: true });
    if (segErr) throw segErr;

    const focusRows = rows
      .filter((r) => r.doc && r.block)
      .map((r) => ({
        huddle_id: hid,
        member_id: access.identity!.id,
        doc: r.doc as string,
        block: r.block as string,
      }));
    if (focusRows.length > 0) {
      const { error: focusErr } = await db.from("huddle_focus").insert(focusRows);
      if (focusErr) throw focusErr;
    }

    res.json({ ok: true });
  });

  // POST /api/rooms/:id/huddles/:hid/focus: updates visible block for notes.
  router.post("/:id/huddles/:hid/focus", ensureLiveKit, segmentsPerIp, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const body = HuddleFocusRequest.parse(req.body ?? {});
    const { access, huddle } = await huddleAccess(id, hid, req);

    if (huddle.ended_at) {
      throw new HttpError(400, "Huddle has already ended.");
    }

    const allowedDocs = new Set(await roomScope(id, access.identity));
    if (!allowedDocs.has(body.doc) || !/^[a-z]\d{1,6}$/.test(body.block)) {
      throw new HttpError(400, "Invalid doc or block.");
    }

    const db = supabaseAdmin();
    const { error } = await db.from("huddle_focus").insert({
      huddle_id: hid,
      member_id: access.identity!.id,
      doc: body.doc,
      block: body.block,
    });
    if (error) throw error;

    res.json({ ok: true });
  });

  // GET /api/rooms/:id/huddles/:hid/transcript: paged transcript segments.
  router.get("/:id/huddles/:hid/transcript", ensureLiveKit, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const query = HuddleTranscriptQuery.parse(req.query);
    const access = await roomAccess(id, req);
    assertReader(access);

    const db = supabaseAdmin();
    const { data: huddle, error: huddleErr } = await db
      .from("huddles")
      .select("*")
      .eq("id", hid)
      .eq("room_id", id)
      .maybeSingle();
    if (huddleErr) throw huddleErr;
    if (!huddle) throw new HttpError(404, "Huddle not found");

    if (huddle.audience === "private") {
      if (!access.identity) {
        throw new HttpError(404, "Huddle not found");
      }
      const { data: member, error: memberErr } = await db
        .from("huddle_members")
        .select("member_id")
        .eq("huddle_id", hid)
        .eq("member_id", access.identity.id)
        .maybeSingle();
      if (memberErr) throw memberErr;
      if (!member) {
        throw new HttpError(404, "Huddle not found");
      }
    }

    const { data: rows, error: segErr } = await db
      .from("huddle_segments")
      .select("seq, id, speaker_id, speaker_name, text, start_at, end_at, doc, block")
      .eq("huddle_id", hid)
      .gt("seq", query.after)
      .order("seq", { ascending: true })
      .limit(query.limit);
    if (segErr) throw segErr;

    const segments = (rows ?? []).map((r) => ({
      ...r,
      seq: Number(r.seq),
    })) as HuddleTranscriptSegment[];

    res.json({
      segments,
      next: segments.length === query.limit ? segments.at(-1)!.seq : null,
    } satisfies HuddleTranscriptResponse);
  });

  // POST /api/rooms/:id/huddles/:hid/notes: start or refresh notes generation.
  router.post("/:id/huddles/:hid/notes", ensureLiveKit, ...limits, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const access = await roomAccess(id, req);
    if (!access.identity) {
      throw new HttpError(401, "Sign in, or send your guest id and key (X-Guest-Id, X-Guest-Key).");
    }
    assertParticipant(access);

    const db = supabaseAdmin();
    const { data: huddle, error: hErr } = await db
      .from("huddles")
      .select("*")
      .eq("id", hid)
      .eq("room_id", id)
      .maybeSingle();
    if (hErr) throw hErr;
    if (!huddle) throw new HttpError(404, "Huddle not found");

    const { data: member, error: mErr } = await db
      .from("huddle_members")
      .select("member_id")
      .eq("huddle_id", hid)
      .eq("member_id", access.identity!.id)
      .maybeSingle();
    if (mErr) throw mErr;

    const isMember = Boolean(member);
    if (huddle.audience === "private" && !isMember) {
      throw new HttpError(404, "Huddle not found");
    }

    if (!canRefreshHuddleNotes(access.role, access.settings, huddle.audience, isMember)) {
      throw new HttpError(403, "Your role cannot refresh notes in this room.");
    }

    startNotes(huddle.id);
    res.status(202).json({ ok: true });
  });

  // GET /api/rooms/:id/huddles/:hid/notes: latest notes + status.
  router.get("/:id/huddles/:hid/notes", ensureLiveKit, optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    const hid = req.params.hid as string;
    const access = await roomAccess(id, req);
    assertReader(access);

    const db = supabaseAdmin();
    const { data: huddle, error: hErr } = await db
      .from("huddles")
      .select("*")
      .eq("id", hid)
      .eq("room_id", id)
      .maybeSingle();
    if (hErr) throw hErr;
    if (!huddle) throw new HttpError(404, "Huddle not found");

    if (huddle.audience === "private") {
      if (!access.identity) {
        throw new HttpError(404, "Huddle not found");
      }
      const { data: member, error: mErr } = await db
        .from("huddle_members")
        .select("member_id")
        .eq("huddle_id", hid)
        .eq("member_id", access.identity.id)
        .maybeSingle();
      if (mErr) throw mErr;
      if (!member) {
        throw new HttpError(404, "Huddle not found");
      }
    }

    const { data: latest, error: nErr } = await db
      .from("huddle_notes")
      .select("version, notes")
      .eq("huddle_id", hid)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (nErr) throw nErr;

    res.json({
      status: huddle.notes_status,
      version: latest ? Number(latest.version) : null,
      notes: (latest?.notes as HuddleNotes) ?? null,
    } satisfies HuddleNotesResponse);
  });
}
