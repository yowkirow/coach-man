import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type {
  EnrollmentContextDto,
  EnrollmentSubmittedDto,
  PortalEnrollAcademyDto,
  PortalEnrollmentDto,
  PortalStudentEnrollmentsDto,
} from "../../shared/api-types";
import { enrollmentRenewSchema, enrollmentSubmitSchema } from "../../shared/schemas";
import { client } from "../db/schema";
import { later } from "../lib/defer";
import { notFound } from "../lib/errors";
import { linkFor } from "../lib/portal-scope";
import { clientIp, enforce } from "../lib/rate-limit";
import { v } from "../lib/validate";
import {
  cancelEnrollment,
  enrollAcademies,
  enrollmentContext,
  type FamilyActor,
  familyEnrollments,
  renewalOffers,
  renewEnrollment,
  submitEnrollment,
} from "../services/enrollment-family";
import { notifyStaffEnrollmentRequest } from "../services/family-push";
import { academyRefFor } from "../services/portal";
import type { AppBindings } from "../types";

/** Sending requests: plenty for a family, few enough to stop a script. */
const SUBMIT_RULE = { windowMs: 60 * 60_000, max: 30 };

function actorOf(c: Context<AppBindings>): FamilyActor {
  return {
    userId: c.var.user.id,
    name: c.var.user.name,
    email: c.var.user.email,
    ip: clientIp(c.req.raw.headers),
    userAgent: c.req.header("User-Agent") ?? null,
  };
}

/**
 * Enrolling, from the family's side (mounted on /api/portal, behind `requirePortal`): who the
 * signed-in person can enroll at an academy, sending a request from the wizard, withdrawing it,
 * the requests and renewals of their students, and renewing in one tap.
 */
export const portalEnrollmentRoutes = new Hono<AppBindings>()
  /** The wizard's first step: the students this person can enroll at a listed academy. */
  .get("/enrollment-context", async (c) => {
    const slug = (c.req.query("slug") ?? "").trim().toLowerCase();
    const body = slug ? await enrollmentContext(c.var.db, actorOf(c), slug) : null;
    if (!body) throw notFound("Academy");
    return c.json<EnrollmentContextDto>(body);
  })

  /** The Enroll page: tiers of the academies the person's students train at. */
  .get("/enroll", async (c) =>
    c.json<PortalEnrollAcademyDto[]>(await enrollAcademies(c.var.db, c.var.portal.links)),
  )

  .post("/enrollments", v("json", enrollmentSubmitSchema), async (c) => {
    await enforce(c, `enroll-submit:user:${c.var.user.id}`, SUBMIT_RULE);
    const body = await submitEnrollment(c.var.db, actorOf(c), c.req.valid("json"));
    if (!body.replay) toReview(c, body);
    return c.json<EnrollmentSubmittedDto>(body, body.replay ? 200 : 201);
  })

  .post("/enrollments/:id/cancel", async (c) => {
    await c.req.raw.arrayBuffer().catch(() => undefined);
    return c.json<PortalEnrollmentDto>(
      await cancelEnrollment(c.var.db, actorOf(c), c.var.portal.links, c.req.param("id")),
    );
  })

  /** One student's requests and renewal (the Payments page). */
  .get("/students/:clientId/enrollments", async (c) => {
    const link = linkFor(c.var.portal, c.req.param("clientId"));
    if (!link) throw notFound("Student");
    const db = c.var.db;
    const row = await db.query.client.findFirst({
      where: and(eq(client.id, link.clientId), eq(client.workspaceId, link.workspaceId)),
    });
    if (!row) throw notFound("Student");
    const [academy, requests, renewals] = await Promise.all([
      academyRefFor(db, link.workspaceId),
      familyEnrollments(db, c.var.user.id, [link], { all: true }),
      renewalOffers(db, [link], new Map([[row.id, row]])),
    ]);
    return c.json<PortalStudentEnrollmentsDto>({
      academy,
      requests,
      renewal: renewals[0] ?? null,
    });
  })

  /** "Renew for next month": the same tier for next month, in one tap. */
  .post("/students/:clientId/renew", v("json", enrollmentRenewSchema), async (c) => {
    const link = linkFor(c.var.portal, c.req.param("clientId"));
    if (!link) throw notFound("Student");
    await enforce(c, `enroll-submit:user:${c.var.user.id}`, SUBMIT_RULE);
    const body = await renewEnrollment(c.var.db, actorOf(c), link, c.req.valid("json"));
    if (!body.replay) toReview(c, body);
    return c.json<EnrollmentSubmittedDto>(body, body.replay ? 200 : 201);
  });

/** Whoever reviews requests (`enrollment`) hears about a new one after the response. */
function toReview(c: Context<AppBindings>, body: EnrollmentSubmittedDto) {
  later(c, "Enrollment request push failed", () =>
    notifyStaffEnrollmentRequest(c.var.db, c.env, {
      workspaceId: body.request.workspaceId,
      requestId: body.request.id,
      actorUserId: c.var.user.id,
    }),
  );
}
