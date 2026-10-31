import type { DashboardRoom, RoomKind, RoomStatus } from "@linkroom/shared";

// Preview shapes for the people, groups and profile parts of the dashboard, which still run on demo
// data. The backend's own contracts (Profile, RoomGroup, UserSummary in @linkroom/shared) differ, so
// these keep separate names until the dashboard is wired to GET /api/me/profile, /api/groups, etc.
export type Person = {
  id: string;
  name: string;
  handle: string;
  color: string;
  avatar_url: string | null;
};

export type PastParticipant = Person & { rooms_together: number; last_seen_at: string };

export type GroupView = { id: string; name: string; color: string; created_at: string };

export type ProfileView = Person & {
  email: string;
  bio: string | null;
  created_at: string;
  stats: { rooms_hosted: number; highlights: number; followers: number; following: number };
};

// "paused" is a dashboard-only status for now: the backend's RoomStatus has no paused state yet
// (CHECKLIST.md "Dashboard"), so only preview data uses it.
export type ViewStatus = RoomStatus | "paused";

// What a room card, the calendar and the filters work with. Real rooms come from GET /api/me/rooms
// (see fromApiRoom); fields the API doesn't return yet get neutral defaults.
export type RoomView = {
  id: string;
  kind: RoomKind;
  title: string;
  source_url: string | null;
  status: ViewStatus;
  role: "owner" | "member"; // only owners can change a room's status
  group_id: string | null;
  // Chosen when the room is created; the calendar draws running rooms in it. Null: use the group colour.
  color: string | null;
  created_at: string;
  // Calendar span: starts at created_at, ends at closed_at (null while running or paused).
  closed_at: string | null;
  paused_at: string | null;
  last_activity_at: string;
  deleted_at: string | null;
  live_count: number;
  participants: Person[];
  counts: { attachments: number; highlights: number; comments: number; ai_queries: number };
};

// colors: room id → colour picked at creation (kept in the browser until rooms.color exists).
export function fromApiRoom(r: DashboardRoom, colors: Record<string, string> = {}): RoomView {
  const lastActivity = r.last_opened_at ?? r.created_at;
  const ended = r.status === "closed" || r.status === "archived";
  return {
    id: r.id,
    kind: r.kind,
    title: r.title?.trim() || "Untitled room",
    source_url: r.source_url,
    status: r.status,
    role: r.role,
    group_id: null,
    color: colors[r.id] ?? null,
    created_at: r.created_at,
    // The API has no closed_at yet, so a finished room ends on the calendar at its last activity.
    closed_at: ended ? lastActivity : null,
    paused_at: null,
    last_activity_at: lastActivity,
    deleted_at: r.status === "deleted" ? lastActivity : null,
    live_count: 0,
    participants: [],
    counts: { attachments: 0, highlights: r.highlight_count, comments: r.comment_count, ai_queries: 0 },
  };
}
