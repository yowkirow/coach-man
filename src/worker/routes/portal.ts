import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type {
  PortalAcademyDto,
  PortalAnnouncementsDto,
  PortalConsentsDto,
  PortalHomeDto,
  PortalHomeStudentDto,
  PortalMoneyDto,
  PortalProgressDto,
  PortalScheduleDto,
  PortalStudentDto,
  PortalTeenInviteCreatedDto,
} from "../../shared/api-types";
import { consentApplies, portalSigner } from "../../shared/consents";
import { checkTeenInvite } from "../../shared/family";
import { consentSignSchema, portalRangeQuerySchema } from "../../shared/schemas";
import { addDays, daysBetween, startOfLocalDay, todayIn } from "../../shared/time";
import type { Db } from "../db/client";
import {
  authorizedPickup,
  client,
  clientAccess,
  consentDocument,
  invite,
  paymentSubmission,
} from "../db/schema";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { toPortalStudentRef } from "../lib/portal-dto";
import {
  canReadPortalFile,
  type FileOwner,
  isPickupKey,
  isProofKey,
  linkFor,
  type PortalLink,
  workspacesOf,
} from "../lib/portal-scope";
import { clientIp } from "../lib/rate-limit";
import { v } from "../lib/validate";
import { originGuard, requirePortal } from "../middleware";
import { familyAnnouncements } from "../services/announcements";
import {
  missingByClient,
  portalConsentDocuments,
  recordSignature,
  studentIsMinor,
} from "../services/consents";
import { familyEnrollments, renewalOffers } from "../services/enrollment-family";
import { createFamilyInvite, familyAudit, revokeFamilyAccess } from "../services/family";
import {
  academiesFor,
  academyRefFor,
  academyTimezone,
  balancesOf,
  commentsFor,
  creditsFor,
  latestAssessmentFor,
  moneyFor,
  nextSessionFor,
  portalStudentDto,
  progressFor,
  sessionsFor,
  studentsFor,
} from "../services/portal";
import type { AppBindings } from "../types";
import { portalEnrollmentRoutes } from "./portal-enrollment";
import { portalPaymentRoutes } from "./portal-payments";
import { portalSafetyRoutes } from "./portal-safety";

const studentNotFound = () => notFound("Student");

/** Home shows the latest few; the Announcements page shows them all. */
const HOME_ANNOUNCEMENTS = 5;

/** The family's view of a student's consent forms (GET, and the answer to signing). */
async function portalConsents(
  db: Db,
  link: PortalLink,
  row: typeof client.$inferSelect,
  today: string,
): Promise<PortalConsentsDto> {
  const [academy, consents] = await Promise.all([
    academyRefFor(db, link.workspaceId),
    portalConsentDocuments(db, row, today),
  ]);
  return {
    academy,
    student: { clientId: row.id, firstName: row.firstName, minor: consents.minor },
    signer: portalSigner(link.relation, consents.minor, row.firstName),
    documents: consents.documents,
    missing: consents.missing,
  };
}

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
      const [nextSession, credits, latestAssessment, consents] = await Promise.all([
        nextSessionFor(db, link, now),
        creditsFor(db, link, today),
        latestAssessmentFor(db, link),
        missingByClient(db, link.workspaceId, [row], today),
      ]);
      home.push({
        ...toPortalStudentRef(row, link),
        nextSession,
        credits,
        balanceMinor: balances.get(link.clientId) ?? 0,
        latestAssessment,
        consentsMissing: consents.get(row.id) ?? 0,
      });
    }
    const [enrollments, renewals, announcements] = await Promise.all([
      familyEnrollments(db, c.var.user.id, scope.links),
      renewalOffers(db, scope.links, students),
      familyAnnouncements(db, scope.links, now, HOME_ANNOUNCEMENTS),
    ]);
    const body: PortalHomeDto = {
      user: { name: c.var.user.name, firstName: firstNameOf(c.var.user.name) },
      academies: [...academies.values()],
      students: home,
      comments,
      // Live announcements that reach these students, pinned first then newest.
      announcements,
      // Only when there are some (the home of someone linked to nobody stays as it was).
      ...(enrollments.length ? { enrollments } : {}),
      ...(renewals.length ? { renewals } : {}),
    };
    return c.json(body);
  })

  /** Every live announcement that reaches the caller's students (the Announcements page). */
  .get("/announcements", async (c) => {
    const { db } = c.var;
    const scope = c.var.portal;
    const workspaces = workspacesOf(scope);
    const [items, academies] = await Promise.all([
      familyAnnouncements(db, scope.links, Date.now()),
      Promise.all(workspaces.map((ws) => academyRefFor(db, ws))),
    ]);
    return c.json<PortalAnnouncementsDto>({ academies, items });
  })

  .route("/", portalEnrollmentRoutes)
  .route("/", portalPaymentRoutes)
  .route("/", portalSafetyRoutes)

  .get("/academies/:workspaceId", async (c) => {
    const workspaceId = c.req.param("workspaceId");
    if (!workspacesOf(c.var.portal).includes(workspaceId)) throw notFound("Academy");
    const academy = (await academiesFor(c.var.db, c.env, [workspaceId])).get(workspaceId);
    if (!academy) throw notFound("Academy");
    return c.json<PortalAcademyDto>(academy);
  })

  .get("/students/:clientId", async (c) => {
    const { link, row, today } = await student(c);
    return c.json<PortalStudentDto>(
      await portalStudentDto(c.var.db, link, row, today, c.var.user.id),
    );
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

  /**
   * The academy's consent forms for this student: each one's text and where it stands, and
   * whether the caller may sign (a parent for a minor, the student as an adult).
   */
  .get("/students/:clientId/consents", async (c) => {
    const { link, row, today } = await student(c);
    return c.json<PortalConsentsDto>(await portalConsents(c.var.db, link, row, today));
  })

  /** Signs one version of a form by typing a name; the IP address and device are kept with it. */
  .post(
    "/students/:clientId/consents/:documentId/sign",
    v("json", consentSignSchema),
    async (c) => {
      const input = c.req.valid("json");
      const { link, row, today } = await student(c);
      const db = c.var.db;
      const minor = studentIsMinor(row, today);
      const signer = portalSigner(link.relation, minor, row.firstName);
      if (!signer.ok) throw new ApiError(403, signer.code, signer.message);
      const doc = await db.query.consentDocument.findFirst({
        where: and(
          eq(consentDocument.id, c.req.param("documentId")),
          eq(consentDocument.workspaceId, link.workspaceId),
          eq(consentDocument.active, true),
        ),
      });
      if (!doc || !consentApplies(doc, minor)) throw notFound("Document");
      if (doc.version !== input.version) {
        throw conflict(
          "This form changed since you opened it. Read the current version, then sign again.",
        );
      }
      await recordSignature(db, {
        workspaceId: link.workspaceId,
        document: doc,
        clientId: row.id,
        signedByUserId: c.var.user.id,
        signerName: input.signerName,
        relation: signer.relation,
        ipAddress: clientIp(c.req.raw.headers),
        userAgent: c.req.header("User-Agent") ?? null,
      });
      return c.json<PortalConsentsDto>(await portalConsents(db, link, row, today), 201);
    },
  )

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
   * Files: the caller's own students' photos, their academies' public images (logo, payment QR,
   * coach photos), their students' payment proofs, and the photos of their students' pickup
   * people. Proofs and pickup photos are looked up by the exact key: the row it belongs to must be
   * of a student the caller is linked to. Anything else answers 404.
   */
  .get("/files/*", async (c) => {
    let key: string;
    try {
      key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/api\/portal\/files\//, ""));
    } catch {
      throw notFound("File");
    }
    const owner: FileOwner | null = isProofKey(key)
      ? ((await c.var.db.query.paymentSubmission.findFirst({
          where: eq(paymentSubmission.proofKey, key),
          columns: { workspaceId: true, clientId: true },
        })) ?? null)
      : isPickupKey(key)
        ? await c.var.db.query.authorizedPickup
            .findFirst({
              where: eq(authorizedPickup.photoKey, key),
              columns: { workspaceId: true, clientId: true },
            })
            .then((r) => (r ? { ...r, kind: "pickup" as const } : null))
        : null;
    if (!canReadPortalFile(c.var.portal, key, owner)) throw notFound("File");
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
