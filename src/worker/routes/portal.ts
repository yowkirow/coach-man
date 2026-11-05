import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type {
  PortalAcademyDto,
  PortalHomeDto,
  PortalHomeStudentDto,
  PortalMoneyDto,
  PortalProgressDto,
  PortalScheduleDto,
  PortalStudentDto,
  PortalTeenInviteCreatedDto,
} from "../../shared/api-types";
import { checkTeenInvite } from "../../shared/family";
import { portalRangeQuerySchema } from "../../shared/schemas";
import { addDays, daysBetween, startOfLocalDay, todayIn } from "../../shared/time";
import { client, clientAccess, invite } from "../db/schema";
import { ApiError, badRequest, forbidden, notFound } from "../lib/errors";
import { toPortalSafety, toPortalStudent, toPortalStudentRef } from "../lib/portal-dto";
import { canReadPortalFile, linkFor, type PortalLink, workspacesOf } from "../lib/portal-scope";
import { v } from "../lib/validate";
import { originGuard, requirePortal } from "../middleware";
import { createFamilyInvite, familyAudit, revokeFamilyAccess } from "../services/family";
import {
  academiesFor,
  academyRefFor,
  academyTimezone,
  balancesOf,
  coachesFor,
  commentsFor,
  creditsFor,
  latestAssessmentFor,
  moneyFor,
  nextSessionFor,
  programsFor,
  progressFor,
  sessionsFor,
  studentsFor,
  teenAccessFor,
} from "../services/portal";
import type { AppBindings } from "../types";

const studentNotFound = () => notFound("Student");

/** The caller's link to the student in the path, and the student's row; 404 otherwise. */
async function student(c: Context<AppBindings>) {
  const link = linkFor(c.var.portal, c.req.param("clientId") ?? "");
  if (!link) throw studentNotFound();
  const row = await c.var.db.query.client.findFirst({
    where: and(eq(client.id, link.clientId), eq(client.workspaceId, link.workspaceId)),
  });
  if (!row) throw studentNotFound();
  return { link, row, today: todayIn(await academyTimezone(c.var.db, link.workspaceId)) };
}

/** Only a parent manages their teen's own login. */
function asGuardian(link: PortalLink) {
  if (link.relation !== "guardian") {
    throw forbidden("Only a parent or guardian can manage a student's own login.");
  }
}

/** The first name of a full name ("Pat Santos" → "Pat"). */
const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/**
 * The family portal's API (/api/portal): what a student or a parent may see, scoped to the
 * students they're linked to (`requirePortal`). Unknown and unlinked ids answer 404. Every answer
 * is built by the family-safe mappers in lib/portal-dto.ts, never from a staff DTO.
 */
export const portalRoutes = new Hono<AppBindings>()
  .use("*", originGuard, requirePortal)

  .get("/home", async (c) => {
    const { db } = c.var;
    const scope = c.var.portal;
    const now = Date.now();
    const [academies, students, balances, comments] = await Promise.all([
      academiesFor(db, c.env, workspacesOf(scope)),
      studentsFor(db, scope.links),
      balancesOf(db, scope.links),
      commentsFor(db, scope.links, 5),
    ]);
    const home: PortalHomeStudentDto[] = [];
    for (const link of scope.links) {
      const row = students.get(link.clientId);
      const academy = academies.get(link.workspaceId);
      if (!row || !academy) continue;
      const today = todayIn(academy.timezone, now);
      const [nextSession, credits, latestAssessment] = await Promise.all([
        nextSessionFor(db, link, now),
        creditsFor(db, link, today),
        latestAssessmentFor(db, link),
      ]);
      home.push({
        ...toPortalStudentRef(row, link),
        nextSession,
        credits,
        balanceMinor: balances.get(link.clientId) ?? 0,
        latestAssessment,
      });
    }
    const body: PortalHomeDto = {
      user: { name: c.var.user.name, firstName: firstNameOf(c.var.user.name) },
      academies: [...academies.values()],
      students: home,
      comments,
      // Announcements arrive with WS5; the home page already has their place.
      announcements: [],
    };
    return c.json(body);
  })

  .get("/academies/:workspaceId", async (c) => {
    const workspaceId = c.req.param("workspaceId");
    if (!workspacesOf(c.var.portal).includes(workspaceId)) throw notFound("Academy");
    const academy = (await academiesFor(c.var.db, c.env, [workspaceId])).get(workspaceId);
    if (!academy) throw notFound("Academy");
    return c.json<PortalAcademyDto>(academy);
  })

  .get("/students/:clientId", async (c) => {
    const { link, row, today } = await student(c);
    const db = c.var.db;
    const [academy, coaches, programs, teenAccess, latest] = await Promise.all([
      academyRefFor(db, link.workspaceId),
      coachesFor(db, link),
      programsFor(db, link),
      link.relation === "guardian" ? teenAccessFor(db, row, today) : Promise.resolve(null),
      latestAssessmentFor(db, link),
    ]);
    const body: PortalStudentDto = {
      academy,
      student: toPortalStudent(row, link, latest?.overallLevel ?? null),
      safety: toPortalSafety(row),
      coaches,
      programs,
      teenAccess,
    };
    return c.json(body);
  })

  .get("/students/:clientId/schedule", v("query", portalRangeQuerySchema), async (c) => {
    const { link, today } = await student(c);
    const q = c.req.valid("query");
    const from = q.from ?? addDays(today, -90);
    const to = q.to ?? addDays(today, 60);
    if (to < from || daysBetween(from, to) > 400) {
      throw badRequest("Pick a window of a year or less, with the start before the end.");
    }
    const db = c.var.db;
    const academy = await academyRefFor(db, link.workspaceId);
    const sessions = await sessionsFor(db, link, {
      from: startOfLocalDay(from, academy.timezone),
      to: startOfLocalDay(addDays(to, 1), academy.timezone),
    });
    return c.json<PortalScheduleDto>({ academy, from, to, sessions });
  })

  .get("/students/:clientId/progress", async (c) => {
    const { link } = await student(c);
    const db = c.var.db;
    const [academy, progress] = await Promise.all([
      academyRefFor(db, link.workspaceId),
      progressFor(db, link),
    ]);
    return c.json<PortalProgressDto>({ academy, ...progress });
  })

  .get("/students/:clientId/money", async (c) => {
    const { link, today } = await student(c);
    const db = c.var.db;
    const [academy, money] = await Promise.all([
      academyRefFor(db, link.workspaceId),
      moneyFor(db, link, today),
    ]);
    return c.json<PortalMoneyDto>({ academy, ...money });
  })

  /** A parent makes their teen's own login (13–17, by birth date): a single-use link, 7 days. */
  .post("/students/:clientId/teen-invite", async (c) => {
    await c.req.raw.arrayBuffer().catch(() => undefined);
    const { link, row, today } = await student(c);
    asGuardian(link);
    const check = checkTeenInvite({
      birthDate: row.birthDate,
      isJunior: row.isJunior,
      today,
      firstName: row.firstName,
    });
    if (!check.ok) throw new ApiError(409, check.code, check.message);
    const created = await createFamilyInvite(c.var.db, c.env, {
      workspaceId: link.workspaceId,
      clientId: row.id,
      relation: "self",
      createdBy: c.var.user.id,
      by: "guardian",
    });
    const body: PortalTeenInviteCreatedDto = {
      invite: {
        id: created.row.id,
        status: "valid",
        createdAt: created.row.createdAt,
        expiresAt: created.row.expiresAt,
      },
      link: created.link,
    };
    return c.json(body, 201);
  })

  /** A parent withdraws a waiting own-login link of their teen. */
  .delete("/students/:clientId/teen-invites/:inviteId", async (c) => {
    const { link, row } = await student(c);
    asGuardian(link);
    const db = c.var.db;
    const found = await db.query.invite.findFirst({
      where: and(
        eq(invite.id, c.req.param("inviteId")),
        eq(invite.workspaceId, link.workspaceId),
        eq(invite.kind, "family"),
        eq(invite.clientId, row.id),
        eq(invite.relation, "self"),
        isNull(invite.acceptedAt),
      ),
    });
    if (!found) throw notFound("Invite");
    if (!found.revokedAt) {
      await db.batch([
        db.update(invite).set({ revokedAt: Date.now() }).where(eq(invite.id, found.id)),
        familyAudit(db, {
          workspaceId: link.workspaceId,
          userId: c.var.user.id,
          action: "revoke",
          entity: "family_invite",
          entityId: found.id,
          data: { clientId: row.id, relation: "self", by: "guardian" },
        }),
      ]);
    }
    return c.body(null, 204);
  })

  /**
   * A parent ends their teen's own login. Only the student's own (`self`) access can be revoked
   * here: other parents' access is the academy's to manage, and isn't even listed (404).
   */
  .delete("/students/:clientId/access/:accessId", async (c) => {
    const { link, row, today } = await student(c);
    asGuardian(link);
    const db = c.var.db;
    const target = await db.query.clientAccess.findFirst({
      where: and(
        eq(clientAccess.id, c.req.param("accessId")),
        eq(clientAccess.clientId, row.id),
        eq(clientAccess.workspaceId, link.workspaceId),
        eq(clientAccess.relation, "self"),
      ),
    });
    if (!target) throw notFound("Login");
    await revokeFamilyAccess(db, {
      student: row,
      accessId: target.id,
      actorId: c.var.user.id,
      today,
      by: "guardian",
    });
    return c.body(null, 204);
  })

  /**
   * Files: the caller's own students' photos and their academies' public images (logo, payment
   * QR, coach photos). Anything else, including other students' files and payment proofs (WS4),
   * answers 404.
   */
  .get("/files/*", async (c) => {
    let key: string;
    try {
      key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/api\/portal\/files\//, ""));
    } catch {
      throw notFound("File");
    }
    if (!canReadPortalFile(c.var.portal, key)) throw notFound("File");
    const obj = await c.env.FILES.get(key);
    if (!obj) throw notFound("File");
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=86400, immutable",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
