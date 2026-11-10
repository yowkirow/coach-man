import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { FamilyAccessDto, FamilyInviteCreatedDto } from "../../shared/api-types";
import { checkFamilyAccess } from "../../shared/family";
import { familyInviteSchema } from "../../shared/schemas";
import { todayIn } from "../../shared/time";
import { client, invite, user } from "../db/schema";
import { ApiError, conflict, notFound } from "../lib/errors";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import {
  activeGuardianCount,
  createFamilyInvite,
  familyAudit,
  loadFamilyAccess,
  revokeFamilyAccess,
  toFamilyInviteDto,
} from "../services/family";
import type { AppBindings, Ctx } from "../types";

async function loadStudent(ctx: Ctx, id: string) {
  const row = await ctx.db.query.client.findFirst({
    where: and(eq(client.id, id), eq(client.workspaceId, ctx.workspaceId)),
  });
  if (!row) throw notFound("Client");
  return row;
}

/**
 * Family access on a student's page (staff API, `familyAccess`: owners, admins, and the front
 * desk). Linked parents and the student's own login, invite links (Copy, Share, a message to paste;
 * no email), and revoking. The age rules decide which invites can be made, and say why not. Every
 * grant and revoke is audited.
 */
export const familyRoutes = new Hono<AppBindings>()
  .get("/clients/:id/family", requireCap("familyAccess"), async (c) => {
    const ctx = ctxOf(c);
    const student = await loadStudent(ctx, c.req.param("id"));
    const body: FamilyAccessDto = await loadFamilyAccess(
      ctx.db,
      student,
      todayIn(ctx.settings.timezone),
    );
    return c.json(body);
  })

  .post(
    "/clients/:id/family/invites",
    requireCap("familyAccess"),
    v("json", familyInviteSchema),
    async (c) => {
      const ctx = ctxOf(c);
      const student = await loadStudent(ctx, c.req.param("id"));
      const { relation } = c.req.valid("json");
      const rule = checkFamilyAccess({
        relation,
        birthDate: student.birthDate,
        isJunior: student.isJunior,
        today: todayIn(ctx.settings.timezone),
        hasGuardian: (await activeGuardianCount(ctx.db, student.id)) > 0,
      });
      if (!rule.ok) throw new ApiError(409, rule.code, rule.message);
      const { row, link } = await createFamilyInvite(ctx.db, ctx.env, {
        workspaceId: ctx.workspaceId,
        clientId: student.id,
        relation,
        createdBy: ctx.userId,
        by: "staff",
      });
      const me = await ctx.db.query.user.findFirst({
        where: eq(user.id, ctx.userId),
        columns: { name: true },
      });
      const body: FamilyInviteCreatedDto = {
        invite: toFamilyInviteDto(row, me?.name ?? null),
        link,
      };
      return c.json(body, 201);
    },
  )

  .delete("/clients/:id/family/invites/:inviteId", requireCap("familyAccess"), async (c) => {
    const ctx = ctxOf(c);
    const student = await loadStudent(ctx, c.req.param("id"));
    const row = await ctx.db.query.invite.findFirst({
      where: and(
        eq(invite.id, c.req.param("inviteId")),
        eq(invite.workspaceId, ctx.workspaceId),
        eq(invite.kind, "family"),
        eq(invite.clientId, student.id),
      ),
    });
    if (!row) throw notFound("Invite");
    if (row.acceptedAt) throw conflict("This invite was already used, so it can't be withdrawn.");
    if (!row.revokedAt) {
      await ctx.db.batch([
        ctx.db.update(invite).set({ revokedAt: Date.now() }).where(eq(invite.id, row.id)),
        familyAudit(ctx.db, {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          action: "revoke",
          entity: "family_invite",
          entityId: row.id,
          data: { clientId: student.id, relation: row.relation, by: "staff" },
        }),
      ]);
    }
    return c.body(null, 204);
  })

  .delete("/clients/:id/family/access/:accessId", requireCap("familyAccess"), async (c) => {
    const ctx = ctxOf(c);
    const student = await loadStudent(ctx, c.req.param("id"));
    const revoked = await revokeFamilyAccess(ctx.db, {
      student,
      accessId: c.req.param("accessId"),
      actorId: ctx.userId,
      today: todayIn(ctx.settings.timezone),
      by: "staff",
    });
    if (revoked === null) throw notFound("Family access");
    return c.body(null, 204);
  });
