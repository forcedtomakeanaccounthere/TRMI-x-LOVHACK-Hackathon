import { MAX_LEDGER_BATCH } from "@linkroom/shared";
import { ApiError, type LedgerAuth } from "@/lib/api";
import type { LedgerEvent } from "./types";

// Keeps a room's ledger on the server (apps/backend routes/ledger.ts), so the room doesn't depend on
// someone being online: whoever opens it later loads every event from there, and can see what
// changed while they were away. Live updates still travel over the room's Realtime channel.
// - load(): every saved event, a page at a time;
// - push(): this browser's new events, in batches, retried while the server can't be reached;
// - backfill(): this browser's own events from before it saved to the server (ids make it safe).

const RETRY_MS = 5000;

export type LedgerIo = {
  // Events as the server stored them (it validated each one when it was saved).
  list: (after: number) => Promise<{ events: { seq: number }[]; next: number | null }>;
  post: (events: LedgerEvent[]) => Promise<{ accepted: string[]; rejected: { id: string | null; reason: string }[] }>;
  /** The server refused some events for good (a role, a kick, a read-only room). */
  onRejected?: (rejected: { id: string | null; reason: string }[]) => void;
};

export class LedgerSync {
  private queue: LedgerEvent[] = [];
  private sending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly io: LedgerIo) {}

  /** Every event the server holds, oldest first. */
  async load(): Promise<LedgerEvent[]> {
    const all: LedgerEvent[] = [];
    let after = 0;
    for (;;) {
      const page = await this.io.list(after);
      for (const row of page.events) {
        const event = { ...row } as Partial<{ seq: number }>;
        delete event.seq; // the server's order, not part of the event
        all.push(event as unknown as LedgerEvent);
      }
      if (page.next === null || page.events.length === 0) break;
      after = page.next;
    }
    return all;
  }

  /** Saves these events (this browser's own), in order. */
  push(events: LedgerEvent[]) {
    if (this.stopped || events.length === 0) return;
    const queued = new Set(this.queue.map((e) => e.id));
    this.queue.push(...events.filter((e) => !queued.has(e.id)));
    void this.flush();
  }

  /** Saves this browser's own events that the server doesn't have yet. */
  backfill(local: LedgerEvent[], onServer: LedgerEvent[], myId: string) {
    const saved = new Set(onServer.map((e) => e.id));
    this.push(local.filter((e) => e.actor.id === myId && !saved.has(e.id)).map(repair));
  }

  private async flush() {
    if (this.sending || this.stopped || this.queue.length === 0) return;
    this.sending = true;
    const batch = this.queue.slice(0, MAX_LEDGER_BATCH);
    try {
      const res = await this.io.post(batch);
      this.queue = this.queue.slice(batch.length);
      if (res.rejected.length) this.io.onRejected?.(res.rejected);
    } catch (err) {
      // The whole batch was refused (signed out, removed, bad input): retrying won't help.
      if (
        err instanceof ApiError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 408 &&
        err.status !== 429
      ) {
        this.queue = this.queue.slice(batch.length);
        this.io.onRejected?.(batch.map((e) => ({ id: e.id, reason: err.message })));
      } else {
        this.sending = false;
        this.retryLater();
        return;
      }
    }
    this.sending = false;
    if (this.queue.length) void this.flush();
  }

  private retryLater() {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, RETRY_MS);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

// Positions are fractions of a block, and the server takes -0.5 to 1.5. Marks saved by older builds
// could reach past that (a long highlighter drag from a short block), so they're clipped before
// they're sent again, the way new ones are clipped when they're made.
const LO = -0.5;
const HI = 1.5;
const fraction = (v: number) => Math.min(HI, Math.max(LO, v));
const span = (from: number, size: number) => {
  const a = fraction(from);
  return [a, Math.max(0, Math.min(HI, from + size) - a)] as const;
};
export function repair(event: LedgerEvent): LedgerEvent {
  if (event.type === "annot.move") return { ...event, x: fraction(event.x), y: fraction(event.y) };
  if (event.type !== "annot.add") return event;
  const a = event.annotation;
  if (a.kind === "region") {
    const [x, w] = span(a.rect.x, a.rect.w);
    const [y, h] = span(a.rect.y, a.rect.h);
    return { ...event, annotation: { ...a, rect: { x, y, w, h } } };
  }
  if (a.kind === "note" || a.kind === "ai")
    return { ...event, annotation: { ...a, x: fraction(a.x), y: fraction(a.y) } };
  if (a.kind === "ink")
    return {
      ...event,
      annotation: { ...a, points: a.points.map(([px, py]) => [fraction(px), fraction(py)] as [number, number]) },
    };
  return event;
}

export const authFor = (
  me: { id: string; signedIn: boolean },
  token: string | null,
  guestKey: () => string,
): LedgerAuth | null => (me.signedIn ? (token ? { token } : null) : { guestId: me.id, guestKey: guestKey() });
