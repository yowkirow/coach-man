import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { LessonSummaryDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import {
  attendanceUpdateSchema,
  lessonCancelSchema,
  lessonCreateSchema,
  lessonUpdateSchema,
  participantSchema,
  rainOutSchema,
  rangeQuerySchema,
} from "../../shared/schemas";
import {
  addDays,
  compareDates,
  daysBetween,
  localDate,
  localTime,
  startOfLocalDay,
  weekdayOf,
  zonedToEpoch,
} from "../../shared/time";
import { attendance, client, lesson, lessonSeries } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { idempotent } from "../lib/idempotency";
import { v } from "../lib/validate";
import { ctxOf } from "../middleware";
import { changeAttendance, releaseLessonFunding, runBatch } from "../services/credits";
import {
  createLessons,
  lessonDetail,
  lessonsBetween,
  MATERIALIZE_DAYS,
  materializeSeries,
  offlinePack,
  today,
} from "../services/lessons";
import type { AppBindings, Ctx } from "../types";

async function loadLesson(ctx: Ctx, id: string) {
  const row = await ctx.db.query.lesson.findFirst({
    where: and(eq(lesson.id, id), eq(lesson.workspaceId, ctx.workspaceId)),
  });
  if (!row) throw notFound("Session");
  return row;
}

async function cancelLesson(ctx: Ctx, id: string, reason: string | null) {
  await ctx.db
    .update(lesson)
    .set({ status: "cancelled", cancelReason: reason })
    .where(and(eq(lesson.id, id), eq(lesson.workspaceId, ctx.workspaceId)));
  await releaseLessonFunding(
    ctx,
    id,
    reason ? `Session cancelled: ${reason}` : "Session cancelled",
  );
}

/** Ends a series before `fromDate`: deletes untouched future occurrences, cancels touched ones. */
async function endSeriesFrom(
  ctx: Ctx,
  seriesId: string,
  fromDate: string,
  reason: string | null,
  keepLessonId?: string,
) {
  const { db, workspaceId } = ctx;
  const series = await db.query.lessonSeries.findFirst({
    where: and(eq(lessonSeries.id, seriesId), eq(lessonSeries.workspaceId, workspaceId)),
  });
  if (!series) return;
  const future = await db
    .select({
      id: lesson.id,
      touched: sql<number>`(select count(*) from attendance a where a.lesson_id = "lesson"."id" and (a.status != 'booked' or a.consumed_package_id is not null or a.charge_id is not null))`,
    })
    .from(lesson)
    .where(
      and(
        eq(lesson.workspaceId, workspaceId),
        eq(lesson.seriesId, seriesId),
        eq(lesson.detached, false),
        sql`${lesson.occurrenceDate} >= ${fromDate}`,
      ),
    );
  const untouched = future
    .filter((f) => Number(f.touched) === 0 && f.id !== keepLessonId)
    .map((f) => f.id);
  const touched = future
    .filter((f) => Number(f.touched) > 0 && f.id !== keepLessonId)
    .map((f) => f.id);
  const endsOn = addDays(fromDate, -1);
  await runBatch(ctx, [
    db
      .update(lessonSeries)
      .set({ endsOn, active: compareDates(endsOn, series.startsOn) >= 0 && series.active })
      .where(eq(lessonSeries.id, seriesId)),
    ...(untouched.length
      ? [db.delete(lesson).where(inArray(lesson.id, untouched.slice(0, 90)))]
      : []),
  ]);
  for (let i = 90; i < untouched.length; i += 90) {
    await db.delete(lesson).where(inArray(lesson.id, untouched.slice(i, i + 90)));
  }
  for (const id of touched) await cancelLesson(ctx, id, reason ?? "Series changed");
}

export const lessonRoutes = new Hono<AppBindings>()
  .get("/today", async (c) => c.json(await today(ctxOf(c))))

  .get("/offline-pack", async (c) => c.json(await offlinePack(ctxOf(c))))

  .get("/lessons", v("query", rangeQuerySchema), async (c) => {
    const { from, to } = c.req.valid("query");
    if (daysBetween(from, to) > 62) throw badRequest("Ask for at most two months at a time.");
    if (compareDates(from, to) > 0) throw badRequest("The range ends before it starts.");
    const items = await lessonsBetween(ctxOf(c), from, to);
    return c.json(items.map((i) => i.summary) satisfies LessonSummaryDto[]);
  })

  .post("/lessons", v("json", lessonCreateSchema), async (c) => {
    const ctx = ctxOf(c);
    const result = await createLessons(ctx, c.req.valid("json"));
    await auditEntry(ctx, "create", "lesson", result.lessonIds[0] ?? null, {
      count: result.lessonIds.length,
      seriesId: result.seriesId,
    });
    const first = result.lessonIds[0];
    return c.json({ ...result, lesson: first ? await lessonDetail(ctx, first) : null }, 201);
  })

  .get("/lessons/:id", async (c) => c.json(await lessonDetail(ctxOf(c), c.req.param("id"))))

  .patch("/lessons/:id", v("json", lessonUpdateSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const current = await loadLesson(ctx, c.req.param("id"));
    const tz = ctx.settings.timezone;
    const date = input.date ?? localDate(current.startsAt, tz);
    const startTime = input.startTime ?? localTime(current.startsAt, tz);
    const duration =
      input.durationMinutes ?? Math.round((current.endsAt - current.startsAt) / 60_000);
    const fields = {
      title: input.title === undefined ? current.title : input.title,
      venueId: input.venueId === undefined ? current.venueId : input.venueId,
      court: input.court === undefined ? current.court : input.court,
      rateId: input.rateId === undefined ? current.rateId : input.rateId,
      priceMinor: input.priceMinor === undefined ? current.priceMinor : input.priceMinor,
      capacity: input.capacity === undefined ? current.capacity : input.capacity,
    };

    if (input.scope === "following" && current.seriesId && current.occurrenceDate) {
      const series = await ctx.db.query.lessonSeries.findFirst({
        where: and(
          eq(lessonSeries.id, current.seriesId),
          eq(lessonSeries.workspaceId, ctx.workspaceId),
        ),
      });
      if (!series) throw notFound("Series");
      const oldDay = weekdayOf(current.occurrenceDate);
      const newDay = weekdayOf(date);
      const weekdays =
        oldDay === newDay
          ? series.weekdays
          : [...new Set(series.weekdays.map((d) => (d === oldDay ? newDay : d)))].sort();
      await endSeriesFrom(ctx, series.id, current.occurrenceDate, "Series changed");
      const newId = uuidv7();
      await ctx.db.insert(lessonSeries).values({
        ...series,
        ...fields,
        id: newId,
        weekdays,
        startTime,
        durationMinutes: duration,
        startsOn: date,
        endsOn: series.endsOn && compareDates(series.endsOn, date) >= 0 ? series.endsOn : null,
        materializedThrough: null,
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const created = await ctx.db.query.lessonSeries.findFirst({
        where: eq(lessonSeries.id, newId),
      });
      if (!created) throw notFound("Series");
      const through = addDays(date, MATERIALIZE_DAYS);
      const ids = await materializeSeries(ctx, created, through);
      await auditEntry(ctx, "update", "lesson_series", newId, { from: series.id });
      const firstId = ids[0];
      return c.json(firstId ? await lessonDetail(ctx, firstId) : null);
    }

    const startsAt = zonedToEpoch(date, startTime, tz);
    await ctx.db
      .update(lesson)
      .set({
        ...fields,
        notes: input.notes === undefined ? current.notes : input.notes,
        startsAt,
        endsAt: startsAt + duration * 60_000,
        detached: current.seriesId ? true : current.detached,
      })
      .where(eq(lesson.id, current.id));
    return c.json(await lessonDetail(ctx, current.id));
  })

  .post("/lessons/:id/cancel", v("json", lessonCancelSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const current = await loadLesson(ctx, c.req.param("id"));
    await cancelLesson(ctx, current.id, input.reason ?? null);
    if (input.scope === "following" && current.seriesId && current.occurrenceDate) {
      await endSeriesFrom(
        ctx,
        current.seriesId,
        addDays(current.occurrenceDate, 1),
        input.reason ?? null,
        current.id,
      );
    }
    await auditEntry(ctx, "cancel", "lesson", current.id, {
      scope: input.scope,
      reason: input.reason,
    });
    return c.json(await lessonDetail(ctx, current.id));
  })

  .post("/lessons/:id/restore", async (c) => {
    const ctx = ctxOf(c);
    const current = await loadLesson(ctx, c.req.param("id"));
    if (current.status !== "cancelled") throw conflict("Only cancelled sessions can be restored.");
    await ctx.db
      .update(lesson)
      .set({ status: "scheduled", cancelReason: null })
      .where(eq(lesson.id, current.id));
    return c.json(await lessonDetail(ctx, current.id));
  })

  .post("/lessons/:id/complete", async (c) => {
    const ctx = ctxOf(c);
    return idempotent(c, async () => {
      const current = await loadLesson(ctx, c.req.param("id"));
      if (current.status === "cancelled") throw conflict("This session was cancelled.");
      await ctx.db
        .update(lesson)
        .set({ status: "completed", completedAt: current.completedAt ?? Date.now() })
        .where(eq(lesson.id, current.id));
      return c.json(await lessonDetail(ctx, current.id));
    });
  })

  .post("/lessons/:id/reopen", async (c) => {
    const ctx = ctxOf(c);
    const current = await loadLesson(ctx, c.req.param("id"));
    await ctx.db
      .update(lesson)
      .set({ status: "scheduled", completedAt: null })
      .where(eq(lesson.id, current.id));
    return c.json(await lessonDetail(ctx, current.id));
  })

  .delete("/lessons/:id", async (c) => {
    const ctx = ctxOf(c);
    const current = await loadLesson(ctx, c.req.param("id"));
    const funded = await ctx.db
      .select({ id: attendance.id })
      .from(attendance)
      .where(
        and(
          eq(attendance.lessonId, current.id),
          sql`(${attendance.consumedPackageId} is not null or ${attendance.chargeId} is not null)`,
        ),
      )
      .limit(1);
    if (funded.length)
      throw conflict("Players already used credits for this session. Cancel it instead.");
    await runBatch(ctx, [
      ctx.db.delete(lesson).where(eq(lesson.id, current.id)),
      auditEntry(ctx, "delete", "lesson", current.id),
    ]);
    return c.body(null, 204);
  })

  .post("/lessons/rain-out", v("json", rainOutSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const tz = ctx.settings.timezone;
    const rows = await ctx.db
      .select({ id: lesson.id })
      .from(lesson)
      .where(
        and(
          eq(lesson.workspaceId, ctx.workspaceId),
          eq(lesson.status, "scheduled"),
          gte(lesson.startsAt, startOfLocalDay(input.date, tz)),
          lt(lesson.startsAt, startOfLocalDay(addDays(input.date, 1), tz)),
          input.venueId ? eq(lesson.venueId, input.venueId) : undefined,
        ),
      );
    const reason = input.reason ?? "Rain-out";
    for (const r of rows) await cancelLesson(ctx, r.id, reason);
    await auditEntry(ctx, "rain_out", "lesson", null, {
      date: input.date,
      venueId: input.venueId,
      count: rows.length,
    });
    return c.json({ cancelled: rows.length });
  })

  .post("/lessons/:id/participants", v("json", participantSchema), async (c) => {
    const ctx = ctxOf(c);
    const current = await loadLesson(ctx, c.req.param("id"));
    if (current.status === "cancelled") throw conflict("This session was cancelled.");
    const { clientId } = c.req.valid("json");
    const who = await ctx.db.query.client.findFirst({
      where: and(eq(client.id, clientId), eq(client.workspaceId, ctx.workspaceId)),
    });
    if (!who) throw notFound("Client");
    const detail = await lessonDetail(ctx, current.id);
    const existing = detail.roster.find((r) => r.clientId === clientId);
    if (existing && existing.status !== "excused" && existing.status !== "late_cancel") {
      return c.json(detail);
    }
    if (
      current.capacity &&
      detail.lesson.bookedCount >= current.capacity &&
      c.req.query("force") !== "1"
    ) {
      throw conflict("This session is full.", { code: "full" });
    }
    if (existing) {
      await changeAttendance(ctx, {
        attendanceId: existing.attendanceId,
        status: "booked",
        mutationId: uuidv7(),
      });
    } else {
      await ctx.db.insert(attendance).values({
        id: uuidv7(),
        workspaceId: ctx.workspaceId,
        lessonId: current.id,
        clientId,
        status: "booked",
      });
    }
    return c.json(await lessonDetail(ctx, current.id), 201);
  })

  .delete("/lessons/:id/participants/:clientId", async (c) => {
    const ctx = ctxOf(c);
    const current = await loadLesson(ctx, c.req.param("id"));
    const row = await ctx.db.query.attendance.findFirst({
      where: and(
        eq(attendance.lessonId, current.id),
        eq(attendance.clientId, c.req.param("clientId")),
      ),
    });
    if (!row) throw notFound("Booking");
    if (row.consumedPackageId || row.chargeId) {
      throw conflict("Undo this player's check-in before removing them.");
    }
    await ctx.db.delete(attendance).where(eq(attendance.id, row.id));
    return c.json(await lessonDetail(ctx, current.id));
  })

  .post("/attendance/:id", v("json", attendanceUpdateSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    return idempotent(c, async () => {
      const result = await changeAttendance(ctx, {
        attendanceId: c.req.param("id"),
        status: input.status,
        packageId: input.packageId,
        complimentary: input.complimentary,
        note: input.note,
        mutationId: input.mutationId,
      });
      return c.json({ replay: result.replay, lesson: await lessonDetail(ctx, result.lessonId) });
    });
  });
