import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { env } from "../env";
import { HttpError } from "../middleware/error";

const UNAVAILABLE = "The AI couldn't answer right now. Try again in a moment.";

/**
 * POSTs to apps/ai and validates the reply. Every AI call goes through here, so each one carries
 * the internal token and a request id, and any failure reaches the user as a friendly 502 or 503
 * (never a 400 because the model returned the wrong shape).
 */
export async function callAi<T>(path: string, body: unknown, schema: z.ZodType<T>, timeoutMs: number): Promise<T> {
  const requestId = randomUUID();
  // One deadline for both attempts: a retry gets only the time the first one left.
  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response | undefined;
  for (let attempt = 1; !res; attempt++) {
    try {
      res = await fetch(`${env.AI_SERVICE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": env.AI_INTERNAL_TOKEN ?? "",
          "X-Request-Id": requestId,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // A refused or dropped connection (a restart, a cold start) is worth one more try. A timeout
      // is not: it has used up the time already.
      if (attempt === 1 && !signal.aborted) {
        console.warn(`AI ${path} [${requestId}] connection failed, retrying once:`, err);
        continue;
      }
      console.error(`AI ${path} [${requestId}] unreachable:`, err);
      throw new HttpError(502, UNAVAILABLE);
    }
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`AI ${path} [${requestId}] answered ${res.status}: ${detail.slice(0, 500)}`);
    if (res.status === 503) throw new HttpError(503, "AI features aren't set up on this server yet.");
    throw new HttpError(502, UNAVAILABLE);
  }

  const parsed = schema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) {
    console.error(`AI ${path} [${requestId}] returned an unexpected shape:`, parsed.error.issues);
    throw new HttpError(502, UNAVAILABLE);
  }
  return parsed.data;
}
