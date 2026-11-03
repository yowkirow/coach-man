import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { GroupDetailDto, GroupDto, SeriesDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import { groupMembersSchema, groupSchema } from "../../shared/schemas";
import { todayIn } from "../../shared/time";
import { client, groupMember, lesson, lessonSeries, trainingGroup } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { inList, unique } from "../lib/sql";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import { packagesForClients, runBatch } from "../services/credits";
import {
  lessonSummaries,
  syncMemberIntoGroupLessons,
  unbookMemberFromGroupLessons,
} from "../services/lessons";
import type { AppBindings, Ctx } from "../types";

const memberCount = sql<number>`(select count(*) from group_member gm where gm.group_id = "training_group"."id" and gm.left_on is null)`;

function toGroupDto(g: typeof trainingGroup.$inferSelect, members: number): GroupDto {
  return {
    id: g.id,
    name: g.name,
    level: g.level,
    description: g.description,
    color: g.color,
    capacity: g.capacity,
    defaultRateId: g.defaultRateId,
    defaultVenueId: g.defaultVenueId,
    memberCount: Number(members),
    archivedAt: g.archivedAt,
  };
}

export function toSeriesDto(s: typeof lessonSeries.$inferSelect): SeriesDto {
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
    weekdays: s.weekdays,
    startTime: s.startTime,
    durationMinutes: s.durationMinutes,
    startsOn: s.startsOn,
    endsOn: s.endsOn,
    venueId: s.venueId,
    court: s.court,
    active: s.active,
  };
}

async function loadGroup(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select({ g: trainingGroup, members: memberCount })
    .from(trainingGroup)
    .where(and(eq(trainingGroup.id, id), eq(trainingGroup.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Group");
  return toGroupDto(row.g, row.members);
}

export const groupRoutes = new Hono<AppBindings>()
  .get("/groups", async (c) => {
    const includeArchived = c.req.query("archived") === "1";
    const rows = await c.var.db
      .select({ g: trainingGroup, members: memberCount })
      .from(trainingGroup)
      .where(
        and(
          eq(trainingGroup.workspaceId, c.var.workspaceId),
          includeArchived ? undefined : isNull(trainingGroup.archivedAt),
        ),
      )
      .orderBy(asc(trainingGroup.name));
    return c.json(rows.map((r) => toGroupDto(r.g, r.members)));
  })

  .post("/groups", requireCap("catalog"), v("json", groupSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const id = input.id ?? uuidv7();
    await runBatch(ctx, [
      ctx.db.insert(trainingGroup).values({ ...input, id, workspaceId: ctx.workspaceId }),
      auditEntry(ctx, "create", "group", id),
    ]);
    return c.json(await loadGroup(ctx, id), 201);
  })

  .get("/groups/:id", async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param("id");
    const group = await loadGroup(ctx, id);
    const [members, series, upcoming] = await Promise.all([
      ctx.db
        .select({
          clientId: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          joinedOn: groupMember.joinedOn,
        })
        .from(groupMember)
        .innerJoin(client, eq(client.id, groupMember.clientId))
        .where(
          and(
            eq(groupMember.groupId, id),
            isNull(groupMember.leftOn),
            eq(groupMember.workspaceId, ctx.workspaceId),
          ),
        )
        .orderBy(asc(client.firstName), asc(client.lastName)),
      ctx.db
        .select()
        .from(lessonSeries)
        .where(and(eq(lessonSeries.groupId, id), eq(lessonSeries.workspaceId, ctx.workspaceId)))
        .orderBy(asc(lessonSeries.startsOn)),
      lessonSummaries(
        ctx,
        and(eq(lesson.groupId, id), gte(lesson.startsAt, Date.now() - 3_600_000)),
      ),
    ]);
    const pkgs = await packagesForClients(
      ctx,
      members.map((m) => m.clientId),
    );
    const today = todayIn(ctx.settings.timezone);
    const credits = new Map<string, number>();
    for (const p of pkgs) {
      if (p.status !== "active" || (p.expiresOn && p.expiresOn < today)) continue;
      credits.set(p.clientId, (credits.get(p.clientId) ?? 0) + p.remaining);
    }
    const body: GroupDetailDto = {
      group,
      members: members.map((m) => ({ ...m, creditsRemaining: credits.get(m.clientId) ?? 0 })),
      series: series.map(toSeriesDto),
      upcoming: upcoming.slice(0, 12).map((u) => u.summary),
    };
    return c.json(body);
  })

  .patch("/groups/:id", requireCap("catalog"), v("json", groupSchema.partial()), async (c) => {
    const ctx = ctxOf(c);
    const { id: _ignored, ...input } = c.req.valid("json");
    const res = await ctx.db
      .update(trainingGroup)
      .set(input)
      .where(
        and(
          eq(trainingGroup.id, c.req.param("id")),
          eq(trainingGroup.workspaceId, ctx.workspaceId),
        ),
      )
      .returning({ id: trainingGroup.id });
    if (!res[0]) throw notFound("Group");
    return c.json(await loadGroup(ctx, c.req.param("id")));
  })

  .post("/groups/:id/archive", requireCap("catalog"), async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param("id");
    const res = await ctx.db
      .update(trainingGroup)
      .set({ archivedAt: Date.now() })
      .where(and(eq(trainingGroup.id, id), eq(trainingGroup.workspaceId, ctx.workspaceId)))
      .returning({ id: trainingGroup.id });
    if (!res[0]) throw notFound("Group");
    await ctx.db
      .update(lessonSeries)
      .set({ active: false })
      .where(and(eq(lessonSeries.groupId, id), eq(lessonSeries.workspaceId, ctx.workspaceId)));
    return c.json(await loadGroup(ctx, id));
  })

  .post("/groups/:id/members", v("json", groupMembersSchema), async (c) => {
    const ctx = ctxOf(c);
    const groupId = c.req.param("id");
    await loadGroup(ctx, groupId);
    const clientIds = unique(c.req.valid("json").clientIds);
    const found = await ctx.db
      .select({ id: client.id })
      .from(client)
      .where(and(eq(client.workspaceId, ctx.workspaceId), inList(client.id, clientIds)));
    if (found.length !== clientIds.length) throw badRequest("Some clients were not found.");
    const today = todayIn(ctx.settings.timezone);
    const existing = await ctx.db
      .select()
      .from(groupMember)
      .where(and(eq(groupMember.groupId, groupId), inList(groupMember.clientId, clientIds)));
    const statements: unknown[] = [];
    for (const clientId of clientIds) {
      const row = existing.find((e) => e.clientId === clientId);
      if (row && !row.leftOn) continue;
      statements.push(
        row
          ? ctx.db
              .update(groupMember)
              .set({ leftOn: null, joinedOn: today })
              .where(eq(groupMember.id, row.id))
          : ctx.db.insert(groupMember).values({
              id: uuidv7(),
              workspaceId: ctx.workspaceId,
              groupId,
              clientId,
              joinedOn: today,
            }),
      );
    }
    await runBatch(ctx, statements);
    await syncMemberIntoGroupLessons(ctx, groupId, clientIds);
    return c.json(await loadGroup(ctx, groupId));
  })

  .delete("/groups/:id/members/:clientId", async (c) => {
    const ctx = ctxOf(c);
    const groupId = c.req.param("id");
    const clientId = c.req.param("clientId");
    await loadGroup(ctx, groupId);
    await ctx.db
      .update(groupMember)
      .set({ leftOn: todayIn(ctx.settings.timezone) })
      .where(
        and(
          eq(groupMember.groupId, groupId),
          eq(groupMember.clientId, clientId),
          eq(groupMember.workspaceId, ctx.workspaceId),
        ),
      );
    await unbookMemberFromGroupLessons(ctx, groupId, clientId);
    return c.json(await loadGroup(ctx, groupId));
  });
