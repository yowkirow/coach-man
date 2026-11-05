import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type {
  PortalAcademyDto,
  PortalAcademyRefDto,
  PortalCoachDto,
  PortalCoachRefDto,
  PortalCommentDto,
  PortalCreditsDto,
  PortalMoneyDto,
  PortalProgressDto,
  PortalSessionDto,
  PortalTeenAccessDto,
} from "../../shared/api-types";
import { checkTeenInvite } from "../../shared/family";
import type { Db } from "../db/client";
import {
  academyProfile,
  assessment,
  assessmentScore,
  attendance,
  client,
  clientCoach,
  event,
  goal,
  groupMember,
  lesson,
  note,
  organization,
  ratingSnapshot,
  skill,
  trainingGroup,
  venue,
  workspaceSettings,
} from "../db/schema";
import {
  type CoachProfileFacts,
  portalSessionTitle,
  type SessionRow,
  toPortalAcademy,
  toPortalAcademyRef,
  toPortalAssessment,
  toPortalCharge,
  toPortalCoach,
  toPortalCoachRef,
  toPortalComment,
  toPortalGoal,
  toPortalPackage,
  toPortalPayment,
  toPortalRating,
  toPortalSession,
} from "../lib/portal-dto";
import type { PortalLink } from "../lib/portal-scope";
import { inList, unique } from "../lib/sql";
import { appOrigin } from "../routes/academy";
import { coachName, coachRefs, staffRows } from "./coaches";
import { packagesForClients } from "./credits";
import { familyInvites, familyLinks, toFamilyInviteDto } from "./family";
import { balancesFor, statementFor } from "./money";

type ClientRow = typeof client.$inferSelect;

/** Statuses that mean the student isn't expected at a session. */
const NOT_COMING = ["excused", "late_cancel"] as const;

/** Each academy's portal profile (name, logo, contact, how to pay, formats). */
export async function academiesFor(
  db: Db,
  env: Env,
  workspaceIds: string[],
): Promise<Map<string, PortalAcademyDto>> {
  const out = new Map<string, PortalAcademyDto>();
  if (!workspaceIds.length) return out;
  const rows = await db
    .select({ org: organization, profile: academyProfile, settings: workspaceSettings })
    .from(organization)
    .leftJoin(academyProfile, eq(academyProfile.workspaceId, organization.id))
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, organization.id))
    .where(inList(organization.id, workspaceIds));
  for (const r of rows) {
    out.set(r.org.id, toPortalAcademy(r.org, r.profile, r.settings, appOrigin(env)));
  }
  return out;
}

/** The name, logo, and formats of one academy (every student-scoped answer carries it). */
export async function academyRefFor(db: Db, workspaceId: string): Promise<PortalAcademyRefDto> {
  const [r] = await db
    .select({
      org: { id: organization.id, name: organization.name },
      logoKey: academyProfile.logoKey,
      settings: workspaceSettings,
    })
    .from(organization)
    .leftJoin(academyProfile, eq(academyProfile.workspaceId, organization.id))
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, organization.id))
    .where(eq(organization.id, workspaceId))
    .limit(1);
  return toPortalAcademyRef(
    r?.org ?? { id: workspaceId, name: "Your academy" },
    { logoKey: r?.logoKey ?? null },
    r?.settings,
  );
}

/** The academy's "today" (YYYY-MM-DD) in its own time zone. */
export async function academyTimezone(db: Db, workspaceId: string): Promise<string> {
  const row = await db.query.workspaceSettings.findFirst({
    where: eq(workspaceSettings.workspaceId, workspaceId),
    columns: { timezone: true },
  });
  return row?.timezone ?? "UTC";
}

/** The linked students' rows, each from its own academy. */
export async function studentsFor(db: Db, links: PortalLink[]): Promise<Map<string, ClientRow>> {
  const out = new Map<string, ClientRow>();
  if (!links.length) return out;
  const rows = await db
    .select()
    .from(client)
    .where(
      inList(
        client.id,
        links.map((l) => l.clientId),
      ),
    );
  for (const r of rows) {
    if (links.some((l) => l.clientId === r.id && l.workspaceId === r.workspaceId)) out.set(r.id, r);
  }
  return out;
}

/** Credits left on the student's active, unexpired packages. */
export async function creditsFor(
  db: Db,
  link: PortalLink,
  today: string,
): Promise<PortalCreditsDto> {
  const packages = (
    await packagesForClients({ db, workspaceId: link.workspaceId }, [link.clientId])
  ).filter((p) => p.status === "active" && (p.expiresOn === null || p.expiresOn >= today));
  const expiries = packages
    .filter((p) => p.remaining > 0 && p.expiresOn)
    .map((p) => p.expiresOn as string)
    .sort();
  return {
    remaining: packages.reduce((s, p) => s + Math.max(0, p.remaining), 0),
    total: packages.reduce((s, p) => s + p.creditsTotal, 0),
    nextExpiryOn: expiries[0] ?? null,
    activePackages: packages.length,
  };
}

/** Sessions the student is on the roster of, in a window, as families see them. */
export async function sessionsFor(
  db: Db,
  link: PortalLink,
  window: { from: number; to: number; upcomingOnly?: boolean; limit?: number },
): Promise<PortalSessionDto[]> {
  const rows: SessionRow[] = await db
    .select({
      lesson,
      venueName: venue.name,
      venueAddress: venue.address,
      groupName: trainingGroup.name,
      eventName: event.name,
      attendance: attendance.status,
    })
    .from(attendance)
    .innerJoin(
      lesson,
      and(eq(lesson.id, attendance.lessonId), eq(lesson.workspaceId, attendance.workspaceId)),
    )
    .leftJoin(venue, eq(venue.id, lesson.venueId))
    .leftJoin(trainingGroup, eq(trainingGroup.id, lesson.groupId))
    .leftJoin(event, eq(event.id, lesson.eventId))
    .where(
      and(
        eq(attendance.workspaceId, link.workspaceId),
        eq(attendance.clientId, link.clientId),
        window.upcomingOnly
          ? and(
              gte(lesson.endsAt, window.from),
              sql`${lesson.status} != 'cancelled'`,
              sql`${attendance.status} not in ('excused', 'late_cancel')`,
            )
          : gte(lesson.startsAt, window.from),
        lt(lesson.startsAt, window.to),
      ),
    )
    .orderBy(asc(lesson.startsAt))
    .limit(window.limit ?? 500);
  const coaches = await coachRefs(
    db,
    link.workspaceId,
    rows.map((r) => r.lesson.coachUserId),
  );
  return rows.map((r) =>
    toPortalSession(
      r,
      r.lesson.coachUserId ? toPortalCoachRef(coaches.get(r.lesson.coachUserId)) : null,
    ),
  );
}

export const isComing = (s: PortalSessionDto) =>
  s.status !== "cancelled" && !(NOT_COMING as readonly string[]).includes(s.attendance ?? "booked");

/** The latest shared comments across the given students (each in its own academy). */
export async function commentsFor(
  db: Db,
  links: PortalLink[],
  limit: number,
): Promise<PortalCommentDto[]> {
  if (!links.length) return [];
  const rows = (
    await db
      .select()
      .from(note)
      .where(
        and(
          inList(
            note.clientId,
            links.map((l) => l.clientId),
          ),
          eq(note.visibility, "shared"),
          eq(note.kind, "comment"),
        ),
      )
      .orderBy(desc(note.createdAt))
      .limit(limit * 2 + 10)
  ).filter((n) => links.some((l) => l.clientId === n.clientId && l.workspaceId === n.workspaceId));

  const out: PortalCommentDto[] = [];
  for (const workspaceId of unique(rows.map((n) => n.workspaceId))) {
    const mine = rows.filter((n) => n.workspaceId === workspaceId);
    const [authors, sessions] = await Promise.all([
      coachRefs(
        db,
        workspaceId,
        mine.map((n) => n.createdBy),
      ),
      sessionTitles(
        db,
        workspaceId,
        mine.map((n) => n.lessonId),
      ),
    ]);
    for (const n of mine) {
      const dto = toPortalComment(
        n,
        n.createdBy ? toPortalCoachRef(authors.get(n.createdBy)) : null,
        n.lessonId ? (sessions.get(n.lessonId) ?? null) : null,
      );
      if (dto) out.push(dto);
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/** Titles and times of the sessions comments were written in (never their rosters). */
async function sessionTitles(db: Db, workspaceId: string, ids: (string | null)[]) {
  const wanted = unique(ids.filter((id): id is string => Boolean(id)));
  const out = new Map<string, { title: string; startsAt: number }>();
  if (!wanted.length) return out;
  const rows = await db
    .select({ lesson, groupName: trainingGroup.name, eventName: event.name })
    .from(lesson)
    .leftJoin(trainingGroup, eq(trainingGroup.id, lesson.groupId))
    .leftJoin(event, eq(event.id, lesson.eventId))
    .where(and(eq(lesson.workspaceId, workspaceId), inList(lesson.id, wanted)));
  for (const r of rows) {
    out.set(r.lesson.id, {
      title: portalSessionTitle(r.lesson, r.groupName, r.eventName),
      startsAt: r.lesson.startsAt,
    });
  }
  return out;
}

/** The student's current coaches with what their profiles let families see. */
export async function coachesFor(db: Db, link: PortalLink): Promise<PortalCoachDto[]> {
  const rows = await db
    .select()
    .from(clientCoach)
    .where(
      and(
        eq(clientCoach.workspaceId, link.workspaceId),
        eq(clientCoach.clientId, link.clientId),
        isNull(clientCoach.endedOn),
      ),
    );
  if (!rows.length) return [];
  const [staff, refs] = await Promise.all([
    staffRows(db, link.workspaceId),
    coachRefs(
      db,
      link.workspaceId,
      rows.map((r) => r.coachUserId),
    ),
  ]);
  const order = (r: (typeof rows)[number]) => (r.role === "primary" ? 0 : 1);
  return rows
    .sort((a, b) => order(a) - order(b) || a.startedOn.localeCompare(b.startedOn))
    .map((r) => {
      const s = staff.find((m) => m.userId === r.coachUserId);
      const ref = refs.get(r.coachUserId);
      const facts: CoachProfileFacts = s
        ? {
            name: coachName(s),
            title: s.title,
            photoKey: s.photoKey,
            bio: s.bio,
            certifications: s.certifications,
            specialties: s.specialties,
            languages: s.languages,
            yearsCoaching: s.yearsCoaching,
            isPublic: s.isPublic,
          }
        : {
            name: ref?.name ?? "Former coach",
            title: null,
            photoKey: ref?.photoKey ?? null,
            bio: null,
            certifications: [],
            specialties: [],
            languages: [],
            yearsCoaching: null,
            isPublic: false,
          };
      return toPortalCoach(r, facts);
    });
}

/** The programs (groups) the student belongs to now, by name. */
export async function programsFor(db: Db, link: PortalLink) {
  return db
    .select({ name: trainingGroup.name })
    .from(groupMember)
    .innerJoin(trainingGroup, eq(trainingGroup.id, groupMember.groupId))
    .where(
      and(
        eq(groupMember.workspaceId, link.workspaceId),
        eq(groupMember.clientId, link.clientId),
        isNull(groupMember.leftOn),
        isNull(trainingGroup.archivedAt),
      ),
    )
    .orderBy(asc(trainingGroup.name));
}

/** Shared assessments, goals, ratings, and shared comments. Nothing a coach kept back. */
export async function progressFor(
  db: Db,
  link: PortalLink,
): Promise<Omit<PortalProgressDto, "academy">> {
  const ws = link.workspaceId;
  const [assessments, goals, ratings] = await Promise.all([
    db
      .select()
      .from(assessment)
      .where(
        and(
          eq(assessment.workspaceId, ws),
          eq(assessment.clientId, link.clientId),
          eq(assessment.sharedWithFamily, true),
        ),
      )
      .orderBy(asc(assessment.assessedOn), asc(assessment.createdAt)),
    db
      .select()
      .from(goal)
      .where(and(eq(goal.workspaceId, ws), eq(goal.clientId, link.clientId)))
      .orderBy(asc(goal.status), desc(goal.createdAt)),
    db
      .select()
      .from(ratingSnapshot)
      .where(and(eq(ratingSnapshot.workspaceId, ws), eq(ratingSnapshot.clientId, link.clientId)))
      .orderBy(asc(ratingSnapshot.recordedOn)),
  ]);
  const ids = assessments.map((a) => a.id);
  const [scores, authors, comments] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(assessmentScore)
          .where(
            and(eq(assessmentScore.workspaceId, ws), inList(assessmentScore.assessmentId, ids)),
          )
      : Promise.resolve([]),
    coachRefs(db, ws, [...assessments.map((a) => a.createdBy), ...goals.map((g) => g.createdBy)]),
    commentsFor(db, [link], 200),
  ]);
  const usedSkills = unique(scores.map((s) => s.skillId));
  const skills = await db
    .select()
    .from(skill)
    .where(
      and(
        eq(skill.workspaceId, ws),
        usedSkills.length
          ? sql`(${skill.active} = 1 or ${inList(skill.id, usedSkills)})`
          : eq(skill.active, true),
      ),
    )
    .orderBy(asc(skill.sortOrder));
  const author = (id: string | null) => (id ? toPortalCoachRef(authors.get(id)) : null);
  return {
    skills: skills.map((s) => ({
      id: s.id,
      category: s.category,
      name: s.name,
      description: s.description,
    })),
    assessments: assessments.flatMap((a) => {
      const dto = toPortalAssessment(
        a,
        scores.filter((s) => s.assessmentId === a.id),
        author(a.createdBy),
      );
      return dto ? [dto] : [];
    }),
    goals: goals.map((g) => toPortalGoal(g, author(g.createdBy))),
    ratings: ratings.map(toPortalRating),
    comments,
  };
}

/** Packages, charges, payments, and the balance of one student (voided entries left out). */
export async function moneyFor(
  db: Db,
  link: PortalLink,
  today: string,
): Promise<Omit<PortalMoneyDto, "academy">> {
  const scope = { db, workspaceId: link.workspaceId };
  const [statement, packages] = await Promise.all([
    statementFor(scope, link.clientId),
    packagesForClients(scope, [link.clientId], { includeInactive: true }),
  ]);
  return {
    balanceMinor: statement.balanceMinor,
    packages: packages
      .flatMap((p) => {
        const dto = toPortalPackage(p, today);
        return dto ? [dto] : [];
      })
      .reverse(),
    charges: statement.charges.flatMap((c) => {
      const dto = toPortalCharge(c);
      return dto ? [dto] : [];
    }),
    payments: statement.payments.flatMap((p) => {
      const dto = toPortalPayment(p);
      return dto ? [dto] : [];
    }),
  };
}

/** Balance (charges minus payments) of several students, each in its own academy. */
export async function balancesOf(db: Db, links: PortalLink[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const workspaceId of unique(links.map((l) => l.workspaceId))) {
    const ids = links.filter((l) => l.workspaceId === workspaceId).map((l) => l.clientId);
    for (const [clientId, balance] of await balancesFor({ db, workspaceId }, ids)) {
      out.set(clientId, balance);
    }
  }
  return out;
}

/** A parent's view of their teen's own login: who has one, waiting links, and whether to offer one. */
export async function teenAccessFor(
  db: Db,
  student: ClientRow,
  today: string,
): Promise<PortalTeenAccessDto> {
  const [logins, invites] = await Promise.all([
    familyLinks(db, student.workspaceId, student.id, "self"),
    familyInvites(db, student.workspaceId, student.id, "self"),
  ]);
  const check = checkTeenInvite({
    birthDate: student.birthDate,
    isJunior: student.isJunior,
    today,
    firstName: student.firstName,
  });
  const now = Date.now();
  return {
    eligible: check.ok ? { ok: true } : check,
    logins: logins.map((l) => ({ accessId: l.id, name: l.name, since: l.since })),
    invites: invites
      .map((r) => toFamilyInviteDto(r.i, null, now))
      .filter((i) => i.status === "valid")
      .map((i) => ({ id: i.id, status: i.status, createdAt: i.createdAt, expiresAt: i.expiresAt })),
  };
}

/** The next session a student is expected at (not cancelled, not excused). */
export async function nextSessionFor(db: Db, link: PortalLink, now: number) {
  const [next] = await sessionsFor(db, link, {
    from: now,
    to: now + 366 * 86_400_000,
    upcomingOnly: true,
    limit: 1,
  });
  return next ?? null;
}

/** The latest shared assessment's date, level, and coach, for the home page. */
export async function latestAssessmentFor(db: Db, link: PortalLink) {
  const [row] = await db
    .select()
    .from(assessment)
    .where(
      and(
        eq(assessment.workspaceId, link.workspaceId),
        eq(assessment.clientId, link.clientId),
        eq(assessment.sharedWithFamily, true),
      ),
    )
    .orderBy(desc(assessment.assessedOn), desc(assessment.createdAt))
    .limit(1);
  if (!row) return null;
  const authors = await coachRefs(db, link.workspaceId, [row.createdBy]);
  return {
    assessedOn: row.assessedOn,
    overallLevel: row.overallLevel,
    author: row.createdBy ? toPortalCoachRef(authors.get(row.createdBy)) : null,
  } satisfies { assessedOn: string; overallLevel: string | null; author: PortalCoachRefDto | null };
}
