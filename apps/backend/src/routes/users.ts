import { FollowStateResponse, UsersQuery, UsersResponse, type UserSummary } from "@linkroom/shared";
import { Router } from "express";
import { z } from "zod";
import { followedIds, likePattern } from "../lib/dashboard";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";

export const usersRouter = Router();

const UserParams = z.object({ id: z.string().uuid() });

// GET /api/users/search?q=...&limit=20: find people to follow, with whether you already do.
usersRouter.get("/search", requireAuth, async (req, res) => {
  const { q, limit } = UsersQuery.parse(req.query);
  const db = supabaseAdmin();

  const [profiles, following] = await Promise.all([
    db
      .from("profiles")
      .select("id, display_name, avatar_color")
      .ilike("display_name", likePattern(q))
      .neq("id", req.user!.id)
      .order("display_name")
      .limit(limit),
    followedIds(db, req.user!.id),
  ]);
  if (profiles.error) throw profiles.error;

  const users = profiles.data.map(
    (profile): UserSummary => ({
      id: profile.id as string,
      display_name: profile.display_name as string,
      avatar_color: profile.avatar_color as string | null,
      is_following: following.has(profile.id as string),
    }),
  );
  res.json({ users } satisfies UsersResponse);
});

// POST /api/users/:id/follow
usersRouter.post("/:id/follow", requireAuth, async (req, res) => {
  const { id } = UserParams.parse(req.params);
  if (id === req.user!.id) throw new HttpError(400, "You can't follow yourself");

  const db = supabaseAdmin();
  const { data: profile, error: profileError } = await db.from("profiles").select("id").eq("id", id).maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new HttpError(404, "User not found");

  const { error } = await db
    .from("follows")
    .upsert({ follower_id: req.user!.id, followee_id: id }, { onConflict: "follower_id,followee_id" });
  if (error) throw error;

  res.json({ id, following: true } satisfies FollowStateResponse);
});

// DELETE /api/users/:id/follow
usersRouter.delete("/:id/follow", requireAuth, async (req, res) => {
  const { id } = UserParams.parse(req.params);

  const { error } = await supabaseAdmin()
    .from("follows")
    .delete()
    .eq("follower_id", req.user!.id)
    .eq("followee_id", id);
  if (error) throw error;

  res.json({ id, following: false } satisfies FollowStateResponse);
});
