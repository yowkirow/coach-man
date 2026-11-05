import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { FAMILY_RELATIONS } from "../../shared/domain";
import { checkFamilyAccess } from "../../shared/family";
import { uuidv7 } from "../../shared/ids";
import { normalizeRole, STAFF_ROLES } from "../../shared/roles";
import { todayIn } from "../../shared/time";
import { getDb } from "../db/client";
import { client, clientAccess, invite, organization, workspaceSettings } from "../db/schema";
import { E2E_HEADER, isBypassRequestAllowed } from "../lib/bypass";
import { ApiError, notFound, noWorkspace, unauthorized } from "../lib/errors";
import { v } from "../lib/validate";
import {
  activeMembership,
  addStaffMember,
  firstWorkspaceForUser,
  membershipsForUser,
  provisionWorkspace,
} from "../lib/workspace";
import { seedSampleData } from "../services/sample-data";
import type { AppBindings } from "../types";

async function callerSession(c: Context<AppBindings>) {
  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw unauthorized();
  return session;
}

/** The caller's active workspace (like requireWorkspace, without provisioning). */
async function callerWorkspace(c: Context<AppBindings>) {
  const { user, session } = await callerSession(c);
  const membership = await activeMembership(
    getDb(c.env.DB),
    user.id,
    (session as { activeOrganizationId?: string | null }).activeOrganizationId,
  );
  if (!membership) throw noWorkspace();
  return { user, workspaceId: membership.workspaceId };
}

/** Finds the user by email or creates them (verified, like a Google sign-in would). */
async function ensureUser(c: Context<AppBindings>, email: string, name: string) {
  const auth = await c.var.auth.$context;
  const found = await auth.internalAdapter.findUserByEmail(email);
  if (found?.user) return found.user;
  return auth.internalAdapter.createUser({ email, name, emailVerified: true }, { method: "e2e" });
}

const memberSchema = z.object({
  email: z.email(),
  name: z.string().min(1).max(80).default("Sam Coach"),
  role: z.enum(STAFF_ROLES).default("coach"),
});

const familySchema = z.object({
  clientId: z.string().min(1),
  email: z.email(),
  name: z.string().min(1).max(80).default("Pat Family"),
  relation: z.enum(FAMILY_RELATIONS).default("guardian"),
  /** Skip the portal's age rules (e.g. to test what the API does with a bad link). */
  force: z.boolean().default(false),
});

/**
 * Playwright-only helpers. Every route answers 404 unless the bypass is enabled for this
 * environment (never in production) and the request carries the shared secret header.
 *
 * - POST /sign-in { email, name, persona?: "coach" | "none" } signs in (see auth.ts e2eSignIn).
 * - POST /member { email, name, role } adds a user to the caller's workspace as staff.
 * - POST /family { clientId, email, name, relation, force? } links a user to a student.
 * - POST /expire-invite { inviteId } makes one of the caller's academy's invites expire now.
 * - POST /seed fills the caller's workspace with the sample data; POST /reset deletes the
 *   workspaces the caller owns.
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

  .post("/member", v("json", memberSchema), async (c) => {
    const { workspaceId } = await callerWorkspace(c);
    const { email, name, role } = c.req.valid("json");
    const user = await ensureUser(c, email.toLowerCase(), name);
    await addStaffMember(getDb(c.env.DB), { workspaceId, userId: user.id, role });
    return c.json({ userId: user.id, workspaceId, role }, 201);
  })

  .post("/family", v("json", familySchema), async (c) => {
    const db = getDb(c.env.DB);
    const { user: caller, workspaceId } = await callerWorkspace(c);
    const input = c.req.valid("json");
    const student = await db.query.client.findFirst({
      where: and(eq(client.id, input.clientId), eq(client.workspaceId, workspaceId)),
    });
    if (!student) throw notFound("Client");
    if (!input.force) {
      const settings = await db.query.workspaceSettings.findFirst({
        where: eq(workspaceSettings.workspaceId, workspaceId),
      });
      const guardians = await db
        .select({ id: clientAccess.id })
        .from(clientAccess)
        .where(
          and(
            eq(clientAccess.clientId, student.id),
            eq(clientAccess.relation, "guardian"),
            isNull(clientAccess.revokedAt),
          ),
        )
        .limit(1);
      const check = checkFamilyAccess({
        relation: input.relation,
        birthDate: student.birthDate,
        isJunior: student.isJunior,
        today: todayIn(settings?.timezone ?? "UTC"),
        hasGuardian: guardians.length > 0,
      });
      if (!check.ok) throw new ApiError(409, check.code, check.message);
    }
    const user = await ensureUser(c, input.email.toLowerCase(), input.name);
    await db
      .insert(clientAccess)
      .values({
        id: uuidv7(),
        workspaceId,
        clientId: student.id,
        userId: user.id,
        relation: input.relation,
        grantedBy: caller.id,
      })
      .onConflictDoUpdate({
        target: [clientAccess.clientId, clientAccess.userId],
        set: { relation: input.relation, revokedAt: null, grantedBy: caller.id },
      });
    return c.json(
      { userId: user.id, clientId: student.id, workspaceId, relation: input.relation },
      201,
    );
  })

  .post("/reset", async (c) => {
    const { user } = await callerSession(c);
    const db = getDb(c.env.DB);
    // Only what the caller owns: a coach-role member must never delete someone else's academy.
    for (const m of await membershipsForUser(db, user.id)) {
      if (normalizeRole(m.role) !== "owner") continue;
      await db.delete(organization).where(eq(organization.id, m.workspaceId));
    }
    return c.body(null, 204);
  })

  /** Makes one of the caller's academy's invites expire now (invites otherwise last 7 days). */
  .post("/expire-invite", v("json", z.object({ inviteId: z.string().min(1) })), async (c) => {
    const { workspaceId } = await callerWorkspace(c);
    const { inviteId } = c.req.valid("json");
    const res = await getDb(c.env.DB)
      .update(invite)
      .set({ expiresAt: Date.now() - 1000 })
      .where(and(eq(invite.id, inviteId), eq(invite.workspaceId, workspaceId)))
      .returning({ id: invite.id });
    if (!res.length) throw notFound("Invite");
    return c.body(null, 204);
  })

  .post("/seed", async (c) => {
    const { user } = await callerSession(c);
    const db = getDb(c.env.DB);
    const wsId =
      (await firstWorkspaceForUser(db, user.id)) ??
      (await provisionWorkspace(db, { id: user.id, name: user.name }));
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
      userId: user.id,
      settings: effective,
      role: "owner",
    });
    return c.json(ids);
  });
