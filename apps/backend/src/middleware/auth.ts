import type { AuthUser } from "@linkroom/shared";
import type { Request, RequestHandler } from "express";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabase";
import { HttpError } from "./error";

export function toAuthUser(user: User): AuthUser {
  const name = user.user_metadata?.name;
  return {
    id: user.id,
    email: user.email ?? "",
    name: typeof name === "string" && name ? name : (user.email?.split("@")[0] ?? ""),
  };
}

function bearerToken(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

// Validates the Supabase access token with the auth server, so revoked sessions are rejected too.
async function resolveUser(token: string) {
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// Requires a logged-in user with a verified email. Sets req.user.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, "Not authenticated");

  const user = await resolveUser(token);
  if (!user) throw new HttpError(401, "Not authenticated");
  if (!user.email_confirmed_at) throw new HttpError(403, "Please verify your email first");

  req.user = toAuthUser(user);
  req.accessToken = token;
  next();
};

// Sets req.user when a valid token is present; never rejects the request.
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req);
  const user = token ? await resolveUser(token).catch(() => null) : null;
  if (user?.email_confirmed_at) {
    req.user = toAuthUser(user);
    req.accessToken = token!;
  }
  next();
};
