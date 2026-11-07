import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { idempotencyKey } from "../db/schema";
import type { AppBindings } from "../types";

/**
 * Replays the stored response when a request with the same Idempotency-Key was already
 * processed for this workspace. Offline-queued mutations send their mutation id as the key,
 * so a retried check-in can never deduct a credit twice.
 */
export async function idempotent(
  c: Context<AppBindings>,
  run: () => Promise<Response>,
): Promise<Response> {
  const header = c.req.header("Idempotency-Key");
  if (!header || header.length > 100) return run();
  const db = c.var.db;
  const key = `${c.var.workspaceId}:${header}`;

  const existing = await db.query.idempotencyKey.findFirst({ where: eq(idempotencyKey.key, key) });
  if (existing) {
    return new Response(existing.response, {
      status: existing.status,
      headers: { "content-type": "application/json", "idempotent-replay": "true" },
    });
  }

  const res = await run();
  if (res.status < 500) {
    const body = await res.clone().text();
    await db
      .insert(idempotencyKey)
      .values({
        key,
        workspaceId: c.var.workspaceId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: res.status,
        response: body,
      })
      .onConflictDoNothing();
  }
  return res;
}
