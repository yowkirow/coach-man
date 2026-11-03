import { and, asc, desc, eq, max } from "drizzle-orm";
import { Hono } from "hono";
import type {
  AssessmentDto,
  GoalDto,
  ProgressDto,
  RatingDto,
  SkillDto,
} from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import {
  assessmentSchema,
  goalSchema,
  noteSchema,
  noteUpdateSchema,
  ratingSchema,
  skillOrderSchema,
  skillSchema,
} from "../../shared/schemas";
import { todayIn } from "../../shared/time";
import { chunkRows } from "../db/client";
import {
  assessment,
  assessmentScore,
  client,
  goal,
  lesson,
  note,
  ratingSnapshot,
  skill,
} from "../db/schema";
import { badRequest, notFound } from "../lib/errors";
import { idempotent } from "../lib/idempotency";
import { inList, unique } from "../lib/sql";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import { runBatch } from "../services/credits";
import { toNoteDto } from "../services/lessons";
import type { AppBindings, Ctx } from "../types";

const toSkillDto = (s: typeof skill.$inferSelect): SkillDto => ({
  id: s.id,
  category: s.category,
  name: s.name,
  description: s.description,
  sortOrder: s.sortOrder,
  active: s.active,
});

const toGoalDto = (g: typeof goal.$inferSelect): GoalDto => ({
  id: g.id,
  title: g.title,
  detail: g.detail,
  targetDate: g.targetDate,
  status: g.status,
  achievedOn: g.achievedOn,
  createdAt: g.createdAt,
});

const toRatingDto = (r: typeof ratingSnapshot.$inferSelect): RatingDto => ({
  id: r.id,
  source: r.source,
  value: r.value,
  recordedOn: r.recordedOn,
});

async function ensureClient(ctx: Ctx, id: string) {
  const row = await ctx.db.query.client.findFirst({
    where: and(eq(client.id, id), eq(client.workspaceId, ctx.workspaceId)),
  });
  if (!row) throw notFound("Client");
  return row;
}

async function validateSkills(ctx: Ctx, skillIds: string[]) {
  const ids = unique(skillIds);
  if (!ids.length) return;
  const found = await ctx.db
    .select({ id: skill.id })
    .from(skill)
    .where(and(eq(skill.workspaceId, ctx.workspaceId), inList(skill.id, ids)));
  if (found.length !== ids.length) throw badRequest("Some skills were not found.");
}

function scoreRows(
  ctx: Ctx,
  assessmentId: string,
  scores: { skillId: string; score: number; note?: string | null }[],
) {
  return scores.map((s) => ({
    id: uuidv7(),
    workspaceId: ctx.workspaceId,
    assessmentId,
    skillId: s.skillId,
    score: s.score,
    note: s.note ?? null,
  }));
}

async function loadProgress(ctx: Ctx, clientId: string): Promise<ProgressDto> {
  const { db, workspaceId } = ctx;
  const [skills, assessments, scores, goals, ratings, notes] = await Promise.all([
    db.select().from(skill).where(eq(skill.workspaceId, workspaceId)).orderBy(asc(skill.sortOrder)),
    db
      .select()
      .from(assessment)
      .where(and(eq(assessment.workspaceId, workspaceId), eq(assessment.clientId, clientId)))
      .orderBy(asc(assessment.assessedOn), asc(assessment.createdAt)),
    db
      .select({ s: assessmentScore })
      .from(assessmentScore)
      .innerJoin(assessment, eq(assessment.id, assessmentScore.assessmentId))
      .where(and(eq(assessment.workspaceId, workspaceId), eq(assessment.clientId, clientId))),
    db
      .select()
      .from(goal)
      .where(and(eq(goal.workspaceId, workspaceId), eq(goal.clientId, clientId)))
      .orderBy(asc(goal.status), desc(goal.createdAt)),
    db
      .select()
      .from(ratingSnapshot)
      .where(
        and(eq(ratingSnapshot.workspaceId, workspaceId), eq(ratingSnapshot.clientId, clientId)),
      )
      .orderBy(asc(ratingSnapshot.recordedOn)),
    db
      .select()
      .from(note)
      .where(and(eq(note.workspaceId, workspaceId), eq(note.clientId, clientId)))
      .orderBy(desc(note.pinned), desc(note.createdAt))
      .limit(200),
  ]);
  return {
    skills: skills.map(toSkillDto),
    assessments: assessments.map(
      (a): AssessmentDto => ({
        id: a.id,
        assessedOn: a.assessedOn,
        overallLevel: a.overallLevel,
        notes: a.notes,
        lessonId: a.lessonId,
        scores: scores
          .filter((s) => s.s.assessmentId === a.id)
          .map((s) => ({ skillId: s.s.skillId, score: s.s.score, note: s.s.note })),
      }),
    ),
    goals: goals.map(toGoalDto),
    ratings: ratings.map(toRatingDto),
    notes: notes.map(toNoteDto),
  };
}

export const progressRoutes = new Hono<AppBindings>()
  .get("/skills", async (c) => {
    const rows = await c.var.db
      .select()
      .from(skill)
      .where(eq(skill.workspaceId, c.var.workspaceId))
      .orderBy(asc(skill.sortOrder));
    return c.json(rows.map(toSkillDto));
  })

  .post("/skills", requireCap("settings"), v("json", skillSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const [top] = await ctx.db
      .select({ n: max(skill.sortOrder) })
      .from(skill)
      .where(eq(skill.workspaceId, ctx.workspaceId));
    const id = input.id ?? uuidv7();
    await ctx.db.insert(skill).values({
      id,
      workspaceId: ctx.workspaceId,
      category: input.category,
      name: input.name,
      description: input.description ?? null,
      sortOrder: (top?.n ?? -1) + 1,
      active: input.active ?? true,
    });
    const row = await ctx.db.query.skill.findFirst({ where: eq(skill.id, id) });
    return c.json(toSkillDto(row as typeof skill.$inferSelect), 201);
  })

  .patch("/skills/:id", requireCap("settings"), v("json", skillSchema.partial()), async (c) => {
    const { id: _ignored, ...input } = c.req.valid("json");
    const res = await c.var.db
      .update(skill)
      .set(input)
      .where(and(eq(skill.id, c.req.param("id")), eq(skill.workspaceId, c.var.workspaceId)))
      .returning();
    if (!res[0]) throw notFound("Skill");
    return c.json(toSkillDto(res[0]));
  })

  .post("/skills/reorder", requireCap("settings"), v("json", skillOrderSchema), async (c) => {
    const ctx = ctxOf(c);
    const { ids } = c.req.valid("json");
    await validateSkills(ctx, ids);
    await runBatch(
      ctx,
      ids.map((id, i) =>
        ctx.db
          .update(skill)
          .set({ sortOrder: i })
          .where(and(eq(skill.id, id), eq(skill.workspaceId, ctx.workspaceId))),
      ),
    );
    return c.body(null, 204);
  })

  .get("/clients/:id/progress", async (c) => {
    const ctx = ctxOf(c);
    await ensureClient(ctx, c.req.param("id"));
    return c.json(await loadProgress(ctx, c.req.param("id")));
  })

  .post("/clients/:id/assessments", v("json", assessmentSchema), async (c) => {
    const ctx = ctxOf(c);
    const clientId = c.req.param("id");
    await ensureClient(ctx, clientId);
    const input = c.req.valid("json");
    await validateSkills(
      ctx,
      input.scores.map((s) => s.skillId),
    );
    const id = input.id ?? uuidv7();
    await runBatch(ctx, [
      ctx.db.insert(assessment).values({
        id,
        workspaceId: ctx.workspaceId,
        clientId,
        assessedOn: input.assessedOn,
        overallLevel: input.overallLevel ?? null,
        notes: input.notes ?? null,
        lessonId: input.lessonId ?? null,
        createdBy: ctx.userId,
      }),
      ...chunkRows(scoreRows(ctx, id, input.scores), 6).map((rows) =>
        ctx.db.insert(assessmentScore).values(rows),
      ),
      ...(input.overallLevel
        ? [ctx.db.update(client).set({ level: input.overallLevel }).where(eq(client.id, clientId))]
        : []),
    ]);
    return c.json(await loadProgress(ctx, clientId), 201);
  })

  .patch("/assessments/:id", v("json", assessmentSchema), async (c) => {
    const ctx = ctxOf(c);
    const row = await ctx.db.query.assessment.findFirst({
      where: and(eq(assessment.id, c.req.param("id")), eq(assessment.workspaceId, ctx.workspaceId)),
    });
    if (!row) throw notFound("Assessment");
    const input = c.req.valid("json");
    await validateSkills(
      ctx,
      input.scores.map((s) => s.skillId),
    );
    await runBatch(ctx, [
      ctx.db
        .update(assessment)
        .set({
          assessedOn: input.assessedOn,
          overallLevel: input.overallLevel ?? null,
          notes: input.notes ?? null,
        })
        .where(eq(assessment.id, row.id)),
      ctx.db.delete(assessmentScore).where(eq(assessmentScore.assessmentId, row.id)),
      ...chunkRows(scoreRows(ctx, row.id, input.scores), 6).map((rows) =>
        ctx.db.insert(assessmentScore).values(rows),
      ),
    ]);
    return c.json(await loadProgress(ctx, row.clientId));
  })

  .delete("/assessments/:id", async (c) => {
    const ctx = ctxOf(c);
    const row = await ctx.db.query.assessment.findFirst({
      where: and(eq(assessment.id, c.req.param("id")), eq(assessment.workspaceId, ctx.workspaceId)),
    });
    if (!row) throw notFound("Assessment");
    await ctx.db.delete(assessment).where(eq(assessment.id, row.id));
    return c.json(await loadProgress(ctx, row.clientId));
  })

  .post("/clients/:id/goals", v("json", goalSchema), async (c) => {
    const ctx = ctxOf(c);
    const clientId = c.req.param("id");
    await ensureClient(ctx, clientId);
    const input = c.req.valid("json");
    await ctx.db.insert(goal).values({
      id: input.id ?? uuidv7(),
      workspaceId: ctx.workspaceId,
      clientId,
      title: input.title,
      detail: input.detail ?? null,
      targetDate: input.targetDate ?? null,
      status: input.status ?? "active",
    });
    return c.json(await loadProgress(ctx, clientId), 201);
  })

  .patch("/goals/:id", v("json", goalSchema.partial()), async (c) => {
    const ctx = ctxOf(c);
    const row = await ctx.db.query.goal.findFirst({
      where: and(eq(goal.id, c.req.param("id")), eq(goal.workspaceId, ctx.workspaceId)),
    });
    if (!row) throw notFound("Goal");
    const { id: _ignored, ...input } = c.req.valid("json");
    const achievedOn =
      input.status === "achieved"
        ? (row.achievedOn ?? todayIn(ctx.settings.timezone))
        : input.status
          ? null
          : row.achievedOn;
    await ctx.db
      .update(goal)
      .set({ ...input, achievedOn })
      .where(eq(goal.id, row.id));
    return c.json(await loadProgress(ctx, row.clientId));
  })

  .delete("/goals/:id", async (c) => {
    const ctx = ctxOf(c);
    const row = await ctx.db.query.goal.findFirst({
      where: and(eq(goal.id, c.req.param("id")), eq(goal.workspaceId, ctx.workspaceId)),
    });
    if (!row) throw notFound("Goal");
    await ctx.db.delete(goal).where(eq(goal.id, row.id));
    return c.json(await loadProgress(ctx, row.clientId));
  })

  .post("/clients/:id/ratings", v("json", ratingSchema), async (c) => {
    const ctx = ctxOf(c);
    const clientId = c.req.param("id");
    await ensureClient(ctx, clientId);
    const input = c.req.valid("json");
    await runBatch(ctx, [
      ctx.db.insert(ratingSnapshot).values({
        id: input.id ?? uuidv7(),
        workspaceId: ctx.workspaceId,
        clientId,
        source: input.source,
        value: input.value,
        recordedOn: input.recordedOn,
      }),
      ...(input.source === "dupr"
        ? [ctx.db.update(client).set({ duprRating: input.value }).where(eq(client.id, clientId))]
        : []),
    ]);
    return c.json(await loadProgress(ctx, clientId), 201);
  })

  .delete("/ratings/:id", async (c) => {
    const ctx = ctxOf(c);
    const row = await ctx.db.query.ratingSnapshot.findFirst({
      where: and(
        eq(ratingSnapshot.id, c.req.param("id")),
        eq(ratingSnapshot.workspaceId, ctx.workspaceId),
      ),
    });
    if (!row) throw notFound("Rating");
    await ctx.db.delete(ratingSnapshot).where(eq(ratingSnapshot.id, row.id));
    return c.json(await loadProgress(ctx, row.clientId));
  })

  .post("/notes", v("json", noteSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    return idempotent(c, async () => {
      if (input.clientId) await ensureClient(ctx, input.clientId);
      if (input.lessonId) {
        const l = await ctx.db.query.lesson.findFirst({
          where: and(eq(lesson.id, input.lessonId), eq(lesson.workspaceId, ctx.workspaceId)),
        });
        if (!l) throw notFound("Session");
      }
      const id = input.id ?? uuidv7();
      const existing = await ctx.db.query.note.findFirst({ where: eq(note.id, id) });
      if (!existing) {
        await ctx.db.insert(note).values({
          id,
          workspaceId: ctx.workspaceId,
          clientId: input.clientId ?? null,
          lessonId: input.lessonId ?? null,
          body: input.body,
          pinned: input.pinned ?? false,
          createdBy: ctx.userId,
        });
      }
      const row = await ctx.db.query.note.findFirst({ where: eq(note.id, id) });
      return c.json(toNoteDto(row as typeof note.$inferSelect), 201);
    });
  })

  .patch("/notes/:id", v("json", noteUpdateSchema), async (c) => {
    const res = await c.var.db
      .update(note)
      .set(c.req.valid("json"))
      .where(and(eq(note.id, c.req.param("id")), eq(note.workspaceId, c.var.workspaceId)))
      .returning();
    if (!res[0]) throw notFound("Note");
    return c.json(toNoteDto(res[0]));
  })

  .delete("/notes/:id", async (c) => {
    const res = await c.var.db
      .delete(note)
      .where(and(eq(note.id, c.req.param("id")), eq(note.workspaceId, c.var.workspaceId)))
      .returning({ id: note.id });
    if (!res[0]) throw notFound("Note");
    return c.body(null, 204);
  });
