import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { TeamPersonDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import {
  teamPageOrderSchema,
  teamPersonSchema,
  teamPersonUpdateSchema,
} from "../../shared/schemas";
import { coachProfile, teamPerson } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { drainBody } from "../lib/drain";
import { notFound } from "../lib/errors";
import { reorderTeamPage } from "../lib/team-page";
import { publicKey, readImage } from "../lib/uploads";
import { v } from "../lib/validate";
import { teamPageEnd } from "../lib/workspace";
import { ctxOf, requireCap } from "../middleware";
import { runBatch } from "../services/credits";
import {
  findTeamPerson,
  loadTeamPage,
  placedEntries,
  toTeamPersonDto,
} from "../services/team-page";
import type { AppBindings, Ctx } from "../types";

const personWhere = (ctx: Ctx, id: string) =>
  and(eq(teamPerson.id, id), eq(teamPerson.workspaceId, ctx.workspaceId));

/** The person in the path (404 otherwise, with the request's body read first). */
async function personOf(c: Context<AppBindings>) {
  const ctx = ctxOf(c);
  try {
    return { ctx, row: await findTeamPerson(ctx, c.req.param("id") ?? "") };
  } catch (err) {
    await drainBody(c);
    throw err;
  }
}

/** `sort_order` from a JSON object of `key → index`, for the row whose `column` is the key. */
const rankFrom = (ranks: string, column: string) =>
  sql`(select value from json_each(${ranks}) where key = ${sql.raw(column)})`;
const rankedRow = (ranks: string, column: string) =>
  sql`${sql.raw(column)} in (select key from json_each(${ranks}))`;

/**
 * The academy's team page (staff API, `team`): who it shows, in what order, and the people on it
 * who don't sign in to CoachMan (display-only), with their team page photos. Staff coach profiles
 * are edited through /coaches; the order spans both. Every change is audited.
 */
export const teamPageRoutes = new Hono<AppBindings>()
  .get("/team-page", requireCap("team"), async (c) => c.json(await loadTeamPage(ctxOf(c))))

  /** A display-only person, added at the end of the page. */
  .post("/team-page/people", requireCap("team"), v("json", teamPersonSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const id = uuidv7();
    await runBatch(ctx, [
      ctx.db.insert(teamPerson).values({
        ...input,
        id,
        workspaceId: ctx.workspaceId,
        sortOrder: await teamPageEnd(ctx.db, ctx.workspaceId),
        createdBy: ctx.userId,
      }),
      auditEntry(ctx, "create", "team_person", id, { name: input.name }),
    ]);
    return c.json<TeamPersonDto>(toTeamPersonDto(await findTeamPerson(ctx, id)), 201);
  })

  .get("/team-page/people/:id", requireCap("team"), async (c) => {
    const { row } = await personOf(c);
    return c.json<TeamPersonDto>(toTeamPersonDto(row));
  })

  .patch(
    "/team-page/people/:id",
    requireCap("team"),
    v("json", teamPersonUpdateSchema),
    async (c) => {
      const { ctx, row } = await personOf(c);
      const set: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(c.req.valid("json"))) {
        if (value !== undefined) set[key] = value;
      }
      if (Object.keys(set).length) {
        await runBatch(ctx, [
          ctx.db.update(teamPerson).set(set).where(personWhere(ctx, row.id)),
          auditEntry(ctx, "update", "team_person", row.id, { fields: Object.keys(set) }),
        ]);
      }
      return c.json<TeamPersonDto>(toTeamPersonDto(await findTeamPerson(ctx, row.id)));
    },
  )

  /** Takes them off the page for good, with their photo. */
  .delete("/team-page/people/:id", requireCap("team"), async (c) => {
    const { ctx, row } = await personOf(c);
    await runBatch(ctx, [
      ctx.db.delete(teamPerson).where(personWhere(ctx, row.id)),
      auditEntry(ctx, "delete", "team_person", row.id, { name: row.name }),
    ]);
    if (row.portraitKey) await ctx.env.FILES.delete(row.portraitKey);
    return c.body(null, 204);
  })

  /** Their team page photo (the app crops it 4:5); replacing it deletes the old one. */
  .put("/team-page/people/:id/portrait", requireCap("team"), async (c) => {
    const { ctx, row } = await personOf(c);
    const image = await readImage(c, "photo");
    const key = publicKey.teamPersonPortrait(ctx.workspaceId, row.id, image.ext);
    await ctx.env.FILES.put(key, image.body, { httpMetadata: { contentType: image.type } });
    const [updated] = await ctx.db
      .update(teamPerson)
      .set({ portraitKey: key })
      .where(personWhere(ctx, row.id))
      .returning({ id: teamPerson.id });
    if (!updated) {
      // Deleted a moment ago: don't leave the new photo behind.
      await ctx.env.FILES.delete(key);
      throw notFound("Person");
    }
    await auditEntry(ctx, "upload", "team_person_portrait", row.id);
    if (row.portraitKey) await ctx.env.FILES.delete(row.portraitKey);
    return c.json({ portraitKey: key });
  })

  .delete("/team-page/people/:id/portrait", requireCap("team"), async (c) => {
    const { ctx, row } = await personOf(c);
    if (row.portraitKey) {
      await runBatch(ctx, [
        ctx.db.update(teamPerson).set({ portraitKey: null }).where(personWhere(ctx, row.id)),
        auditEntry(ctx, "remove", "team_person_portrait", row.id),
      ]);
      await ctx.env.FILES.delete(row.portraitKey);
    }
    return c.body(null, 204);
  })

  /**
   * The page's order, top to bottom: `sort_order` becomes each entry's place, for staff (on their
   * coach profile, made first if they have none yet) and display-only people alike. People the
   * request leaves out keep their order after the ones it names; unknown ids are ignored.
   */
  .put("/team-page/order", requireCap("team"), v("json", teamPageOrderSchema), async (c) => {
    const ctx = ctxOf(c);
    const { entries } = c.req.valid("json");
    const next = reorderTeamPage(await placedEntries(ctx), entries);
    const staffRanks: Record<string, number> = {};
    const personRanks: Record<string, number> = {};
    const missing: { userId: string; rank: number }[] = [];
    next.forEach((p, rank) => {
      if (p.kind === "listed") personRanks[p.id] = rank;
      else {
        staffRanks[p.id] = rank;
        if (!p.hasProfile) missing.push({ userId: p.id, rank });
      }
    });
    const staffJson = JSON.stringify(staffRanks);
    const personJson = JSON.stringify(personRanks);
    await runBatch(ctx, [
      ...missing.map((m) =>
        ctx.db
          .insert(coachProfile)
          .values({
            id: uuidv7(),
            workspaceId: ctx.workspaceId,
            userId: m.userId,
            sortOrder: m.rank,
          })
          .onConflictDoNothing(),
      ),
      ctx.db
        .update(coachProfile)
        .set({ sortOrder: rankFrom(staffJson, '"coach_profile"."user_id"') })
        .where(
          and(
            eq(coachProfile.workspaceId, ctx.workspaceId),
            rankedRow(staffJson, '"coach_profile"."user_id"'),
          ),
        ),
      ctx.db
        .update(teamPerson)
        .set({ sortOrder: rankFrom(personJson, '"team_person"."id"') })
        .where(
          and(
            eq(teamPerson.workspaceId, ctx.workspaceId),
            rankedRow(personJson, '"team_person"."id"'),
          ),
        ),
      auditEntry(ctx, "reorder", "team_page", null, { entries: next.length }),
    ]);
    return c.json(await loadTeamPage(ctx));
  });
