import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AttendanceStatus, LessonKind } from "../../shared/domain";
import { CONSUMING_STATUSES, LESSON_KIND_LABELS } from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import { localDate } from "../../shared/time";
import { attendance, charge, clientPackage, creditLedger, lesson, rate } from "../db/schema";
import { conflict, notFound } from "../lib/errors";
import { inList } from "../lib/sql";
import type { Ctx, WorkspaceSettingsRow } from "../types";
import { rebuildAllocations } from "./money";

export interface PackageWithRemaining {
  id: string;
  clientId: string;
  name: string;
  creditsTotal: number;
  remaining: number;
  expiresOn: string | null;
  purchasedOn: string;
  status: string;
  lessonKinds: LessonKind[];
}

// Correlated subqueries use explicit, table-qualified raw SQL: drizzle omits table names in
// single-table selects, which would silently bind the inner table's own columns instead.
export const remainingExpr = sql<number>`("client_package"."credits_total" + coalesce((select sum(cl.delta) from credit_ledger cl where cl.client_package_id = "client_package"."id"), 0))`;

/** Packages for the given clients with remaining credits (active/exhausted unless includeInactive). */
export async function packagesForClients(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  clientIds: readonly string[],
  options: { includeInactive?: boolean } = {},
): Promise<PackageWithRemaining[]> {
  if (clientIds.length === 0) return [];
  const rows = await ctx.db
    .select({
      id: clientPackage.id,
      clientId: clientPackage.clientId,
      name: clientPackage.name,
      creditsTotal: clientPackage.creditsTotal,
      remaining: remainingExpr,
      expiresOn: clientPackage.expiresOn,
      purchasedOn: clientPackage.purchasedOn,
      status: clientPackage.status,
      lessonKinds: clientPackage.lessonKinds,
    })
    .from(clientPackage)
    .where(
      and(
        eq(clientPackage.workspaceId, ctx.workspaceId),
        inList(clientPackage.clientId, clientIds),
        options.includeInactive
          ? sql`${clientPackage.status} != 'void'`
          : inArray(clientPackage.status, ["active", "exhausted"]),
      ),
    )
    .orderBy(asc(clientPackage.purchasedOn));
  return rows.map((r) => ({ ...r, remaining: Number(r.remaining) }));
}

export function packageCovers(pkg: { lessonKinds: LessonKind[] }, kind: LessonKind): boolean {
  if (kind === "event") return false;
  return pkg.lessonKinds.length === 0 || pkg.lessonKinds.includes(kind);
}

/** Usable packages for a lesson, earliest expiry first (first-expiring, first-used). */
export function usablePackages(
  packages: readonly PackageWithRemaining[],
  kind: LessonKind,
  onDate: string,
): PackageWithRemaining[] {
  return packages
    .filter(
      (p) =>
        p.status !== "void" &&
        p.status !== "expired" &&
        p.remaining > 0 &&
        (p.expiresOn === null || p.expiresOn >= onDate) &&
        packageCovers(p, kind),
    )
    .sort((a, b) => {
      if (a.expiresOn !== b.expiresOn) {
        if (a.expiresOn === null) return 1;
        if (b.expiresOn === null) return -1;
        return a.expiresOn < b.expiresOn ? -1 : 1;
      }
      return a.purchasedOn < b.purchasedOn ? -1 : a.purchasedOn > b.purchasedOn ? 1 : 0;
    });
}

export function statusConsumes(
  status: AttendanceStatus,
  settings: Pick<WorkspaceSettingsRow, "noShowUsesCredit" | "lateCancelUsesCredit">,
): boolean {
  if (CONSUMING_STATUSES.includes(status)) return true;
  if (status === "no_show") return settings.noShowUsesCredit;
  if (status === "late_cancel") return settings.lateCancelUsesCredit;
  return false;
}

/** Per-attendee price for pay-per-session charges. */
export function effectivePrice(
  l: { priceMinor: number | null; startsAt: number; endsAt: number },
  r: { priceMinor: number; unit: string } | null | undefined,
): number {
  if (l.priceMinor !== null && l.priceMinor !== undefined) return l.priceMinor;
  if (!r) return 0;
  if (r.unit === "hour") return Math.round((r.priceMinor * (l.endsAt - l.startsAt)) / 3_600_000);
  return r.priceMinor;
}

export type Funding = { type: "none" } | { type: "package"; id: string } | { type: "charge" };

/** Pure decision: which funding an attendance should end up with. */
export function decideFunding(args: {
  consumes: boolean;
  requestedPackageId: string | "none" | undefined;
  current: Funding;
  usable: readonly { id: string }[];
}): Funding {
  const { consumes, requestedPackageId, current, usable } = args;
  if (!consumes) return { type: "none" };
  if (requestedPackageId === "none") return { type: "charge" };
  if (requestedPackageId) return { type: "package", id: requestedPackageId };
  if (current.type !== "none") return current;
  const first = usable[0];
  return first ? { type: "package", id: first.id } : { type: "charge" };
}

export interface AttendanceChange {
  attendanceId: string;
  status: AttendanceStatus;
  packageId?: string | "none";
  complimentary?: boolean;
  note?: string | null;
  mutationId: string;
}

export interface AttendanceResult {
  replay: boolean;
  clientId: string;
  lessonId: string;
}

const CONFLICT_MESSAGE = "This check-in changed on another device. Refresh and try again.";

/**
 * Moves an attendance to a new status and keeps credits and charges consistent:
 * consuming statuses use a package credit (earliest expiry first) or create a pay-per-session
 * charge; anything else releases them. Every credit movement is written to the append-only ledger.
 */
export async function changeAttendance(
  ctx: Ctx,
  input: AttendanceChange,
): Promise<AttendanceResult> {
  try {
    return await applyAttendance(ctx, input);
  } catch (err) {
    if (!isGuardFailure(err)) throw err;
  }
  try {
    return await applyAttendance(ctx, input);
  } catch (err) {
    if (isGuardFailure(err)) throw conflict(CONFLICT_MESSAGE);
    throw err;
  }
}

function isGuardFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const text = `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}`;
  return /NOT NULL constraint failed/i.test(text);
}

async function applyAttendance(ctx: Ctx, input: AttendanceChange): Promise<AttendanceResult> {
  const { db, workspaceId, settings } = ctx;
  const att = await db.query.attendance.findFirst({
    where: and(eq(attendance.id, input.attendanceId), eq(attendance.workspaceId, workspaceId)),
  });
  if (!att) throw notFound("Check-in");
  if (att.lastMutationId === input.mutationId) {
    return { replay: true, clientId: att.clientId, lessonId: att.lessonId };
  }

  const les = await db.query.lesson.findFirst({
    where: and(eq(lesson.id, att.lessonId), eq(lesson.workspaceId, workspaceId)),
  });
  if (!les) throw notFound("Session");
  if (les.status === "cancelled") throw conflict("This session was cancelled.");

  const lessonDate = localDate(les.startsAt, settings.timezone);
  const complimentary = input.complimentary ?? att.complimentary;
  const consumes = les.kind !== "event" && !complimentary && statusConsumes(input.status, settings);

  const current: Funding = att.consumedPackageId
    ? { type: "package", id: att.consumedPackageId }
    : att.chargeId
      ? { type: "charge" }
      : { type: "none" };

  const pkgs = await packagesForClients(ctx, [att.clientId]);
  if (consumes && input.packageId && input.packageId !== "none") {
    const chosen = pkgs.find((p) => p.id === input.packageId);
    if (!chosen) throw notFound("Package");
    const alreadyHolds = current.type === "package" && current.id === chosen.id;
    if (!alreadyHolds && usablePackages([chosen], les.kind, lessonDate).length === 0) {
      throw conflict(
        `${chosen.name} can't pay for this session: no credits left, expired, or wrong type.`,
      );
    }
  }
  let target = decideFunding({
    consumes,
    requestedPackageId: input.packageId,
    current,
    usable: usablePackages(pkgs, les.kind, lessonDate),
  });

  let price = 0;
  if (target.type === "charge" && current.type !== "charge") {
    const r = les.rateId
      ? await db.query.rate.findFirst({
          where: and(eq(rate.id, les.rateId), eq(rate.workspaceId, workspaceId)),
        })
      : null;
    price = effectivePrice(les, r);
    if (price <= 0) target = { type: "none" };
  }

  const now = Date.now();
  const mid = input.mutationId;
  // Resolves to NULL (violating NOT NULL, which aborts the whole batch) unless our update applied.
  const guard = (value: string) =>
    sql`(select ${value} from attendance g where g.id = ${att.id} and g.last_mutation_id = ${mid})`;

  const touchedPackages = new Set<string>();
  const ledger: (typeof creditLedger.$inferInsert)[] = [];
  if (current.type === "package" && !(target.type === "package" && target.id === current.id)) {
    ledger.push({
      id: uuidv7(),
      workspaceId,
      clientPackageId: current.id,
      clientId: att.clientId,
      delta: 1,
      reason: "reversal",
      attendanceId: att.id,
      lessonId: les.id,
      createdBy: ctx.userId,
    });
    touchedPackages.add(current.id);
  }
  if (target.type === "package" && !(current.type === "package" && current.id === target.id)) {
    ledger.push({
      id: uuidv7(),
      workspaceId,
      clientPackageId: target.id,
      clientId: att.clientId,
      delta: -1,
      reason: "use",
      attendanceId: att.id,
      lessonId: les.id,
      createdBy: ctx.userId,
    });
    touchedPackages.add(target.id);
  }

  const keepCharge = current.type === "charge" && target.type === "charge";
  const newChargeId = target.type === "charge" ? (keepCharge ? att.chargeId : uuidv7()) : null;
  const voidChargeId = current.type === "charge" && target.type !== "charge" ? att.chargeId : null;
  const isIn = input.status === "present" || input.status === "late";

  const statements: unknown[] = [
    db
      .update(attendance)
      .set({
        status: input.status,
        consumedPackageId: target.type === "package" ? target.id : null,
        chargeId: newChargeId,
        complimentary,
        checkedInAt: isIn ? (att.checkedInAt ?? now) : null,
        note: input.note === undefined ? att.note : input.note,
        version: att.version + 1,
        lastMutationId: mid,
      })
      .where(and(eq(attendance.id, att.id), eq(attendance.version, att.version))),
    ...ledger.map((row) =>
      db.insert(creditLedger).values({ ...row, clientPackageId: guard(row.clientPackageId) }),
    ),
  ];

  if (newChargeId && !keepCharge) {
    statements.push(
      db.insert(charge).values({
        id: newChargeId,
        workspaceId,
        clientId: guard(att.clientId),
        kind: "session",
        description: `${les.title ?? LESSON_KIND_LABELS[les.kind]} · ${lessonDate}`,
        amountMinor: price,
        attendanceId: att.id,
        occurredOn: lessonDate,
        createdBy: ctx.userId,
      }),
    );
  }
  if (voidChargeId) {
    statements.push(
      db
        .update(charge)
        .set({ voidedAt: now, voidReason: "Check-in changed" })
        .where(and(eq(charge.id, voidChargeId), eq(charge.workspaceId, workspaceId))),
    );
  }
  if (touchedPackages.size > 0) statements.push(refreshPackageStatus(ctx, [...touchedPackages]));

  await runBatch(ctx, statements);

  const after = await db.query.attendance.findFirst({ where: eq(attendance.id, att.id) });
  if (!after || after.lastMutationId !== mid) throw conflict(CONFLICT_MESSAGE);
  if ((newChargeId && !keepCharge) || voidChargeId) await rebuildAllocations(ctx, att.clientId);
  return { replay: false, clientId: att.clientId, lessonId: att.lessonId };
}

/** db.batch with a loosely typed statement list (all statements are drizzle queries). */
export async function runBatch(ctx: Pick<Ctx, "db">, statements: unknown[]): Promise<void> {
  if (statements.length === 0) return;
  // biome-ignore lint/suspicious/noExplicitAny: drizzle's batch tuple type cannot express a dynamic list.
  await ctx.db.batch(statements as any);
}

/** Recomputes active/exhausted status for packages after ledger changes. */
export function refreshPackageStatus(ctx: Pick<Ctx, "db" | "workspaceId">, ids: string[]) {
  return ctx.db
    .update(clientPackage)
    .set({
      status: sql`case when ${remainingExpr} <= 0 then 'exhausted' else 'active' end`,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(clientPackage.workspaceId, ctx.workspaceId),
        inList(clientPackage.id, ids),
        inArray(clientPackage.status, ["active", "exhausted"]),
      ),
    );
}

/** Releases credits and charges for every attendance of a lesson (used when a session is cancelled). */
export async function releaseLessonFunding(ctx: Ctx, lessonId: string, reason: string) {
  const { db, workspaceId } = ctx;
  const rows = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.lessonId, lessonId), eq(attendance.workspaceId, workspaceId)));
  const now = Date.now();
  const statements: unknown[] = [];
  const packages = new Set<string>();
  const clients = new Set<string>();
  for (const a of rows) {
    if (a.consumedPackageId) {
      statements.push(
        db.insert(creditLedger).values({
          id: uuidv7(),
          workspaceId,
          clientPackageId: a.consumedPackageId,
          clientId: a.clientId,
          delta: 1,
          reason: "reversal",
          attendanceId: a.id,
          lessonId,
          note: reason,
          createdBy: ctx.userId,
        }),
      );
      packages.add(a.consumedPackageId);
    }
    if (a.chargeId) {
      statements.push(
        db
          .update(charge)
          .set({ voidedAt: now, voidReason: reason })
          .where(and(eq(charge.id, a.chargeId), eq(charge.workspaceId, workspaceId))),
      );
      clients.add(a.clientId);
    }
    if (a.consumedPackageId || a.chargeId) {
      statements.push(
        db
          .update(attendance)
          .set({ consumedPackageId: null, chargeId: null, version: a.version + 1 })
          .where(eq(attendance.id, a.id)),
      );
    }
  }
  if (packages.size) statements.push(refreshPackageStatus(ctx, [...packages]));
  await runBatch(ctx, statements);
  for (const clientId of clients) await rebuildAllocations(ctx, clientId);
}
