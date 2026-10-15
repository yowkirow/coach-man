import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db/client";
import { member, organization, workspaceSettings } from "../db/schema";
import { E2E_HEADER, isBypassRequestAllowed } from "../lib/bypass";
import { unauthorized } from "../lib/errors";
import { firstWorkspaceForUser, provisionWorkspace } from "../lib/workspace";
import { seedSampleData } from "../services/sample-data";
import type { AppBindings } from "../types";

/**
 * Playwright-only helpers. Every route answers 404 unless the bypass is enabled for this
 * environment (never in production) and the request carries the shared secret header.
 */
export const testRoutes = new Hono<AppBindings>()
  .use("*", async (c, next) => {
    if (!isBypassRequestAllowed(c.env, c.req.header(E2E_HEADER))) {
      // Drain the body first: Miniflare's local proxy can fail a request answered unread.
      await c.req.raw.arrayBuffer().catch(() => undefined);
      return c.json({ error: { code: "not_found", message: "No such endpoint." } }, 404);
    }
    await next();
  })

  .post("/sign-in", async (c) => {
    const url = new URL("/api/auth/e2e/sign-in", c.req.url);
    const body = await c.req.text();
    const headers = new Headers(c.req.raw.headers);
    headers.set("content-type", "application/json");
    return c.var.auth.handler(new Request(url, { method: "POST", headers, body: body || "{}" }));
  })

  .post("/reset", async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw unauthorized();
    const db = getDb(c.env.DB);
    const memberships = await db.select().from(member).where(eq(member.userId, session.user.id));
    for (const m of memberships) {
      await db.delete(organization).where(eq(organization.id, m.organizationId));
    }
    return c.body(null, 204);
  })

  .post("/seed", async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw unauthorized();
    const db = getDb(c.env.DB);
    const wsId =
      (await firstWorkspaceForUser(db, session.user.id)) ??
      (await provisionWorkspace(db, { id: session.user.id, name: session.user.name }));
    const settings = await db.query.workspaceSettings.findFirst({
      where: eq(workspaceSettings.workspaceId, wsId),
    });
    if (!settings) throw unauthorized();
    const tz = c.req.query("tz");
    const currency = c.req.query("currency");
    const effective = {
      ...settings,
      ...(tz ? { timezone: tz } : {}),
      ...(currency ? { currency } : {}),
    };
    await db
      .update(workspaceSettings)
      .set({
        timezone: effective.timezone,
        currency: effective.currency,
        onboardedAt: settings.onboardedAt ?? Date.now(),
      })
      .where(eq(workspaceSettings.workspaceId, wsId));
    const ids = await seedSampleData({
      db,
      env: c.env,
      workspaceId: wsId,
      userId: session.user.id,
      settings: effective,
    });
    return c.json(ids);
  });
