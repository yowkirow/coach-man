import { and, asc, eq, gte, inArray, isNull, lt, ne, type SQL, sql } from "drizzle-orm";
import type {
  CoachRefDto,
  LessonDetailDto,
  LessonSummaryDto,
  NoteDto,
  RosterEntryDto,
  TodayDto,
} from "../../shared/api-types";
import { LESSON_KIND_LABELS, type LessonKind } from "../../shared/domain";
import { isLastWeekOfMonth } from "../../shared/enrollment";
import { uuidv7 } from "../../shared/ids";
import { can } from "../../shared/roles";
import type { LessonCreateInput } from "../../shared/schemas";
import {
  addDays,
  ageOn,
  compareDates,
  localDate,
  monthDay,
  startOfLocalDay,
  todayIn,
  weekdayOf,
  zonedToEpoch,
} from "../../shared/time";
import { chunkRows } from "../db/client";
import {
  attendance,
  charge,
  client,
  clientPackage,
  event,
  eventRegistration,
  groupMember,
  lesson,
  lessonSeries,
  note,
  notificationPref,
  rate,
  trainingGroup,
  venue,
} from "../db/schema";
import { badRequest, notFound } from "../lib/errors";
import { inList, unique } from "../lib/sql";
import type { Ctx } from "../types";
import { cleanCoaches, coachRefs, staffIds } from "./coaches";
import {
  effectivePrice,
  packagesForClients,
  remainingExpr,
  runBatch,
  usablePackages,
} from "./credits";
import { renewalsDue, requestedCount } from "./enrollment-staff";
import { balancesDue, balancesFor } from "./money";

/** How far ahead recurring series are materialized into concrete lessons. */
export const MATERIALIZE_DAYS = 56;

/** Most one-off sessions a single "repeats" request may add to an event. */
export const MAX_EVENT_SESSIONS = 120;

type LessonRow = typeof lesson.$inferSelect;

export async function lessonSummaries(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  where: SQL | undefined,
) {
  const { db, workspaceId } = ctx;
  const rows = await db
    .select({
      lesson,
      venueName: venue.name,
      groupName: trainingGroup.name,
      eventName: event.name,
      bookedCount: sql<number>`(select count(*) from attendance a where a.lesson_id = "lesson"."id" and a.status not in ('excused', 'late_cancel'))`,
      checkedInCount: sql<number>`(select count(*) from attendance a where a.lesson_id = "lesson"."id" and a.status in ('present', 'late'))`,
      participantNames: sql<
        string | null
      >`(select group_concat(c.first_name || ' ' || c.last_name, ', ') from attendance a join client c on c.id = a.client_id where a.lesson_id = "lesson"."id" and a.status not in ('excused', 'late_cancel'))`,
    })
    .from(lesson)
    .leftJoin(venue, eq(venue.id, lesson.venueId))
    .leftJoin(trainingGroup, eq(trainingGroup.id, lesson.groupId))
    .leftJoin(event, eq(event.id, lesson.eventId))
    .where(and(eq(lesson.workspaceId, workspaceId), where))
    .orderBy(asc(lesson.startsAt));
  return rows.map((r) => ({
    row: r.lesson,
    groupName: r.groupName,
    eventName: r.eventName,
    summary: {
      id: r.lesson.id,
      kind: r.lesson.kind,
      title: lessonTitle(r.lesson, r.groupName, r.eventName, r.participantNames),
      startsAt: r.lesson.startsAt,
      endsAt: r.lesson.endsAt,
      venueId: r.lesson.venueId,
      venueName: r.venueName,
      court: r.lesson.court,
      groupId: r.lesson.groupId,
      eventId: r.lesson.eventId,
      status: r.lesson.status,
      seriesId: r.lesson.seriesId,
      bookedCount: Number(r.bookedCount),
      checkedInCount: Number(r.checkedInCount),
      capacity: r.lesson.capacity,
      coachUserId: r.lesson.coachUserId,
      assistantCoachIds: r.lesson.assistantCoachIds ?? [],
    } satisfies LessonSummaryDto,
  }));
}

export function lessonTitle(
  l: { title: string | null; kind: LessonKind },
  groupName: string | null,
  eventName: string | null,
  participantNames: string | null,
): string {
  return (
    l.title?.trim() ||
    groupName ||
    eventName ||
    participantNames?.trim() ||
    LESSON_KIND_LABELS[l.kind]
  );
}

export async function rostersFor(
  ctx: Ctx,
  lessons: readonly { id: string; kind: LessonKind; startsAt: number }[],
): Promise<Map<string, RosterEntryDto[]>> {
  const result = new Map<string, RosterEntryDto[]>();
  if (lessons.length === 0) return result;
  const { db, workspaceId, settings } = ctx;
  const rows = await db
    .select({
      a: attendance,
      firstName: client.firstName,
      lastName: client.lastName,
      photoKey: client.photoKey,
      isJunior: client.isJunior,
      medical: client.medicalNotes,
    })
    .from(attendance)
    .innerJoin(client, eq(client.id, attendance.clientId))
    .where(
      and(
        eq(attendance.workspaceId, workspaceId),
        inList(
          attendance.lessonId,
          lessons.map((l) => l.id),
        ),
      ),
    )
    .orderBy(asc(client.firstName), asc(client.lastName));

  const clientIds = unique(rows.map((r) => r.a.clientId));
  // Coaches never get money (the API strips it anyway), so don't look it up for them.
  const money = can(ctx.role, "money");
  const chargeIds = money
    ? rows.map((r) => r.a.chargeId).filter((v): v is string => Boolean(v))
    : [];
  const [pkgs, balances, charges] = await Promise.all([
    packagesForClients(ctx, clientIds),
    money ? balancesFor(ctx, clientIds) : Promise.resolve(new Map<string, number>()),
    chargeIds.length
      ? db
          .select({ id: charge.id, amountMinor: charge.amountMinor })
          .from(charge)
          .where(and(eq(charge.workspaceId, workspaceId), inList(charge.id, chargeIds)))
      : Promise.resolve([]),
  ]);
  const chargeAmount = new Map(charges.map((c) => [c.id, c.amountMinor]));
  const lessonById = new Map(lessons.map((l) => [l.id, l]));

  for (const r of rows) {
    const les = lessonById.get(r.a.lessonId);
    if (!les) continue;
    const date = localDate(les.startsAt, settings.timezone);
    const own = pkgs.filter((p) => p.clientId === r.a.clientId);
    const usable = usablePackages(own, les.kind, date);
    const consumed = r.a.consumedPackageId
      ? own.find((p) => p.id === r.a.consumedPackageId)
      : undefined;
    const shown = consumed ?? usable[0];
    const entry: RosterEntryDto = {
      attendanceId: r.a.id,
      clientId: r.a.clientId,
      firstName: r.firstName,
      lastName: r.lastName,
      photoKey: r.photoKey,
      status: r.a.status,
      version: r.a.version,
      consumedPackageId: r.a.consumedPackageId,
      complimentary: r.a.complimentary,
      chargeId: r.a.chargeId,
      chargeMinor: r.a.chargeId ? (chargeAmount.get(r.a.chargeId) ?? null) : null,
      note: r.a.note,
      checkedInAt: r.a.checkedInAt,
      packageName: shown?.name ?? null,
      packageRemaining: shown?.remaining ?? null,
      packageCredits: shown?.creditsTotal ?? null,
      usablePackages: usable.map((p) => ({
        id: p.id,
        name: p.name,
        remaining: p.remaining,
        expiresOn: p.expiresOn,
      })),
      balanceMinor: balances.get(r.a.clientId) ?? 0,
      isJunior: r.isJunior,
      medicalFlag: Boolean(r.medical?.trim()),
    };
    const list = result.get(r.a.lessonId);
    if (list) list.push(entry);
    else result.set(r.a.lessonId, [entry]);
  }
  return result;
}

export async function lessonDetail(ctx: Ctx, lessonId: string): Promise<LessonDetailDto> {
  const [item] = await lessonSummaries(ctx, eq(lesson.id, lessonId));
  if (!item) throw notFound("Session");
  return (await lessonDetails(ctx, [item]))[0] as LessonDetailDto;
}

async function lessonDetails(
  ctx: Ctx,
  items: Awaited<ReturnType<typeof lessonSummaries>>,
): Promise<LessonDetailDto[]> {
  if (items.length === 0) return [];
  const { db, workspaceId } = ctx;
  const ids = items.map((i) => i.row.id);
  const rateIds = unique(items.map((i) => i.row.rateId).filter((v): v is string => Boolean(v)));
  const [rosters, notes, rates] = await Promise.all([
    rostersFor(
      ctx,
      items.map((i) => i.row),
    ),
    db
      .select()
      .from(note)
      .where(and(eq(note.workspaceId, workspaceId), inList(note.lessonId, ids)))
      .orderBy(asc(note.createdAt)),
    rateIds.length
      ? db
          .select()
          .from(rate)
          .where(and(eq(rate.workspaceId, workspaceId), inList(rate.id, rateIds)))
      : Promise.resolve([]),
  ]);
  const authors = await coachRefs(
    db,
    workspaceId,
    notes.map((n) => n.createdBy),
  );
  const rateById = new Map(rates.map((r) => [r.id, r]));
  return items.map((i) => ({
    lesson: {
      ...i.summary,
      notes: i.row.notes,
      rateId: i.row.rateId,
      priceMinor: i.row.priceMinor,
      effectivePriceMinor: effectivePrice(i.row, i.row.rateId ? rateById.get(i.row.rateId) : null),
      cancelReason: i.row.cancelReason,
      completedAt: i.row.completedAt,
      groupName: i.groupName,
      eventName: i.eventName,
      occurrenceDate: i.row.occurrenceDate,
    },
    roster: rosters.get(i.row.id) ?? [],
    notes: notes.filter((n) => n.lessonId === i.row.id).map((n) => toNoteDto(n, authors)),
  }));
}

export function toNoteDto(
  n: typeof note.$inferSelect,
  authors: Map<string, CoachRefDto> = new Map(),
): NoteDto {
  return {
    id: n.id,
    clientId: n.clientId,
    lessonId: n.lessonId,
    body: n.body,
    pinned: n.pinned,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    createdBy: n.createdBy,
    author: n.createdBy ? (authors.get(n.createdBy) ?? null) : null,
    visibility: n.visibility,
    kind: n.kind,
    editedAt: n.editedAt,
  };
}

export async function lessonsBetween(ctx: Ctx, from: string, to: string) {
  const tz = ctx.settings.timezone;
  return lessonSummaries(
    ctx,
    and(
      gte(lesson.startsAt, startOfLocalDay(from, tz)),
      lt(lesson.startsAt, startOfLocalDay(addDays(to, 1), tz)),
    ),
  );
}

export async function offlinePack(ctx: Ctx, days = 7) {
  const from = todayIn(ctx.settings.timezone);
  const to = addDays(from, days);
  const items = await lessonsBetween(ctx, from, to);
  return { generatedAt: Date.now(), from, to, lessons: await lessonDetails(ctx, items) };
}

export async function today(ctx: Ctx): Promise<TodayDto> {
  const { db, workspaceId, settings } = ctx;
  const date = todayIn(settings.timezone);
  const items = await lessonsBetween(ctx, date, date);
  const rosters = await rostersFor(
    ctx,
    items.map((i) => i.row),
  );

  const pref = await db.query.notificationPref.findFirst({
    where: eq(notificationPref.userId, ctx.userId),
  });
  const expiryWindow = pref?.packageExpiryDays ?? 7;

  const [activePackages, due, clients, uniforms, enrollments] = await Promise.all([
    db
      .select({
        clientId: clientPackage.clientId,
        name: clientPackage.name,
        remaining: remainingExpr,
        expiresOn: clientPackage.expiresOn,
        firstName: client.firstName,
        lastName: client.lastName,
      })
      .from(clientPackage)
      .innerJoin(client, eq(client.id, clientPackage.clientId))
      .where(
        and(
          eq(clientPackage.workspaceId, workspaceId),
          eq(clientPackage.status, "active"),
          ne(client.status, "archived"),
        ),
      ),
    can(ctx.role, "money") ? balancesDue(ctx) : Promise.resolve([]),
    db
      .select({
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        birthDate: client.birthDate,
      })
      .from(client)
      .where(
        and(
          eq(client.workspaceId, workspaceId),
          inArray(client.status, ["active", "lead"]),
          sql`substr(${client.birthDate}, 6, 5) = ${monthDay(date)}`,
        ),
      ),
    // Owners and admins hand out the uniforms packages came with.
    can(ctx.role, "catalog")
      ? db
          .select({
            id: clientPackage.id,
            clientId: clientPackage.clientId,
            name: clientPackage.name,
            uniformSize: clientPackage.uniformSize,
            firstName: client.firstName,
            lastName: client.lastName,
          })
          .from(clientPackage)
          .innerJoin(client, eq(client.id, clientPackage.clientId))
          .where(
            and(
              eq(clientPackage.workspaceId, workspaceId),
              eq(clientPackage.includesUniform, true),
              isNull(clientPackage.uniformIssuedAt),
              inArray(clientPackage.status, ["active", "exhausted"]),
              ne(client.status, "archived"),
            ),
          )
          .orderBy(asc(clientPackage.purchasedOn))
          .limit(20)
      : Promise.resolve([]),
    // Owners and admins: requests to review, and in the month's last week who hasn't renewed.
    can(ctx.role, "enrollment")
      ? Promise.all([
          requestedCount(ctx),
          isLastWeekOfMonth(date) ? renewalsDue(ctx).then((r) => r.length) : null,
        ]).then(([requested, notRenewed]) => ({ requested, notRenewed }))
      : Promise.resolve(undefined),
  ]);

  const horizon = addDays(date, expiryWindow);
  const notExpired = (p: { expiresOn: string | null }) =>
    p.expiresOn === null || p.expiresOn >= date;
  return {
    date,
    now: Date.now(),
    lessons: items.map((i) => ({ ...i.summary, roster: rosters.get(i.row.id) ?? [] })),
    alerts: {
      lowCredits: activePackages
        .filter((p) => Number(p.remaining) === 1 && notExpired(p))
        .map((p) => ({
          clientId: p.clientId,
          name: `${p.firstName} ${p.lastName}`.trim(),
          packageName: p.name,
          remaining: Number(p.remaining),
        })),
      expiringPackages: activePackages
        .filter(
          (p) =>
            p.expiresOn && p.expiresOn >= date && p.expiresOn <= horizon && Number(p.remaining) > 0,
        )
        .sort((a, b) => compareDates(a.expiresOn ?? "", b.expiresOn ?? ""))
        .map((p) => ({
          clientId: p.clientId,
          name: `${p.firstName} ${p.lastName}`.trim(),
          packageName: p.name,
          expiresOn: p.expiresOn as string,
          remaining: Number(p.remaining),
        })),
      balancesDue: due.slice(0, 8).map((b) => ({
        clientId: b.clientId,
        name: `${b.firstName} ${b.lastName}`.trim(),
        balanceMinor: b.balanceMinor,
      })),
      birthdays: clients.map((c) => ({
        clientId: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        age: c.birthDate ? ageOn(c.birthDate, date) : null,
      })),
      uniforms: uniforms.map((u) => ({
        clientId: u.clientId,
        name: `${u.firstName} ${u.lastName}`.trim(),
        clientPackageId: u.id,
        packageName: u.name,
        uniformSize: u.uniformSize,
      })),
      ...(enrollments ? { enrollments } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Creation, recurrence, and group booking
// ---------------------------------------------------------------------------

export function occurrenceDates(
  s: { weekdays: number[]; startsOn: string; endsOn: string | null },
  from: string,
  through: string,
): string[] {
  const start = compareDates(from, s.startsOn) < 0 ? s.startsOn : from;
  const end = s.endsOn && compareDates(s.endsOn, through) < 0 ? s.endsOn : through;
  const out: string[] = [];
  for (let d = start; compareDates(d, end) <= 0; d = addDays(d, 1)) {
    if (s.weekdays.includes(weekdayOf(d))) out.push(d);
  }
  return out;
}

async function activeGroupMemberIds(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  groupId: string,
): Promise<string[]> {
  const rows = await ctx.db
    .select({ clientId: groupMember.clientId })
    .from(groupMember)
    .innerJoin(client, eq(client.id, groupMember.clientId))
    .where(
      and(
        eq(groupMember.workspaceId, ctx.workspaceId),
        eq(groupMember.groupId, groupId),
        isNull(groupMember.leftOn),
        ne(client.status, "archived"),
      ),
    );
  return rows.map((r) => r.clientId);
}

/** Players whose registration for an event is confirmed (not waitlisted or cancelled). */
async function registeredClientIds(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  eventId: string,
): Promise<string[]> {
  const rows = await ctx.db
    .select({ clientId: eventRegistration.clientId })
    .from(eventRegistration)
    .where(
      and(
        eq(eventRegistration.workspaceId, ctx.workspaceId),
        eq(eventRegistration.eventId, eventId),
        eq(eventRegistration.status, "registered"),
      ),
    );
  return rows.map((r) => r.clientId);
}

function attendanceRows(
  ctx: Pick<Ctx, "workspaceId">,
  lessonId: string,
  clientIds: readonly string[],
) {
  const now = Date.now();
  return clientIds.map((clientId) => ({
    id: uuidv7(),
    workspaceId: ctx.workspaceId,
    lessonId,
    clientId,
    status: "booked" as const,
    complimentary: false,
    version: 0,
    createdAt: now,
    updatedAt: now,
  }));
}

/** Materializes a series' occurrences up to `through` (inclusive), skipping ones that exist. */
export async function materializeSeries(
  ctx: Ctx,
  s: typeof lessonSeries.$inferSelect,
  through: string,
): Promise<string[]> {
  const { db, workspaceId } = ctx;
  const from = s.materializedThrough ? addDays(s.materializedThrough, 1) : s.startsOn;
  if (compareDates(from, through) > 0) return [];
  const dates = occurrenceDates(s, from, through);
  const existing = await db
    .select({ occurrenceDate: lesson.occurrenceDate })
    .from(lesson)
    .where(and(eq(lesson.workspaceId, workspaceId), eq(lesson.seriesId, s.id)));
  const have = new Set(existing.map((e) => e.occurrenceDate));
  const participants = s.groupId ? await activeGroupMemberIds(ctx, s.groupId) : s.participantIds;

  const now = Date.now();
  const lessons: (typeof lesson.$inferInsert)[] = [];
  const bookings: ReturnType<typeof attendanceRows> = [];
  for (const d of dates) {
    if (have.has(d)) continue;
    const startsAt = zonedToEpoch(d, s.startTime, s.timezone);
    const id = uuidv7(startsAt);
    lessons.push({
      id,
      workspaceId,
      kind: s.kind,
      title: s.title,
      startsAt,
      endsAt: startsAt + s.durationMinutes * 60_000,
      venueId: s.venueId,
      court: s.court,
      groupId: s.groupId,
      rateId: s.rateId,
      priceMinor: s.priceMinor,
      capacity: s.capacity,
      status: "scheduled",
      seriesId: s.id,
      occurrenceDate: d,
      detached: false,
      coachUserId: s.coachUserId,
      assistantCoachIds: s.assistantCoachIds ?? [],
      createdAt: now,
      updatedAt: now,
    });
    bookings.push(...attendanceRows(ctx, id, participants));
  }
  const endMark = s.endsOn && compareDates(s.endsOn, through) < 0 ? s.endsOn : through;
  await runBatch(ctx, [
    ...chunkRows(lessons, 20).map((rows) => db.insert(lesson).values(rows).onConflictDoNothing()),
    ...chunkRows(bookings, 9).map((rows) =>
      db.insert(attendance).values(rows).onConflictDoNothing(),
    ),
    db
      .update(lessonSeries)
      .set({ materializedThrough: endMark })
      .where(and(eq(lessonSeries.id, s.id), eq(lessonSeries.workspaceId, workspaceId))),
  ]);
  return lessons.map((l) => l.id as string);
}

/**
 * Lead and assistant coaches for new sessions: what the request says, else the group's or event's
 * coaches (those still on the team), else whoever schedules them as the lead.
 */
async function sessionCoaches(
  ctx: Ctx,
  input: Pick<LessonCreateInput, "coachUserId" | "assistantCoachIds">,
  source: { coachUserId: string | null; assistantCoachIds: string[] } | undefined,
) {
  const team = await staffIds(ctx.db, ctx.workspaceId);
  const explicit = [input.coachUserId, ...(input.assistantCoachIds ?? [])].filter(
    (id): id is string => Boolean(id),
  );
  if (explicit.some((id) => !team.has(id))) {
    throw badRequest("Pick coaches from your team.", {
      fields: { coachUserId: "That person isn't on your team." },
    });
  }
  const fromSource =
    source?.coachUserId && team.has(source.coachUserId) ? source.coachUserId : null;
  const lead = input.coachUserId !== undefined ? input.coachUserId : (fromSource ?? ctx.userId);
  const assistants =
    input.assistantCoachIds ?? (source?.assistantCoachIds ?? []).filter((id) => team.has(id));
  return cleanCoaches(lead, assistants);
}

export async function createLessons(
  ctx: Ctx,
  input: LessonCreateInput,
): Promise<{ lessonIds: string[]; seriesId: string | null }> {
  const { db, workspaceId, settings } = ctx;
  const tz = settings.timezone;
  let grp: typeof trainingGroup.$inferSelect | undefined;
  if (input.groupId) {
    grp = await db.query.trainingGroup.findFirst({
      where: and(eq(trainingGroup.id, input.groupId), eq(trainingGroup.workspaceId, workspaceId)),
    });
    if (!grp) throw notFound("Group");
  }
  let ev: typeof event.$inferSelect | undefined;
  if (input.eventId) {
    ev = await db.query.event.findFirst({
      where: and(eq(event.id, input.eventId), eq(event.workspaceId, workspaceId)),
    });
    if (!ev) throw notFound("Event");
  }
  const clientIds = unique(input.clientIds);
  if (clientIds.length) {
    const found = await db
      .select({ id: client.id })
      .from(client)
      .where(and(eq(client.workspaceId, workspaceId), inList(client.id, clientIds)));
    if (found.length !== clientIds.length) throw badRequest("Some clients were not found.");
  }
  const coaches = await sessionCoaches(ctx, input, grp ?? ev);

  if (input.recurrence) {
    if (input.recurrence.endsOn && compareDates(input.recurrence.endsOn, input.date) < 0) {
      throw badRequest("The repeat end date is before the first session.");
    }
    // A series can't carry its event, so event sessions are added one by one instead.
    if (ev) return createEventSessions(ctx, input, input.recurrence, ev, clientIds, coaches);
    const seriesId = input.id ?? uuidv7();
    const row: typeof lessonSeries.$inferInsert = {
      id: seriesId,
      workspaceId,
      kind: input.kind,
      title: input.title ?? null,
      groupId: input.groupId ?? null,
      venueId: input.venueId ?? null,
      court: input.court ?? null,
      rateId: input.rateId ?? null,
      priceMinor: input.priceMinor ?? null,
      capacity: input.capacity ?? null,
      weekdays: unique(input.recurrence.weekdays).sort(),
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      startsOn: input.date,
      endsOn: input.recurrence.endsOn ?? null,
      timezone: tz,
      participantIds: input.groupId ? [] : clientIds,
      materializedThrough: null,
      active: true,
      ...coaches,
    };
    await db.insert(lessonSeries).values(row);
    const created = await db.query.lessonSeries.findFirst({ where: eq(lessonSeries.id, seriesId) });
    if (!created) throw notFound("Series");
    const through = addDays(todayIn(tz), MATERIALIZE_DAYS);
    const ids = await materializeSeries(
      ctx,
      created,
      compareDates(through, input.date) < 0 ? input.date : through,
    );
    if (input.groupId && clientIds.length) {
      await bookClientsIntoLessons(ctx, ids, clientIds);
    }
    // Series rows have no notes column, so the plan is kept on the first session.
    const first = ids[0];
    if (input.notes && first) {
      await db
        .update(lesson)
        .set({ notes: input.notes })
        .where(and(eq(lesson.id, first), eq(lesson.workspaceId, workspaceId)));
    }
    return { lessonIds: ids, seriesId };
  }

  const startsAt = zonedToEpoch(input.date, input.startTime, tz);
  const id = input.id ?? uuidv7(startsAt);
  const participants = unique([
    ...(input.groupId ? await activeGroupMemberIds(ctx, input.groupId) : []),
    ...(ev ? await registeredClientIds(ctx, ev.id) : []),
    ...clientIds,
  ]);
  await runBatch(ctx, [
    db.insert(lesson).values({
      id,
      workspaceId,
      kind: input.kind,
      title: input.title ?? null,
      startsAt,
      endsAt: startsAt + input.durationMinutes * 60_000,
      venueId: input.venueId ?? null,
      court: input.court ?? null,
      groupId: input.groupId ?? null,
      eventId: input.eventId ?? null,
      rateId: input.rateId ?? null,
      priceMinor: input.priceMinor ?? null,
      capacity: input.capacity ?? null,
      notes: input.notes ?? null,
      status: "scheduled",
      ...coaches,
    }),
    ...chunkRows(attendanceRows(ctx, id, participants), 9).map((rows) =>
      db.insert(attendance).values(rows).onConflictDoNothing(),
    ),
  ]);
  return { lessonIds: [id], seriesId: null };
}

/**
 * "Repeats" for an event: one-off sessions on the chosen weekdays from the first date through the
 * event's last day (or an earlier end date), each booked with the event's registered players.
 */
async function createEventSessions(
  ctx: Ctx,
  input: LessonCreateInput,
  recurrence: NonNullable<LessonCreateInput["recurrence"]>,
  ev: typeof event.$inferSelect,
  clientIds: readonly string[],
  coaches: { coachUserId: string | null; assistantCoachIds: string[] },
): Promise<{ lessonIds: string[]; seriesId: null }> {
  const { db, workspaceId, settings } = ctx;
  const from = compareDates(input.date, ev.startsOn) < 0 ? ev.startsOn : input.date;
  const until =
    recurrence.endsOn && compareDates(recurrence.endsOn, ev.endsOn) < 0
      ? recurrence.endsOn
      : ev.endsOn;
  const dates = occurrenceDates(
    { weekdays: unique(recurrence.weekdays), startsOn: from, endsOn: until },
    from,
    until,
  );
  if (dates.length === 0) {
    throw badRequest("None of the days you picked fall within the event's dates.", {
      fields: { "recurrence.weekdays": "No sessions fall within the event's dates." },
    });
  }
  if (dates.length > MAX_EVENT_SESSIONS) {
    throw badRequest(
      `That would add ${dates.length} sessions. Add at most ${MAX_EVENT_SESSIONS} at a time.`,
      {
        fields: {
          "recurrence.endsOn": `Pick an earlier date: at most ${MAX_EVENT_SESSIONS} sessions at a time.`,
        },
      },
    );
  }
  const participants = unique([
    ...(input.groupId ? await activeGroupMemberIds(ctx, input.groupId) : []),
    ...(await registeredClientIds(ctx, ev.id)),
    ...clientIds,
  ]);
  const now = Date.now();
  const rows = dates.map((d, i) => {
    const startsAt = zonedToEpoch(d, input.startTime, settings.timezone);
    return {
      id: i === 0 && input.id ? input.id : uuidv7(startsAt),
      workspaceId,
      kind: input.kind,
      title: input.title ?? null,
      startsAt,
      endsAt: startsAt + input.durationMinutes * 60_000,
      venueId: input.venueId ?? null,
      court: input.court ?? null,
      groupId: input.groupId ?? null,
      eventId: ev.id,
      rateId: input.rateId ?? null,
      priceMinor: input.priceMinor ?? null,
      capacity: input.capacity ?? null,
      // Like a new series, the plan belongs to the first session.
      notes: i === 0 ? (input.notes ?? null) : null,
      status: "scheduled" as const,
      detached: false,
      coachUserId: coaches.coachUserId,
      assistantCoachIds: coaches.assistantCoachIds,
      createdAt: now,
      updatedAt: now,
    } satisfies typeof lesson.$inferInsert;
  });
  const ids = rows.map((r) => r.id);
  await runBatch(ctx, [
    ...chunkRows(rows, 24).map((chunk) => db.insert(lesson).values(chunk)),
    ...chunkRows(
      ids.flatMap((lessonId) => attendanceRows(ctx, lessonId, participants)),
      9,
    ).map((chunk) => db.insert(attendance).values(chunk).onConflictDoNothing()),
  ]);
  return { lessonIds: ids, seriesId: null };
}

export async function bookClientsIntoLessons(
  ctx: Ctx,
  lessonIds: readonly string[],
  clientIds: readonly string[],
) {
  const rows = lessonIds.flatMap((lessonId) => attendanceRows(ctx, lessonId, clientIds));
  await runBatch(
    ctx,
    chunkRows(rows, 9).map((chunk) =>
      ctx.db.insert(attendance).values(chunk).onConflictDoNothing(),
    ),
  );
}

/** Books a new group member into the group's upcoming scheduled sessions. */
export async function syncMemberIntoGroupLessons(
  ctx: Ctx,
  groupId: string,
  clientIds: readonly string[],
) {
  const upcoming = await ctx.db
    .select({ id: lesson.id })
    .from(lesson)
    .where(
      and(
        eq(lesson.workspaceId, ctx.workspaceId),
        eq(lesson.groupId, groupId),
        eq(lesson.status, "scheduled"),
        gte(lesson.startsAt, Date.now()),
      ),
    );
  await bookClientsIntoLessons(
    ctx,
    upcoming.map((l) => l.id),
    clientIds,
  );
}

/** Removes a departing member's untouched bookings from the group's upcoming sessions. */
export async function unbookMemberFromGroupLessons(ctx: Ctx, groupId: string, clientId: string) {
  await ctx.db
    .delete(attendance)
    .where(
      and(
        eq(attendance.workspaceId, ctx.workspaceId),
        eq(attendance.clientId, clientId),
        eq(attendance.status, "booked"),
        sql`"attendance"."lesson_id" in (select l.id from lesson l where l.group_id = ${groupId} and l.starts_at >= ${Date.now()} and l.status = 'scheduled')`,
      ),
    );
}

/** Extends every active series to the rolling horizon. Called daily from cron and on demand. */
export async function extendAllSeries(ctx: Ctx) {
  const through = addDays(todayIn(ctx.settings.timezone), MATERIALIZE_DAYS);
  const series = await ctx.db
    .select()
    .from(lessonSeries)
    .where(and(eq(lessonSeries.workspaceId, ctx.workspaceId), eq(lessonSeries.active, true)));
  for (const s of series) {
    if (s.materializedThrough && compareDates(s.materializedThrough, through) >= 0) continue;
    if (s.endsOn && s.materializedThrough && compareDates(s.materializedThrough, s.endsOn) >= 0)
      continue;
    await materializeSeries(ctx, s, through);
  }
}

export type { LessonRow };
