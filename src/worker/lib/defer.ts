import type { Context } from "hono";

/**
 * Work that runs after the response is sent (Cloudflare's `executionCtx.waitUntil`), so a push to
 * every family never holds up the request that caused it. It never throws: a failure is logged.
 * Outside a Worker request (unit tests, scripts) there's no execution context; the work still
 * runs, unawaited.
 */
export function deferrer(c: Context): (work: Promise<unknown>) => void {
  return (work) => {
    const safe = work.catch((err) => console.error("Deferred work failed", err));
    try {
      c.executionCtx.waitUntil(safe);
    } catch {
      // No ExecutionContext here: `safe` runs on its own.
    }
  };
}

/** Runs `work()` after the response (see deferrer), logging failures under `label`. */
export function later(c: Context, label: string, work: () => Promise<unknown>): void {
  deferrer(c)(
    Promise.resolve()
      .then(work)
      .catch((err) => console.error(label, err)),
  );
}

/**
 * Runs `work()` after the response when the caller has a request (`ctx.defer`), else now (cron,
 * scripts), logging failures under `label` either way. Never throws.
 */
export async function afterResponse(
  ctx: { defer?: (work: Promise<unknown>) => void },
  label: string,
  work: () => Promise<unknown>,
): Promise<void> {
  const task = Promise.resolve()
    .then(work)
    .catch((err) => console.error(label, err));
  if (ctx.defer) ctx.defer(task);
  else await task;
}
