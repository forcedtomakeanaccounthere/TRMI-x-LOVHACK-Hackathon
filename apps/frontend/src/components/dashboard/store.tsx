"use client";

import type { RoomKind } from "@linkroom/shared";
import { createContext, use, useEffect, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { getFreshSession } from "@/lib/session";
import type { DashboardData } from "./demo-data";
import { saveGroups, saveProfileOverride, saveRoomMeta } from "./local-prefs";
import { DEMO_ROOM_ID } from "@/components/room/demo";
import type { GroupView, Person, RoomView, ViewStatus } from "./types";

export type StatusFilter = ViewStatus | "all";
export type SortKey = "activity" | "created" | "comments" | "title";
export type SinceFilter = "any" | "7d" | "30d";

export type Filters = {
  query: string;
  status: StatusFilter;
  kind: RoomKind | "any";
  group: string | "any";
  since: SinceFilter;
  sort: SortKey;
};

export const DEFAULT_FILTERS: Filters = {
  query: "",
  status: "all",
  kind: "any",
  group: "any",
  since: "any",
  sort: "activity",
};

type State = DashboardData & { filters: Filters };

type Action =
  | { type: "filters"; patch: Partial<Filters> }
  | { type: "reset-filters" }
  | { type: "room-status"; id: string; status: Exclude<ViewStatus, "deleted"> }
  | { type: "room-delete"; id: string }
  // Restores to `status` (undo) or, from the Deleted tab, to closed.
  | { type: "room-restore"; id: string; status?: Exclude<ViewStatus, "deleted"> }
  // Rollback after a failed request: puts the room back exactly as it was.
  | { type: "room-replace"; room: RoomView }
  | { type: "room-move"; id: string; group: string | null }
  | { type: "profile-update"; patch: { name?: string; avatar_url?: string | null } }
  | { type: "group-create"; group: GroupView }
  // Removes the group; its rooms drop back to no group (deleting them is a separate room-delete).
  | { type: "group-delete"; id: string }
  | { type: "follow-toggle"; person: Person };

// Optimistic, local updates. Status changes also reach the backend (see `actions` below); groups are
// saved in this browser and following stays local until their endpoints exist (CHECKLIST.md "Dashboard").
function reducer(state: State, action: Action): State {
  const now = new Date().toISOString();
  const updateRoom = (id: string, patch: (r: RoomView) => Partial<RoomView>) => ({
    ...state,
    rooms: state.rooms.map((r) => (r.id === id ? { ...r, ...patch(r) } : r)),
  });

  switch (action.type) {
    case "filters":
      return { ...state, filters: { ...state.filters, ...action.patch } };
    case "reset-filters":
      return { ...state, filters: { ...DEFAULT_FILTERS, query: state.filters.query } };
    case "room-status":
      return updateRoom(action.id, (r) => ({
        status: action.status,
        paused_at: action.status === "paused" ? now : action.status === "running" ? null : r.paused_at,
        closed_at: action.status === "closed" && !r.closed_at ? now : action.status === "running" ? null : r.closed_at,
        live_count: action.status === "running" ? r.live_count : 0,
      }));
    case "room-delete":
      return updateRoom(action.id, () => ({ status: "deleted", deleted_at: now, live_count: 0 }));
    case "room-restore":
      return updateRoom(action.id, (r) => {
        const status = action.status ?? "closed";
        const ended = status === "closed" || status === "archived";
        return { status, deleted_at: null, closed_at: ended ? (r.closed_at ?? now) : r.closed_at };
      });
    case "room-replace":
      return updateRoom(action.room.id, () => action.room);
    case "room-move":
      return updateRoom(action.id, () => ({ group_id: action.group }));
    case "profile-update":
      return { ...state, profile: { ...state.profile, ...action.patch } };
    case "group-create":
      return { ...state, groups: [...state.groups, action.group] };
    case "group-delete":
      return {
        ...state,
        groups: state.groups.filter((g) => g.id !== action.id),
        rooms: state.rooms.map((r) => (r.group_id === action.id ? { ...r, group_id: null } : r)),
        filters: state.filters.group === action.id ? { ...state.filters, group: "any" } : state.filters,
      };
    case "follow-toggle": {
      const following = state.following.some((p) => p.id === action.person.id)
        ? state.following.filter((p) => p.id !== action.person.id)
        : [action.person, ...state.following];
      return { ...state, following, profile: { ...state.profile, stats: { ...state.profile.stats, following: following.length } } };
    }
  }
}

// live: rooms came from GET /api/rooms/mine and status changes are saved.
// preview: demo rooms (signed out, or the backend couldn't be reached); changes stay on this page.
export type DataSource = "live" | "preview";

type SettableStatus = Exclude<ViewStatus, "deleted">;

export type RoomActions = {
  setStatus: (room: RoomView, status: SettableStatus) => void;
  remove: (room: RoomView) => void;
  restore: (room: RoomView, status?: SettableStatus) => void;
  // Saved in this browser until PATCH /api/me/profile exists. False if the browser refused it.
  updateProfile: (patch: { name?: string; avatar_url?: string | null }) => boolean;
  // Groups live in this browser until the groups API exists (see local-prefs).
  createGroup: (group: GroupView) => void;
  moveRoom: (room: RoomView, groupId: string | null) => void;
  // Deletes the group; rooms listed in deleteRoomIds are deleted too, the rest stay without a group.
  deleteGroup: (groupId: string, deleteRoomIds: string[]) => void;
};

type DashboardContextValue = {
  state: State;
  dispatch: React.Dispatch<Action>;
  actions: RoomActions;
  source: DataSource;
  // The backend has no paused status yet, so pause and resume exist only in preview data.
  canPause: boolean;
  // Where a room card opens: preview rooms are made up, so they open the demo room instead of a 404.
  roomHref: (id: string) => string;
  visibleRooms: RoomView[];
  groupById: Map<string, GroupView>;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({
  initial,
  source,
  children,
}: {
  initial: DashboardData;
  source: DataSource;
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, { ...initial, filters: DEFAULT_FILTERS });

  const profileId = state.profile.id;
  // Group actions need the current rooms and groups without rebuilding every action on each change.
  const roomsRef = useRef(state.rooms);
  const groupsRef = useRef(state.groups);
  useEffect(() => {
    roomsRef.current = state.rooms;
    groupsRef.current = state.groups;
  }, [state.rooms, state.groups]);
  const groupById = useMemo(() => new Map(state.groups.map((g) => [g.id, g])), [state.groups]);
  const visibleRooms = useMemo(() => filterRooms(state.rooms, state.filters, groupById), [state.rooms, state.filters, groupById]);

  const actions = useMemo<RoomActions>(() => {
    // Saves a status the screen already shows; on failure puts `before` back and says why.
    const save = (before: RoomView, status: Exclude<ViewStatus, "paused">) => {
      if (source !== "live") return;
      void (async () => {
        try {
          const session = await getFreshSession();
          if (!session) throw new ApiError("Sign in again to change your rooms.", 401);
          const token = session.access_token;
          if (status === "deleted") {
            await api.deleteRoom(before.id, token);
          } else {
            // A deleted room has to be restored (it comes back running) before its status can change.
            if (before.status === "deleted") await api.restoreRoom(before.id, token);
            if (before.status !== "deleted" || status !== "running") await api.updateRoom(before.id, { status }, token);
          }
        } catch (err) {
          dispatch({ type: "room-replace", room: before });
          toast.error(err instanceof ApiError ? err.message : "Couldn't update the room. Check your connection.");
        }
      })();
    };

    return {
      setStatus(room, status) {
        dispatch({ type: "room-status", id: room.id, status });
        if (status !== "paused" && room.status !== "paused") save(room, status);
      },
      remove(room) {
        dispatch({ type: "room-delete", id: room.id });
        save(room, "deleted");
      },
      restore(room, status = "closed") {
        dispatch({ type: "room-restore", id: room.id, status });
        if (status !== "paused") save(room, status);
      },
      updateProfile(patch) {
        if (!saveProfileOverride(profileId, patch)) return false;
        dispatch({ type: "profile-update", patch });
        return true;
      },
      // Saved right away (not in an effect): the New room dialog navigates off the page next.
      createGroup(group) {
        groupsRef.current = [...groupsRef.current, group];
        saveGroups(profileId, groupsRef.current);
        dispatch({ type: "group-create", group });
      },
      moveRoom(room, groupId) {
        saveRoomMeta(room.id, { group_id: groupId });
        dispatch({ type: "room-move", id: room.id, group: groupId });
      },
      deleteGroup(groupId, deleteRoomIds) {
        const doomed = new Set(deleteRoomIds);
        for (const room of roomsRef.current) {
          if (room.group_id !== groupId) continue;
          saveRoomMeta(room.id, { group_id: null });
          if (doomed.has(room.id) && room.status !== "deleted") {
            dispatch({ type: "room-delete", id: room.id });
            save(room, "deleted");
          }
        }
        groupsRef.current = groupsRef.current.filter((g) => g.id !== groupId);
        saveGroups(profileId, groupsRef.current);
        dispatch({ type: "group-delete", id: groupId });
      },
    };
  }, [source, profileId]);

  const roomHref = (id: string) => (source === "live" ? `/r/${id}` : `/r/${DEMO_ROOM_ID}`);


  return (
    <DashboardContext
      value={{ state, dispatch, actions, source, canPause: source === "preview", roomHref, visibleRooms, groupById }}
    >
      {children}
    </DashboardContext>
  );
}

export function useDashboard() {
  const ctx = use(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside <DashboardProvider>");
  return ctx;
}

const SINCE_DAYS: Record<SinceFilter, number | null> = { any: null, "7d": 7, "30d": 30 };

export function filterRooms(rooms: RoomView[], f: Filters, groups: Map<string, GroupView>) {
  const q = f.query.trim().toLowerCase();
  const sinceDays = SINCE_DAYS[f.since];
  const cutoff = sinceDays === null ? null : new Date(Date.now() - sinceDays * 86_400_000).toISOString();

  return rooms
    .filter((r) => {
      // "All" means every room still in use; archived and deleted rooms only show on their own tab.
      if (f.status === "all" ? r.status === "archived" || r.status === "deleted" : r.status !== f.status) return false;
      if (f.kind !== "any" && r.kind !== f.kind) return false;
      if (f.group !== "any" && r.group_id !== f.group) return false;
      if (cutoff && r.last_activity_at < cutoff) return false;
      if (!q) return true;
      const haystack = [
        r.title,
        r.source_url ?? "",
        r.group_id ? (groups.get(r.group_id)?.name ?? "") : "",
        ...r.participants.map((p) => p.name),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => {
      switch (f.sort) {
        case "created":
          return b.created_at.localeCompare(a.created_at);
        case "comments":
          return b.counts.comments - a.counts.comments;
        case "title":
          return a.title.localeCompare(b.title);
        default:
          return b.live_count - a.live_count || b.last_activity_at.localeCompare(a.last_activity_at);
      }
    });
}

export function activeFilterCount(f: Filters) {
  return [f.kind !== "any", f.group !== "any", f.since !== "any", f.sort !== "activity"].filter(Boolean).length;
}
