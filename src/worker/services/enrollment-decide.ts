import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { EnrollmentDetailDto } from "../../shared/api-types";
import type { FamilyRelation } from "../../shared/domain";
import { capacityState, enrollmentMode, nextStatus } from "../../shared/enrollment";
import { checkFamilyAccess } from "../../shared/family";
import { uuidv7 } from "../../shared/ids";
import type { EnrollmentApproveInput } from "../../shared/schemas";
import { compareDates, localDate, monthLabel, startOfLocalDay, todayIn } from "../../shared/time";
import { firstDayOf, monthOf, type SaleTerms, saleTerms } from "../../shared/validity";
import { chunkRows } from "../db/client";
import {
  attendance,
  authorizedPickup,
  charge,
  client,
  clientAccess,
  clientCoach,
  clientPackage,
  consentSignature,
  enrollmentRequest,
  eventRegistration,
  groupMember,
  lesson,
  payment,
  paymentSubmission,
  ratingSnapshot,
  user,
} from "../db/schema";
import { auditEntry } from "../lib/audit";
import { notFound } from "../lib/errors";
import type { Ctx } from "../types";
import { staffIds } from "./coaches";
import { runBatch } from "./credits";
import {
  answersOf,
  type ClientRow,
  isNewStudent,
  isRenewal,
  type RequestRow,
  refuse,
  startDateOf,
} from "./enrollment-core";
import { enrollmentDetail, groupLessonsFrom, programMembers } from "./enrollment-staff";
import { activeGuardianCount } from "./family";
import { rebuildAllocations } from "./money";
import { planPackageSale } from "./packages";

// Deciding enrollment requests (owners and admins): approve, waitlist, decline.

const ATTENDING = (s: string) => s !== "excused" && s !== "late_cancel";

async function loadRequest(ctx: Ctx, id: string): Promise<RequestRow> {
  const req = await ctx.db.query.enrollmentRequest.findFirst({
    where: and(eq(enrollmentRequest.id, id), eq(enrollmentRequest.workspaceId, ctx.workspaceId)),
  });
  if (!req) throw notFound("Request");
  return req;
}

/** A new student's lead record has nothing of its own yet (it can be merged away). */
async function leadIsEmpty(ctx: Ctx, leadId: string): Promise<boolean> {
  const ws = ctx.workspaceId;
  const tallies = await Promise.all(
    [clientPackage, charge, payment, attendance, eventRegistration].map((t) =>
      ctx.db
        .select({ n: count() })
        .from(t)
        .where(and(eq(t.workspaceId, ws), eq(t.clientId, leadId))),
    ),
  );
  return tallies.every((rows) => (rows[0]?.n ?? 0) === 0);
}

/**
 * Approves a request in one batch: sells the tier (its price now, the charge with it; month-end
 * tiers for the request's month), adds the student to the program from the start (or books the
 * trial session), makes the student active (with the family's answers on file), saves the
 * self-rating (source `self`), and marks the request approved with what it created. The request
 * is claimed in the same batch, and the package's client id reads that claim back: if another
 * approval got there first, the batch aborts, and the answer is the request as it was approved
 * (approving twice never sells twice).
 *
 * `linkClientId` (new students only): the student is someone already training here. Their
 * record is used instead; the request, its signatures, pickups, and the family's access move to
 * it, and the empty lead is deleted.
 */
export async function approveEnrollment(
  ctx: Ctx,
  id: string,
  input: EnrollmentApproveInput,
): Promise<EnrollmentDetailDto> {
  const { db, workspaceId: ws } = ctx;
  const req = await loadRequest(ctx, id);
  const step = nextStatus(req.status, "approve", "staff");
  if (!step.ok) throw refuse(409, step.code, step.message);
  if (step.replay) return enrollmentDetail(ctx, id);

  const tier = req.packageId
    ? await db.query.packageTemplate.findFirst({
        where: (t, { and: all, eq: is }) =>
          all(is(t.id, req.packageId as string), is(t.workspaceId, ws)),
      })
    : undefined;
  if (!tier) {
    throw refuse(
      409,
      "tier_missing",
      "The package this request is for was deleted. Decline it, or ask the family to pick another.",
    );
  }
  const lead = await db.query.client.findFirst({
    where: and(eq(client.id, req.clientId), eq(client.workspaceId, ws)),
  });
  if (!lead) throw notFound("Student");
  const answers = answersOf(req);
  const relation: FamilyRelation = answers.relation ?? "guardian";
  const today = todayIn(ctx.settings.timezone);
  const now = Date.now();
  const warnings: string[] = [];

  // Matching a new student to someone already training here.
  let student: ClientRow = lead;
  const linking = Boolean(input.linkClientId && input.linkClientId !== lead.id);
  if (linking) {
    if (!isNewStudent(req, lead)) {
      throw refuse(
        409,
        "not_new",
        "Only a new student's request can be matched to someone already training here.",
      );
    }
    const target = await db.query.client.findFirst({
      where: and(eq(client.id, input.linkClientId as string), eq(client.workspaceId, ws)),
    });
    if (!target) throw notFound("Student");
    if (!(await leadIsEmpty(ctx, lead.id))) {
      throw refuse(
        409,
        "lead_has_records",
        `${lead.firstName}'s new record already has packages or sessions, so it can't be merged here.`,
      );
    }
    const access = checkFamilyAccess({
      relation,
      birthDate: target.birthDate,
      isJunior: target.isJunior,
      today,
      hasGuardian: (await activeGuardianCount(db, target.id)) > 0,
    });
    if (!access.ok) {
      throw refuse(409, access.code, `${target.firstName} ${target.lastName}: ${access.message}`);
    }
    student = target;
  }

  const program = tier.programId
    ? await db.query.trainingGroup.findFirst({
        where: (g, { and: all, eq: is }) =>
          all(is(g.id, tier.programId as string), is(g.workspaceId, ws)),
      })
    : undefined;
  const mode = enrollmentMode(tier);

  // The package's dates, by the tier's mode.
  let terms: SaleTerms;
  let startsOn: string;
  let sessionId: string | null = null;
  let booking: { existing: typeof attendance.$inferSelect | undefined } | null = null;
  if (mode === "month") {
    const startMonth = input.startMonth ?? req.startMonth ?? monthOf(today);
    const sale = saleTerms({ validityMode: "month_end", validityDays: null, today, startMonth });
    if (!sale.ok) {
      throw refuse(
        409,
        "period_passed",
        `This request was for ${monthLabel(startMonth, ctx.settings.locale)}. Pick this month or next month to approve it.`,
        { field: "startMonth" },
      );
    }
    terms = sale.terms;
    startsOn = firstDayOf(sale.terms.startMonth as string);
  } else if (mode === "session") {
    const lessonId = input.lessonId ?? req.lessonId;
    const les = lessonId
      ? await db.query.lesson.findFirst({
          where: and(eq(lesson.id, lessonId), eq(lesson.workspaceId, ws)),
        })
      : undefined;
    if (
      !les ||
      les.groupId !== tier.programId ||
      les.status !== "scheduled" ||
      les.startsAt <= now
    ) {
      throw refuse(
        409,
        "session_unavailable",
        "That session has passed or was cancelled. Pick another session to approve this request.",
        { field: "lessonId" },
      );
    }
    const roster = await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.workspaceId, ws), eq(attendance.lessonId, les.id)));
    const existing = roster.find((a) => a.clientId === student.id);
    const state = capacityState({
      capacity: les.capacity ?? program?.capacity ?? null,
      taken: roster.filter((a) => ATTENDING(a.status)).length,
      alreadyIn: Boolean(existing && ATTENDING(existing.status)),
    });
    if (state.over && !input.force) {
      throw refuse(
        409,
        "session_full",
        `That session is full (${state.taken} of ${state.capacity}). Approve anyway to book one more, or pick another session.`,
        { capacity: state.capacity, taken: state.taken },
      );
    }
    if (state.over) {
      warnings.push(`The session now has ${state.taken + 1} players for ${state.capacity} places.`);
    }
    const sessionDate = localDate(les.startsAt, ctx.settings.timezone);
    const sale = saleTerms({
      validityMode: tier.validityMode,
      validityDays: tier.validityDays,
      today,
    });
    if (!sale.ok) throw refuse(409, "period_passed", sale.message);
    // The trial's package always covers the trial.
    terms =
      sale.terms.expiresOn && compareDates(sale.terms.expiresOn, sessionDate) < 0
        ? { ...sale.terms, expiresOn: sessionDate }
        : sale.terms;
    startsOn = today;
    sessionId = les.id;
    booking = { existing };
  } else {
    const asked = input.startDate ?? startDateOf(req) ?? today;
    const purchasedOn = compareDates(asked, today) > 0 ? asked : today;
    const sale = saleTerms({
      validityMode: tier.validityMode,
      validityDays: tier.validityDays,
      today,
      purchasedOn,
    });
    if (!sale.ok) throw refuse(409, "period_passed", sale.message);
    terms = sale.terms;
    startsOn = purchasedOn;
  }

  const packageId = uuidv7();
  // NULL (aborting the batch on the package's NOT NULL client id) unless this approval's claim
  // of the request applied.
  const guard = sql`(select ${student.id} from enrollment_request g where g.id = ${req.id} and g.client_package_id = ${packageId})`;
  const sale = planPackageSale(
    ctx,
    {
      id: tier.id,
      name: tier.name,
      credits: tier.credits,
      lessonKinds: tier.lessonKinds ?? [],
      validityMode: tier.validityMode,
      includesUniform: tier.includesUniform,
      sessionsLabel: tier.sessionsLabel,
    },
    {
      id: packageId,
      clientId: student.id,
      clientIdValue: guard,
      priceMinor: tier.priceMinor,
      terms,
      uniformSize: answers.shirtSize ?? student.shirtSize ?? null,
      enrollmentId: req.id,
    },
  );

  const statements: unknown[] = [
    db
      .update(enrollmentRequest)
      .set({
        status: "approved",
        decidedBy: ctx.userId,
        decidedAt: now,
        clientId: student.id,
        clientPackageId: packageId,
        chargeId: sale.chargeId,
        // What was approved, when staff picked another month or session.
        startMonth: terms.startMonth ?? req.startMonth,
        lessonId: sessionId ?? req.lessonId,
      })
      .where(
        and(
          eq(enrollmentRequest.id, req.id),
          eq(enrollmentRequest.workspaceId, ws),
          inArray(enrollmentRequest.status, ["requested", "waitlisted"]),
          eq(enrollmentRequest.clientId, lead.id),
        ),
      ),
    ...sale.statements,
  ];

  if (linking) {
    const leadAccess = await db
      .select()
      .from(clientAccess)
      .where(and(eq(clientAccess.clientId, lead.id), isNull(clientAccess.revokedAt)));
    statements.push(
      db
        .update(enrollmentRequest)
        .set({ clientId: student.id })
        .where(and(eq(enrollmentRequest.workspaceId, ws), eq(enrollmentRequest.clientId, lead.id))),
      db
        .update(consentSignature)
        .set({ clientId: student.id })
        .where(and(eq(consentSignature.workspaceId, ws), eq(consentSignature.clientId, lead.id))),
      db
        .update(authorizedPickup)
        .set({ clientId: student.id })
        .where(and(eq(authorizedPickup.workspaceId, ws), eq(authorizedPickup.clientId, lead.id))),
      // A proof the family sent before approval moves with the request (WS4c).
      db
        .update(paymentSubmission)
        .set({ clientId: student.id })
        .where(and(eq(paymentSubmission.workspaceId, ws), eq(paymentSubmission.clientId, lead.id))),
    );
    for (const a of leadAccess) {
      const accessId = uuidv7();
      statements.push(
        db
          .insert(clientAccess)
          .values({
            id: accessId,
            workspaceId: ws,
            clientId: student.id,
            userId: a.userId,
            relation: a.relation,
            grantedBy: ctx.userId,
          })
          .onConflictDoUpdate({
            target: [clientAccess.clientId, clientAccess.userId],
            set: { relation: a.relation, revokedAt: null, grantedBy: ctx.userId },
          }),
        auditEntry(ctx, "grant", "client_access", accessId, {
          clientId: student.id,
          userId: a.userId,
          relation: a.relation,
          by: "enrollment_link",
          enrollmentId: req.id,
        }),
      );
    }
    statements.push(
      db.delete(client).where(and(eq(client.id, lead.id), eq(client.workspaceId, ws))),
      auditEntry(ctx, "link", "enrollment_request", req.id, {
        leadClientId: lead.id,
        clientId: student.id,
      }),
    );
  }

  // In the program from the start (month and date tiers), on its sessions from then on.
  if (mode !== "session" && program && program.archivedAt === null) {
    const membership = await db.query.groupMember.findFirst({
      where: and(eq(groupMember.groupId, program.id), eq(groupMember.clientId, student.id)),
    });
    const members = await programMembers(ctx, program.id);
    const alreadyIn = Boolean(membership && !membership.leftOn);
    const state = capacityState({ capacity: program.capacity, taken: members.count, alreadyIn });
    if (state.over) {
      warnings.push(
        `${program.name} now has ${members.count + 1} members for ${program.capacity} places.`,
      );
    }
    if (!membership) {
      statements.push(
        db.insert(groupMember).values({
          id: uuidv7(),
          workspaceId: ws,
          groupId: program.id,
          clientId: student.id,
          joinedOn: startsOn,
        }),
      );
    } else if (membership.leftOn) {
      statements.push(
        db
          .update(groupMember)
          .set({ leftOn: null, joinedOn: startsOn })
          .where(eq(groupMember.id, membership.id)),
      );
    }
    const from = Math.max(now, startOfLocalDay(startsOn, ctx.settings.timezone));
    const ahead = await groupLessonsFrom(ctx, program.id, from);
    const rows = ahead.map((l) => ({
      id: uuidv7(),
      workspaceId: ws,
      lessonId: l.id,
      clientId: student.id,
      status: "booked" as const,
      complimentary: false,
      version: 0,
      createdAt: now,
      updatedAt: now,
    }));
    for (const chunk of chunkRows(rows, 9)) {
      statements.push(db.insert(attendance).values(chunk).onConflictDoNothing());
    }
  } else if (mode !== "session" && program) {
    warnings.push(`${program.name} is archived, so ${student.firstName} wasn't added to it.`);
  }

  // The trial session.
  if (sessionId && booking) {
    const existing = booking.existing;
    if (!existing) {
      statements.push(
        db.insert(attendance).values({
          id: uuidv7(),
          workspaceId: ws,
          lessonId: sessionId,
          clientId: student.id,
          status: "booked",
        }),
      );
    } else if (!ATTENDING(existing.status) && !existing.consumedPackageId && !existing.chargeId) {
      statements.push(
        db
          .update(attendance)
          .set({ status: "booked", version: existing.version + 1 })
          .where(eq(attendance.id, existing.id)),
      );
    }
  }

  // The student is active now, with what the family told the academy on file.
  const submitter = await db.query.user.findFirst({
    where: eq(user.id, req.requestedBy),
    columns: { name: true },
  });
  const set: Partial<typeof client.$inferInsert> = { status: "active" };
  if (!student.joinedOn) set.joinedOn = today;
  if (answers.shirtSize) set.shirtSize = answers.shirtSize;
  if (answers.medicalNotes) set.medicalNotes = answers.medicalNotes;
  if (answers.emergencyName) set.emergencyName = answers.emergencyName;
  if (answers.emergencyPhone) set.emergencyPhone = answers.emergencyPhone;
  if (answers.phone) {
    if (relation === "self") set.phone = answers.phone;
    else set.guardianPhone = answers.phone;
  }
  if (relation === "guardian" && !student.guardianName && submitter?.name) {
    set.guardianName = submitter.name;
  }
  statements.push(
    db
      .update(client)
      .set(set)
      .where(and(eq(client.id, student.id), eq(client.workspaceId, ws))),
  );

  // A coach for a new student: the program's lead (when they're still on the team).
  if (program?.coachUserId) {
    const primary = await db.query.clientCoach.findFirst({
      where: and(
        eq(clientCoach.workspaceId, ws),
        eq(clientCoach.clientId, student.id),
        eq(clientCoach.role, "primary"),
        isNull(clientCoach.endedOn),
      ),
    });
    if (!primary && (await staffIds(db, ws)).has(program.coachUserId)) {
      statements.push(
        db.insert(clientCoach).values({
          id: uuidv7(),
          workspaceId: ws,
          clientId: student.id,
          coachUserId: program.coachUserId,
          role: "primary",
          startedOn: today,
          assignedBy: ctx.userId,
        }),
      );
    }
  }

  // The family's own estimate of the level, in the rating history (renewals don't repeat it).
  if (typeof answers.selfRating === "number" && !isRenewal(req)) {
    statements.push(
      db.insert(ratingSnapshot).values({
        id: uuidv7(),
        workspaceId: ws,
        clientId: student.id,
        source: "self",
        value: answers.selfRating,
        recordedOn: today,
      }),
    );
  }

  statements.push(
    auditEntry(ctx, "approve", "enrollment_request", req.id, {
      clientId: student.id,
      packageId: tier.id,
      clientPackageId: packageId,
      chargeId: sale.chargeId,
      ...(terms.startMonth ? { startMonth: terms.startMonth } : {}),
      ...(sessionId ? { lessonId: sessionId } : {}),
      ...(linking ? { linkedFrom: lead.id } : {}),
      ...(warnings.length ? { warnings } : {}),
    }),
  );

  try {
    await runBatch(ctx, statements);
  } catch (err) {
    // Another approval claimed it first: answer with that one.
    const now2 = await db.query.enrollmentRequest.findFirst({
      where: eq(enrollmentRequest.id, req.id),
    });
    if (now2?.status === "approved") return enrollmentDetail(ctx, id);
    if (now2 && now2.status !== req.status) {
      throw refuse(409, "invalid_transition", "This request was decided just now. Reload it.");
    }
    throw err;
  }
  await rebuildAllocations(ctx, student.id);
  return enrollmentDetail(ctx, id, warnings);
}

/** Puts a request on the waitlist (or changes its note); it can be approved later. */
export async function waitlistEnrollment(
  ctx: Ctx,
  id: string,
  note: string | null | undefined,
): Promise<EnrollmentDetailDto> {
  const req = await loadRequest(ctx, id);
  const step = nextStatus(req.status, "waitlist", "staff");
  if (!step.ok) throw refuse(409, step.code, step.message);
  const now = Date.now();
  if (step.replay) {
    if (note !== undefined) {
      await ctx.db
        .update(enrollmentRequest)
        .set({ decisionNote: note })
        .where(and(eq(enrollmentRequest.id, req.id), eq(enrollmentRequest.status, "waitlisted")));
    }
    return enrollmentDetail(ctx, id);
  }
  const updated = await ctx.db
    .update(enrollmentRequest)
    .set({
      status: "waitlisted",
      decidedBy: ctx.userId,
      decidedAt: now,
      decisionNote: note ?? null,
    })
    .where(and(eq(enrollmentRequest.id, req.id), eq(enrollmentRequest.status, "requested")))
    .returning({ id: enrollmentRequest.id });
  if (!updated.length) {
    throw refuse(409, "invalid_transition", "This request was decided just now. Reload it.");
  }
  await runBatch(ctx, [
    auditEntry(ctx, "waitlist", "enrollment_request", req.id, {
      clientId: req.clientId,
      ...(note ? { note } : {}),
    }),
  ]);
  return enrollmentDetail(ctx, id);
}

/** Declines a request with a reason the family sees. */
export async function declineEnrollment(
  ctx: Ctx,
  id: string,
  reason: string,
): Promise<EnrollmentDetailDto> {
  const req = await loadRequest(ctx, id);
  const step = nextStatus(req.status, "decline", "staff");
  if (!step.ok) throw refuse(409, step.code, step.message);
  if (step.replay) return enrollmentDetail(ctx, id);
  const updated = await ctx.db
    .update(enrollmentRequest)
    .set({ status: "declined", decidedBy: ctx.userId, decidedAt: Date.now(), decisionNote: reason })
    .where(
      and(
        eq(enrollmentRequest.id, req.id),
        inArray(enrollmentRequest.status, ["requested", "waitlisted"]),
      ),
    )
    .returning({ id: enrollmentRequest.id });
  if (!updated.length) {
    throw refuse(409, "invalid_transition", "This request was decided just now. Reload it.");
  }
  await runBatch(ctx, [
    auditEntry(ctx, "decline", "enrollment_request", req.id, { clientId: req.clientId, reason }),
  ]);
  return enrollmentDetail(ctx, id);
}
