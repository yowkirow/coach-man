import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { PackageTemplateDto, RateDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import {
  packageTemplateSchema,
  packageTemplateUpdateSchema,
  rateSchema,
  reorderSchema,
} from "../../shared/schemas";
import { packageTemplate, rate, trainingGroup } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { inList, unique } from "../lib/sql";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import { assertStaff } from "../services/coaches";
import { runBatch } from "../services/credits";
import type { AppBindings, Ctx } from "../types";

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

export const toPackageDto = (
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
  programId: p.programId,
  coachUserId: p.coachUserId,
  sessionsLabel: p.sessionsLabel,
  validityMode: p.validityMode,
  inclusions: p.inclusions ?? [],
  audience: p.audience,
  commitmentNote: p.commitmentNote,
  includesUniform: p.includesUniform,
  asksSelfRating: p.asksSelfRating,
  isPublic: p.isPublic,
  highlight: p.highlight,
  sortOrder: p.sortOrder,
});

/** A tier's program must be one of the academy's groups; its coach must be on the team. */
async function checkTierLinks(
  ctx: Ctx,
  input: { programId?: string | null; coachUserId?: string | null },
) {
  if (input.programId) {
    const program = await ctx.db.query.trainingGroup.findFirst({
      where: and(
        eq(trainingGroup.id, input.programId),
        eq(trainingGroup.workspaceId, ctx.workspaceId),
      ),
      columns: { id: true },
    });
    if (!program) {
      throw badRequest("Pick one of your programs.", {
        fields: { programId: "That program isn't in this academy." },
      });
    }
  }
  if (input.coachUserId) await assertStaff(ctx, [input.coachUserId], "coachUserId");
}

/** Where a new package goes in the academy's order: after the others. */
async function nextPackageOrder(ctx: Ctx): Promise<number> {
  const [row] = await ctx.db
    .select({ max: sql<number | null>`max(${packageTemplate.sortOrder})` })
    .from(packageTemplate)
    .where(eq(packageTemplate.workspaceId, ctx.workspaceId));
  return row?.max === null || row?.max === undefined ? 0 : row.max + 10;
}

/** Ids in a new order → sortOrder 0, 10, 20… (gaps leave room for one-off edits). */
function reorderStatements(ctx: Ctx, ids: string[]) {
  return unique(ids).map((id, i) =>
    ctx.db
      .update(packageTemplate)
      .set({ sortOrder: i * 10 })
      .where(and(eq(packageTemplate.id, id), eq(packageTemplate.workspaceId, ctx.workspaceId))),
  );
}

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

  /** Every staff member reads the tiers (coaches without prices: the API strips them). */
  .get("/packages", async (c) => {
    const rows = await c.var.db
      .select({ p: packageTemplate, sold: soldCount })
      .from(packageTemplate)
      .where(eq(packageTemplate.workspaceId, c.var.workspaceId))
      .orderBy(asc(packageTemplate.sortOrder), asc(packageTemplate.name));
    return c.json(rows.map((r) => toPackageDto(r.p, r.sold)));
  })

  .post("/packages", catalogOnly, v("json", packageTemplateSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    await checkTierLinks(ctx, input);
    const id = input.id ?? uuidv7();
    const monthEnd = input.validityMode === "month_end";
    const sortOrder = input.sortOrder ?? (await nextPackageOrder(ctx));
    await runBatch(ctx, [
      ctx.db.insert(packageTemplate).values({
        ...input,
        id,
        sortOrder,
        workspaceId: ctx.workspaceId,
        // Month-end tiers run to the end of their start month; a day count would mislead.
        validityDays: monthEnd ? null : (input.validityDays ?? null),
        inclusions: input.inclusions ?? [],
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
    await checkTierLinks(ctx, input);
    const set = { ...input };
    if (input.validityMode === "month_end") set.validityDays = null;
    const res = await ctx.db
      .update(packageTemplate)
      .set(set)
      .where(and(eq(packageTemplate.id, id), eq(packageTemplate.workspaceId, ctx.workspaceId)))
      .returning({ id: packageTemplate.id });
    if (!res[0]) throw notFound("Package");
    const [row] = await ctx.db
      .select({ p: packageTemplate, sold: soldCount })
      .from(packageTemplate)
      .where(eq(packageTemplate.id, id));
    return c.json(toPackageDto(row?.p as typeof packageTemplate.$inferSelect, row?.sold ?? 0));
  })

  /** The tiers' order on the public page and the rates sheet. */
  .post("/packages/reorder", catalogOnly, v("json", reorderSchema), async (c) => {
    const ctx = ctxOf(c);
    const { ids } = c.req.valid("json");
    const found = await ctx.db
      .select({ id: packageTemplate.id })
      .from(packageTemplate)
      .where(
        and(eq(packageTemplate.workspaceId, ctx.workspaceId), inList(packageTemplate.id, ids)),
      );
    if (found.length !== unique(ids).length) throw badRequest("Some packages were not found.");
    await runBatch(ctx, [
      ...reorderStatements(ctx, ids),
      auditEntry(ctx, "reorder", "package", null, { ids }),
    ]);
    const rows = await ctx.db
      .select({ p: packageTemplate, sold: soldCount })
      .from(packageTemplate)
      .where(eq(packageTemplate.workspaceId, ctx.workspaceId))
      .orderBy(asc(packageTemplate.sortOrder), asc(packageTemplate.name));
    return c.json(rows.map((r) => toPackageDto(r.p, r.sold)));
  });
