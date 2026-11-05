import { sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { Db } from "../db/client";
import { rateLimit } from "../db/schema";
import type { AppBindings } from "../types";
import { ApiError } from "./errors";

/**
 * Fixed-window rate limits for our own public endpoints (Better Auth limits its own), stored in
 * Better Auth's `rate_limit` table under keys that start with "coachman:". Each hit is one atomic
 * upsert, so concurrent requests can't slip past the count.
 */

export interface RateRule {
  windowMs: number;
  max: number;
}

export interface WindowState {
  count: number;
  /** When the current window opened (epoch ms). */
  windowStart: number;
}

/** The window after one more hit at `now`, and whether that hit is allowed. */
export function nextWindow(
  prev: WindowState | null,
  now: number,
  rule: RateRule,
): WindowState & { allowed: boolean; retryAfterMs: number } {
  const fresh = !prev || now - prev.windowStart >= rule.windowMs;
  const state = fresh
    ? { count: 1, windowStart: now }
    : { count: prev.count + 1, windowStart: prev.windowStart };
  const allowed = state.count <= rule.max;
  return {
    ...state,
    allowed,
    retryAfterMs: allowed ? 0 : Math.max(0, state.windowStart + rule.windowMs - now),
  };
}

/** The caller's IP as Cloudflare reports it (x-forwarded-for only matters off Cloudflare). */
export function clientIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** Counts one hit against `key` and reports whether it is within the rule. */
export async function hit(db: Db, key: string, rule: RateRule, now = Date.now()) {
  const id = `coachman:${key}`;
  // Same arithmetic as nextWindow, done in SQL so the read and the write are one statement.
  const [row] = await db
    .insert(rateLimit)
    .values({ id, key: id, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${now} - ${rateLimit.lastRequest} >= ${rule.windowMs} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${now} - ${rateLimit.lastRequest} >= ${rule.windowMs} then ${now} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count, windowStart: rateLimit.lastRequest });
  const count = row?.count ?? 1;
  const windowStart = row?.windowStart ?? now;
  const allowed = count <= rule.max;
  return {
    allowed,
    retryAfterSeconds: allowed
      ? 0
      : Math.ceil(Math.max(1, windowStart + rule.windowMs - now) / 1000),
  };
}

/** Route guard: at most `rule.max` requests per IP per window for this bucket. */
export const limitByIp = (bucket: string, rule: RateRule) =>
  createMiddleware<AppBindings>(async (c, next) => {
    const result = await hit(c.var.db, `${bucket}:${clientIp(c.req.raw.headers)}`, rule);
    if (!result.allowed) {
      // Drain the body first: Miniflare's local proxy can fail a request answered unread.
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        await c.req.raw.arrayBuffer().catch(() => undefined);
      }
      c.header("Retry-After", String(result.retryAfterSeconds));
      throw new ApiError(
        429,
        "rate_limited",
        "Too many tries from this connection. Wait a minute, then try again.",
      );
    }
    await next();
  });
