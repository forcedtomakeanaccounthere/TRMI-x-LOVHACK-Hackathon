import * as Y from "yjs";
import type { NotebookMessage } from "./use-room-channel";

// Keeps one browser's copy of the shared notebook (a Yjs document) in step with everyone else's:
// - local edits go out over the room channel at once, and to apps/backend in batches (it keeps the
//   merged notebook for whoever comes later);
// - edits from others are applied as they arrive;
// - on load, the saved notebook is applied and the room is asked for anything newer than it.
// Yjs updates commute and repeat harmlessly, so order and duplicates don't matter.

export const REMOTE = Symbol("notebook-remote"); // origin of edits that came from elsewhere
export const SAVE_DELAY_MS = 800;
const RETRY_DELAY_MS = 5000;

export type NotebookIo = {
  broadcast: (update: string, to?: string) => void;
  request: (stateVector: string) => void;
  save: (update: string) => Promise<void>;
  /** Called when a save fails; return true to retry it later, false to drop it. */
  onSaveError?: (err: unknown) => boolean;
};

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export class NotebookSync {
  private pending: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private destroyed = false;

  constructor(
    private readonly doc: Y.Doc,
    private readonly io: NotebookIo,
    private readonly delayMs = SAVE_DELAY_MS,
  ) {
    doc.on("update", this.onUpdate);
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return; // someone else's edit: they send and save it
    this.io.broadcast(toB64(update));
    this.pending.push(update);
    this.schedule(this.delayMs);
  };

  /** Applies the saved notebook (if any), then asks the room for edits it doesn't include. */
  load(state: string | null) {
    if (state) Y.applyUpdate(this.doc, fromB64(state), REMOTE);
    this.io.request(toB64(Y.encodeStateVector(this.doc)));
  }

  receive(message: NotebookMessage) {
    if (message.type === "update") {
      Y.applyUpdate(this.doc, fromB64(message.update), REMOTE);
      return;
    }
    // A newcomer listed what it has: send it what it lacks (an empty diff is 2 bytes).
    const diff = Y.encodeStateAsUpdate(this.doc, fromB64(message.sv));
    if (diff.length > 2) this.io.broadcast(toB64(diff), message.from);
  }

  private schedule(delay: number) {
    if (this.timer || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  /** Saves the edits made here since the last save, as one merged update. */
  async flush() {
    if (this.saving || !this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    this.saving = true;
    try {
      await this.io.save(toB64(batch.length === 1 ? batch[0]! : Y.mergeUpdates(batch)));
    } catch (err) {
      if (this.io.onSaveError?.(err) ?? true) {
        this.pending = [...batch, ...this.pending];
        this.saving = false;
        this.schedule(RETRY_DELAY_MS);
        return;
      }
    }
    this.saving = false;
    if (this.pending.length) this.schedule(this.delayMs);
  }

  /** Stops listening and saves what's left. */
  destroy() {
    this.doc.off("update", this.onUpdate);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.flush();
    this.destroyed = true;
  }
}
