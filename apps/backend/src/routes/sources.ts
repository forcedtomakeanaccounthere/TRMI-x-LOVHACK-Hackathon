import { AddSourceRequest, MAX_ROOM_SOURCES, type AttachedSource, type RoomSourcesResponse } from "@linkroom/shared";
import type { Router } from "express";
import { assertParticipant, assertReader, can, roomAccess, type Access } from "../lib/ledger";
import { attachedSources } from "../lib/sources";
import { supabaseAdmin } from "../lib/supabase";
import { optionalAuth, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

// The documents attached to a room workspace (the Sources rail). Registered on the rooms router.

function assertCanChange(access: Access) {
  assertParticipant(access);
  if (access.status !== "running") throw new HttpError(409, "This room is read only");
}

export function sourcesRoutes(router: Router) {
  // GET /api/rooms/:id/sources: the attached documents, in order.
  router.get("/:id/sources", optionalAuth, async (req, res) => {
    const id = req.params.id as string;
    assertReader(await roomAccess(id, req));
    res.json({ sources: await attachedSources(id) } satisfies RoomSourcesResponse);
  });

  // POST /api/rooms/:id/sources  { source_room_id }: attaches another room (an editor's upload or
  // link). Attaching one already there changes nothing (200).
  router.post("/:id/sources", requireAuth, async (req, res) => {
    const id = req.params.id as string;
    const { source_room_id: sourceId } = AddSourceRequest.parse(req.body ?? {});
    const access = await roomAccess(id, req);
    assertCanChange(access);
    if (!can.addSources(access.role)) throw new HttpError(403, "Your role can't add sources");
    if (sourceId === id) throw new HttpError(400, "A room can't be attached to itself");

    const db = supabaseAdmin();
    const { data: source, error: sourceError } = await db.from("rooms").select("status").eq("id", sourceId).maybeSingle();
    if (sourceError) throw sourceError;
    if (!source || source.status === "deleted") throw new HttpError(404, "That document wasn't found");

    const current = await attachedSources(id);
    const existing = current.find((s) => s.id === sourceId);
    if (existing) {
      res.status(200).json(existing satisfies AttachedSource);
      return;
    }
    if (current.length >= MAX_ROOM_SOURCES) throw new HttpError(409, `A room can have up to ${MAX_ROOM_SOURCES} sources`);

    const { data: last, error: lastError } = await db
      .from("room_attachments")
      .select("position")
      .eq("room_id", id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw lastError;
    const { error } = await db.from("room_attachments").upsert(
      {
        room_id: id,
        source_room_id: sourceId,
        added_by: req.user!.id,
        added_by_name: req.user!.name.trim().slice(0, 40) || null,
        position: last ? (last.position as number) + 1 : 0,
      },
      { onConflict: "room_id,source_room_id", ignoreDuplicates: true },
    );
    if (error) throw error;

    const added = (await attachedSources(id)).find((s) => s.id === sourceId);
    if (!added) throw new HttpError(404, "That document wasn't found");
    res.status(201).json(added satisfies AttachedSource);
  });

  // DELETE /api/rooms/:id/sources/:sourceId: by whoever attached it, or an admin.
  router.delete("/:id/sources/:sourceId", requireAuth, async (req, res) => {
    const id = req.params.id as string;
    const sourceId = req.params.sourceId as string;
    const access = await roomAccess(id, req);
    assertCanChange(access);

    const db = supabaseAdmin();
    const { data: row, error } = await db
      .from("room_attachments")
      .select("added_by")
      .eq("room_id", id)
      .eq("source_room_id", sourceId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new HttpError(404, "That source isn't attached to this room");
    const mine = row.added_by === req.user!.id;
    if (!(can.manage(access.role) || (mine && can.addSources(access.role)))) {
      throw new HttpError(403, "Only who added it or an admin can remove this source");
    }

    const { error: deleteError } = await db.from("room_attachments").delete().eq("room_id", id).eq("source_room_id", sourceId);
    if (deleteError) throw deleteError;
    res.json({ ok: true });
  });
}
