import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { ChargeListItemDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import { chargeSchema, paymentSchema, rangeQuerySchema, voidSchema } from "../../shared/schemas";
import { todayIn } from "../../shared/time";
import { charge, client, payment, paymentAllocation } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { idempotent } from "../lib/idempotency";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import { runBatch } from "../services/credits";
import {
  balancesDue,
  moneySummary,
  planPayment,
  rebuildAllocations,
  statementFor,
  toPaymentDto,
} from "../services/money";
import { proofVoidStatements } from "../services/payment-proofs";
import type { AppBindings, Ctx } from "../types";

async function ensureClient(ctx: Ctx, clientId: string) {
  const row = await ctx.db.query.client.findFirst({
    where: and(eq(client.id, clientId), eq(client.workspaceId, ctx.workspaceId)),
  });
  if (!row) throw notFound("Client");
  return row;
}

export const moneyRoutes = new Hono<AppBindings>()
  .get("/money/summary", requireCap("money"), async (c) => {
    const ctx = ctxOf(c);
    const month = c.req.query("month") ?? todayIn(ctx.settings.timezone).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest("Use YYYY-MM for the month.");
    return c.json(await moneySummary(ctx, month));
  })

  .get("/money/balances", requireCap("money"), async (c) => c.json(await balancesDue(ctxOf(c))))

  .get("/clients/:id/statement", requireCap("money"), async (c) => {
    const ctx = ctxOf(c);
    await ensureClient(ctx, c.req.param("id"));
    return c.json(await statementFor(ctx, c.req.param("id")));
  })

  .get("/payments", requireCap("money"), v("query", rangeQuerySchema), async (c) => {
    const ctx = ctxOf(c);
    const { from, to } = c.req.valid("query");
    const rows = await ctx.db
      .select({ p: payment, firstName: client.firstName, lastName: client.lastName })
      .from(payment)
      .innerJoin(client, eq(client.id, payment.clientId))
      .where(
        and(
          eq(payment.workspaceId, ctx.workspaceId),
          gte(payment.paidOn, from),
          lte(payment.paidOn, to),
        ),
      )
      .orderBy(desc(payment.paidOn), desc(payment.createdAt));
    return c.json(rows.map((r) => toPaymentDto(r.p, `${r.firstName} ${r.lastName}`.trim())));
  })

  .post("/payments", requireCap("money"), v("json", paymentSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    return idempotent(c, async () => {
      const who = await ensureClient(ctx, input.clientId);
      const planned = planPayment(ctx, {
        id: input.id,
        clientId: input.clientId,
        amountMinor: input.amountMinor,
        method: input.method,
        paidOn: input.paidOn,
        reference: input.reference ?? null,
        note: input.note ?? null,
      });
      await runBatch(ctx, planned.statements);
      await rebuildAllocations(ctx, input.clientId);
      const row = await ctx.db.query.payment.findFirst({ where: eq(payment.id, planned.id) });
      return c.json(
        toPaymentDto(row as typeof payment.$inferSelect, `${who.firstName} ${who.lastName}`.trim()),
        201,
      );
    });
  })

  /**
   * Voids a payment (it stays on record, struck through). A payment recorded by confirming a
   * family's proof takes the proof with it: the proof shows "Payment voided" (never "Confirmed"
   * with no live payment behind it), and staff can review it again.
   */
  .post("/payments/:id/void", requireCap("money"), v("json", voidSchema), async (c) => {
    const ctx = ctxOf(c);
    const row = await ctx.db.query.payment.findFirst({
      where: and(eq(payment.id, c.req.param("id")), eq(payment.workspaceId, ctx.workspaceId)),
    });
    if (!row) throw notFound("Payment");
    const { reason } = c.req.valid("json");
    await runBatch(ctx, [
      ctx.db
        .update(payment)
        .set({
          voidedAt: Date.now(),
          note: reason ? `${row.note ? `${row.note} · ` : ""}Voided: ${reason}` : row.note,
        })
        .where(eq(payment.id, row.id)),
      auditEntry(ctx, "void", "payment", row.id, { reason }),
      ...(await proofVoidStatements(ctx, row.id, reason ?? null)),
    ]);
    await rebuildAllocations(ctx, row.clientId);
    return c.json(await statementFor(ctx, row.clientId));
  })

  .get("/charges", requireCap("money"), v("query", rangeQuerySchema), async (c) => {
    const ctx = ctxOf(c);
    const { from, to } = c.req.valid("query");
    const paid = ctx.db
      .select({
        chargeId: paymentAllocation.chargeId,
        paid: sql<number>`sum(${paymentAllocation.amountMinor})`.as("paid"),
      })
      .from(paymentAllocation)
      .where(eq(paymentAllocation.workspaceId, ctx.workspaceId))
      .groupBy(paymentAllocation.chargeId)
      .as("paid_by_charge");
    const rows = await ctx.db
      .select({
        ch: charge,
        paidMinor: sql<number>`coalesce(${paid.paid}, 0)`,
        firstName: client.firstName,
        lastName: client.lastName,
      })
      .from(charge)
      .innerJoin(client, eq(client.id, charge.clientId))
      .leftJoin(paid, eq(paid.chargeId, charge.id))
      .where(
        and(
          eq(charge.workspaceId, ctx.workspaceId),
          gte(charge.occurredOn, from),
          lte(charge.occurredOn, to),
        ),
      )
      .orderBy(desc(charge.occurredOn), desc(charge.createdAt));
    return c.json(
      rows.map(
        (r): ChargeListItemDto => ({
          id: r.ch.id,
          kind: r.ch.kind,
          description: r.ch.description,
          amountMinor: r.ch.amountMinor,
          paidMinor: Number(r.paidMinor),
          occurredOn: r.ch.occurredOn,
          voidedAt: r.ch.voidedAt,
          clientPackageId: r.ch.clientPackageId,
          attendanceId: r.ch.attendanceId,
          registrationId: r.ch.registrationId,
          clientId: r.ch.clientId,
          clientName: `${r.firstName} ${r.lastName}`.trim(),
        }),
      ),
    );
  })

  .post("/charges", requireCap("money"), v("json", chargeSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    await ensureClient(ctx, input.clientId);
    const id = input.id ?? uuidv7();
    await runBatch(ctx, [
      ctx.db.insert(charge).values({
        id,
        workspaceId: ctx.workspaceId,
        clientId: input.clientId,
        kind: input.kind,
        description: input.description,
        amountMinor: input.amountMinor,
        occurredOn: input.occurredOn,
        createdBy: ctx.userId,
      }),
      auditEntry(ctx, "create", "charge", id, { amountMinor: input.amountMinor }),
    ]);
    await rebuildAllocations(ctx, input.clientId);
    return c.json(await statementFor(ctx, input.clientId), 201);
  })

  .post("/charges/:id/void", requireCap("money"), v("json", voidSchema), async (c) => {
    const ctx = ctxOf(c);
    const row = await ctx.db.query.charge.findFirst({
      where: and(eq(charge.id, c.req.param("id")), eq(charge.workspaceId, ctx.workspaceId)),
    });
    if (!row) throw notFound("Charge");
    if (row.attendanceId) throw badRequest("Change the check-in to remove a session charge.");
    const { reason } = c.req.valid("json");
    await runBatch(ctx, [
      ctx.db
        .update(charge)
        .set({ voidedAt: Date.now(), voidReason: reason ?? "Voided" })
        .where(eq(charge.id, row.id)),
      auditEntry(ctx, "void", "charge", row.id, { reason }),
    ]);
    await rebuildAllocations(ctx, row.clientId);
    return c.json(await statementFor(ctx, row.clientId));
  });
