import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { can } from "../../shared/roles";
import { coachProfileUpdateSchema } from "../../shared/schemas";
import { coachProfile } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { notFound } from "../lib/errors";
import { publicKey, readImage } from "../lib/uploads";
import { v } from "../lib/validate";
import { assertCan, ctxOf } from "../middleware";
import { ensureCoachProfile, staffRows, toCoachProfile, toCoachSummary } from "../services/coaches";
import { runBatch } from "../services/credits";
import type { AppBindings, Ctx } from "../types";

/** Yourself, or anyone on the team when you manage it (`team`). */
async function targetCoach(c: Context<AppBindings>) {
  const ctx = ctxOf(c);
  const userId = c.req.param("userId") ?? "";
  if (userId !== ctx.userId && !can(ctx.role, "team")) {
    // Drain the body first: Miniflare's local proxy can fail a request answered unread.
    if (c.req.method !== "GET") await c.req.raw.arrayBuffer().catch(() => undefined);
    assertCan(ctx.role, "team");
  }
  const row = (await staffRows(ctx.db, ctx.workspaceId)).find((s) => s.userId === userId);
  if (!row) throw notFound("Coach");
  // Members from before profiles existed get one before their first change (reads use defaults).
  if (c.req.method !== "GET" && !row.profileId) {
    await ensureCoachProfile(ctx.db, ctx.workspaceId, userId);
  }
  return { ctx, row };
}

async function loadProfile(ctx: Ctx, userId: string) {
  const row = (await staffRows(ctx.db, ctx.workspaceId)).find((s) => s.userId === userId);
  if (!row) throw notFound("Coach");
  return toCoachProfile(row);
}

const profileWhere = (ctx: Ctx, userId: string) =>
  and(eq(coachProfile.workspaceId, ctx.workspaceId), eq(coachProfile.userId, userId));

/** The id of a member's coach profile (made by `targetCoach` for changes, if it was missing). */
async function profileIdOf(ctx: Ctx, userId: string): Promise<string> {
  const p = await ctx.db.query.coachProfile.findFirst({
    where: profileWhere(ctx, userId),
    columns: { id: true },
  });
  if (!p) throw notFound("Coach");
  return p.id;
}

/**
 * Coach profiles (staff API). Everyone on the team lists the team with their roles (names and
 * avatars for everyone; coach pickers offer only people who coach); each person edits their own
 * profile, and people who manage the team (`team`) edit anyone's. Photos (square) and team page
 * photos (half-body, 4:5) are public R2 keys (ws/<id>/public/coaches/…) because the academy's public
 * pages show them.
 */
export const coachRoutes = new Hono<AppBindings>()
  .get("/coaches", async (c) => {
    const rows = await staffRows(c.var.db, c.var.workspaceId);
    return c.json(rows.map(toCoachSummary));
  })

  .get("/coaches/:userId", async (c) => {
    const { ctx, row } = await targetCoach(c);
    return c.json(await loadProfile(ctx, row.userId));
  })

  .patch("/coaches/:userId", v("json", coachProfileUpdateSchema), async (c) => {
    const { ctx, row } = await targetCoach(c);
    const input = c.req.valid("json");
    // The order coaches appear in on the academy page is the academy's call.
    if (input.sortOrder !== undefined) assertCan(ctx.role, "team");
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) if (value !== undefined) set[key] = value;
    if (Object.keys(set).length) {
      await runBatch(ctx, [
        ctx.db.update(coachProfile).set(set).where(profileWhere(ctx, row.userId)),
        auditEntry(ctx, "update", "coach_profile", row.userId, { fields: Object.keys(set) }),
      ]);
    }
    return c.json(await loadProfile(ctx, row.userId));
  })

  .put("/coaches/:userId/photo", async (c) => {
    const { ctx, row } = await targetCoach(c);
    const image = await readImage(c, "photo");
    const key = publicKey.coachPhoto(
      ctx.workspaceId,
      row.profileId ?? (await profileIdOf(ctx, row.userId)),
      image.ext,
    );
    await ctx.env.FILES.put(key, image.body, { httpMetadata: { contentType: image.type } });
    await ctx.db.update(coachProfile).set({ photoKey: key }).where(profileWhere(ctx, row.userId));
    if (row.photoKey) await ctx.env.FILES.delete(row.photoKey);
    return c.json({ photoKey: key });
  })

  .delete("/coaches/:userId/photo", async (c) => {
    const { ctx, row } = await targetCoach(c);
    await ctx.db.update(coachProfile).set({ photoKey: null }).where(profileWhere(ctx, row.userId));
    if (row.photoKey) await ctx.env.FILES.delete(row.photoKey);
    return c.body(null, 204);
  })

  /**
   * The half-body team page photo (whole, aspect kept; its framing places it in each frame).
   * Replacing it deletes the old one and resets the framing.
   */
  .put("/coaches/:userId/portrait", async (c) => {
    const { ctx, row } = await targetCoach(c);
    const image = await readImage(c, "photo");
    const key = publicKey.coachPortrait(
      ctx.workspaceId,
      row.profileId ?? (await profileIdOf(ctx, row.userId)),
      image.ext,
    );
    await ctx.env.FILES.put(key, image.body, { httpMetadata: { contentType: image.type } });
    await runBatch(ctx, [
      ctx.db
        .update(coachProfile)
        .set({ portraitKey: key, portraitFraming: null })
        .where(profileWhere(ctx, row.userId)),
      auditEntry(ctx, "upload", "coach_portrait", row.userId),
    ]);
    if (row.portraitKey) await ctx.env.FILES.delete(row.portraitKey);
    return c.json({ portraitKey: key });
  })

  .delete("/coaches/:userId/portrait", async (c) => {
    const { ctx, row } = await targetCoach(c);
    if (row.portraitKey) {
      await runBatch(ctx, [
        ctx.db
          .update(coachProfile)
          .set({ portraitKey: null, portraitFraming: null })
          .where(profileWhere(ctx, row.userId)),
        auditEntry(ctx, "remove", "coach_portrait", row.userId),
      ]);
      await ctx.env.FILES.delete(row.portraitKey);
    }
    return c.body(null, 204);
  });
