import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AccountDto } from "../../shared/api-types";
import { normalizeRole } from "../../shared/roles";
import { academyProfile, client, clientAccess, member, organization, passkey } from "../db/schema";
import { ApiError, unauthorized } from "../lib/errors";
import { v } from "../lib/validate";
import { membershipsForUser, ownedWorkspaceForUser, provisionWorkspace } from "../lib/workspace";
import { originGuard } from "../middleware";
import type { AppBindings } from "../types";

async function sessionOf(c: Context<AppBindings>) {
  const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) throw unauthorized();
  return result;
}

/**
 * Makes `workspaceId` the session's active workspace through Better Auth, which also refreshes the
 * signed session cookie cache (otherwise the old workspace would stick for up to five minutes).
 * The caller must already be a member of that workspace.
 */
export async function setActiveWorkspace(c: Context<AppBindings>, workspaceId: string) {
  const { headers } = await c.var.auth.api.setActiveOrganization({
    headers: c.req.raw.headers,
    body: { organizationId: workspaceId },
    returnHeaders: true,
  });
  for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
}

/** Signed-in account endpoints that don't need a workspace (/api/account). */
export const accountRoutes = new Hono<AppBindings>()
  .use("*", originGuard)

  .get("/", async (c) => {
    const db = c.var.db;
    const { user, session } = await sessionOf(c);
    const [staffRows, familyRows, keys] = await Promise.all([
      db
        .select({
          workspaceId: member.organizationId,
          role: member.role,
          name: organization.name,
          slug: organization.slug,
          logoKey: academyProfile.logoKey,
        })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .leftJoin(academyProfile, eq(academyProfile.workspaceId, member.organizationId))
        .where(eq(member.userId, user.id))
        .orderBy(asc(member.createdAt)),
      db
        .select({
          workspaceId: clientAccess.workspaceId,
          academyName: organization.name,
          slug: organization.slug,
          logoKey: academyProfile.logoKey,
          clientId: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          relation: clientAccess.relation,
        })
        .from(clientAccess)
        .innerJoin(client, eq(client.id, clientAccess.clientId))
        .innerJoin(organization, eq(organization.id, clientAccess.workspaceId))
        .leftJoin(academyProfile, eq(academyProfile.workspaceId, clientAccess.workspaceId))
        .where(and(eq(clientAccess.userId, user.id), isNull(clientAccess.revokedAt)))
        .orderBy(asc(organization.name), asc(client.firstName), asc(client.lastName)),
      db.select({ n: count() }).from(passkey).where(eq(passkey.userId, user.id)),
    ]);

    const staff: AccountDto["staff"] = [];
    for (const r of staffRows) {
      if (staff.some((s) => s.workspaceId === r.workspaceId)) continue;
      staff.push({
        workspaceId: r.workspaceId,
        name: r.name,
        slug: r.slug,
        role: normalizeRole(r.role),
        logoKey: r.logoKey ?? null,
      });
    }

    const family: AccountDto["family"] = [];
    for (const r of familyRows) {
      let academy = family.find((f) => f.workspaceId === r.workspaceId);
      if (!academy) {
        academy = {
          workspaceId: r.workspaceId,
          academyName: r.academyName,
          slug: r.slug,
          logoKey: r.logoKey ?? null,
          students: [],
        };
        family.push(academy);
      }
      academy.students.push({
        clientId: r.clientId,
        firstName: r.firstName,
        lastName: r.lastName,
        relation: r.relation,
      });
    }

    const preferred = (session as { activeOrganizationId?: string | null }).activeOrganizationId;
    const body: AccountDto = {
      user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
      passkeyCount: keys[0]?.n ?? 0,
      staff,
      family,
      activeWorkspaceId:
        staff.find((s) => s.workspaceId === preferred)?.workspaceId ??
        staff[0]?.workspaceId ??
        null,
    };
    return c.json(body);
  })

  /** "Set up CoachMan for my coaching": the caller's own workspace, created once. */
  .post("/workspaces", async (c) => {
    const { user } = await sessionOf(c);
    const owned = await ownedWorkspaceForUser(c.var.db, user.id);
    const workspaceId =
      owned ?? (await provisionWorkspace(c.var.db, { id: user.id, name: user.name }));
    await setActiveWorkspace(c, workspaceId);
    return c.json({ workspaceId, created: !owned }, owned ? 200 : 201);
  })

  /** Switches the academy /api/v1 acts in (staff of more than one academy). */
  .post(
    "/active-workspace",
    v("json", z.object({ workspaceId: z.string().min(1).max(100) })),
    async (c) => {
      const { user } = await sessionOf(c);
      const { workspaceId } = c.req.valid("json");
      const memberships = await membershipsForUser(c.var.db, user.id);
      if (!memberships.some((m) => m.workspaceId === workspaceId)) {
        throw new ApiError(403, "forbidden", "You're not on this academy's team.");
      }
      await setActiveWorkspace(c, workspaceId);
      return c.json({ workspaceId });
    },
  );
