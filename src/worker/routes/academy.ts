import { and, eq, ne } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AcademyDto, PublicAcademyPreviewDto } from "../../shared/api-types";
import { ACADEMY_SOCIALS, type AcademySocial, isAcademySlug } from "../../shared/domain";
import { academyUpdateSchema } from "../../shared/schemas";
import type { Db } from "../db/client";
import { academyProfile, organization } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { conflict, notFound } from "../lib/errors";
import { publicKey, readImage } from "../lib/uploads";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import { runBatch } from "../services/credits";
import { loadPublicAcademy } from "../services/public-academy";
import type { AppBindings } from "../types";

type ProfileRow = typeof academyProfile.$inferSelect;

/** The academy's profile row, created on first use (and at provisioning). */
export async function ensureAcademyProfile(db: Db, workspaceId: string): Promise<ProfileRow> {
  const find = () =>
    db.query.academyProfile.findFirst({ where: eq(academyProfile.workspaceId, workspaceId) });
  const existing = await find();
  if (existing) return existing;
  await db.insert(academyProfile).values({ workspaceId }).onConflictDoNothing();
  const row = await find();
  if (!row) throw notFound("Academy");
  return row;
}

export const appOrigin = (env: Env) => env.APP_URL.replace(/\/+$/, "");

export function toAcademyDto(
  org: { id: string; name: string; slug: string },
  p: ProfileRow,
  env: Env,
): AcademyDto {
  const base = `${appOrigin(env)}/a/`;
  const socials: Partial<Record<AcademySocial, string>> = {};
  for (const key of ACADEMY_SOCIALS) {
    const value = p.socials?.[key];
    if (value) socials[key] = value;
  }
  return {
    workspaceId: org.id,
    name: org.name,
    slug: org.slug,
    publicBaseUrl: base,
    publicUrl: isAcademySlug(org.slug) ? `${base}${org.slug}` : null,
    tagline: p.tagline,
    about: p.about,
    contactPhone: p.contactPhone,
    contactEmail: p.contactEmail,
    address: p.address,
    mapUrl: p.mapUrl,
    socials,
    logoKey: p.logoKey,
    coverKey: p.coverKey,
    paymentInstructions: p.paymentInstructions,
    paymentQrKey: p.paymentQrKey,
    policies: p.policies,
    enrollmentOpen: p.enrollmentOpen,
    listed: p.listed,
    updatedAt: p.updatedAt,
  };
}

async function loadAcademy(db: Db, workspaceId: string, env: Env): Promise<AcademyDto> {
  const [org, profile] = await Promise.all([
    db.query.organization.findFirst({ where: eq(organization.id, workspaceId) }),
    ensureAcademyProfile(db, workspaceId),
  ]);
  if (!org) throw notFound("Academy");
  return toAcademyDto(org, profile, env);
}

const isSlugClash = (err: unknown) =>
  /UNIQUE constraint failed: organization\.slug/i.test(String((err as Error)?.message ?? err));

const SLUG_TAKEN = "That address is taken. Try another.";

/** Which image an upload route manages. */
const IMAGES = {
  logo: { column: "logoKey", noun: "logo", key: publicKey.logo },
  cover: { column: "coverKey", noun: "cover photo", key: publicKey.cover },
  paymentQr: { column: "paymentQrKey", noun: "QR code", key: publicKey.paymentQr },
} as const;

async function putImage(c: Context<AppBindings>, name: keyof typeof IMAGES) {
  const { column, noun, key } = IMAGES[name];
  const ctx = ctxOf(c);
  const image = await readImage(c, noun);
  const profile = await ensureAcademyProfile(ctx.db, ctx.workspaceId);
  const next = key(ctx.workspaceId, image.ext);
  await ctx.env.FILES.put(next, image.body, { httpMetadata: { contentType: image.type } });
  await runBatch(ctx, [
    ctx.db
      .update(academyProfile)
      .set({ [column]: next })
      .where(eq(academyProfile.workspaceId, ctx.workspaceId)),
    auditEntry(ctx, "upload", `academy_${name}`, ctx.workspaceId),
  ]);
  const previous = profile[column];
  if (previous) await ctx.env.FILES.delete(previous);
  return c.json({ key: next });
}

async function deleteImage(c: Context<AppBindings>, name: keyof typeof IMAGES) {
  const { column } = IMAGES[name];
  const ctx = ctxOf(c);
  const profile = await ensureAcademyProfile(ctx.db, ctx.workspaceId);
  const previous = profile[column];
  await ctx.db
    .update(academyProfile)
    .set({ [column]: null })
    .where(eq(academyProfile.workspaceId, ctx.workspaceId));
  if (previous) await ctx.env.FILES.delete(previous);
  return c.body(null, 204);
}

/**
 * The academy profile (staff API). Everyone on the team reads it; owners and admins (`settings`)
 * change it, including the academy's name and its public address (organization.slug), and upload
 * its logo, its website's cover photo, and its payment QR code (public R2 keys). The website's
 * other photos are in routes/academy-photos.ts.
 */
export const academyRoutes = new Hono<AppBindings>()
  .get("/academy", async (c) => c.json(await loadAcademy(c.var.db, c.var.workspaceId, c.env)))

  /**
   * The public page as families will see it (published programs and tiers only), also while it
   * isn't listed: owners and admins check it before sharing the address.
   */
  .get("/academy/public-preview", requireCap("settings"), async (c) => {
    const ctx = ctxOf(c);
    const found = await loadPublicAcademy(
      ctx.db,
      { workspaceId: ctx.workspaceId },
      { preview: true },
    );
    if (!found) throw notFound("Academy");
    const slug = found.academy.slug;
    const body: PublicAcademyPreviewDto = {
      ...found.academy,
      listed: found.listed,
      publicUrl: isAcademySlug(slug) ? `${appOrigin(ctx.env)}/a/${slug}` : null,
    };
    return c.json(body);
  })

  .patch("/academy", requireCap("settings"), v("json", academyUpdateSchema), async (c) => {
    const ctx = ctxOf(c);
    const { name, slug, socials, ...rest } = c.req.valid("json");
    await ensureAcademyProfile(ctx.db, ctx.workspaceId);
    if (slug !== undefined) {
      const taken = await ctx.db.query.organization.findFirst({
        where: and(eq(organization.slug, slug), ne(organization.id, ctx.workspaceId)),
        columns: { id: true },
      });
      if (taken) throw conflict(SLUG_TAKEN, { fields: { slug: SLUG_TAKEN } });
    }

    const orgSet: { name?: string; slug?: string } = {};
    if (name) orgSet.name = name;
    if (slug !== undefined) orgSet.slug = slug;
    const profileSet: Partial<ProfileRow> = {};
    for (const [k, value] of Object.entries(rest)) {
      if (value !== undefined) Object.assign(profileSet, { [k]: value });
    }
    if (socials) {
      const clean: Record<string, string> = {};
      for (const [k, value] of Object.entries(socials)) if (value) clean[k] = value;
      profileSet.socials = clean;
    }

    const statements: unknown[] = [];
    if (Object.keys(orgSet).length) {
      statements.push(
        ctx.db.update(organization).set(orgSet).where(eq(organization.id, ctx.workspaceId)),
      );
    }
    if (Object.keys(profileSet).length) {
      statements.push(
        ctx.db
          .update(academyProfile)
          .set(profileSet)
          .where(eq(academyProfile.workspaceId, ctx.workspaceId)),
      );
    }
    if (statements.length) {
      statements.push(
        auditEntry(ctx, "update", "academy", ctx.workspaceId, {
          fields: [...Object.keys(orgSet), ...Object.keys(profileSet)],
        }),
      );
      try {
        await runBatch(ctx, statements);
      } catch (err) {
        if (isSlugClash(err)) throw conflict(SLUG_TAKEN, { fields: { slug: SLUG_TAKEN } });
        throw err;
      }
    }
    return c.json(await loadAcademy(ctx.db, ctx.workspaceId, ctx.env));
  })

  .put("/academy/logo", requireCap("settings"), (c) => putImage(c, "logo"))
  .delete("/academy/logo", requireCap("settings"), (c) => deleteImage(c, "logo"))
  .put("/academy/cover", requireCap("settings"), (c) => putImage(c, "cover"))
  .delete("/academy/cover", requireCap("settings"), (c) => deleteImage(c, "cover"))
  .put("/academy/payment-qr", requireCap("settings"), (c) => putImage(c, "paymentQr"))
  .delete("/academy/payment-qr", requireCap("settings"), (c) => deleteImage(c, "paymentQr"));
