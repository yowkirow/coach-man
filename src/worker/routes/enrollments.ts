import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type {
  EnrollmentCountDto,
  EnrollmentDetailDto,
  EnrollmentListDto,
  RenewalsDueDto,
} from "../../shared/api-types";
import {
  enrollmentApproveSchema,
  enrollmentDeclineSchema,
  enrollmentListQuerySchema,
  enrollmentWaitlistSchema,
} from "../../shared/schemas";
import { todayIn } from "../../shared/time";
import { addMonths, monthOf } from "../../shared/validity";
import { organization } from "../db/schema";
import { afterResponse } from "../lib/defer";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import { emailEnrollmentDecision } from "../services/email";
import {
  approveEnrollment,
  declineEnrollment,
  waitlistEnrollment,
} from "../services/enrollment-decide";
import {
  enrollmentDetail,
  listEnrollments,
  renewalsDue,
  requestedCount,
} from "../services/enrollment-staff";
import { notifyEnrollmentDecision } from "../services/family-push";
import type { AppBindings, Ctx } from "../types";
import { appOrigin } from "./academy";

/**
 * The Enrollments inbox (/api/v1/enrollments): owners, admins, and the front desk (`enrollment`)
 * review what families asked for and approve, waitlist, or decline it; and see who hasn't renewed
 * this month. Coaches get 403 on every route.
 */
export const enrollmentRoutes = new Hono<AppBindings>()
  .use("/enrollments", requireCap("enrollment"))
  .use("/enrollments/*", requireCap("enrollment"))

  .get("/enrollments", v("query", enrollmentListQuerySchema), async (c) => {
    const status = c.req.valid("query").status ?? "requested";
    return c.json<EnrollmentListDto>(await listEnrollments(ctxOf(c), status));
  })

  /** The nav badge: requests waiting for a decision. */
  .get("/enrollments/count", async (c) =>
    c.json<EnrollmentCountDto>({ requested: await requestedCount(ctxOf(c)) }),
  )

  /** "Not yet renewed": month-end packages ending this month with nothing for next month. */
  .get("/enrollments/renewals", async (c) => {
    const ctx = ctxOf(c);
    const today = todayIn(ctx.settings.timezone);
    const org = await ctx.db.query.organization.findFirst({
      where: eq(organization.id, ctx.workspaceId),
      columns: { name: true },
    });
    return c.json<RenewalsDueDto>({
      academyName: org?.name ?? "",
      today,
      nextMonth: addMonths(monthOf(today), 1),
      portalUrl: `${appOrigin(c.env)}/my`,
      items: await renewalsDue(ctx),
    });
  })

  .get("/enrollments/:id", async (c) =>
    c.json<EnrollmentDetailDto>(await enrollmentDetail(ctxOf(c), c.req.param("id"))),
  )

  .post("/enrollments/:id/approve", v("json", enrollmentApproveSchema), async (c) => {
    const ctx = ctxOf(c);
    const detail = await approveEnrollment(ctx, c.req.param("id"), c.req.valid("json"));
    await decided(ctx, c.req.param("id"));
    return c.json<EnrollmentDetailDto>(detail);
  })

  .post("/enrollments/:id/waitlist", v("json", enrollmentWaitlistSchema), async (c) => {
    const ctx = ctxOf(c);
    const detail = await waitlistEnrollment(ctx, c.req.param("id"), c.req.valid("json").note);
    await decided(ctx, c.req.param("id"));
    return c.json<EnrollmentDetailDto>(detail);
  })

  .post("/enrollments/:id/decline", v("json", enrollmentDeclineSchema), async (c) => {
    const ctx = ctxOf(c);
    const detail = await declineEnrollment(ctx, c.req.param("id"), c.req.valid("json").reason);
    await decided(ctx, c.req.param("id"));
    return c.json<EnrollmentDetailDto>(detail);
  });

/**
 * The family hears about a decision after the response, by push and by email, each on its own (a
 * replay is deduped by the log).
 */
function decided(ctx: Ctx, requestId: string) {
  const input = { workspaceId: ctx.workspaceId, requestId, actorUserId: ctx.userId };
  return Promise.all([
    afterResponse(ctx, "Enrollment decision push failed", () =>
      notifyEnrollmentDecision(ctx.db, ctx.env, input),
    ),
    afterResponse(ctx, "Enrollment decision email failed", () =>
      emailEnrollmentDecision(ctx.db, ctx.env, input),
    ),
  ]);
}
