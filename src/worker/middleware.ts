import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { DEFAULT_PAYMENT_METHODS } from "../shared/domain";
import { getAuth } from "./auth";
import { getDb } from "./db/client";
import { member, workspaceSettings } from "./db/schema";
import { ApiError, forbidden, unauthorized } from "./lib/errors";
import { firstWorkspaceForUser, provisionWorkspace } from "./lib/workspace";
import type { AppBindings, Ctx } from "./types";

export const withServices = createMiddleware<AppBindings>(async (c, next) => {
  c.set("db", getDb(c.env.DB));
  c.set("auth", getAuth(c.env));
  await next();
});

/** API responses are private and never cached by intermediaries. */
export const apiHeaders = createMiddleware<AppBindings>(async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

/** Rejects cross-origin state-changing requests (defence in depth on top of SameSite cookies). */
export const originGuard = createMiddleware<AppBindings>(async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("Origin");
    if (origin) {
      const allowed = new URL(c.env.APP_URL).origin;
      const self = new URL(c.req.url).origin;
      if (origin !== allowed && origin !== self) throw forbidden("Cross-origin request blocked.");
    }
  }
  await next();
});

export const requireWorkspace = createMiddleware<AppBindings>(async (c, next) => {
  const db = c.var.db;
  const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) throw unauthorized();
  const { user, session } = result;

  let workspaceId =
    (session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  if (workspaceId) {
    const rows = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, user.id), eq(member.organizationId, workspaceId)))
      .limit(1);
    if (rows.length === 0) workspaceId = null;
  }
  if (!workspaceId) {
    workspaceId =
      (await firstWorkspaceForUser(db, user.id)) ??
      (await provisionWorkspace(db, { id: user.id, name: user.name }));
  }

  let settings = await db.query.workspaceSettings.findFirst({
    where: eq(workspaceSettings.workspaceId, workspaceId),
  });
  if (!settings) {
    await db
      .insert(workspaceSettings)
      .values({ workspaceId, paymentMethods: DEFAULT_PAYMENT_METHODS })
      .onConflictDoNothing();
    settings = await db.query.workspaceSettings.findFirst({
      where: eq(workspaceSettings.workspaceId, workspaceId),
    });
  }
  if (!settings)
    throw new ApiError(500, "workspace_unavailable", "Workspace settings are missing.");

  c.set("user", user);
  c.set("workspaceId", workspaceId);
  c.set("settings", settings);
  await next();
});

export function ctxOf(c: Context<AppBindings>): Ctx {
  return {
    db: c.var.db,
    env: c.env,
    workspaceId: c.var.workspaceId,
    userId: c.var.user.id,
    settings: c.var.settings,
  };
}
