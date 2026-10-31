// Ephemeral events sent over the Supabase Realtime channel `room:{id}`. Never stored.

export const roomChannel = (roomId: string) => `room:${roomId}`;

export type BlockAnchor = { block: string; x: number; y: number };

export type PresenceState = {
  id: string;
  name: string;
  color: string;
  following: string | null;
};

export type BroadcastEvents = {
  cursor: { id: string; anchor: BlockAnchor | null };
  scroll: { id: string; block: string; ratio: number };
  summon: { id: string; block: string };
  react: { id: string; block: string; emoji: string };
};

export const THROTTLE_MS = { cursor: 50, scroll: 200 } as const;

export const PRESENCE_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899",
] as const;
