import { and, asc, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { DEFAULT_PAYMENT_METHODS } from "../shared/domain";
import { type Capability, can, normalizeRole } from "../shared/roles";
import { getAuth } from "./auth";
import { getDb } from "./db/client";
import { client, clientAccess, organization, workspaceSettings } from "./db/schema";
import { ApiError, forbidden, noWorkspace, unauthorized } from "./lib/errors";
import { redactMoney } from "./lib/redact";
import { activeMembership } from "./lib/workspace";
import type { AppBindings, Ctx } from "./types";

export const withServices = createMiddleware<AppBindings>(async (c, next) => {
  c.set("db", getDb(c.env.DB));
  c.set("auth", getAuth(c.env));
  await next();
});

/**
 * API responses are private and never cached by intermediaries, unless a route says otherwise
 * (public academy images under /api/public/files).
 */
export const apiHeaders = createMiddleware<AppBindings>(async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control") || !c.req.path.startsWith("/api/public/")) {
    c.header("Cache-Control", "no-store");
  }
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

/** Any signed-in person (staff or family); sets `user`. */
export const requireUser = createMiddleware<AppBindings>(async (c, next) => {
  const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) throw unauthorized();
  c.set("user", result.user);
  await next();
});

/**
 * The family portal (/api/portal): any signed-in person, with the students they're linked to
 * (active client_access rows, each in its student's own academy). Someone linked to nobody gets
 * an empty scope, not an error; routes answer 404 for anything outside it.
 */
export const requirePortal = createMiddleware<AppBindings>(async (c, next) => {
  const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) {
    // Drain the body first: Miniflare's local proxy can fail a request answered unread.
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      await c.req.raw.arrayBuffer().catch(() => undefined);
    }
    throw unauthorized();
  }
  const links = await c.var.db
    .select({
      accessId: clientAccess.id,
      clientId: clientAccess.clientId,
      workspaceId: clientAccess.workspaceId,
      relation: clientAccess.relation,
    })
    .from(clientAccess)
    .innerJoin(
      client,
      and(eq(client.id, clientAccess.clientId), eq(client.workspaceId, clientAccess.workspaceId)),
    )
    .where(and(eq(clientAccess.userId, result.user.id), isNull(clientAccess.revokedAt)))
    .orderBy(asc(clientAccess.createdAt));
  c.set("user", result.user);
  c.set("portal", { userId: result.user.id, links });
  await next();
});

/**
 * Staff only: resolves the academy the caller acts in (the session's active workspace, else their
 * oldest membership) and their role there. Never creates a workspace: people who aren't staff
 * anywhere get 403 `no_workspace` and the app sends them to /welcome.
 */
export const requireWorkspace = createMiddleware<AppBindings>(async (c, next) => {
  const db = c.var.db;
  const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) throw unauthorized();
  const { user, session } = result;

  const membership = await activeMembership(
    db,
    user.id,
    (session as { activeOrganizationId?: string | null }).activeOrganizationId,
  );
  if (!membership) throw noWorkspace();
  const { workspaceId } = membership;

  let settings = await db.query.workspaceSettings.findFirst({
    where: eq(workspaceSettings.workspaceId, workspaceId),
  });
  if (!settings) {
    try {
      await db
        .insert(workspaceSettings)
        .values({ workspaceId, paymentMethods: DEFAULT_PAYMENT_METHODS })
        .onConflictDoNothing();
    } catch (err) {
      // The workspace was deleted while this request was in flight: not staff there any more.
      const exists = await db.query.organization.findFirst({
        where: eq(organization.id, workspaceId),
        columns: { id: true },
      });
      if (!exists) throw noWorkspace();
      throw err;
    }
    settings = await db.query.workspaceSettings.findFirst({
      where: eq(workspaceSettings.workspaceId, workspaceId),
    });
  }
  if (!settings)
    throw new ApiError(500, "workspace_unavailable", "Workspace settings are missing.");

  c.set("user", user);
  c.set("workspaceId", workspaceId);
  c.set("settings", settings);
  c.set("role", normalizeRole(membership.role));
  await next();
});

const CAPABILITY_DENIED: Record<Capability, string> = {
  money: "Only the academy's owner and admins can see or change money.",
  catalog: "Only the academy's owner and admins can change rates, packages, programs, and events.",
  team: "Only the academy's owner and admins can manage the team.",
  settings: "Only the academy's owner and admins can change academy settings.",
  enrollment: "Only the academy's owner and admins can review enrollments and payments.",
  familyAccess: "Only the academy's owner and admins can manage family access.",
  announcements: "Only the academy's owner and admins can publish announcements.",
  data: "Only the academy's owner and admins can import, export, or delete data.",
  ownership: "Only the academy's owner can do this.",
};

/** 403 unless the caller's role has the capability. */
export function assertCan(role: string, cap: Capability): void {
  if (!can(role, cap)) throw new ApiError(403, "forbidden", CAPABILITY_DENIED[cap], { cap });
}

/** Route guard: the caller's role must have `cap` (runs after requireWorkspace). */
export const requireCap = (cap: Capability) =>
  createMiddleware<AppBindings>(async (c, next) => {
    if (!can(c.var.role, cap)) {
      // Drain the body first: Miniflare's local proxy can fail a request answered unread.
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        await c.req.raw.arrayBuffer().catch(() => undefined);
      }
      assertCan(c.var.role, cap);
    }
    await next();
  });

/**
 * Strips money from successful JSON responses for staff without the `money` capability (coaches).
 * See lib/redact.ts for what counts as money.
 */
export const redactMoneyForRole = createMiddleware<AppBindings>(async (c, next) => {
  await next();
  if (!c.var.role || can(c.var.role, "money")) return;
  const res = c.res;
  if (res.status < 200 || res.status >= 300) return;
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return;
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  c.res = undefined;
  c.res = new Response(body === undefined ? text : JSON.stringify(redactMoney(body)), {
    status: res.status,
    headers,
  });
});

export function ctxOf(c: Context<AppBindings>): Ctx {
  return {
    db: c.var.db,
    env: c.env,
    workspaceId: c.var.workspaceId,
    userId: c.var.user.id,
    settings: c.var.settings,
    role: c.var.role,
  };
}
