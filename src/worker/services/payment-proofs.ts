import { and, asc, count, desc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type {
  EnrollmentPaymentDto,
  PaymentProofDto,
  PaymentProofListDto,
  PortalPaymentProofDto,
  ProofDuplicateDto,
} from "../../shared/api-types";
import {
  DEFAULT_PAYMENT_METHODS,
  isPlaceholderEmail,
  PAYMENT_SUBMISSION_STATUSES,
  type PaymentSubmissionStatus,
} from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import {
  checkProofDetails,
  type DuplicateCandidate,
  findDuplicates,
  isReviewableProof,
  MAX_PENDING_PROOFS,
  nextProofStatus,
  normalizeReference,
} from "../../shared/payment-proofs";
import type { PaymentProofConfirmInput, PaymentProofSubmitInput } from "../../shared/schemas";
import { dateLabel, localDate, todayIn } from "../../shared/time";
import type { Db } from "../db/client";
import {
  auditLog,
  client,
  clientAccess,
  enrollmentRequest,
  lesson,
  packageTemplate,
  payment,
  paymentSubmission,
  user,
  workspaceSettings,
} from "../db/schema";
import { auditEntry } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { toPortalProof } from "../lib/portal-dto";
import type { PortalLink } from "../lib/portal-scope";
import { fullName, inList, unique } from "../lib/sql";
import { proofKeyFor } from "../lib/uploads";
import type { Ctx } from "../types";
import { coachRefs } from "./coaches";
import { runBatch } from "./credits";
import { modeOf, paymentsFor, refuse, requestPayment, startDateOf } from "./enrollment-core";
import { balancesFor, planPayment, rebuildAllocations } from "./money";

// Payment proofs (WS4c). Families send a screenshot of a payment made outside CoachMan (or say
// they'll pay cash at the court) from the portal; owners and admins confirm it, which records a
// real payment through the money service (allocations and balances follow), or don't accept it
// with a reason the family reads. Staff reads and decisions are here, and the family's side too.

type ProofRow = typeof paymentSubmission.$inferSelect;

/** One proof read for staff, with its student and the person who sent it. */
interface StaffProofRow {
  s: ProofRow;
  firstName: string;
  lastName: string;
  photoKey: string | null;
  submitterName: string | null;
  submitterEmail: string | null;
  relation: "self" | "guardian" | null;
}

/**
 * `normalizeReference` in SQL, for finding duplicates in the database: upper case, without
 * spaces, tabs, line breaks, or the separators - . / # : _ (keep the two in step).
 */
export function referenceKeySql(column: SQLiteColumn | SQL): SQL {
  let expr: SQL = sql`${column}`;
  for (const ch of [" ", "-", ".", "/", "#", ":", "_"]) expr = sql`replace(${expr}, ${ch}, '')`;
  for (const code of [9, 10, 13]) expr = sql`replace(${expr}, char(${sql.raw(String(code))}), '')`;
  return sql`upper(${expr})`;
}

/** The academy's payment methods, time zone, and locale (the portal has no staff context). */
export async function academySettings(db: Db, workspaceId: string) {
  const row = await db.query.workspaceSettings.findFirst({
    where: eq(workspaceSettings.workspaceId, workspaceId),
    columns: { paymentMethods: true, timezone: true, locale: true },
  });
  return {
    paymentMethods: row?.paymentMethods ?? DEFAULT_PAYMENT_METHODS,
    timezone: row?.timezone ?? "UTC",
    locale: row?.locale ?? "en-US",
  };
}

// --- Staff reads ---------------------------------------------------------------------------------

async function staffRows(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  where: SQL | undefined,
  order: "oldest" | "newest",
  limit: number,
): Promise<StaffProofRow[]> {
  const { db, workspaceId } = ctx;
  return db
    .select({
      s: paymentSubmission,
      firstName: client.firstName,
      lastName: client.lastName,
      photoKey: client.photoKey,
      submitterName: user.name,
      submitterEmail: user.email,
      relation: clientAccess.relation,
    })
    .from(paymentSubmission)
    .innerJoin(
      client,
      and(
        eq(client.id, paymentSubmission.clientId),
        eq(client.workspaceId, paymentSubmission.workspaceId),
      ),
    )
    .leftJoin(user, eq(user.id, paymentSubmission.submittedBy))
    .leftJoin(
      clientAccess,
      and(
        eq(clientAccess.clientId, paymentSubmission.clientId),
        eq(clientAccess.userId, paymentSubmission.submittedBy),
      ),
    )
    .where(and(eq(paymentSubmission.workspaceId, workspaceId), where))
    .orderBy(
      order === "oldest" ? asc(paymentSubmission.createdAt) : desc(paymentSubmission.createdAt),
      order === "oldest" ? asc(paymentSubmission.id) : desc(paymentSubmission.id),
    )
    .limit(limit);
}

/** Proofs and payments of the academy that might be the same money as the proofs under review. */
async function duplicatesFor(
  db: Db,
  workspaceId: string,
  targets: readonly ProofRow[],
): Promise<Map<string, ProofDuplicateDto[]>> {
  const out = new Map<string, ProofDuplicateDto[]>();
  if (!targets.length) return out;
  const keys = unique(
    targets.map((t) => normalizeReference(t.reference)).filter((k): k is string => Boolean(k)),
  );
  const clientIds = unique(targets.map((t) => t.clientId));
  const [proofs, payments] = await Promise.all([
    db
      .select({
        id: paymentSubmission.id,
        clientId: paymentSubmission.clientId,
        amountMinor: paymentSubmission.amountMinor,
        method: paymentSubmission.method,
        paidOn: paymentSubmission.paidOn,
        reference: paymentSubmission.reference,
        status: paymentSubmission.status,
        resubmitOf: paymentSubmission.resubmitOf,
        firstName: client.firstName,
        lastName: client.lastName,
      })
      .from(paymentSubmission)
      .innerJoin(client, eq(client.id, paymentSubmission.clientId))
      .where(
        and(
          eq(paymentSubmission.workspaceId, workspaceId),
          or(
            keys.length ? inList(referenceKeySql(paymentSubmission.reference), keys) : undefined,
            inList(paymentSubmission.clientId, clientIds),
          ),
        ),
      )
      .limit(1000),
    db
      .select({
        id: payment.id,
        clientId: payment.clientId,
        amountMinor: payment.amountMinor,
        method: payment.method,
        paidOn: payment.paidOn,
        reference: payment.reference,
        fromProofId: paymentSubmission.id,
        firstName: client.firstName,
        lastName: client.lastName,
      })
      .from(payment)
      .innerJoin(client, eq(client.id, payment.clientId))
      .leftJoin(paymentSubmission, eq(paymentSubmission.paymentId, payment.id))
      .where(
        and(
          eq(payment.workspaceId, workspaceId),
          isNull(payment.voidedAt),
          or(
            keys.length ? inList(referenceKeySql(payment.reference), keys) : undefined,
            inList(payment.clientId, clientIds),
          ),
        ),
      )
      .limit(2000),
  ]);
  const candidates: (DuplicateCandidate & { clientName: string; method: string })[] = [
    ...proofs.map((p) => ({
      kind: "proof" as const,
      id: p.id,
      clientId: p.clientId,
      amountMinor: p.amountMinor,
      method: p.method,
      paidOn: p.paidOn,
      reference: p.reference,
      status: p.status,
      resubmitOf: p.resubmitOf,
      clientName: fullName(p),
    })),
    ...payments.map((p) => ({
      kind: "payment" as const,
      id: p.id,
      clientId: p.clientId,
      amountMinor: p.amountMinor,
      method: p.method,
      paidOn: p.paidOn,
      reference: p.reference,
      status: "recorded" as const,
      fromProofId: p.fromProofId,
      clientName: fullName(p),
    })),
  ];
  for (const t of targets) {
    const matches = findDuplicates(t, candidates);
    out.set(
      t.id,
      matches.flatMap((m) => {
        const c = candidates.find((x) => x.kind === m.kind && x.id === m.id);
        if (!c) return [];
        return [
          {
            kind: m.kind,
            id: m.id,
            reason: m.reason,
            clientId: c.clientId,
            clientName: c.clientName,
            amountMinor: c.amountMinor,
            method: c.method,
            paidOn: c.paidOn,
            reference: c.reference,
            status: c.status,
          } satisfies ProofDuplicateDto,
        ];
      }),
    );
  }
  return out;
}

/** Builds staff DTOs for proof rows: the request each pays, payments, reviewers, balances. */
async function toStaffProofs(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  rows: StaffProofRow[],
): Promise<PaymentProofDto[]> {
  if (!rows.length) return [];
  const { db, workspaceId: ws } = ctx;
  const ids = rows.map((r) => r.s.id);
  const requestIds = unique(rows.map((r) => r.s.enrollmentId).filter((x): x is string => !!x));
  const paymentIds = unique(rows.map((r) => r.s.paymentId).filter((x): x is string => !!x));
  const previousIds = unique(rows.map((r) => r.s.resubmitOf).filter((x): x is string => !!x));
  const [requests, payments, reviewers, balances, previous, resent, duplicates] = await Promise.all(
    [
      requestIds.length
        ? db
            .select({
              r: enrollmentRequest,
              tierName: packageTemplate.name,
              validityMode: packageTemplate.validityMode,
              credits: packageTemplate.credits,
              tierProgramId: packageTemplate.programId,
              sessionStartsAt: lesson.startsAt,
            })
            .from(enrollmentRequest)
            .leftJoin(
              packageTemplate,
              and(
                eq(packageTemplate.id, enrollmentRequest.packageId),
                eq(packageTemplate.workspaceId, ws),
              ),
            )
            .leftJoin(
              lesson,
              and(eq(lesson.id, enrollmentRequest.lessonId), eq(lesson.workspaceId, ws)),
            )
            .where(
              and(eq(enrollmentRequest.workspaceId, ws), inList(enrollmentRequest.id, requestIds)),
            )
        : Promise.resolve([]),
      paymentIds.length
        ? db
            .select()
            .from(payment)
            .where(and(eq(payment.workspaceId, ws), inList(payment.id, paymentIds)))
        : Promise.resolve([]),
      coachRefs(
        db,
        ws,
        rows.map((r) => r.s.reviewedBy),
      ),
      balancesFor(ctx, unique(rows.map((r) => r.s.clientId))),
      previousIds.length
        ? db
            .select({
              id: paymentSubmission.id,
              rejectReason: paymentSubmission.rejectReason,
              createdAt: paymentSubmission.createdAt,
            })
            .from(paymentSubmission)
            .where(
              and(eq(paymentSubmission.workspaceId, ws), inList(paymentSubmission.id, previousIds)),
            )
        : Promise.resolve([]),
      db
        .select({ id: paymentSubmission.id, resubmitOf: paymentSubmission.resubmitOf })
        .from(paymentSubmission)
        .where(
          and(eq(paymentSubmission.workspaceId, ws), inList(paymentSubmission.resubmitOf, ids)),
        )
        .orderBy(desc(paymentSubmission.createdAt)),
      duplicatesFor(
        db,
        ws,
        rows.filter((r) => isReviewableProof(r.s.status)).map((r) => r.s),
      ),
    ],
  );
  const charges = await paymentsFor(
    db,
    ws,
    requests.map((r) => r.r.chargeId),
  );
  const requestBy = new Map(requests.map((r) => [r.r.id, r]));
  const paymentBy = new Map(payments.map((p) => [p.id, p]));
  const previousBy = new Map(previous.map((p) => [p.id, p]));
  const resentBy = new Map<string, string>();
  for (const r of resent)
    if (r.resubmitOf && !resentBy.has(r.resubmitOf)) resentBy.set(r.resubmitOf, r.id);

  return rows.map(({ s, ...r }) => {
    const req = s.enrollmentId ? requestBy.get(s.enrollmentId) : undefined;
    const pay = s.paymentId ? paymentBy.get(s.paymentId) : undefined;
    const prev = s.resubmitOf ? previousBy.get(s.resubmitOf) : undefined;
    const enrollmentPayment: EnrollmentPaymentDto | null = req
      ? requestPayment(req.r, charges)
      : null;
    return {
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      student: {
        clientId: s.clientId,
        firstName: r.firstName,
        lastName: r.lastName,
        photoKey: r.photoKey,
        balanceMinor: balances.get(s.clientId) ?? 0,
      },
      submitter: {
        name: r.submitterName ?? "Someone",
        email: r.submitterEmail && !isPlaceholderEmail(r.submitterEmail) ? r.submitterEmail : null,
        relation: r.relation,
      },
      amountMinor: s.amountMinor,
      method: s.method,
      reference: s.reference,
      paidOn: s.paidOn,
      note: s.note,
      proofKey: s.proofKey,
      enrollment: req
        ? {
            id: req.r.id,
            tierName: req.tierName ?? "Package",
            mode: modeOf(
              req.r,
              req.validityMode && req.credits !== null
                ? {
                    validityMode: req.validityMode,
                    credits: req.credits,
                    programId: req.tierProgramId,
                  }
                : null,
            ),
            startMonth: req.r.startMonth,
            startDate: startDateOf(req.r),
            sessionStartsAt: req.sessionStartsAt,
            status: req.r.status,
            payment: enrollmentPayment,
          }
        : null,
      reviewedBy: s.reviewedBy
        ? (reviewers.get(s.reviewedBy) ?? { userId: s.reviewedBy, name: "Someone", photoKey: null })
        : null,
      reviewedAt: s.reviewedAt,
      rejectReason: s.rejectReason,
      payment: pay
        ? {
            id: pay.id,
            amountMinor: pay.amountMinor,
            method: pay.method,
            paidOn: pay.paidOn,
            reference: pay.reference,
            voidedAt: pay.voidedAt,
          }
        : null,
      resubmitOf: prev
        ? { id: prev.id, rejectReason: prev.rejectReason, createdAt: prev.createdAt }
        : null,
      resubmittedBy: resentBy.get(s.id) ?? null,
      duplicates: duplicates.get(s.id) ?? [],
    };
  });
}

/** GET /payment-proofs?status=: pending ones oldest first (a queue), the rest newest first. */
export async function listProofs(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  status: PaymentSubmissionStatus | "all",
): Promise<PaymentProofListDto> {
  const { db, workspaceId: ws } = ctx;
  const [counted, rows] = await Promise.all([
    db
      .select({ status: paymentSubmission.status, n: count() })
      .from(paymentSubmission)
      .where(eq(paymentSubmission.workspaceId, ws))
      .groupBy(paymentSubmission.status),
    staffRows(
      ctx,
      status === "all" ? undefined : eq(paymentSubmission.status, status),
      status === "pending" ? "oldest" : "newest",
      200,
    ),
  ]);
  const counts = Object.fromEntries(PAYMENT_SUBMISSION_STATUSES.map((s) => [s, 0])) as Record<
    PaymentSubmissionStatus,
    number
  >;
  for (const c of counted) counts[c.status] = c.n;
  return { counts, items: await toStaffProofs(ctx, rows) };
}

/** Proofs waiting for review (the Money badge). */
export async function pendingProofCount(ctx: Pick<Ctx, "db" | "workspaceId">): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(paymentSubmission)
    .where(
      and(
        eq(paymentSubmission.workspaceId, ctx.workspaceId),
        eq(paymentSubmission.status, "pending"),
      ),
    );
  return row?.n ?? 0;
}

export async function proofDetail(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  id: string,
): Promise<PaymentProofDto> {
  const rows = await staffRows(ctx, eq(paymentSubmission.id, id), "newest", 1);
  const [dto] = await toStaffProofs(ctx, rows);
  if (!dto) throw notFound("Payment proof");
  return dto;
}

/** A student's proofs, newest first (their profile's Money tab). */
export function clientProofs(ctx: Pick<Ctx, "db" | "workspaceId">, clientId: string) {
  return staffRows(ctx, eq(paymentSubmission.clientId, clientId), "newest", 50).then((rows) =>
    toStaffProofs(ctx, rows),
  );
}

/** The proofs sent for one enrollment request, newest first (the request's Payment card). */
export function requestProofs(ctx: Pick<Ctx, "db" | "workspaceId">, requestId: string) {
  return staffRows(ctx, eq(paymentSubmission.enrollmentId, requestId), "newest", 50).then((rows) =>
    toStaffProofs(ctx, rows),
  );
}

/** How many proofs wait for review per request (the inbox's "Proof to review" pill). */
export async function pendingByRequest(
  db: Db,
  workspaceId: string,
  requestIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!requestIds.length) return out;
  const rows = await db
    .select({ enrollmentId: paymentSubmission.enrollmentId, n: count() })
    .from(paymentSubmission)
    .where(
      and(
        eq(paymentSubmission.workspaceId, workspaceId),
        eq(paymentSubmission.status, "pending"),
        inList(paymentSubmission.enrollmentId, requestIds),
      ),
    )
    .groupBy(paymentSubmission.enrollmentId);
  for (const r of rows) if (r.enrollmentId) out.set(r.enrollmentId, r.n);
  return out;
}

// --- Staff decisions -----------------------------------------------------------------------------

async function loadProof(ctx: Pick<Ctx, "db" | "workspaceId">, id: string): Promise<ProofRow> {
  const row = await ctx.db.query.paymentSubmission.findFirst({
    where: and(eq(paymentSubmission.id, id), eq(paymentSubmission.workspaceId, ctx.workspaceId)),
  });
  if (!row) throw notFound("Payment proof");
  return row;
}

/**
 * Confirms a proof: records the payment through the money service (the amount, method, date, and
 * reference as sent unless staff changed them, and a note pointing at the proof), marks the proof
 * confirmed with who and when, and writes the audit log, all in one batch. The proof is claimed in
 * the same batch and the payment's client id reads that claim back: if another confirmation got
 * there first, the batch aborts and the answer is the proof as it was confirmed, so confirming
 * twice never records twice. A proof whose payment was voided can be confirmed again (a new
 * payment).
 */
export async function confirmProof(
  ctx: Ctx,
  id: string,
  input: PaymentProofConfirmInput,
): Promise<PaymentProofDto> {
  const { db, workspaceId: ws } = ctx;
  const row = await loadProof(ctx, id);
  const step = nextProofStatus(row.status, "confirm", "staff");
  if (!step.ok) throw refuse(409, step.code, step.message);
  if (step.replay) return proofDetail(ctx, id);

  const amountMinor = input.amountMinor ?? row.amountMinor;
  const method = input.method ?? row.method;
  const paidOn = input.paidOn ?? row.paidOn;
  const reference = input.reference === undefined ? row.reference : input.reference;
  // The method the family picked stays acceptable even if the academy renamed its methods since;
  // a method staff choose must be one of the academy's.
  const methods =
    input.method === undefined
      ? [...ctx.settings.paymentMethods, row.method]
      : ctx.settings.paymentMethods;
  const check = checkProofDetails({
    amountMinor,
    method,
    methods,
    paidOn,
    today: todayIn(ctx.settings.timezone),
    reference,
    hasImage: true,
  });
  if (!check.ok) throw badRequest(check.message, { fields: { [check.field]: check.message } });

  const sender = await db.query.user.findFirst({
    where: eq(user.id, row.submittedBy),
    columns: { name: true },
  });
  const sentOn = dateLabel(localDate(row.createdAt, ctx.settings.timezone), ctx.settings.locale);
  const note = [
    `From the payment proof ${sender?.name ?? "the family"} sent on ${sentOn}`,
    input.note,
  ]
    .filter(Boolean)
    .join(" · ");
  const now = Date.now();
  const paymentId = uuidv7();
  // NULL (aborting the batch on the payment's NOT NULL client id) unless this confirmation's
  // claim of the proof applied.
  const guard = sql`(select ${row.clientId} from payment_submission g where g.id = ${row.id} and g.payment_id = ${paymentId})`;
  const planned = planPayment(ctx, {
    id: paymentId,
    clientId: row.clientId,
    clientIdValue: guard,
    amountMinor,
    method,
    paidOn,
    reference,
    note,
    audit: { proofId: row.id },
  });
  const statements: unknown[] = [
    db
      .update(paymentSubmission)
      .set({
        status: "confirmed",
        paymentId,
        reviewedBy: ctx.userId,
        reviewedAt: now,
        rejectReason: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(paymentSubmission.id, row.id),
          eq(paymentSubmission.workspaceId, ws),
          eq(paymentSubmission.status, row.status),
        ),
      ),
    ...planned.statements,
    auditEntry(ctx, "confirm", "payment_submission", row.id, {
      clientId: row.clientId,
      paymentId,
      amountMinor,
      ...(amountMinor !== row.amountMinor ? { submittedMinor: row.amountMinor } : {}),
      ...(row.status === "voided" ? { again: true } : {}),
    }),
  ];
  try {
    await runBatch(ctx, statements);
  } catch (err) {
    const now2 = await loadProof(ctx, id);
    if (now2.status === "confirmed") return proofDetail(ctx, id);
    if (now2.status !== row.status) {
      throw refuse(409, "invalid_transition", "This proof was reviewed just now. Reload it.");
    }
    throw err;
  }
  await rebuildAllocations(ctx, row.clientId);
  return proofDetail(ctx, id);
}

/** Doesn't accept a proof, with the reason the family reads. Rejecting again changes nothing. */
export async function rejectProof(ctx: Ctx, id: string, reason: string): Promise<PaymentProofDto> {
  const { db, workspaceId: ws } = ctx;
  const row = await loadProof(ctx, id);
  const step = nextProofStatus(row.status, "reject", "staff");
  if (!step.ok) throw refuse(409, step.code, step.message);
  if (step.replay) return proofDetail(ctx, id);
  const now = Date.now();
  // The audit entry's action is NULL (aborting the batch) unless this decision's update applied.
  const claimed = sql`(select 'reject' from payment_submission g where g.id = ${row.id} and g.status = 'rejected' and g.reviewed_at = ${now} and g.reviewed_by = ${ctx.userId})`;
  try {
    await runBatch(ctx, [
      db
        .update(paymentSubmission)
        .set({
          status: "rejected",
          rejectReason: reason,
          reviewedBy: ctx.userId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(paymentSubmission.id, row.id),
            eq(paymentSubmission.workspaceId, ws),
            eq(paymentSubmission.status, row.status),
          ),
        ),
      db.insert(auditLog).values({
        id: uuidv7(),
        workspaceId: ws,
        userId: ctx.userId,
        action: claimed,
        entity: "payment_submission",
        entityId: row.id,
        data: { clientId: row.clientId, reason },
      }),
    ]);
  } catch (err) {
    const now2 = await loadProof(ctx, id);
    if (now2.status === "rejected") return proofDetail(ctx, id);
    if (now2.status !== row.status) {
      throw refuse(409, "invalid_transition", "This proof was reviewed just now. Reload it.");
    }
    throw err;
  }
  return proofDetail(ctx, id);
}

/**
 * Voiding a payment that confirming a proof recorded: the proof becomes "Payment voided" (staff
 * can confirm it again, with a new payment, or not accept it). Statements for the void's batch.
 */
export async function proofVoidStatements(
  ctx: Ctx,
  paymentId: string,
  reason: string | null,
): Promise<unknown[]> {
  const proof = await ctx.db.query.paymentSubmission.findFirst({
    where: and(
      eq(paymentSubmission.workspaceId, ctx.workspaceId),
      eq(paymentSubmission.paymentId, paymentId),
      eq(paymentSubmission.status, "confirmed"),
    ),
  });
  if (!proof) return [];
  return [
    ctx.db
      .update(paymentSubmission)
      .set({ status: "voided", updatedAt: Date.now() })
      .where(and(eq(paymentSubmission.id, proof.id), eq(paymentSubmission.status, "confirmed"))),
    auditEntry(ctx, "void", "payment_submission", proof.id, {
      clientId: proof.clientId,
      paymentId,
      reason,
    }),
  ];
}

// --- The family's side ---------------------------------------------------------------------------

export interface ProofImage {
  body: ArrayBuffer;
  type: string;
  ext: string;
}

/**
 * The proofs of the caller's linked students (optionally only some ids, or only those for some
 * requests), newest first, as the family sees them.
 */
export async function familyProofs(
  db: Db,
  viewerUserId: string,
  links: readonly PortalLink[],
  filter: { ids?: string[]; enrollmentIds?: string[]; limit?: number } = {},
): Promise<PortalPaymentProofDto[]> {
  if (!links.length) return [];
  if (filter.enrollmentIds && !filter.enrollmentIds.length) return [];
  const rows = await db
    .select({
      s: paymentSubmission,
      sentBy: user.name,
      paymentAmount: payment.amountMinor,
      paymentPaidOn: payment.paidOn,
      paymentVoidedAt: payment.voidedAt,
    })
    .from(paymentSubmission)
    .leftJoin(user, eq(user.id, paymentSubmission.submittedBy))
    .leftJoin(
      payment,
      and(
        eq(payment.id, paymentSubmission.paymentId),
        eq(payment.workspaceId, paymentSubmission.workspaceId),
      ),
    )
    .where(
      and(
        inList(
          paymentSubmission.clientId,
          links.map((l) => l.clientId),
        ),
        filter.ids ? inList(paymentSubmission.id, filter.ids) : undefined,
        filter.enrollmentIds
          ? inList(paymentSubmission.enrollmentId, filter.enrollmentIds)
          : undefined,
      ),
    )
    .orderBy(desc(paymentSubmission.createdAt), desc(paymentSubmission.id))
    .limit(filter.limit ?? 100);
  // Each proof is the family's only through a link to its student in that student's academy.
  const mine = rows.filter((r) =>
    links.some((l) => l.clientId === r.s.clientId && l.workspaceId === r.s.workspaceId),
  );
  if (!mine.length) return [];
  const resent = await db
    .select({ resubmitOf: paymentSubmission.resubmitOf })
    .from(paymentSubmission)
    .where(
      inList(
        paymentSubmission.resubmitOf,
        mine.map((r) => r.s.id),
      ),
    );
  const resentIds = new Set(resent.map((r) => r.resubmitOf));
  return mine.map((r) =>
    toPortalProof(r.s, {
      viewerUserId,
      sentByName: r.sentBy ?? "Someone",
      payment:
        r.paymentAmount !== null && r.paymentPaidOn !== null
          ? {
              amountMinor: r.paymentAmount,
              paidOn: r.paymentPaidOn,
              voidedAt: r.paymentVoidedAt,
            }
          : null,
      resubmitted: resentIds.has(r.s.id),
    }),
  );
}

/** The proofs sent for some requests, by request (the portal's request cards). */
export async function proofsForRequests(
  db: Db,
  viewerUserId: string,
  links: readonly PortalLink[],
  requestIds: readonly string[],
): Promise<Map<string, PortalPaymentProofDto[]>> {
  const out = new Map<string, PortalPaymentProofDto[]>();
  const proofs = await familyProofs(db, viewerUserId, links, {
    enrollmentIds: [...requestIds],
  });
  for (const p of proofs) {
    if (!p.enrollmentId) continue;
    const list = out.get(p.enrollmentId) ?? [];
    list.push(p);
    out.set(p.enrollmentId, list);
  }
  return out;
}

/**
 * Sends a proof for one of the caller's students: the details are checked against the academy's
 * own settings (its payment methods, its today), the screenshot is stored privately under the
 * student's `payments/` folder, and the proof and its audit entry are written together (the
 * screenshot is removed again if they aren't). A retried send with the same `id` answers with the
 * proof the first one made.
 */
export async function submitProof(
  db: Db,
  env: Env,
  actor: { userId: string },
  link: PortalLink,
  input: PaymentProofSubmitInput,
  image: ProofImage | null,
): Promise<{ proof: PortalPaymentProofDto; replay: boolean }> {
  const ws = link.workspaceId;
  const replayOf = async (id: string) => {
    const [proof] = await familyProofs(db, actor.userId, [link], { ids: [id] });
    return proof;
  };
  if (input.id) {
    const existing = await db.query.paymentSubmission.findFirst({
      where: eq(paymentSubmission.id, input.id),
    });
    if (existing) {
      const own =
        existing.submittedBy === actor.userId &&
        existing.clientId === link.clientId &&
        existing.workspaceId === ws;
      const proof = own ? await replayOf(existing.id) : undefined;
      if (!proof) throw refuse(409, "conflict", "That proof was already sent. Reload the page.");
      return { proof, replay: true };
    }
  }

  const settings = await academySettings(db, ws);
  const check = checkProofDetails({
    amountMinor: input.amountMinor,
    method: input.method,
    methods: settings.paymentMethods,
    paidOn: input.paidOn,
    today: todayIn(settings.timezone),
    reference: input.reference,
    hasImage: Boolean(image),
  });
  if (!check.ok) {
    throw badRequest(check.message, { fields: { [check.field]: check.message } });
  }

  let enrollmentId = input.enrollmentId ?? null;
  const resubmitOf = input.resubmitOf ?? null;
  if (resubmitOf) {
    const previous = await db.query.paymentSubmission.findFirst({
      where: and(
        eq(paymentSubmission.id, resubmitOf),
        eq(paymentSubmission.workspaceId, ws),
        eq(paymentSubmission.clientId, link.clientId),
      ),
    });
    if (!previous) throw refuse(404, "not_found", "Payment proof not found.");
    if (previous.status !== "rejected") {
      throw refuse(
        409,
        "not_resubmittable",
        "Only a proof the academy didn't accept can be sent again.",
      );
    }
    enrollmentId = enrollmentId ?? previous.enrollmentId;
  }
  if (enrollmentId) {
    const request = await db.query.enrollmentRequest.findFirst({
      where: and(
        eq(enrollmentRequest.id, enrollmentId),
        eq(enrollmentRequest.workspaceId, ws),
        eq(enrollmentRequest.clientId, link.clientId),
      ),
      columns: { status: true },
    });
    if (!request) throw refuse(404, "not_found", "Request not found.");
    if (request.status !== "approved") {
      throw refuse(
        409,
        "request_not_approved",
        "You can pay for this request once the academy approves it.",
      );
    }
  }
  const [waiting] = await db
    .select({ n: count() })
    .from(paymentSubmission)
    .where(
      and(
        eq(paymentSubmission.workspaceId, ws),
        eq(paymentSubmission.clientId, link.clientId),
        eq(paymentSubmission.status, "pending"),
      ),
    );
  if ((waiting?.n ?? 0) >= MAX_PENDING_PROOFS) {
    throw refuse(
      409,
      "too_many_pending",
      `${MAX_PENDING_PROOFS} proofs are already waiting for the academy. Send more once they're reviewed.`,
    );
  }

  const id = input.id ?? uuidv7();
  const key = image ? proofKeyFor(ws, link.clientId, image.ext) : null;
  if (image && key) {
    await env.FILES.put(key, image.body, {
      httpMetadata: { contentType: image.type },
      customMetadata: { proofId: id, uploadedBy: actor.userId },
    });
  }
  try {
    await db.batch([
      db.insert(paymentSubmission).values({
        id,
        workspaceId: ws,
        clientId: link.clientId,
        submittedBy: actor.userId,
        enrollmentId,
        amountMinor: input.amountMinor,
        method: input.method,
        reference: input.reference ?? null,
        paidOn: input.paidOn,
        proofKey: key,
        note: input.note ?? null,
        status: "pending",
        resubmitOf,
      }),
      db.insert(auditLog).values({
        id: uuidv7(),
        workspaceId: ws,
        userId: actor.userId,
        action: "submit",
        entity: "payment_submission",
        entityId: id,
        data: {
          clientId: link.clientId,
          amountMinor: input.amountMinor,
          method: input.method,
          screenshot: Boolean(key),
          ...(enrollmentId ? { enrollmentId } : {}),
          ...(resubmitOf ? { resubmitOf } : {}),
        },
      }),
    ]);
  } catch (err) {
    if (key) await env.FILES.delete(key).catch(() => undefined);
    // A retry racing the first send: answer with the proof the first one made.
    const proof = input.id ? await replayOf(input.id) : undefined;
    if (proof) return { proof, replay: true };
    throw err;
  }
  const proof = await replayOf(id);
  if (!proof) throw notFound("Payment proof");
  return { proof, replay: false };
}

/** The person who sent a proof withdraws it while it waits for review. */
export async function withdrawProof(
  db: Db,
  actor: { userId: string },
  link: PortalLink,
  id: string,
): Promise<PortalPaymentProofDto> {
  const row = await db.query.paymentSubmission.findFirst({
    where: and(
      eq(paymentSubmission.id, id),
      eq(paymentSubmission.workspaceId, link.workspaceId),
      eq(paymentSubmission.clientId, link.clientId),
    ),
  });
  if (!row) throw refuse(404, "not_found", "Payment proof not found.");
  if (row.submittedBy !== actor.userId) {
    throw refuse(403, "not_yours", "Only the person who sent this proof can withdraw it.");
  }
  const answer = async () => {
    const [proof] = await familyProofs(db, actor.userId, [link], { ids: [row.id] });
    if (!proof) throw notFound("Payment proof");
    return proof;
  };
  const step = nextProofStatus(row.status, "withdraw", "family");
  if (!step.ok) throw refuse(409, step.code, step.message);
  if (step.replay) return answer();
  const now = Date.now();
  // The audit entry's action is NULL (aborting the batch) unless this withdrawal applied.
  const claimed = sql`(select 'withdraw' from payment_submission g where g.id = ${row.id} and g.status = 'withdrawn' and g.updated_at = ${now})`;
  try {
    await db.batch([
      db
        .update(paymentSubmission)
        .set({ status: "withdrawn", updatedAt: now })
        .where(
          and(
            eq(paymentSubmission.id, row.id),
            eq(paymentSubmission.status, "pending"),
            eq(paymentSubmission.submittedBy, actor.userId),
          ),
        ),
      db.insert(auditLog).values({
        id: uuidv7(),
        workspaceId: link.workspaceId,
        userId: actor.userId,
        action: claimed,
        entity: "payment_submission",
        entityId: row.id,
        data: { clientId: row.clientId },
      }),
    ]);
  } catch (err) {
    const now2 = await db.query.paymentSubmission.findFirst({
      where: eq(paymentSubmission.id, row.id),
      columns: { status: true },
    });
    if (now2?.status === "withdrawn") return answer();
    if (now2 && now2.status !== row.status) {
      throw refuse(409, "invalid_transition", "The academy reviewed this proof just now.");
    }
    throw err;
  }
  return answer();
}

/** The private screenshots of a student's proofs (deleted with the student). */
export async function proofKeysOf(
  db: Db,
  workspaceId: string,
  clientId: string,
): Promise<string[]> {
  const rows = await db
    .select({ key: paymentSubmission.proofKey })
    .from(paymentSubmission)
    .where(
      and(eq(paymentSubmission.workspaceId, workspaceId), eq(paymentSubmission.clientId, clientId)),
    );
  return rows.map((r) => r.key).filter((k): k is string => Boolean(k));
}
