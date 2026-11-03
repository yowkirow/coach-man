import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { PackageTemplateDto, RateDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import {
  packageTemplateSchema,
  packageTemplateUpdateSchema,
  rateSchema,
} from "../../shared/schemas";
import { packageTemplate, rate } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { notFound } from "../lib/errors";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import { runBatch } from "../services/credits";
import type { AppBindings } from "../types";

/** Rates and package templates set prices: owner and admins only. */
const catalogOnly = requireCap("catalog");

const toRateDto = (r: typeof rate.$inferSelect): RateDto => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  durationMinutes: r.durationMinutes,
  priceMinor: r.priceMinor,
  unit: r.unit,
  active: r.active,
});

const soldCount = sql<number>`(select count(*) from client_package cp where cp.package_id = "package"."id")`;

const toPackageDto = (
  p: typeof packageTemplate.$inferSelect,
  sold: number,
): PackageTemplateDto => ({
  id: p.id,
  name: p.name,
  credits: p.credits,
  lessonKinds: p.lessonKinds,
  priceMinor: p.priceMinor,
  validityDays: p.validityDays,
  description: p.description,
  active: p.active,
  soldCount: Number(sold),
});

export const catalogRoutes = new Hono<AppBindings>()
  .get("/rates", async (c) => {
    const rows = await c.var.db
      .select()
      .from(rate)
      .where(eq(rate.workspaceId, c.var.workspaceId))
      .orderBy(asc(rate.kind), asc(rate.name));
    return c.json(rows.map(toRateDto));
  })

  .post("/rates", catalogOnly, v("json", rateSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const id = input.id ?? uuidv7();
    await runBatch(ctx, [
      ctx.db.insert(rate).values({ ...input, id, workspaceId: ctx.workspaceId }),
      auditEntry(ctx, "create", "rate", id, { priceMinor: input.priceMinor }),
    ]);
    const row = await ctx.db.query.rate.findFirst({ where: eq(rate.id, id) });
    return c.json(toRateDto(row as typeof rate.$inferSelect), 201);
  })

  .patch("/rates/:id", catalogOnly, v("json", rateSchema.partial()), async (c) => {
    const ctx = ctxOf(c);
    const { id: _ignored, ...input } = c.req.valid("json");
    const res = await ctx.db
      .update(rate)
      .set(input)
      .where(and(eq(rate.id, c.req.param("id")), eq(rate.workspaceId, ctx.workspaceId)))
      .returning();
    if (!res[0]) throw notFound("Rate");
    await auditEntry(ctx, "update", "rate", res[0].id, input);
    return c.json(toRateDto(res[0]));
  })

  .get("/packages", async (c) => {
    const rows = await c.var.db
      .select({ p: packageTemplate, sold: soldCount })
      .from(packageTemplate)
      .where(eq(packageTemplate.workspaceId, c.var.workspaceId))
      .orderBy(asc(packageTemplate.name));
    return c.json(rows.map((r) => toPackageDto(r.p, r.sold)));
  })

  .post("/packages", catalogOnly, v("json", packageTemplateSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const id = input.id ?? uuidv7();
    await runBatch(ctx, [
      ctx.db.insert(packageTemplate).values({
        ...input,
        id,
        workspaceId: ctx.workspaceId,
        validityDays: input.validityDays ?? null,
      }),
      auditEntry(ctx, "create", "package", id, {
        priceMinor: input.priceMinor,
        credits: input.credits,
      }),
    ]);
    const row = await ctx.db.query.packageTemplate.findFirst({ where: eq(packageTemplate.id, id) });
    return c.json(toPackageDto(row as typeof packageTemplate.$inferSelect, 0), 201);
  })

  .patch("/packages/:id", catalogOnly, v("json", packageTemplateUpdateSchema), async (c) => {
    const ctx = ctxOf(c);
    const { id: _ignored, ...input } = c.req.valid("json");
    const id = c.req.param("id");
    const res = await ctx.db
      .update(packageTemplate)
      .set(input)
      .where(and(eq(packageTemplate.id, id), eq(packageTemplate.workspaceId, ctx.workspaceId)))
      .returning({ id: packageTemplate.id });
    if (!res[0]) throw notFound("Package");
    const [row] = await ctx.db
      .select({ p: packageTemplate, sold: soldCount })
      .from(packageTemplate)
      .where(eq(packageTemplate.id, id));
    return c.json(toPackageDto(row?.p as typeof packageTemplate.$inferSelect, row?.sold ?? 0));
  });
