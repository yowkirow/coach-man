import { and, asc, count, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type {
  EnrollmentDetailDto,
  EnrollmentListDto,
  EnrollmentListItemDto,
  RenewalDueDto,
} from "../../shared/api-types";
import {
  ENROLLMENT_STATUSES,
  type EnrollmentStatus,
  type FamilyRelation,
  isPlaceholderEmail,
} from "../../shared/domain";
import {
  capacityState,
  isOpenEnrollment,
  monthChoices,
  programAgeNote,
  SESSION_WINDOW_DAYS,
  seatsLeft,
} from "../../shared/enrollment";
import { isMinor } from "../../shared/family";
import { addDays, ageOn, compareDates, todayIn } from "../../shared/time";
import { firstDayOf, lastDayOf, monthOf } from "../../shared/validity";
import {
  attendance,
  authorizedPickup,
  client,
  clientAccess,
  consentDocument,
  consentSignature,
  enrollmentRequest,
  groupMember,
  lesson,
  packageTemplate,
  trainingGroup,
  user,
  venue,
} from "../db/schema";
import { notFound } from "../lib/errors";
import type { Ctx } from "../types";
import { coachRefs } from "./coaches";
import { missingByClient } from "./consents";
import {
  answersOf,
  isNewStudent,
  isRenewal,
  modeOf,
  paymentsFor,
  programSessions,
  requestPayment,
  startDateOf,
} from "./enrollment-core";
import { renewalFacts, renewalOf } from "./enrollment-family";
import { hasGoogleAccount } from "./family";
import { pendingByRequest, requestProofs } from "./payment-proofs";

// The staff side of enrollment (WS4b): the Enrollments inbox (owners and admins, `enrollment`),
// a request's detail, and who hasn't renewed. Approving, waitlisting, and declining live in
// enrollment-decide.ts.

const ATTENDING_STATUSES = (s: string) => s !== "excused" && s !== "late_cancel";

/** Requests waiting for a decision (the nav badge and Today). */
export async function requestedCount(ctx: Pick<Ctx, "db" | "workspaceId">): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(enrollmentRequest)
    .where(
      and(
        eq(enrollmentRequest.workspaceId, ctx.workspaceId),
        eq(enrollmentRequest.status, "requested"),
      ),
    );
  return row?.n ?? 0;
}

/** GET /enrollments?status=: newest first, with how many there are in each status. */
export async function listEnrollments(
  ctx: Ctx,
  status: EnrollmentStatus | "all",
): Promise<EnrollmentListDto> {
  const { db, workspaceId: ws } = ctx;
  const today = todayIn(ctx.settings.timezone);
  const [counted, rows] = await Promise.all([
    db
      .select({ status: enrollmentRequest.status, n: count() })
      .from(enrollmentRequest)
      .where(eq(enrollmentRequest.workspaceId, ws))
      .groupBy(enrollmentRequest.status),
    db
      .select({
        r: enrollmentRequest,
        firstName: client.firstName,
        lastName: client.lastName,
        clientStatus: client.status,
        birthDate: client.birthDate,
        isJunior: client.isJunior,
        submitter: user.name,
        tierName: packageTemplate.name,
        validityMode: packageTemplate.validityMode,
        credits: packageTemplate.credits,
        tierProgramId: packageTemplate.programId,
        programName: trainingGroup.name,
        sessionStartsAt: lesson.startsAt,
      })
      .from(enrollmentRequest)
      .innerJoin(
        client,
        and(
          eq(client.id, enrollmentRequest.clientId),
          eq(client.workspaceId, enrollmentRequest.workspaceId),
        ),
      )
      .leftJoin(user, eq(user.id, enrollmentRequest.requestedBy))
      .leftJoin(
        packageTemplate,
        and(
          eq(packageTemplate.id, enrollmentRequest.packageId),
          eq(packageTemplate.workspaceId, ws),
        ),
      )
      .leftJoin(
        trainingGroup,
        and(eq(trainingGroup.id, enrollmentRequest.programId), eq(trainingGroup.workspaceId, ws)),
      )
      .leftJoin(lesson, and(eq(lesson.id, enrollmentRequest.lessonId), eq(lesson.workspaceId, ws)))
      .where(
        and(
          eq(enrollmentRequest.workspaceId, ws),
          status === "all" ? undefined : eq(enrollmentRequest.status, status),
        ),
      )
      .orderBy(desc(enrollmentRequest.createdAt))
      .limit(200),
  ]);
  const counts = Object.fromEntries(ENROLLMENT_STATUSES.map((s) => [s, 0])) as Record<
    EnrollmentStatus,
    number
  >;
  for (const c of counted) counts[c.status] = c.n;
  const waiting = await pendingByRequest(
    db,
    ws,
    rows.filter((r) => r.r.status === "approved").map((r) => r.r.id),
  );
  const items: EnrollmentListItemDto[] = rows.map((row) => {
    const answers = answersOf(row.r);
    return {
      id: row.r.id,
      status: row.r.status,
      createdAt: row.r.createdAt,
      decidedAt: row.r.decidedAt,
      student: {
        clientId: row.r.clientId,
        firstName: row.firstName,
        lastName: row.lastName,
        isNew: isNewStudent(row.r, { status: row.clientStatus }),
        minor: isMinor({ birthDate: row.birthDate, isJunior: row.isJunior, today }),
      },
      submitter: { name: row.submitter ?? "Someone", relation: answers.relation ?? null },
      tierName: row.tierName ?? "Package",
      programName: row.programName,
      mode: modeOf(
        row.r,
        row.validityMode && row.credits !== null
          ? { validityMode: row.validityMode, credits: row.credits, programId: row.tierProgramId }
          : null,
      ),
      startMonth: row.r.startMonth,
      startDate: startDateOf(row.r),
      sessionStartsAt: row.sessionStartsAt,
      renewal: isRenewal(row.r),
      ...(waiting.get(row.r.id) ? { proofsPending: waiting.get(row.r.id) } : {}),
    };
  });
  return { counts, items };
}

/** Members of a program now (not archived students). */
export async function programMembers(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  groupId: string,
): Promise<{ count: number; clientIds: Set<string> }> {
  const rows = await ctx.db
    .select({ clientId: groupMember.clientId })
    .from(groupMember)
    .innerJoin(client, eq(client.id, groupMember.clientId))
    .where(
      and(
        eq(groupMember.workspaceId, ctx.workspaceId),
        eq(groupMember.groupId, groupId),
        isNull(groupMember.leftOn),
        ne(client.status, "archived"),
      ),
    );
  return { count: rows.length, clientIds: new Set(rows.map((r) => r.clientId)) };
}

/** GET /enrollments/:id: everything staff need to decide one request. */
export async function enrollmentDetail(
  ctx: Ctx,
  id: string,
  warnings?: string[],
): Promise<EnrollmentDetailDto> {
  const { db, workspaceId: ws } = ctx;
  const req = await db.query.enrollmentRequest.findFirst({
    where: and(eq(enrollmentRequest.id, id), eq(enrollmentRequest.workspaceId, ws)),
  });
  if (!req) throw notFound("Request");
  const today = todayIn(ctx.settings.timezone);
  const now = Date.now();
  const answers = answersOf(req);
  const [student, submitter, tier, pickups, signed] = await Promise.all([
    db.query.client.findFirst({
      where: and(eq(client.id, req.clientId), eq(client.workspaceId, ws)),
    }),
    db.query.user.findFirst({ where: eq(user.id, req.requestedBy) }),
    req.packageId
      ? db.query.packageTemplate.findFirst({
          where: and(eq(packageTemplate.id, req.packageId), eq(packageTemplate.workspaceId, ws)),
        })
      : Promise.resolve(undefined),
    db
      .select()
      .from(authorizedPickup)
      .where(and(eq(authorizedPickup.workspaceId, ws), eq(authorizedPickup.clientId, req.clientId)))
      .orderBy(asc(authorizedPickup.createdAt)),
    db
      .select({ s: consentSignature, title: consentDocument.title })
      .from(consentSignature)
      .innerJoin(consentDocument, eq(consentDocument.id, consentSignature.documentId))
      .where(and(eq(consentSignature.workspaceId, ws), eq(consentSignature.enrollmentId, req.id)))
      .orderBy(asc(consentSignature.signedAt)),
  ]);
  if (!student) throw notFound("Student");
  const program = req.programId
    ? await db.query.trainingGroup.findFirst({
        where: and(eq(trainingGroup.id, req.programId), eq(trainingGroup.workspaceId, ws)),
      })
    : undefined;
  const [members, session, google, access, deciders, missing, payments, proofs] = await Promise.all(
    [
      program ? programMembers(ctx, program.id) : Promise.resolve(null),
      req.lessonId
        ? db
            .select({ l: lesson, venueName: venue.name })
            .from(lesson)
            .leftJoin(venue, eq(venue.id, lesson.venueId))
            .where(and(eq(lesson.id, req.lessonId), eq(lesson.workspaceId, ws)))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      submitter ? hasGoogleAccount(db, submitter.id) : Promise.resolve(false),
      db.query.clientAccess.findFirst({
        where: and(
          eq(clientAccess.clientId, req.clientId),
          eq(clientAccess.userId, req.requestedBy),
        ),
      }),
      coachRefs(db, ws, [req.decidedBy]),
      missingByClient(db, ws, [student], today),
      paymentsFor(db, ws, [req.chargeId]),
      requestProofs(ctx, req.id),
    ],
  );
  const roster = session
    ? await db
        .select({ clientId: attendance.clientId, status: attendance.status })
        .from(attendance)
        .where(eq(attendance.lessonId, session.l.id))
    : [];
  const mode = modeOf(req, tier);
  const minor = isMinor({ birthDate: student.birthDate, isJunior: student.isJunior, today });
  const isNew = isNewStudent(req, student);
  const relation: FamilyRelation | null = answers.relation ?? access?.relation ?? null;
  const open = isOpenEnrollment(req.status);

  // Room if it's approved: the program (by month or date) or the session (a trial).
  let capacity: EnrollmentDetailDto["capacity"] = null;
  if (open && mode === "session" && session) {
    const taken = roster.filter((r) => ATTENDING_STATUSES(r.status)).length;
    const alreadyIn = roster.some((r) => r.clientId === student.id && ATTENDING_STATUSES(r.status));
    const state = capacityState({
      capacity: session.l.capacity ?? program?.capacity ?? null,
      taken,
      alreadyIn,
    });
    capacity = { kind: "session", ...pick(state), alreadyIn };
  } else if (open && program && members) {
    const alreadyIn = members.clientIds.has(student.id);
    const state = capacityState({ capacity: program.capacity, taken: members.count, alreadyIn });
    capacity = { kind: "program", ...pick(state), alreadyIn };
  }

  // The validity approving would give, as asked.
  const startDate = startDateOf(req);
  let startsOn: string | null = null;
  let expiresOn: string | null = null;
  if (mode === "month" && req.startMonth) {
    startsOn = firstDayOf(req.startMonth);
    expiresOn = lastDayOf(req.startMonth);
  } else if (mode === "date" && startDate) {
    startsOn = compareDates(startDate, today) > 0 ? startDate : today;
    expiresOn = tier?.validityDays ? addDays(startsOn, tier.validityDays - 1) : null;
  }

  const matches =
    isNew && open
      ? await db
          .select({
            clientId: client.id,
            firstName: client.firstName,
            lastName: client.lastName,
            birthDate: client.birthDate,
            phone: client.phone,
            status: client.status,
          })
          .from(client)
          .where(
            and(
              eq(client.workspaceId, ws),
              ne(client.id, student.id),
              ne(client.status, "archived"),
              or(
                and(
                  sql`lower(${client.firstName}) = lower(${student.firstName})`,
                  sql`lower(${client.lastName}) = lower(${student.lastName})`,
                ),
                student.birthDate
                  ? and(
                      sql`lower(${client.firstName}) = lower(${student.firstName})`,
                      eq(client.birthDate, student.birthDate),
                    )
                  : undefined,
                answers.phone
                  ? or(eq(client.phone, answers.phone), eq(client.guardianPhone, answers.phone))
                  : undefined,
              ),
            ),
          )
          .orderBy(asc(client.firstName), asc(client.lastName))
          .limit(5)
      : [];

  const sessions =
    open && mode === "session" && program
      ? (
          await programSessions(db, ws, program, {
            from: now,
            to: now + SESSION_WINDOW_DAYS * 86_400_000,
          })
        ).map((s) => ({
          lessonId: s.id,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          seatsLeft: seatsLeft(s.capacity, s.booked),
        }))
      : [];

  return {
    id: req.id,
    status: req.status,
    createdAt: req.createdAt,
    decidedAt: req.decidedAt,
    decidedBy: req.decidedBy
      ? (deciders.get(req.decidedBy) ?? { userId: req.decidedBy, name: "Someone", photoKey: null })
      : null,
    decisionNote: req.decisionNote,
    renewal: isRenewal(req),
    student: {
      clientId: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      birthDate: student.birthDate,
      age: student.birthDate ? ageOn(student.birthDate, today) : null,
      minor,
      status: student.status,
      isNew,
      phone: student.phone,
      email: student.email,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
    },
    submitter: {
      name: submitter?.name ?? "Someone",
      email: submitter && !isPlaceholderEmail(submitter.email) ? submitter.email : null,
      relation,
      signIn: submitter && isPlaceholderEmail(submitter.email) && !google ? "passkey" : "google",
    },
    tier: tier
      ? {
          id: tier.id,
          name: tier.name,
          priceMinor: tier.priceMinor,
          credits: tier.credits,
          sessionsLabel: tier.sessionsLabel,
          validityMode: tier.validityMode,
          validityDays: tier.validityDays,
          includesUniform: tier.includesUniform,
          asksSelfRating: tier.asksSelfRating,
          inclusions: tier.inclusions ?? [],
          active: tier.active,
        }
      : null,
    program: program
      ? {
          id: program.id,
          name: program.name,
          capacity: program.capacity,
          members: members?.count ?? 0,
          ageMin: program.ageMin,
          ageMax: program.ageMax,
        }
      : null,
    mode,
    period: {
      startMonth: req.startMonth,
      startDate,
      startsOn,
      expiresOn,
      session: session
        ? {
            lessonId: session.l.id,
            startsAt: session.l.startsAt,
            endsAt: session.l.endsAt,
            venueName: session.venueName,
            court: session.l.court,
            status: session.l.status,
            capacity: session.l.capacity ?? program?.capacity ?? null,
            booked: roster.filter((r) => ATTENDING_STATUSES(r.status)).length,
          }
        : null,
    },
    answers: {
      selfRating: typeof answers.selfRating === "number" ? answers.selfRating : null,
      selfRatingUnsure: answers.selfRatingUnsure === true,
      shirtSize: answers.shirtSize ?? null,
      phone: answers.phone ?? null,
      email: answers.email ?? null,
      medicalNotes: answers.medicalNotes ?? null,
      emergencyName: answers.emergencyName ?? null,
      emergencyPhone: answers.emergencyPhone ?? null,
      notes: answers.notes ?? null,
    },
    pickups: pickups.map((p) => ({
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      phone: p.phone,
    })),
    consents: signed.map((x) => ({
      documentId: x.s.documentId,
      title: x.title,
      version: x.s.documentVersion,
      signerName: x.s.signerName,
      relation: x.s.relation,
      signedAt: x.s.signedAt,
    })),
    consentsMissing: missing.get(student.id) ?? 0,
    capacity,
    ageNote: program ? programAgeNote(program, student.birthDate, today) : null,
    payment: requestPayment(req, payments),
    proofs,
    created: { clientPackageId: req.clientPackageId, chargeId: req.chargeId },
    matches,
    options: {
      startMonths:
        open && mode === "month"
          ? monthChoices(today).map((m) => ({ month: m.month, expiresOn: m.expiresOn }))
          : [],
      sessions,
    },
    ...(warnings?.length ? { warnings } : {}),
  };
}

function pick(s: ReturnType<typeof capacityState>) {
  return { capacity: s.capacity, taken: s.taken, left: s.left, over: s.over };
}

/**
 * "Not yet renewed": students whose month-end package runs for this month, of a tier still on
 * sale, with nothing for next month (no package, no open or approved request).
 */
export async function renewalsDue(ctx: Ctx): Promise<RenewalDueDto[]> {
  const { db, workspaceId: ws } = ctx;
  const today = todayIn(ctx.settings.timezone);
  const facts = await renewalFacts(db, ws, null, today);
  const thisMonth = monthOf(today);
  const ids = [
    ...new Set(facts.packages.filter((p) => p.startMonth === thisMonth).map((p) => p.clientId)),
  ];
  if (!ids.length) return [];
  const clients = await db
    .select()
    .from(client)
    .where(
      and(
        eq(client.workspaceId, ws),
        inArray(client.id, ids.slice(0, 500)),
        ne(client.status, "archived"),
      ),
    );
  const out: RenewalDueDto[] = [];
  for (const c of clients) {
    const found = renewalOf(facts, c.id, today);
    if (!found) continue;
    const current = facts.packages.find((p) => p.id === found.offer.fromClientPackageId);
    const minor = isMinor({ birthDate: c.birthDate, isJunior: c.isJunior, today });
    out.push({
      clientId: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      minor,
      tierName: found.tier.name,
      packageId: found.tier.id,
      clientPackageId: found.offer.fromClientPackageId,
      expiresOn: current?.startMonth ? lastDayOf(current.startMonth) : lastDayOf(thisMonth),
      contactName: minor ? (c.guardianName ?? null) : `${c.firstName} ${c.lastName}`.trim(),
      contactPhone: minor ? (c.guardianPhone ?? c.phone) : (c.phone ?? null),
    });
  }
  return out.sort(
    (a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName),
  );
}

/** Upcoming sessions of a program from a moment on (ids only), for booking a new member. */
export async function groupLessonsFrom(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  groupId: string,
  fromMs: number,
) {
  return ctx.db
    .select({ id: lesson.id })
    .from(lesson)
    .where(
      and(
        eq(lesson.workspaceId, ctx.workspaceId),
        eq(lesson.groupId, groupId),
        eq(lesson.status, "scheduled"),
        gte(lesson.startsAt, fromMs),
      ),
    );
}
