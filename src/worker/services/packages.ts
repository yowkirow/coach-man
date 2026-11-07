import type { SQL } from "drizzle-orm";
import type { LessonKind, ValidityMode } from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import { monthLabel } from "../../shared/time";
import type { SaleTerms } from "../../shared/validity";
import { charge, clientPackage, payment } from "../db/schema";
import { auditEntry } from "../lib/audit";
import type { Ctx } from "../types";

/** What a package is sold as: a template's fields (or a custom package's). */
export interface SaleTemplate {
  /** The template it's sold from (null for a custom package). */
  id: string | null;
  name: string;
  credits: number;
  lessonKinds: LessonKind[];
  validityMode: ValidityMode;
  includesUniform: boolean;
  sessionsLabel: string | null;
}

export interface SaleInput {
  id?: string;
  clientId: string;
  /**
   * The value written to the new package's client_id, when it isn't simply `clientId`: a guard
   * subquery that is NULL unless the caller's claim in the same batch applied, so a sale that
   * lost a race aborts the whole batch (approving an enrollment twice never sells twice).
   */
  clientIdValue?: SQL;
  priceMinor: number;
  terms: SaleTerms;
  uniformSize?: string | null;
  notes?: string | null;
  /** The enrollment request this sale approves. */
  enrollmentId?: string | null;
  payment?: { amountMinor: number; method: string; reference?: string | null };
  /** Extra fields for the audit entry. */
  audit?: Record<string, unknown>;
}

export interface PlannedSale {
  id: string;
  /** The package's charge (null for a free package). */
  chargeId: string | null;
  statements: unknown[];
}

/** The charge line for a package: "Monthly (4–6 sessions) · December 2026". */
export function saleDescription(
  template: Pick<SaleTemplate, "name" | "sessionsLabel" | "credits">,
  startMonth: string | null,
  locale: string,
): string {
  const sessions =
    template.sessionsLabel ??
    `${template.credits} ${template.credits === 1 ? "session" : "sessions"}`;
  return startMonth
    ? `${template.name} (${sessions}) · ${monthLabel(startMonth, locale)}`
    : `${template.name} (${sessions})`;
}

/**
 * Selling a package to a client: the package, its charge (when it costs anything), an optional
 * payment taken on the spot, and the audit entry. Builds the statements without running them, so
 * a sale can be part of a bigger batch (approving an enrollment). Callers rebuild the client's
 * payment allocations after the batch.
 */
export function planPackageSale(ctx: Ctx, template: SaleTemplate, input: SaleInput): PlannedSale {
  const id = input.id ?? uuidv7();
  const { purchasedOn, startMonth, expiresOn } = input.terms;
  const price = input.priceMinor;
  const chargeId = price > 0 ? uuidv7() : null;
  const statements: unknown[] = [
    ctx.db.insert(clientPackage).values({
      id,
      workspaceId: ctx.workspaceId,
      clientId: input.clientIdValue ?? input.clientId,
      packageId: template.id,
      name: template.name,
      creditsTotal: template.credits,
      lessonKinds: template.lessonKinds ?? [],
      priceMinor: price,
      purchasedOn,
      expiresOn,
      startMonth,
      includesUniform: template.includesUniform,
      uniformSize: template.includesUniform ? (input.uniformSize ?? null) : null,
      status: "active",
      notes: input.notes ?? null,
      enrollmentId: input.enrollmentId ?? null,
    }),
    auditEntry(ctx, "sell", "client_package", id, {
      clientId: input.clientId,
      name: template.name,
      credits: template.credits,
      price,
      ...(startMonth ? { startMonth } : {}),
      ...(input.enrollmentId ? { enrollmentId: input.enrollmentId } : {}),
      ...input.audit,
    }),
  ];
  if (chargeId) {
    statements.push(
      ctx.db.insert(charge).values({
        id: chargeId,
        workspaceId: ctx.workspaceId,
        clientId: input.clientId,
        kind: "package",
        description: saleDescription(template, startMonth, ctx.settings.locale),
        amountMinor: price,
        clientPackageId: id,
        occurredOn: purchasedOn,
        createdBy: ctx.userId,
      }),
    );
  }
  if (input.payment) {
    statements.push(
      ctx.db.insert(payment).values({
        id: uuidv7(),
        workspaceId: ctx.workspaceId,
        clientId: input.clientId,
        amountMinor: input.payment.amountMinor,
        method: input.payment.method,
        reference: input.payment.reference ?? null,
        paidOn: purchasedOn,
        note: `For ${template.name}`,
        createdBy: ctx.userId,
      }),
    );
  }
  return { id, chargeId, statements };
}
