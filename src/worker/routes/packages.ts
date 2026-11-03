import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { PackageBalanceDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import {
  clientPackageUpdateSchema,
  creditAdjustSchema,
  sellPackageSchema,
} from "../../shared/schemas";
import { addDays, todayIn } from "../../shared/time";
import {
  charge,
  client,
  clientPackage,
  creditLedger,
  packageTemplate,
  payment,
} from "../db/schema";
import { auditEntry } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import { packagesForClients, refreshPackageStatus, runBatch } from "../services/credits";
import { rebuildAllocations } from "../services/money";
import type { AppBindings, Ctx } from "../types";

/** Selling, voiding, extending, and adjusting packages is money: owner and admins only. */
const moneyOnly = requireCap("money");

async function packageDto(ctx: Ctx, clientId: string, id: string): Promise<PackageBalanceDto> {
  const all = await packagesForClients(ctx, [clientId], { includeInactive: true });
  const p = all.find((x) => x.id === id);
  if (!p) throw notFound("Package");
  return {
    id: p.id,
    name: p.name,
    creditsTotal: p.creditsTotal,
    remaining: p.remaining,
    expiresOn: p.expiresOn,
    status: p.status as PackageBalanceDto["status"],
    lessonKinds: p.lessonKinds,
  };
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

    const purchasedOn = input.purchasedOn ?? todayIn(ctx.settings.timezone);
    const expiresOn =
      input.expiresOn !== undefined
        ? input.expiresOn
        : validityDays
          ? addDays(purchasedOn, validityDays - 1)
          : null;
    const id = input.id ?? uuidv7();
    const statements: unknown[] = [
      ctx.db.insert(clientPackage).values({
        id,
        workspaceId: ctx.workspaceId,
        clientId,
        packageId: templateId,
        name,
        creditsTotal: credits,
        lessonKinds: lessonKinds ?? [],
        priceMinor: price,
        purchasedOn,
        expiresOn,
        status: "active",
        notes: input.notes ?? null,
      }),
      auditEntry(ctx, "sell", "client_package", id, { clientId, name, credits, price }),
    ];
    if (price > 0) {
      statements.push(
        ctx.db.insert(charge).values({
          id: uuidv7(),
          workspaceId: ctx.workspaceId,
          clientId,
          kind: "package",
          description: `${name} (${credits} ${credits === 1 ? "session" : "sessions"})`,
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
          clientId,
          amountMinor: input.payment.amountMinor,
          method: input.payment.method,
          reference: input.payment.reference ?? null,
          paidOn: purchasedOn,
          note: `For ${name}`,
          createdBy: ctx.userId,
        }),
      );
    }
    await runBatch(ctx, statements);
    await rebuildAllocations(ctx, clientId);
    return c.json(await packageDto(ctx, clientId, id), 201);
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
  });
