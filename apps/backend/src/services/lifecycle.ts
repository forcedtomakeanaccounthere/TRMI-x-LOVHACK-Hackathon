import { roomChannel } from "@linkroom/shared";
import { supabaseAdmin } from "../lib/supabase";

export interface LifecycleTransition {
  room_id: string;
  old_status: string;
  new_status: string;
  transition_reason: string;
}

/**
 * Runs the database stored procedure sweep_room_lifecycle() which evaluates:
 * 1. Empty running rooms (> 30m without participants) -> paused ('empty_30m')
 * 2. Idle running rooms with people present (> 2h without keystrokes/mouse events) -> paused ('idle_2h')
 * 3. Paused rooms (> 10 days since last activity) -> archived ('archived_10d_inactive')
 *
 * For any transitioned rooms, broadcasts a realtime status event to active readers.
 */
export async function runLifecycleSweep(
  db = supabaseAdmin(),
): Promise<LifecycleTransition[]> {
  const { data, error } = await db.rpc("sweep_room_lifecycle");
  if (error) {
    console.error("[lifecycle] Error executing sweep_room_lifecycle RPC:", error);
    throw error;
  }

  const transitions = (data as LifecycleTransition[] | null) ?? [];

  for (const item of transitions) {
    console.log(
      `[lifecycle] Room ${item.room_id} transitioned: ${item.old_status} -> ${item.new_status} (${item.transition_reason})`,
    );

    // Broadcast status change to connected room channels
    try {
      const channel = db.channel(roomChannel(item.room_id));
      await channel.send({
        type: "broadcast",
        event: "status",
        payload: {
          id: item.room_id,
          status: item.new_status,
          reason: item.transition_reason,
        },
      });
      await db.removeChannel(channel);
    } catch (broadcastErr) {
      // Non-fatal: logged so failure to reach socket doesn't break DB status
      console.warn(`[lifecycle] Broadcast failed for room ${item.room_id}:`, broadcastErr);
    }
  }

  return transitions;
}

let workerTimer: NodeJS.Timeout | null = null;

/**
 * Starts the recurring lifecycle worker.
 * By default runs every 60 seconds (60,000 ms).
 */
export function startLifecycleWorker(intervalMs = 60_000) {
  if (workerTimer) return stopLifecycleWorker;

  // Run initial sweep asynchronously
  runLifecycleSweep().catch((err) => {
    console.error("[lifecycle] Initial sweep failed:", err);
  });

  workerTimer = setInterval(() => {
    runLifecycleSweep().catch((err) => {
      console.error("[lifecycle] Recurring sweep failed:", err);
    });
  }, intervalMs);

  // Allow Node process to exit gracefully if only this timer is pending
  if (workerTimer.unref) workerTimer.unref();

  return stopLifecycleWorker;
}

/**
 * Stops the recurring lifecycle worker.
 */
export function stopLifecycleWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
