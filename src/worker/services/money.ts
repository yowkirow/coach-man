import { and, asc, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import type {
  BalanceDto,
  ChargeDto,
  MoneySummaryDto,
  PaymentDto,
  StatementDto,
} from "../../shared/api-types";
import type { ChargeKind } from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import { addDays } from "../../shared/time";
import { chunkRows } from "../db/client";
import { charge, client, payment, paymentAllocation } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { inList } from "../lib/sql";
import type { Ctx } from "../types";

export interface PaymentPlanInput {
  id?: string;
  clientId: string;
  /**
   * The value written to the payment's client_id, when it isn't simply `clientId`: a guard
   * subquery that is NULL unless the caller's claim in the same batch applied, so a payment that
   * lost a race aborts the whole batch (confirming a proof twice never records twice).
   */
  clientIdValue?: SQL;
  amountMinor: number;
  method: string;
  paidOn: string;
  reference?: string | null;
  note?: string | null;
  /** Extra fields for the audit entry. */
  audit?: Record<string, unknown>;
}

/**
 * Recording a payment: the payment row and its audit entry, built without running them so they
 * can join a bigger batch (confirming a payment proof). Callers rebuild the client's allocations
 * after the batch, which settles the oldest charges first.
 */
export function planPayment(
  ctx: Ctx,
  input: PaymentPlanInput,
): { id: string; statements: unknown[] } {
  const id = input.id ?? uuidv7();
  return {
    id,
    statements: [
      ctx.db.insert(payment).values({
        id,
        workspaceId: ctx.workspaceId,
        clientId: input.clientIdValue ?? input.clientId,
        amountMinor: input.amountMinor,
        method: input.method,
        paidOn: input.paidOn,
        reference: input.reference ?? null,
        note: input.note ?? null,
        createdBy: ctx.userId,
      }),
      auditEntry(ctx, "create", "payment", id, {
        clientId: input.clientId,
        amountMinor: input.amountMinor,
        ...input.audit,
      }),
    ],
  };
}

interface AllocCharge {
  id: string;
  amountMinor: number;
}
interface AllocPayment {
  id: string;
  amountMinor: number;
}

/** Greedy oldest-first allocation of payments to positive charges. Pure, for testing. */
export function allocate(
  charges: readonly AllocCharge[],
  payments: readonly AllocPayment[],
): { paymentId: string; chargeId: string; amountMinor: number }[] {
  const out: { paymentId: string; chargeId: string; amountMinor: number }[] = [];
  const open = charges.filter((c) => c.amountMinor > 0).map((c) => ({ ...c, left: c.amountMinor }));
  let ci = 0;
  for (const p of payments) {
    let left = p.amountMinor;
    while (left > 0 && ci < open.length) {
      const target = open[ci];
      if (!target) break;
      const take = Math.min(left, target.left);
      if (take > 0) out.push({ paymentId: p.id, chargeId: target.id, amountMinor: take });
      left -= take;
      target.left -= take;
      if (target.left === 0) ci++;
    }
  }
  return out;
}

/** Rebuilds the derived payment allocations for one client. */
export async function rebuildAllocations(ctx: Pick<Ctx, "db" | "workspaceId">, clientId: string) {
  const { db, workspaceId } = ctx;
  const [charges, payments] = await Promise.all([
    db
      .select({ id: charge.id, amountMinor: charge.amountMinor })
      .from(charge)
      .where(
        and(
          eq(charge.workspaceId, workspaceId),
          eq(charge.clientId, clientId),
          isNull(charge.voidedAt),
        ),
      )
      .orderBy(asc(charge.occurredOn), asc(charge.createdAt)),
    db
      .select({ id: payment.id, amountMinor: payment.amountMinor })
      .from(payment)
      .where(
        and(
          eq(payment.workspaceId, workspaceId),
          eq(payment.clientId, clientId),
          isNull(payment.voidedAt),
        ),
      )
      .orderBy(asc(payment.paidOn), asc(payment.createdAt)),
  ]);
  const rows = allocate(charges, payments).map((a) => ({
    id: uuidv7(),
    workspaceId,
    clientId,
    ...a,
  }));
  const statements: unknown[] = [
    db
      .delete(paymentAllocation)
      .where(
        and(
          eq(paymentAllocation.workspaceId, workspaceId),
          eq(paymentAllocation.clientId, clientId),
        ),
      ),
    ...chunkRows(rows, 6).map((chunk) => db.insert(paymentAllocation).values(chunk)),
  ];
  // biome-ignore lint/suspicious/noExplicitAny: dynamic batch list.
  await db.batch(statements as any);
}

/** Balance (charges - payments) per client, for the given clients or all clients. */
export async function balancesFor(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  clientIds?: readonly string[],
): Promise<Map<string, number>> {
  const { db, workspaceId } = ctx;
  const chargeRows = await db
    .select({
      clientId: charge.clientId,
      total: sql<number>`coalesce(sum(${charge.amountMinor}), 0)`,
    })
    .from(charge)
    .where(
      and(
        eq(charge.workspaceId, workspaceId),
        isNull(charge.voidedAt),
        clientIds ? inList(charge.clientId, clientIds) : undefined,
      ),
    )
    .groupBy(charge.clientId);
  const paymentRows = await db
    .select({
      clientId: payment.clientId,
      total: sql<number>`coalesce(sum(${payment.amountMinor}), 0)`,
    })
    .from(payment)
    .where(
      and(
        eq(payment.workspaceId, workspaceId),
        isNull(payment.voidedAt),
        clientIds ? inList(payment.clientId, clientIds) : undefined,
      ),
    )
    .groupBy(payment.clientId);
  const map = new Map<string, number>();
  for (const r of chargeRows) map.set(r.clientId, Number(r.total));
  for (const r of paymentRows) map.set(r.clientId, (map.get(r.clientId) ?? 0) - Number(r.total));
  return map;
}

export async function statementFor(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  clientId: string,
): Promise<StatementDto> {
  const { db, workspaceId } = ctx;
  const paidByCharge = db
    .select({
      chargeId: paymentAllocation.chargeId,
      paid: sql<number>`sum(${paymentAllocation.amountMinor})`.as("paid"),
    })
    .from(paymentAllocation)
    .where(
      and(eq(paymentAllocation.workspaceId, workspaceId), eq(paymentAllocation.clientId, clientId)),
    )
    .groupBy(paymentAllocation.chargeId)
    .as("paid_by_charge");

  const [charges, payments, clientRow] = await Promise.all([
    db
      .select({
        id: charge.id,
        kind: charge.kind,
        description: charge.description,
        amountMinor: charge.amountMinor,
        paidMinor: sql<number>`coalesce(${paidByCharge.paid}, 0)`,
        occurredOn: charge.occurredOn,
        voidedAt: charge.voidedAt,
        clientPackageId: charge.clientPackageId,
        attendanceId: charge.attendanceId,
        registrationId: charge.registrationId,
      })
      .from(charge)
      .leftJoin(paidByCharge, eq(paidByCharge.chargeId, charge.id))
      .where(and(eq(charge.workspaceId, workspaceId), eq(charge.clientId, clientId)))
      .orderBy(desc(charge.occurredOn), desc(charge.createdAt)),
    db
      .select()
      .from(payment)
      .where(and(eq(payment.workspaceId, workspaceId), eq(payment.clientId, clientId)))
      .orderBy(desc(payment.paidOn), desc(payment.createdAt)),
    db.query.client.findFirst({
      where: and(eq(client.id, clientId), eq(client.workspaceId, workspaceId)),
    }),
  ]);
  const name = clientRow ? `${clientRow.firstName} ${clientRow.lastName}`.trim() : "";
  const balanceMinor =
    charges.filter((c) => !c.voidedAt).reduce((s, c) => s + c.amountMinor, 0) -
    payments.filter((p) => !p.voidedAt).reduce((s, p) => s + p.amountMinor, 0);
  return {
    balanceMinor,
    charges: charges.map((c) => ({ ...c, paidMinor: Number(c.paidMinor) }) satisfies ChargeDto),
    payments: payments.map((p) => toPaymentDto(p, name)),
  };
}

export function toPaymentDto(p: typeof payment.$inferSelect, clientName: string): PaymentDto {
  return {
    id: p.id,
    clientId: p.clientId,
    clientName,
    amountMinor: p.amountMinor,
    method: p.method,
    paidOn: p.paidOn,
    reference: p.reference,
    note: p.note,
    voidedAt: p.voidedAt,
  };
}

export async function balancesDue(ctx: Pick<Ctx, "db" | "workspaceId">): Promise<BalanceDto[]> {
  const balances = await balancesFor(ctx);
  const due = [...balances.entries()].filter(([, v]) => v > 0);
  if (due.length === 0) return [];
  const ids = due.map(([id]) => id);
  const { db, workspaceId } = ctx;
  const clients = await db
    .select({ id: client.id, firstName: client.firstName, lastName: client.lastName })
    .from(client)
    .where(and(eq(client.workspaceId, workspaceId), inList(client.id, ids)));
  const oldest = await db
    .select({ clientId: charge.clientId, oldest: sql<string>`min(${charge.occurredOn})` })
    .from(charge)
    .leftJoin(
      db
        .select({
          chargeId: paymentAllocation.chargeId,
          paid: sql<number>`sum(${paymentAllocation.amountMinor})`.as("paid"),
        })
        .from(paymentAllocation)
        .where(eq(paymentAllocation.workspaceId, workspaceId))
        .groupBy(paymentAllocation.chargeId)
        .as("pa"),
      sql`pa.charge_id = ${charge.id}`,
    )
    .where(
      and(
        eq(charge.workspaceId, workspaceId),
        isNull(charge.voidedAt),
        inList(charge.clientId, ids),
        sql`${charge.amountMinor} > coalesce(pa.paid, 0)`,
      ),
    )
    .groupBy(charge.clientId);
  const oldestBy = new Map(oldest.map((o) => [o.clientId, o.oldest]));
  return clients
    .map((c) => ({
      clientId: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      balanceMinor: balances.get(c.id) ?? 0,
      oldestUnpaidOn: oldestBy.get(c.id) ?? null,
    }))
    .sort((a, b) => b.balanceMinor - a.balanceMinor);
}

export async function moneySummary(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  month: string,
): Promise<MoneySummaryDto> {
  const { db, workspaceId } = ctx;
  const from = `${month}-01`;
  const to = addDays(nextMonth(from), 0);
  const firstOfRange = monthsBack(from, 5);

  const [byKind, byMethod, chargedMonths, receivedMonths, balances] = await Promise.all([
    db
      .select({ kind: charge.kind, amountMinor: sql<number>`sum(${charge.amountMinor})` })
      .from(charge)
      .where(
        and(
          eq(charge.workspaceId, workspaceId),
          isNull(charge.voidedAt),
          sql`${charge.occurredOn} >= ${from} and ${charge.occurredOn} < ${to}`,
        ),
      )
      .groupBy(charge.kind),
    db
      .select({ method: payment.method, amountMinor: sql<number>`sum(${payment.amountMinor})` })
      .from(payment)
      .where(
        and(
          eq(payment.workspaceId, workspaceId),
          isNull(payment.voidedAt),
          sql`${payment.paidOn} >= ${from} and ${payment.paidOn} < ${to}`,
        ),
      )
      .groupBy(payment.method),
    db
      .select({
        month: sql<string>`substr(${charge.occurredOn}, 1, 7)`,
        amount: sql<number>`sum(${charge.amountMinor})`,
      })
      .from(charge)
      .where(
        and(
          eq(charge.workspaceId, workspaceId),
          isNull(charge.voidedAt),
          sql`${charge.occurredOn} >= ${firstOfRange} and ${charge.occurredOn} < ${to}`,
        ),
      )
      .groupBy(sql`substr(${charge.occurredOn}, 1, 7)`),
    db
      .select({
        month: sql<string>`substr(${payment.paidOn}, 1, 7)`,
        amount: sql<number>`sum(${payment.amountMinor})`,
      })
      .from(payment)
      .where(
        and(
          eq(payment.workspaceId, workspaceId),
          isNull(payment.voidedAt),
          sql`${payment.paidOn} >= ${firstOfRange} and ${payment.paidOn} < ${to}`,
        ),
      )
      .groupBy(sql`substr(${payment.paidOn}, 1, 7)`),
    balancesFor(ctx),
  ]);

  const months: MoneySummaryDto["months"] = [];
  for (let i = 5; i >= 0; i--) {
    const m = monthsBack(from, i).slice(0, 7);
    months.push({
      month: m,
      chargedMinor: Number(chargedMonths.find((r) => r.month === m)?.amount ?? 0),
      receivedMinor: Number(receivedMonths.find((r) => r.month === m)?.amount ?? 0),
    });
  }
  const current = months[months.length - 1];
  return {
    month,
    chargedMinor: current?.chargedMinor ?? 0,
    receivedMinor: current?.receivedMinor ?? 0,
    outstandingMinor: [...balances.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0),
    byKind: byKind.map((r) => ({ kind: r.kind as ChargeKind, amountMinor: Number(r.amountMinor) })),
    byMethod: byMethod.map((r) => ({ method: r.method, amountMinor: Number(r.amountMinor) })),
    months,
  };
}

function nextMonth(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split("-").map(Number);
  const year = (y ?? 1970) + ((m ?? 1) === 12 ? 1 : 0);
  const month = (m ?? 1) === 12 ? 1 : (m ?? 1) + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function monthsBack(firstOfMonth: string, n: number): string {
  const [y, m] = firstOfMonth.split("-").map(Number);
  const total = (y ?? 1970) * 12 + ((m ?? 1) - 1) - n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
