import type { RoomGroup } from "@linkroom/shared";

// Browser-only stand-ins for data the backend doesn't store yet (CHECKLIST.md "Dashboard"): a room's
// colour, custom name and group (rooms.color / title / group_id), the user's groups (room_groups) and
// profile edits (PATCH /api/me/profile). Every access is guarded, because storage can be blocked or full.

const ROOM_META_KEY = "linkroom-room-meta";
const groupsKey = (userId: string) => `linkroom-groups:${userId}`;
const profileKey = (userId: string) => `linkroom-profile:${userId}`;

// group_id: a string puts the room in that group, null takes it out of its group, absent keeps the default.
export type RoomMeta = { color?: string; title?: string; group_id?: string | null };
export type ProfileOverride = { name?: string; avatar_url?: string | null };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function getRoomMeta(): Record<string, RoomMeta> {
  return read<Record<string, RoomMeta>>(ROOM_META_KEY, {});
}

export function saveRoomMeta(roomId: string, patch: RoomMeta) {
  const all = getRoomMeta();
  write(ROOM_META_KEY, { ...all, [roomId]: { ...all[roomId], ...patch } });
}

// Null until the user first changes their groups; callers then fall back to a default list.
export function getSavedGroups(userId: string): RoomGroup[] | null {
  return read<RoomGroup[] | null>(groupsKey(userId), null);
}

export function saveGroups(userId: string, groups: RoomGroup[]) {
  write(groupsKey(userId), groups);
}

export function getProfileOverride(userId: string): ProfileOverride {
  return read<ProfileOverride>(profileKey(userId), {});
}

// Returns false when the browser refused to store it (usually: the image is too big).
export function saveProfileOverride(userId: string, override: ProfileOverride) {
  return write(profileKey(userId), { ...getProfileOverride(userId), ...override });
}

// Shrinks an image to a square JPEG data URL, so an avatar fits comfortably in localStorage.
export async function imageToAvatar(file: File, size = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  // Centre crop to a square, then scale.
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
