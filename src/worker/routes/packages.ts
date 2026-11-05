import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { PackageBalanceDto } from "../../shared/api-types";
import type { ValidityMode } from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import {
  clientPackageUpdateSchema,
  creditAdjustSchema,
  sellPackageSchema,
  uniformUpdateSchema,
} from "../../shared/schemas";
import { todayIn } from "../../shared/time";
import { saleTerms } from "../../shared/validity";
import { charge, client, clientPackage, creditLedger, packageTemplate } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import {
  packagesForClients,
  refreshPackageStatus,
  runBatch,
  toPackageBalanceDto,
} from "../services/credits";
import { rebuildAllocations } from "../services/money";
import { planPackageSale } from "../services/packages";
import type { AppBindings, Ctx } from "../types";

/** Selling, voiding, extending, and adjusting packages is money: owner and admins only. */
const moneyOnly = requireCap("money");

async function packageDto(ctx: Ctx, clientId: string, id: string): Promise<PackageBalanceDto> {
  const all = await packagesForClients(ctx, [clientId], { includeInactive: true });
  const p = all.find((x) => x.id === id);
  if (!p) throw notFound("Package");
  return toPackageBalanceDto(p);
}

export const packageRoutes = new Hono<AppBindings>()
  .post("/clients/:id/packages", moneyOnly, v("json", sellPackageSchema), async (c) => {
    const ctx = ctxOf(c);
    const clientId = c.req.param("id");
    const input = c.req.valid("json");
    const who = await ctx.db.query.client.findFirst({
      where: and(eq(client.id, clientId), eq(client.workspaceId, ctx.workspaceId)),
    });
    if (!who) throw notFound("Client");

    let name: string;
    let credits: number;
    let lessonKinds: (typeof clientPackage.$inferInsert)["lessonKinds"];
    let validityDays: number | null;
    let validityMode: ValidityMode = "days";
    let includesUniform = false;
    let sessionsLabel: string | null = null;
    let price: number;
    let templateId: string | null = null;
    if (input.packageId) {
      const tpl = await ctx.db.query.packageTemplate.findFirst({
        where: and(
          eq(packageTemplate.id, input.packageId),
          eq(packageTemplate.workspaceId, ctx.workspaceId),
        ),
      });
      if (!tpl) throw notFound("Package");
      templateId = tpl.id;
      name = tpl.name;
      credits = tpl.credits;
      lessonKinds = tpl.lessonKinds;
      validityDays = tpl.validityDays;
      validityMode = tpl.validityMode;
      includesUniform = tpl.includesUniform;
      sessionsLabel = tpl.sessionsLabel;
      price = input.priceMinor ?? tpl.priceMinor;
    } else if (input.custom) {
      name = input.custom.name;
      credits = input.custom.credits;
      lessonKinds = input.custom.lessonKinds;
      validityDays = input.custom.validityDays ?? null;
      if (input.priceMinor === undefined) throw badRequest("Enter a price for the custom package.");
      price = input.priceMinor;
    } else {
      throw badRequest("Choose a package.");
    }

    // Month-end packages run for one calendar month (this month or next), with no proration.
    const today = todayIn(ctx.settings.timezone);
    const sale = saleTerms({
      validityMode,
      validityDays,
      today,
      purchasedOn: input.purchasedOn,
      startMonth: input.startMonth,
      expiresOn: input.expiresOn,
    });
    if (!sale.ok) throw badRequest(sale.message, { fields: { [sale.field]: sale.message } });

    const planned = planPackageSale(
      ctx,
      {
        id: templateId,
        name,
        credits,
        lessonKinds: lessonKinds ?? [],
        validityMode,
        includesUniform,
        sessionsLabel,
      },
      {
        id: input.id,
        clientId,
        priceMinor: price,
        terms: sale.terms,
        uniformSize: input.uniformSize,
        notes: input.notes,
        payment: input.payment,
      },
    );
    await runBatch(ctx, planned.statements);
    await rebuildAllocations(ctx, clientId);
    return c.json(await packageDto(ctx, clientId, planned.id), 201);
  })

  .patch("/client-packages/:id", moneyOnly, v("json", clientPackageUpdateSchema), async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const pkg = await ctx.db.query.clientPackage.findFirst({
      where: and(eq(clientPackage.id, id), eq(clientPackage.workspaceId, ctx.workspaceId)),
    });
    if (!pkg) throw notFound("Package");
    const statements: unknown[] = [
      ctx.db
        .update(clientPackage)
        .set({
          expiresOn: input.expiresOn === undefined ? pkg.expiresOn : input.expiresOn,
          notes: input.notes === undefined ? pkg.notes : input.notes,
          status:
            input.status === "void"
              ? "void"
              : pkg.status === "expired" && input.expiresOn
                ? "active"
                : pkg.status,
        })
        .where(eq(clientPackage.id, id)),
      auditEntry(ctx, "update", "client_package", id, input),
    ];
    if (input.status === "void" && pkg.status !== "void") {
      statements.push(
        ctx.db
          .update(charge)
          .set({ voidedAt: Date.now(), voidReason: "Package voided" })
          .where(and(eq(charge.clientPackageId, id), eq(charge.workspaceId, ctx.workspaceId))),
      );
    } else {
      statements.push(refreshPackageStatus(ctx, [id]));
    }
    await runBatch(ctx, statements);
    await rebuildAllocations(ctx, pkg.clientId);
    return c.json(await packageDto(ctx, pkg.clientId, id));
  })

  .post("/client-packages/:id/adjust", moneyOnly, v("json", creditAdjustSchema), async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const pkg = await ctx.db.query.clientPackage.findFirst({
      where: and(eq(clientPackage.id, id), eq(clientPackage.workspaceId, ctx.workspaceId)),
    });
    if (!pkg) throw notFound("Package");
    if (pkg.status === "void") throw badRequest("This package was voided.");
    await runBatch(ctx, [
      ctx.db.insert(creditLedger).values({
        id: uuidv7(),
        workspaceId: ctx.workspaceId,
        clientPackageId: id,
        clientId: pkg.clientId,
        delta: input.delta,
        reason: "adjustment",
        note: input.note,
        createdBy: ctx.userId,
      }),
      refreshPackageStatus(ctx, [id]),
      auditEntry(ctx, "adjust", "client_package", id, input),
    ]);
    return c.json(await packageDto(ctx, pkg.clientId, id));
  })

  /**
   * The training uniform a package came with: its size, and whether it was handed out. Any staff
   * member (it happens at the court); no money involved.
   */
  .patch("/client-packages/:id/uniform", v("json", uniformUpdateSchema), async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const pkg = await ctx.db.query.clientPackage.findFirst({
      where: and(eq(clientPackage.id, id), eq(clientPackage.workspaceId, ctx.workspaceId)),
    });
    if (!pkg) throw notFound("Package");
    if (!pkg.includesUniform) throw conflict("This package doesn't include a uniform.");
    const set: Partial<typeof clientPackage.$inferInsert> = {};
    if (input.uniformSize !== undefined) set.uniformSize = input.uniformSize;
    if (input.issued !== undefined) {
      set.uniformIssuedAt = input.issued ? (pkg.uniformIssuedAt ?? Date.now()) : null;
    }
    if (Object.keys(set).length) {
      await runBatch(ctx, [
        ctx.db.update(clientPackage).set(set).where(eq(clientPackage.id, id)),
        auditEntry(ctx, "uniform", "client_package", id, {
          clientId: pkg.clientId,
          ...(input.uniformSize !== undefined ? { size: input.uniformSize } : {}),
          ...(input.issued !== undefined ? { issued: input.issued } : {}),
        }),
      ]);
    }
    return c.json(await packageDto(ctx, pkg.clientId, id));
  });
