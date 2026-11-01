// Room status broadcasts (paused / running, from apps/backend's lifecycle worker) arrive on the
// room's realtime channel, which only useRoomChannel may open: supabase-js returns the same channel
// for the same topic, so a second subscriber would share it and its subscribe() would never fire.
// useRoomChannel passes those broadcasts on here, for RoomActivityTracker.

export type RoomStatusMessage = { status?: string; reason?: string };

const bus = new EventTarget();

export function emitRoomStatus(message: RoomStatusMessage) {
  bus.dispatchEvent(new CustomEvent<RoomStatusMessage>("status", { detail: message }));
}

/** Calls `listener` for every status broadcast; returns the unsubscribe function. */
export function onRoomStatus(listener: (message: RoomStatusMessage) => void) {
  const handle = (e: Event) => listener((e as CustomEvent<RoomStatusMessage>).detail);
  bus.addEventListener("status", handle);
  return () => bus.removeEventListener("status", handle);
}
