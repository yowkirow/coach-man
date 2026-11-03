import { and, asc, count, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { MeDto, VenueDto, WorkspaceSettingsDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import { capabilitiesFor } from "../../shared/roles";
import { onboardingSchema, venueSchema, workspaceUpdateSchema } from "../../shared/schemas";
import { organization, passkey, venue, workspaceSettings } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { notFound } from "../lib/errors";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import { runBatch } from "../services/credits";
import { hasSampleData, removeSampleData, seedSampleData } from "../services/sample-data";
import type { AppBindings, WorkspaceSettingsRow } from "../types";

export function toSettingsDto(s: WorkspaceSettingsRow): WorkspaceSettingsDto {
  return {
    currency: s.currency,
    timezone: s.timezone,
    locale: s.locale,
    sport: s.sport,
    paymentMethods: s.paymentMethods,
    noShowUsesCredit: s.noShowUsesCredit,
    lateCancelUsesCredit: s.lateCancelUsesCredit,
    lateCancelHours: s.lateCancelHours,
    defaultSessionMinutes: s.defaultSessionMinutes,
    weekStartsOn: s.weekStartsOn,
    onboardedAt: s.onboardedAt,
  };
}

const toVenueDto = (r: typeof venue.$inferSelect): VenueDto => ({
  id: r.id,
  name: r.name,
  address: r.address,
  courtCount: r.courtCount,
  notes: r.notes,
});

export const meRoutes = new Hono<AppBindings>()
  .get("/me", async (c) => {
    const { db, user, workspaceId, settings, role } = c.var;
    const [org, keys] = await Promise.all([
      db.query.organization.findFirst({ where: eq(organization.id, workspaceId) }),
      db.select({ n: count() }).from(passkey).where(eq(passkey.userId, user.id)),
    ]);
    const body: MeDto = {
      user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
      workspace: { id: workspaceId, name: org?.name ?? "My coaching" },
      role,
      can: capabilitiesFor(role),
      settings: toSettingsDto(settings),
      passkeyCount: keys[0]?.n ?? 0,
      hasSampleData: await hasSampleData({ db, workspaceId }),
      appEnv: c.env.APP_ENV,
    };
    return c.json(body);
  })

  .delete("/workspace/sample-data", requireCap("data"), async (c) => {
    const removed = await removeSampleData(ctxOf(c));
    return c.json({ removed });
  })

  .patch("/workspace", requireCap("settings"), v("json", workspaceUpdateSchema), async (c) => {
    const ctx = ctxOf(c);
    const { name, ...settings } = c.req.valid("json");
    const statements: unknown[] = [];
    if (name) {
      statements.push(
        ctx.db.update(organization).set({ name }).where(eq(organization.id, ctx.workspaceId)),
      );
    }
    if (Object.keys(settings).length) {
      statements.push(
        ctx.db
          .update(workspaceSettings)
          .set(settings)
          .where(eq(workspaceSettings.workspaceId, ctx.workspaceId)),
      );
    }
    statements.push(auditEntry(ctx, "update", "workspace", ctx.workspaceId, { name, ...settings }));
    await runBatch(ctx, statements);
    const fresh = await ctx.db.query.workspaceSettings.findFirst({
      where: eq(workspaceSettings.workspaceId, ctx.workspaceId),
    });
    return c.json(toSettingsDto(fresh as WorkspaceSettingsRow));
  })

  .post("/workspace/onboard", requireCap("settings"), v("json", onboardingSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    await runBatch(ctx, [
      ctx.db
        .update(organization)
        .set({ name: input.name })
        .where(eq(organization.id, ctx.workspaceId)),
      ctx.db
        .update(workspaceSettings)
        .set({
          currency: input.currency,
          timezone: input.timezone,
          locale: input.locale,
          onboardedAt: ctx.settings.onboardedAt ?? Date.now(),
        })
        .where(eq(workspaceSettings.workspaceId, ctx.workspaceId)),
    ]);
    const fresh = (await ctx.db.query.workspaceSettings.findFirst({
      where: eq(workspaceSettings.workspaceId, ctx.workspaceId),
    })) as WorkspaceSettingsRow;
    if (input.withSampleData) await seedSampleData({ ...ctx, settings: fresh });
    return c.json(toSettingsDto(fresh));
  })

  .get("/venues", async (c) => {
    const rows = await c.var.db
      .select()
      .from(venue)
      .where(and(eq(venue.workspaceId, c.var.workspaceId), isNull(venue.archivedAt)))
      .orderBy(asc(venue.name));
    return c.json(rows.map(toVenueDto));
  })

  .post("/venues", requireCap("settings"), v("json", venueSchema), async (c) => {
    const input = c.req.valid("json");
    const id = input.id ?? uuidv7();
    await c.var.db.insert(venue).values({
      id,
      workspaceId: c.var.workspaceId,
      name: input.name,
      address: input.address ?? null,
      courtCount: input.courtCount ?? null,
      notes: input.notes ?? null,
    });
    const row = await c.var.db.query.venue.findFirst({ where: eq(venue.id, id) });
    return c.json(toVenueDto(row as typeof venue.$inferSelect), 201);
  })

  .patch("/venues/:id", requireCap("settings"), v("json", venueSchema.partial()), async (c) => {
    const { id: _ignored, ...input } = c.req.valid("json");
    const id = c.req.param("id");
    const res = await c.var.db
      .update(venue)
      .set(input)
      .where(and(eq(venue.id, id), eq(venue.workspaceId, c.var.workspaceId)))
      .returning();
    if (!res[0]) throw notFound("Venue");
    return c.json(toVenueDto(res[0]));
  })

  .delete("/venues/:id", requireCap("settings"), async (c) => {
    const res = await c.var.db
      .update(venue)
      .set({ archivedAt: Date.now() })
      .where(and(eq(venue.id, c.req.param("id")), eq(venue.workspaceId, c.var.workspaceId)))
      .returning({ id: venue.id });
    if (!res[0]) throw notFound("Venue");
    return c.body(null, 204);
  });
