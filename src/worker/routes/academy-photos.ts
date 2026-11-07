import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { isPhotoOrder, MAX_ACADEMY_PHOTOS, PHOTO_LIMIT_MESSAGE } from "../../shared/academy-photos";
import type { AcademyPhotoDto } from "../../shared/api-types";
import type { PhotoFraming } from "../../shared/framing";
import { uuidv7 } from "../../shared/ids";
import { academyPhotoOrderSchema, academyPhotoUpdateSchema } from "../../shared/schemas";
import { academyPhoto } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { drainBody } from "../lib/drain";
import { badRequest } from "../lib/errors";
import { publicKey, readImage } from "../lib/uploads";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import {
  academyPhotos,
  findAcademyPhoto,
  loadAcademyPhotos,
  toAcademyPhotoDto,
} from "../services/academy-photos";
import { runBatch } from "../services/credits";
import type { AppBindings, Ctx } from "../types";

const photoWhere = (ctx: Ctx, id: string) =>
  and(eq(academyPhoto.id, id), eq(academyPhoto.workspaceId, ctx.workspaceId));

/** How many photos the academy has, as a SQL value. */
const photoCount = (workspaceId: string) =>
  sql<number>`(select count(*) from ${academyPhoto} where ${academyPhoto.workspaceId} = ${workspaceId})`;

/** The photo in the path (404 otherwise, with the request's body read first). */
async function photoOf(c: Context<AppBindings>) {
  const ctx = ctxOf(c);
  try {
    return { ctx, row: await findAcademyPhoto(ctx, c.req.param("id") ?? "") };
  } catch (err) {
    await drainBody(c);
    throw err;
  }
}

/**
 * The academy's website photos (staff API): courts, sessions, and camps, shown on its public page
 * in the order it sets, each with an optional caption. Everyone on the team reads them; owners and
 * admins (`settings`) add, caption, reorder, and remove them. The files are public R2 keys under
 * `ws/<id>/public/photos/`; every change is audited.
 */
export const academyPhotoRoutes = new Hono<AppBindings>()
  .get("/academy/photos", async (c) => c.json<AcademyPhotoDto[]>(await loadAcademyPhotos(ctxOf(c))))

  /** A new photo (the image is the body), at the end of the order. */
  .post("/academy/photos", requireCap("settings"), async (c) => {
    const ctx = ctxOf(c);
    const [{ count } = { count: 0 }] = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(academyPhoto)
      .where(eq(academyPhoto.workspaceId, ctx.workspaceId));
    if (Number(count) >= MAX_ACADEMY_PHOTOS) {
      await drainBody(c);
      throw badRequest(PHOTO_LIMIT_MESSAGE);
    }
    const image = await readImage(c, "photo");
    const id = uuidv7();
    const key = publicKey.academyPhoto(ctx.workspaceId, image.ext);
    await ctx.env.FILES.put(key, image.body, { httpMetadata: { contentType: image.type } });
    const now = Date.now();
    // The limit is checked again inside the insert, so two uploads at once can't pass it. The
    // values follow the table's column order: id, workspace, key, caption, framing, place,
    // created, updated.
    const [row] = await ctx.db
      .insert(academyPhoto)
      .select(
        sql`select ${id}, ${ctx.workspaceId}, ${key}, null, null, (select coalesce(max(${academyPhoto.sortOrder}), -1) + 1 from ${academyPhoto} where ${academyPhoto.workspaceId} = ${ctx.workspaceId}), ${now}, ${now} where ${photoCount(ctx.workspaceId)} < ${MAX_ACADEMY_PHOTOS}`,
      )
      .returning();
    if (!row) {
      await ctx.env.FILES.delete(key);
      throw badRequest(PHOTO_LIMIT_MESSAGE);
    }
    await auditEntry(ctx, "upload", "academy_photo", row.id);
    return c.json<AcademyPhotoDto>(toAcademyPhotoDto(row), 201);
  })

  /** Its caption (trimmed; empty clears it) and where it sits in its frames. */
  .patch(
    "/academy/photos/:id",
    requireCap("settings"),
    v("json", academyPhotoUpdateSchema),
    async (c) => {
      const { ctx, row } = await photoOf(c);
      const { caption, framing } = c.req.valid("json");
      const set: { caption?: string | null; framing?: PhotoFraming | null } = {};
      if (caption !== undefined && caption !== row.caption) set.caption = caption;
      if (framing !== undefined) set.framing = framing;
      if (Object.keys(set).length) {
        await runBatch(ctx, [
          ctx.db.update(academyPhoto).set(set).where(photoWhere(ctx, row.id)),
          auditEntry(ctx, "update", "academy_photo", row.id, { fields: Object.keys(set) }),
        ]);
      }
      return c.json<AcademyPhotoDto>(toAcademyPhotoDto(await findAcademyPhoto(ctx, row.id)));
    },
  )

  /**
   * The photos' order, first to last: the request names every one of the academy's photos once
   * (otherwise 400, so a stale order never hides a photo added meanwhile). Answers the photos.
   */
  .put(
    "/academy/photos/order",
    requireCap("settings"),
    v("json", academyPhotoOrderSchema),
    async (c) => {
      const ctx = ctxOf(c);
      const { ids } = c.req.valid("json");
      const current = (await academyPhotos(ctx.db, ctx.workspaceId)).map((p) => p.id);
      if (!isPhotoOrder(current, ids)) {
        throw badRequest("List each of your photos once, in the new order.");
      }
      if (ids.length) {
        await runBatch(ctx, [
          ...ids.map((photoId, i) =>
            ctx.db.update(academyPhoto).set({ sortOrder: i }).where(photoWhere(ctx, photoId)),
          ),
          auditEntry(ctx, "reorder", "academy_photos", null, { photos: ids.length }),
        ]);
      }
      return c.json<AcademyPhotoDto[]>(await loadAcademyPhotos(ctx));
    },
  )

  /** Takes the photo off the website for good, with its file. */
  .delete("/academy/photos/:id", requireCap("settings"), async (c) => {
    const { ctx, row } = await photoOf(c);
    await runBatch(ctx, [
      ctx.db.delete(academyPhoto).where(photoWhere(ctx, row.id)),
      auditEntry(ctx, "delete", "academy_photo", row.id),
    ]);
    await ctx.env.FILES.delete(row.key);
    return c.body(null, 204);
  });
