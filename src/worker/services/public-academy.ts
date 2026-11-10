import { and, asc, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import type {
  PublicAcademyDto,
  PublicCoachRefDto,
  PublicConsentDocumentDto,
  PublicSessionDto,
} from "../../shared/api-types";
import { isAcademySlug } from "../../shared/domain";
import { SESSION_WINDOW_DAYS } from "../../shared/enrollment";
import { UUID_RE } from "../../shared/ids";
import { isCoachingRole } from "../../shared/roles";
import { addDays, daysBetween, startOfLocalDay, todayIn } from "../../shared/time";
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
  teamPerson,
  trainingGroup,
  user,
  venue,
  workspaceSettings,
} from "../db/schema";
import {
  isListed,
  type PublicCoachFacts,
  teamPersonFacts,
  toProgramCoachRefs,
  toPublicAcademy,
  toPublicAcademyPhoto,
  toPublicCoach,
  toPublicCoachRef,
  toPublicConsentDocument,
  toPublicConsentRef,
  toPublicPackage,
  toPublicProgram,
  toPublicWeeklySession,
} from "../lib/public-dto";
import { inList, unique } from "../lib/sql";
import { type TeamPageItem, teamPageOrder } from "../lib/team-page";
import { academyPhotos } from "./academy-photos";
import { coachName } from "./coaches";
import { programSessions, toPublicSession } from "./enrollment-core";

type OrgRow = typeof organization.$inferSelect;

/** Who to load: a public address (anyone), or an academy by id (its own staff's preview). */
export type PublicTarget = { slug: string } | { workspaceId: string };

/**
 * A listed academy by its public address, with what enrolling needs to know about it (null when
 * the page isn't public: unlisted, legacy `ws-…`, or unknown).
 */
export async function findListedAcademy(db: Db, slug: string) {
  const found = await findAcademy(db, { slug }, false);
  if (!found) return null;
  const settings = await db.query.workspaceSettings.findFirst({
    where: eq(workspaceSettings.workspaceId, found.org.id),
  });
  return {
    workspaceId: found.org.id,
    slug: found.org.slug,
    name: found.org.name,
    enrollmentOpen: Boolean(found.profile?.enrollmentOpen),
    timezone: settings?.timezone ?? "UTC",
    locale: settings?.locale ?? "en-US",
    currency: settings?.currency ?? "USD",
  };
}

export type ListedAcademy = NonNullable<Awaited<ReturnType<typeof findListedAcademy>>>;

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

/**
 * The team page's people: current staff who coach, with a public coach profile, and the academy's
 * public display-only people, merged in the academy's order (`team`). The front desk is never
 * there, whatever their profile says. `byUser` holds the staff among them by user id: program and
 * tier coach refs name staff only.
 */
async function publicCoaches(
  db: Db,
  workspaceId: string,
): Promise<{ team: PublicCoachFacts[]; byUser: Map<string, PublicCoachFacts> }> {
  const [rows, people] = await Promise.all([
    db
      .select({
        userId: member.userId,
        role: member.role,
        accountName: user.name,
        p: coachProfile,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .innerJoin(
        coachProfile,
        and(eq(coachProfile.userId, member.userId), eq(coachProfile.workspaceId, workspaceId)),
      )
      .where(and(eq(member.organizationId, workspaceId), eq(coachProfile.isPublic, true))),
    db
      .select()
      .from(teamPerson)
      .where(and(eq(teamPerson.workspaceId, workspaceId), eq(teamPerson.isPublic, true))),
  ]);
  type Placed = TeamPageItem & { facts: PublicCoachFacts };
  const byUser = new Map<string, PublicCoachFacts>();
  const staff: Placed[] = [];
  for (const r of rows) {
    if (byUser.has(r.userId) || !isCoachingRole(r.role)) continue;
    const name = coachName({ displayName: r.p.displayName, accountName: r.accountName });
    const facts: PublicCoachFacts = {
      profileId: r.p.id,
      name,
      title: r.p.title,
      bio: r.p.bio,
      photoKey: r.p.photoKey,
      portraitKey: r.p.portraitKey,
      portraitFraming: r.p.portraitFraming ?? null,
      certifications: r.p.certifications ?? [],
      highlights: r.p.highlights ?? [],
      specialties: r.p.specialties ?? [],
      languages: r.p.languages ?? [],
      yearsCoaching: r.p.yearsCoaching,
      duprRating: r.p.duprRating,
    };
    byUser.set(r.userId, facts);
    staff.push({ kind: "staff", id: r.userId, name, sortOrder: r.p.sortOrder, facts });
  }
  const listed: Placed[] = people.map((p) => ({
    kind: "listed",
    id: p.id,
    name: p.name,
    sortOrder: p.sortOrder,
    facts: teamPersonFacts(p),
  }));
  return { team: teamPageOrder(staff, listed).map((e) => e.facts), byUser };
}

/**
 * Everything the public academy page shows, from published rows only: the profile when listed
 * (its cover photo among it), public programs with their running weekly series, public tiers that
 * are for sale (in public programs, or in none), the team page's people (public coach profiles and
 * public display-only people, in the academy's order), the website photos in the academy's order,
 * and the titles of active required consents.
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

  const [settings, groups, coaches, consents, photos] = await Promise.all([
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
    academyPhotos(db, ws),
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
  // A coach-specific tier names its coach; `lead` is about programs only.
  const tierCoach = (userId: string | null): PublicCoachRefDto | null => {
    const c = userId ? coaches.byUser.get(userId) : undefined;
    return c ? toPublicCoachRef(c, false) : null;
  };

  const nextByProgram = new Map(next.map((n) => [n.groupId, Number(n.startsAt)]));
  const programs = groups.map((g) =>
    toPublicProgram(g, {
      schedule: series
        .filter((s) => s.groupId === g.id)
        .map((s) => toPublicWeeklySession(s, venueById.get(s.venueId ?? "") ?? null)),
      venue: venueById.get(g.defaultVenueId ?? "") ?? null,
      coaches: toProgramCoachRefs(g, coaches.byUser),
      nextSessionAt: nextByProgram.get(g.id) ?? null,
    }),
  );
  const publicPrograms = new Set(programIds);
  const tiers = packages
    // A tier of an unpublished (or archived) program is unpublished with it.
    .filter((p) => !p.programId || publicPrograms.has(p.programId))
    .map((p) => toPublicPackage(p, tierCoach(p.coachUserId)));

  const academy = toPublicAcademy(org, profile, settings, {
    programs,
    packages: tiers,
    coaches: coaches.team.map(toPublicCoach),
    photos: photos.map(toPublicAcademyPhoto),
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

/** The widest window of sessions one public request may ask for. */
const MAX_SESSION_WINDOW_DAYS = 92;

/**
 * Upcoming sessions of a listed academy's public program (for picking a trial session): from
 * today (or `from`) for six weeks (or to `to`, at most 92 days), scheduled ones only, with places
 * left. Null when the academy or the program isn't public.
 */
export async function loadPublicSessions(
  db: Db,
  slug: string,
  programId: string,
  q: { from?: string; to?: string },
  now = Date.now(),
): Promise<PublicSessionDto[] | null> {
  const found = await findAcademy(db, { slug }, false);
  if (!found || !UUID_RE.test(programId)) return null;
  const ws = found.org.id;
  const program = await db.query.trainingGroup.findFirst({
    where: and(
      eq(trainingGroup.id, programId),
      eq(trainingGroup.workspaceId, ws),
      eq(trainingGroup.isPublic, true),
      isNull(trainingGroup.archivedAt),
    ),
  });
  if (!program) return null;
  const settings = await db.query.workspaceSettings.findFirst({
    where: eq(workspaceSettings.workspaceId, ws),
  });
  const tz = settings?.timezone ?? "UTC";
  const today = todayIn(tz, now);
  const from = q.from && q.from > today ? q.from : today;
  let to = q.to ?? addDays(today, SESSION_WINDOW_DAYS);
  if (daysBetween(from, to) > MAX_SESSION_WINDOW_DAYS) to = addDays(from, MAX_SESSION_WINDOW_DAYS);
  if (to < from) return [];
  const sessions = await programSessions(db, ws, program, {
    from: Math.max(now, startOfLocalDay(from, tz)),
    to: startOfLocalDay(addDays(to, 1), tz),
  });
  return sessions.map((s) => toPublicSession(s, tz));
}
