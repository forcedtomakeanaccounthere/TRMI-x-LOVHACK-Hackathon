import { z } from "zod";

// Proposed contracts for the parts of /dashboard that apps/backend doesn't serve yet: people, groups,
// profiles and invites (see CHECKLIST.md "Dashboard"). The room list itself already exists:
// DashboardRoom / DashboardResponse in ./schemas, served by GET /api/rooms/mine.

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const Person = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(40),
  handle: z.string().max(30),
  color: HexColor,
  avatar_url: z.string().url().nullable(),
});
export type Person = z.infer<typeof Person>;

// A collection of rooms (a course, a team, a book club). Rooms gain a nullable group_id.
export const RoomGroup = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  color: HexColor,
  created_at: z.string(),
});
export type RoomGroup = z.infer<typeof RoomGroup>;

// GET /api/me/participants: people I've shared rooms with, for quick invites.
export const PastParticipant = Person.extend({
  rooms_together: z.number().int().positive(),
  last_seen_at: z.string(),
});
export type PastParticipant = z.infer<typeof PastParticipant>;

// GET /api/me/profile
export const Profile = Person.extend({
  email: z.string(),
  bio: z.string().max(160).nullable(),
  created_at: z.string(),
  stats: z.object({
    rooms_hosted: z.number().int().nonnegative(),
    highlights: z.number().int().nonnegative(),
    followers: z.number().int().nonnegative(),
    following: z.number().int().nonnegative(),
  }),
});
export type Profile = z.infer<typeof Profile>;

// POST /api/rooms/:id/invites
export const InviteRequest = z.object({ user_ids: z.array(z.string().uuid()).min(1).max(50) });
export type InviteRequest = z.infer<typeof InviteRequest>;
