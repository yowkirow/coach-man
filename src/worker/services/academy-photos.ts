import { and, asc, eq } from "drizzle-orm";
import type { AcademyPhotoDto } from "../../shared/api-types";
import type { Db } from "../db/client";
import { academyPhoto } from "../db/schema";
import { notFound } from "../lib/errors";
import type { Ctx } from "../types";

export type AcademyPhotoRow = typeof academyPhoto.$inferSelect;

export function toAcademyPhotoDto(p: AcademyPhotoRow): AcademyPhotoDto {
  return {
    id: p.id,
    key: p.key,
    caption: p.caption,
    framing: p.framing ?? null,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
  };
}

/** The academy's website photos in its order: by place, then the oldest first. */
export function academyPhotos(db: Db, workspaceId: string) {
  return db
    .select()
    .from(academyPhoto)
    .where(eq(academyPhoto.workspaceId, workspaceId))
    .orderBy(asc(academyPhoto.sortOrder), asc(academyPhoto.createdAt), asc(academyPhoto.id));
}

/** GET /academy/photos: the website photos, in order. */
export async function loadAcademyPhotos(
  ctx: Pick<Ctx, "db" | "workspaceId">,
): Promise<AcademyPhotoDto[]> {
  return (await academyPhotos(ctx.db, ctx.workspaceId)).map(toAcademyPhotoDto);
}

/** One of the academy's website photos, or 404 (another academy's photo included). */
export async function findAcademyPhoto(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  id: string,
): Promise<AcademyPhotoRow> {
  const row = await ctx.db.query.academyPhoto.findFirst({
    where: and(eq(academyPhoto.id, id), eq(academyPhoto.workspaceId, ctx.workspaceId)),
  });
  if (!row) throw notFound("Photo");
  return row;
}
