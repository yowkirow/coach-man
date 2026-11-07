import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

/**
 * Reads and drops a request's body before answering without it: Miniflare's local proxy (vite dev
 * and preview, and so the E2E suite) fails a request answered unread with a 500 "fetch failed"
 * instead of passing the answer on. In production this only reads a body nobody needed.
 */
export async function drainBody(c: Context): Promise<void> {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    await c.req.raw.arrayBuffer().catch(() => undefined);
  }
}

/**
 * The same, for every request, after its route: a route that answers without reading the body it
 * was sent (the app posts `{}` to actions like "archive"), or an error answered before the body was
 * read, still reaches the client.
 */
export const drainUnreadBody = createMiddleware(async (c, next) => {
  await next();
  if (!c.req.raw.bodyUsed) await drainBody(c);
});
