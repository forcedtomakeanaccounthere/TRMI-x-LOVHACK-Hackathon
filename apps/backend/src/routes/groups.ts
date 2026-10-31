import {
  CreateGroupRequest,
  GroupsResponse,
  UpdateGroupRequest,
  type RoomGroup,
} from "@linkroom/shared";
import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

export const groupsRouter = Router();

type GroupRow = {
  id: string;
  name: string;
  color: string | null;
  position: number;
  created_at: string;
};

// Rooms a user deleted are left out of the group counts, just as they are left out of the dashboard.
async function roomCounts(groupIds: string[]) {
  const counts = new Map<string, number>();
  if (!groupIds.length) return counts;

  const { data, error } = await supabaseAdmin()
    .from("rooms")
    .select("group_id")
    .in("group_id", groupIds)
    .neq("status", "deleted");
  if (error) throw error;

  for (const room of data) {
    const id = room.group_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function shape(group: GroupRow, roomCount: number): RoomGroup {
  return {
    id: group.id,
    name: group.name,
    color: group.color,
    position: group.position,
    room_count: roomCount,
    created_at: group.created_at,
  };
}

const GROUP_COLUMNS = "id, name, color, position, created_at";

// GET /api/groups
groupsRouter.get("/", requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin()
    .from("room_groups")
    .select(GROUP_COLUMNS)
    .eq("owner_id", req.user!.id)
    .order("position")
    .order("created_at");
  if (error) throw error;

  const counts = await roomCounts(data.map((group) => group.id as string));
  res.json({
    groups: data.map((group) => shape(group as GroupRow, counts.get(group.id as string) ?? 0)),
  } satisfies GroupsResponse);
});

// POST /api/groups  { name, color?, position? }
groupsRouter.post("/", requireAuth, async (req, res) => {
  const body = CreateGroupRequest.parse(req.body);

  const { data, error } = await supabaseAdmin()
    .from("room_groups")
    .insert({
      owner_id: req.user!.id,
      name: body.name,
      color: body.color ?? null,
      position: body.position ?? 0,
    })
    .select(GROUP_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "You already have a group with that name");
    throw error;
  }

  res.status(201).json(shape(data as GroupRow, 0));
});

// PATCH /api/groups/:id  { name?, color?, position? }
groupsRouter.patch("/:id", requireAuth, async (req, res) => {
  const body = UpdateGroupRequest.parse(req.body);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.color !== undefined) patch.color = body.color;
  if (body.position !== undefined) patch.position = body.position;

  const { data, error } = await supabaseAdmin()
    .from("room_groups")
    .update(patch)
    .eq("id", req.params.id)
    .eq("owner_id", req.user!.id)
    .select(GROUP_COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "You already have a group with that name");
    throw error;
  }
  if (!data) throw new HttpError(404, "Group not found");

  const counts = await roomCounts([data.id as string]);
  res.json(shape(data as GroupRow, counts.get(data.id as string) ?? 0));
});

// DELETE /api/groups/:id: the rooms in it survive, unfiled (the foreign key sets group_id to null).
groupsRouter.delete("/:id", requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin()
    .from("room_groups")
    .delete()
    .eq("id", req.params.id)
    .eq("owner_id", req.user!.id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Group not found");

  res.status(204).end();
});
