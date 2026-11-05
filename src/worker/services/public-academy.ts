import { and, asc, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import type {
  PublicAcademyDto,
  PublicCoachRefDto,
  PublicConsentDocumentDto,
} from "../../shared/api-types";
import { isAcademySlug } from "../../shared/domain";
import { todayIn } from "../../shared/time";
import type { Db } from "../db/client";
import {
  academyProfile,
  coachProfile,
  consentDocument,
  lesson,
  lessonSeries,
  member,
  organization,
  packageTemplate,
  trainingGroup,
  user,
  venue,
  workspaceSettings,
} from "../db/schema";
import {
  isListed,
  type PublicCoachFacts,
  toPublicAcademy,
  toPublicCoach,
  toPublicCoachRef,
  toPublicConsentDocument,
  toPublicConsentRef,
  toPublicPackage,
  toPublicProgram,
  toPublicWeeklySession,
} from "../lib/public-dto";
import { inList, unique } from "../lib/sql";
import { coachName } from "./coaches";

type OrgRow = typeof organization.$inferSelect;

/** Who to load: a public address (anyone), or an academy by id (its own staff's preview). */
export type PublicTarget = { slug: string } | { workspaceId: string };

/**
 * The academy and its profile, if the page may be shown: listed under a real public address, or
 * any academy when `preview` is set (staff looking at their own page before listing it).
 */
async function findAcademy(db: Db, target: PublicTarget, preview: boolean) {
  let org: OrgRow | undefined;
  if ("slug" in target) {
    // Legacy `ws-…` slugs and anything that isn't a public address never match.
    if (!isAcademySlug(target.slug)) return null;
    org = await db.query.organization.findFirst({ where: eq(organization.slug, target.slug) });
  } else {
    org = await db.query.organization.findFirst({
      where: eq(organization.id, target.workspaceId),
    });
  }
  if (!org) return null;
  const profile = await db.query.academyProfile.findFirst({
    where: eq(academyProfile.workspaceId, org.id),
  });
  if (!preview && !isListed(org, profile)) return null;
  return { org, profile: profile ?? null };
}

/** Current staff with a public coach profile, in the academy's coach order. */
async function publicCoaches(db: Db, workspaceId: string): Promise<Map<string, PublicCoachFacts>> {
  const rows = await db
    .select({ userId: member.userId, accountName: user.name, p: coachProfile })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(
      coachProfile,
      and(eq(coachProfile.userId, member.userId), eq(coachProfile.workspaceId, workspaceId)),
    )
    .where(and(eq(member.organizationId, workspaceId), eq(coachProfile.isPublic, true)));
  const sorted = rows.sort(
    (a, b) =>
      a.p.sortOrder - b.p.sortOrder ||
      coachName({ displayName: a.p.displayName, accountName: a.accountName }).localeCompare(
        coachName({ displayName: b.p.displayName, accountName: b.accountName }),
      ),
  );
  const out = new Map<string, PublicCoachFacts>();
  for (const r of sorted) {
    if (out.has(r.userId)) continue;
    out.set(r.userId, {
      profileId: r.p.id,
      name: coachName({ displayName: r.p.displayName, accountName: r.accountName }),
      title: r.p.title,
      bio: r.p.bio,
      photoKey: r.p.photoKey,
      certifications: r.p.certifications ?? [],
      specialties: r.p.specialties ?? [],
      languages: r.p.languages ?? [],
      yearsCoaching: r.p.yearsCoaching,
      duprRating: r.p.duprRating,
    });
  }
  return out;
}

/**
 * Everything the public academy page shows, from published rows only: the profile when listed,
 * public programs with their running weekly series, public tiers that are for sale (in public
 * programs, or in none), public coach profiles, and the titles of active required consents.
 * Null when the page isn't public (or, for a preview, when the academy doesn't exist).
 */
export async function loadPublicAcademy(
  db: Db,
  target: PublicTarget,
  opts: { preview?: boolean; now?: number } = {},
): Promise<{ academy: PublicAcademyDto; listed: boolean } | null> {
  const found = await findAcademy(db, target, Boolean(opts.preview));
  if (!found) return null;
  const { org, profile } = found;
  const ws = org.id;
  const now = opts.now ?? Date.now();

  const [settings, groups, coaches, consents] = await Promise.all([
    db.query.workspaceSettings.findFirst({ where: eq(workspaceSettings.workspaceId, ws) }),
    db
      .select()
      .from(trainingGroup)
      .where(
        and(
          eq(trainingGroup.workspaceId, ws),
          eq(trainingGroup.isPublic, true),
          isNull(trainingGroup.archivedAt),
        ),
      )
      .orderBy(asc(trainingGroup.sortOrder), asc(trainingGroup.name)),
    publicCoaches(db, ws),
    db
      .select()
      .from(consentDocument)
      .where(
        and(
          eq(consentDocument.workspaceId, ws),
          eq(consentDocument.active, true),
          eq(consentDocument.required, true),
        ),
      )
      .orderBy(asc(consentDocument.createdAt)),
  ]);
  const today = todayIn(settings?.timezone ?? "UTC", now);
  const programIds = groups.map((g) => g.id);

  const [series, packages, next] = await Promise.all([
    programIds.length
      ? db
          .select()
          .from(lessonSeries)
          .where(
            and(
              eq(lessonSeries.workspaceId, ws),
              inList(lessonSeries.groupId, programIds),
              eq(lessonSeries.active, true),
              or(isNull(lessonSeries.endsOn), gte(lessonSeries.endsOn, today)),
            ),
          )
          .orderBy(asc(lessonSeries.startTime))
      : Promise.resolve([]),
    db
      .select()
      .from(packageTemplate)
      .where(
        and(
          eq(packageTemplate.workspaceId, ws),
          eq(packageTemplate.isPublic, true),
          eq(packageTemplate.active, true),
        ),
      )
      .orderBy(asc(packageTemplate.sortOrder), asc(packageTemplate.priceMinor)),
    programIds.length
      ? db
          .select({ groupId: lesson.groupId, startsAt: sql<number>`min(${lesson.startsAt})` })
          .from(lesson)
          .where(
            and(
              eq(lesson.workspaceId, ws),
              inList(lesson.groupId, programIds),
              eq(lesson.status, "scheduled"),
              gt(lesson.startsAt, now),
            ),
          )
          .groupBy(lesson.groupId)
      : Promise.resolve([]),
  ]);

  const venueIds = unique(
    [...series.map((s) => s.venueId), ...groups.map((g) => g.defaultVenueId)].filter(
      (id): id is string => Boolean(id),
    ),
  );
  const venues = venueIds.length
    ? await db
        .select()
        .from(venue)
        .where(and(eq(venue.workspaceId, ws), inList(venue.id, venueIds)))
    : [];
  const venueById = new Map(venues.map((v) => [v.id, v]));
  const coachRef = (userId: string | null): PublicCoachRefDto | null => {
    const c = userId ? coaches.get(userId) : undefined;
    return c ? toPublicCoachRef(c) : null;
  };

  const nextByProgram = new Map(next.map((n) => [n.groupId, Number(n.startsAt)]));
  const programs = groups.map((g) =>
    toPublicProgram(g, {
      schedule: series
        .filter((s) => s.groupId === g.id)
        .map((s) => toPublicWeeklySession(s, venueById.get(s.venueId ?? "") ?? null)),
      venue: venueById.get(g.defaultVenueId ?? "") ?? null,
      coaches: unique([g.coachUserId, ...(g.assistantCoachIds ?? [])])
        .map(coachRef)
        .filter((c): c is PublicCoachRefDto => c !== null),
      nextSessionAt: nextByProgram.get(g.id) ?? null,
    }),
  );
  const publicPrograms = new Set(programIds);
  const tiers = packages
    // A tier of an unpublished (or archived) program is unpublished with it.
    .filter((p) => !p.programId || publicPrograms.has(p.programId))
    .map((p) => toPublicPackage(p, coachRef(p.coachUserId)));

  const academy = toPublicAcademy(org, profile, settings, {
    programs,
    packages: tiers,
    coaches: [...coaches.values()].map(toPublicCoach),
    consents: consents.map(toPublicConsentRef),
    today,
  });
  return { academy, listed: isListed(org, profile) };
}

/** The texts of a listed academy's active required consents (for enrollment). */
export async function loadPublicConsents(
  db: Db,
  slug: string,
): Promise<PublicConsentDocumentDto[] | null> {
  const found = await findAcademy(db, { slug }, false);
  if (!found) return null;
  const rows = await db
    .select()
    .from(consentDocument)
    .where(
      and(
        eq(consentDocument.workspaceId, found.org.id),
        eq(consentDocument.active, true),
        eq(consentDocument.required, true),
      ),
    )
    .orderBy(asc(consentDocument.createdAt));
  return rows.map(toPublicConsentDocument);
}
