import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type {
  EnrollmentPaymentDto,
  PortalEnrollmentDto,
  PublicSessionDto,
} from "../../shared/api-types";
import type { EnrollmentAnswers, EnrollmentStatus } from "../../shared/domain";
import {
  type EnrollmentMode,
  enrollmentMode,
  isOpenEnrollment,
  seatsLeft,
} from "../../shared/enrollment";
import { isMinor } from "../../shared/family";
import { localDate } from "../../shared/time";
import type { Db } from "../db/client";
import {
  charge,
  client,
  enrollmentRequest,
  lesson,
  packageTemplate,
  paymentAllocation,
  trainingGroup,
  venue,
} from "../db/schema";
import { ApiError } from "../lib/errors";
import { inList, unique } from "../lib/sql";

// Shared pieces of enrollment (WS4b): request rows, tiers, program sessions, payment summaries,
// and the family's view of a request. The family side (wizard, cancel, renew) lives in
// enrollment-family.ts, the staff inbox in enrollment-staff.ts.

export type RequestRow = typeof enrollmentRequest.$inferSelect;
export type TierRow = typeof packageTemplate.$inferSelect;
export type GroupRow = typeof trainingGroup.$inferSelect;
export type ClientRow = typeof client.$inferSelect;

/** Statuses that count as "taken" on a session (the student is expected). */
export const ATTENDING = sql`not in ('excused', 'late_cancel')`;

export const answersOf = (row: Pick<RequestRow, "answers">): EnrollmentAnswers =>
  (row.answers ?? {}) as EnrollmentAnswers;

export const startDateOf = (row: Pick<RequestRow, "answers">): string | null => {
  const v = answersOf(row).startDate;
  return typeof v === "string" ? v : null;
};

/** A request's mode: from its tier, else from the period it stored. */
export function modeOf(
  row: Pick<RequestRow, "startMonth" | "lessonId">,
  tier: Pick<TierRow, "validityMode" | "credits" | "programId"> | null | undefined,
): EnrollmentMode {
  if (tier) return enrollmentMode(tier);
  return row.startMonth ? "month" : row.lessonId ? "session" : "date";
}

/** The made-a-new-student flag, while the student is still the lead it made. */
export const isNewStudent = (row: Pick<RequestRow, "answers">, c: Pick<ClientRow, "status">) =>
  answersOf(row).newStudent === true && c.status === "lead";

export const isRenewal = (row: Pick<RequestRow, "answers">) =>
  typeof answersOf(row).renewalOf === "string";

/** A refusal with a code the app can act on. */
export const refuse = (
  status: 400 | 403 | 404 | 409,
  code: string,
  message: string,
  details?: unknown,
) => new ApiError(status, code, message, details);

/**
 * A tier families may enroll in: published (public, for sale) and in no program or in a public
 * program that's running — the same rule as the academy page.
 */
export async function enrollableTier(db: Db, workspaceId: string, packageId: string) {
  const tier = await db.query.packageTemplate.findFirst({
    where: and(eq(packageTemplate.id, packageId), eq(packageTemplate.workspaceId, workspaceId)),
  });
  if (!tier?.isPublic || !tier.active) return null;
  let program: GroupRow | null = null;
  if (tier.programId) {
    program =
      (await db.query.trainingGroup.findFirst({
        where: and(
          eq(trainingGroup.id, tier.programId),
          eq(trainingGroup.workspaceId, workspaceId),
        ),
      })) ?? null;
    if (!program?.isPublic || program.archivedAt !== null) return null;
  }
  return { tier, program };
}

// --- Program sessions ------------------------------------------------------------------------

export interface ProgramSession {
  id: string;
  startsAt: number;
  endsAt: number;
  status: string;
  court: string | null;
  venueName: string | null;
  venueAddress: string | null;
  /** Players expected (not excused or late-cancelled). */
  booked: number;
  /** The session's own capacity, else its program's. */
  capacity: number | null;
}

/** Scheduled sessions of a program in a window, with how many are booked. Never who. */
export async function programSessions(
  db: Db,
  workspaceId: string,
  program: Pick<GroupRow, "id" | "capacity">,
  window: { from: number; to: number },
): Promise<ProgramSession[]> {
  const rows = await db
    .select({
      id: lesson.id,
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      status: lesson.status,
      court: lesson.court,
      capacity: lesson.capacity,
      venueName: venue.name,
      venueAddress: venue.address,
      booked: sql<number>`(select count(*) from attendance a where a.lesson_id = "lesson"."id" and a.status ${ATTENDING})`,
    })
    .from(lesson)
    .leftJoin(venue, eq(venue.id, lesson.venueId))
    .where(
      and(
        eq(lesson.workspaceId, workspaceId),
        eq(lesson.groupId, program.id),
        eq(lesson.status, "scheduled"),
        gte(lesson.startsAt, window.from),
        lt(lesson.startsAt, window.to),
      ),
    )
    .orderBy(asc(lesson.startsAt))
    .limit(120);
  return rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    status: r.status,
    court: r.court,
    venueName: r.venueName,
    venueAddress: r.venueAddress,
    booked: Number(r.booked),
    capacity: r.capacity ?? program.capacity ?? null,
  }));
}

/** A session as the public (and the wizard) sees it: when, where, and how many places are left. */
export function toPublicSession(s: ProgramSession, timezone: string): PublicSessionDto {
  return {
    id: s.id,
    date: localDate(s.startsAt, timezone),
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    venue: s.venueName ? { name: s.venueName, address: s.venueAddress } : null,
    court: s.court,
    seatsLeft: seatsLeft(s.capacity, s.booked),
  };
}

// --- Payment summary ---------------------------------------------------------------------------

/**
 * What approving charged and how much of it payments cover (allocations are rebuilt oldest
 * first). The hook payment proofs (WS4c) build on: a request is paid once its charge is covered.
 */
export async function paymentsFor(
  db: Db,
  workspaceId: string,
  chargeIds: readonly (string | null)[],
): Promise<Map<string, EnrollmentPaymentDto>> {
  const ids = unique(chargeIds.filter((id): id is string => Boolean(id)));
  const out = new Map<string, EnrollmentPaymentDto>();
  if (!ids.length) return out;
  const [charges, paid] = await Promise.all([
    db
      .select({ id: charge.id, amountMinor: charge.amountMinor, voidedAt: charge.voidedAt })
      .from(charge)
      .where(and(eq(charge.workspaceId, workspaceId), inList(charge.id, ids))),
    db
      .select({
        chargeId: paymentAllocation.chargeId,
        paid: sql<number>`coalesce(sum(${paymentAllocation.amountMinor}), 0)`,
      })
      .from(paymentAllocation)
      .where(
        and(
          eq(paymentAllocation.workspaceId, workspaceId),
          inList(paymentAllocation.chargeId, ids),
        ),
      )
      .groupBy(paymentAllocation.chargeId),
  ]);
  const paidBy = new Map(paid.map((p) => [p.chargeId, Number(p.paid)]));
  for (const c of charges) {
    if (c.voidedAt !== null) continue;
    out.set(c.id, paymentSummary(c.id, c.amountMinor, paidBy.get(c.id) ?? 0));
  }
  return out;
}

export function paymentSummary(
  chargeId: string | null,
  amountMinor: number,
  paidMinor: number,
): EnrollmentPaymentDto {
  const paid = Math.min(Math.max(0, paidMinor), Math.max(0, amountMinor));
  const due = Math.max(0, amountMinor - paid);
  return {
    chargeId,
    amountMinor,
    paidMinor: paid,
    dueMinor: due,
    status: due === 0 ? "paid" : paid > 0 ? "partial" : "unpaid",
  };
}

/** An approved request's payment: its charge's, or nothing owed when the tier was free. */
export function requestPayment(
  row: Pick<RequestRow, "status" | "chargeId">,
  payments: ReadonlyMap<string, EnrollmentPaymentDto>,
): EnrollmentPaymentDto | null {
  if (row.status !== "approved") return null;
  if (!row.chargeId) return paymentSummary(null, 0, 0);
  return payments.get(row.chargeId) ?? null;
}

// --- The family's view -----------------------------------------------------------------------

export interface FamilyRequestRow {
  r: RequestRow;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  isJunior: boolean;
  tierName: string | null;
  sessionsLabel: string | null;
  credits: number | null;
  validityMode: TierRow["validityMode"] | null;
  priceMinor: number | null;
  programId: string | null;
  programName: string | null;
  lessonStartsAt: number | null;
  lessonEndsAt: number | null;
  lessonCourt: string | null;
  venueName: string | null;
}

/** Requests with their tier, program, and session, for the family's view. */
export async function familyRequestRows(
  db: Db,
  links: readonly { clientId: string; workspaceId: string }[],
  opts: { since?: number; limit?: number } = {},
): Promise<FamilyRequestRow[]> {
  if (!links.length) return [];
  const rows = await db
    .select({
      r: enrollmentRequest,
      firstName: client.firstName,
      lastName: client.lastName,
      birthDate: client.birthDate,
      isJunior: client.isJunior,
      tierName: packageTemplate.name,
      sessionsLabel: packageTemplate.sessionsLabel,
      credits: packageTemplate.credits,
      validityMode: packageTemplate.validityMode,
      priceMinor: packageTemplate.priceMinor,
      programId: packageTemplate.programId,
      programName: trainingGroup.name,
      lessonStartsAt: lesson.startsAt,
      lessonEndsAt: lesson.endsAt,
      lessonCourt: lesson.court,
      venueName: venue.name,
    })
    .from(enrollmentRequest)
    .innerJoin(
      client,
      and(
        eq(client.id, enrollmentRequest.clientId),
        eq(client.workspaceId, enrollmentRequest.workspaceId),
      ),
    )
    .leftJoin(
      packageTemplate,
      and(
        eq(packageTemplate.id, enrollmentRequest.packageId),
        eq(packageTemplate.workspaceId, enrollmentRequest.workspaceId),
      ),
    )
    .leftJoin(
      trainingGroup,
      and(
        eq(trainingGroup.id, enrollmentRequest.programId),
        eq(trainingGroup.workspaceId, enrollmentRequest.workspaceId),
      ),
    )
    .leftJoin(
      lesson,
      and(
        eq(lesson.id, enrollmentRequest.lessonId),
        eq(lesson.workspaceId, enrollmentRequest.workspaceId),
      ),
    )
    .leftJoin(venue, eq(venue.id, lesson.venueId))
    .where(
      and(
        inList(
          enrollmentRequest.clientId,
          links.map((l) => l.clientId),
        ),
        opts.since
          ? sql`(${inArray(enrollmentRequest.status, ["requested", "waitlisted"])} or ${enrollmentRequest.updatedAt} >= ${opts.since})`
          : undefined,
      ),
    )
    .orderBy(sql`${enrollmentRequest.createdAt} desc`)
    .limit(opts.limit ?? 100);
  // Each request is the family's only through a link to its student in that student's academy.
  return rows.filter((row) =>
    links.some((l) => l.clientId === row.r.clientId && l.workspaceId === row.r.workspaceId),
  );
}

/**
 * A request as the family sees it: what they asked for and where it stands, the academy's words
 * when it waitlisted or declined it, and what's owed once approved. Never who decided it, internal
 * notes, or anything about other students.
 */
export function toPortalEnrollment(
  row: FamilyRequestRow,
  ctx: {
    viewerUserId: string;
    relation: "self" | "guardian";
    today: string;
    payments: ReadonlyMap<string, EnrollmentPaymentDto>;
  },
): PortalEnrollmentDto {
  const r = row.r;
  const minor = isMinor({ birthDate: row.birthDate, isJunior: row.isJunior, today: ctx.today });
  const mayAct =
    r.requestedBy === ctx.viewerUserId ||
    ctx.relation === "guardian" ||
    (ctx.relation === "self" && !minor);
  const status = r.status as EnrollmentStatus;
  return {
    id: r.id,
    clientId: r.clientId,
    workspaceId: r.workspaceId,
    student: { firstName: row.firstName, lastName: row.lastName },
    tier: {
      name: row.tierName ?? "Package",
      sessionsLabel: row.sessionsLabel,
      credits: row.credits,
      validityMode: row.validityMode,
      priceMinor: row.priceMinor,
    },
    programName: row.programName,
    mode: modeOf(
      r,
      row.validityMode && row.credits !== null
        ? { validityMode: row.validityMode, credits: row.credits, programId: row.programId }
        : null,
    ),
    startMonth: r.startMonth,
    startDate: startDateOf(r),
    session:
      r.lessonId && row.lessonStartsAt !== null && row.lessonEndsAt !== null
        ? {
            startsAt: row.lessonStartsAt,
            endsAt: row.lessonEndsAt,
            venue: row.venueName,
            court: row.lessonCourt,
          }
        : null,
    status,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    note: status === "declined" || status === "waitlisted" ? r.decisionNote : null,
    canCancel: isOpenEnrollment(status) && mayAct,
    renewal: isRenewal(r),
    payment: requestPayment(r, ctx.payments),
  };
}
