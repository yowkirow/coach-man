import { and, asc, desc, eq, gt, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  type AnnouncementState,
  announcementState,
  audienceKey,
  compareLive,
  type FamilyAudience,
  reachesFamily,
  resolvePublish,
  sortForState,
} from "../../shared/announcements";
import type {
  AnnouncementDto,
  AnnouncementListDto,
  CoachRefDto,
  PortalAnnouncementDto,
} from "../../shared/api-types";
import type { AnnouncementAudience } from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import type { AnnouncementInput } from "../../shared/schemas";
import type { Db } from "../db/client";
import {
  announcement,
  auditLog,
  clientAccess,
  event,
  eventRegistration,
  groupMember,
  trainingGroup,
} from "../db/schema";
import { badRequest, notFound } from "../lib/errors";
import { toPortalAnnouncement } from "../lib/portal-dto";
import type { PortalLink } from "../lib/portal-scope";
import { inList, unique } from "../lib/sql";
import type { Ctx } from "../types";
import { coachRefs } from "./coaches";

type Row = typeof announcement.$inferSelect;
type StaffCtx = Pick<Ctx, "db" | "workspaceId">;

/** Live now: published, its time reached, and not ended. */
const liveAt = (now: number) =>
  and(
    isNotNull(announcement.publishedAt),
    lte(announcement.publishedAt, now),
    or(isNull(announcement.expiresAt), gt(announcement.expiresAt, now)),
  );

/** Program and event names by `audienceKey(workspaceId, id)`, for the rows that target one. */
async function audienceNames(db: Db, rows: readonly Row[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const programIds = unique(
    rows.filter((r) => r.audience === "program" && r.audienceId).map((r) => r.audienceId as string),
  );
  const eventIds = unique(
    rows.filter((r) => r.audience === "event" && r.audienceId).map((r) => r.audienceId as string),
  );
  const [groups, events] = await Promise.all([
    programIds.length
      ? db
          .select({
            id: trainingGroup.id,
            workspaceId: trainingGroup.workspaceId,
            name: trainingGroup.name,
          })
          .from(trainingGroup)
          .where(inList(trainingGroup.id, programIds))
      : Promise.resolve([]),
    eventIds.length
      ? db
          .select({ id: event.id, workspaceId: event.workspaceId, name: event.name })
          .from(event)
          .where(inList(event.id, eventIds))
      : Promise.resolve([]),
  ]);
  for (const g of groups) out.set(audienceKey(g.workspaceId, g.id), g.name);
  for (const e of events) out.set(audienceKey(e.workspaceId, e.id), e.name);
  return out;
}

const nameOf = (names: Map<string, string>, r: Row) =>
  r.audience !== "all" && r.audienceId
    ? (names.get(audienceKey(r.workspaceId, r.audienceId)) ?? null)
    : null;

function toDto(
  r: Row,
  names: Map<string, string>,
  authors: Map<string, CoachRefDto>,
  now: number,
): AnnouncementDto {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    audience: r.audience,
    audienceId: r.audience === "all" ? null : r.audienceId,
    audienceName: nameOf(names, r),
    pinned: r.pinned,
    publishedAt: r.publishedAt,
    expiresAt: r.expiresAt,
    state: announcementState(r, now),
    notifiedAt: r.notifiedAt,
    author: r.createdBy ? (authors.get(r.createdBy) ?? null) : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function toDtos(ctx: StaffCtx, rows: Row[], now: number): Promise<AnnouncementDto[]> {
  if (!rows.length) return [];
  const [names, authors] = await Promise.all([
    audienceNames(ctx.db, rows),
    coachRefs(
      ctx.db,
      ctx.workspaceId,
      rows.map((r) => r.createdBy),
    ),
  ]);
  return rows.map((r) => toDto(r, names, authors, now));
}

async function rowOf(ctx: StaffCtx, id: string): Promise<Row> {
  const row = await ctx.db.query.announcement.findFirst({
    where: and(eq(announcement.id, id), eq(announcement.workspaceId, ctx.workspaceId)),
  });
  if (!row) throw notFound("Announcement");
  return row;
}

/**
 * The academy's announcements in one state (or all), with counts per state. `full` = the caller
 * may compose (`announcements`); everyone else only ever gets the live ones and their count.
 */
export async function listAnnouncements(
  ctx: StaffCtx,
  status: AnnouncementState | "all",
  now: number,
  full: boolean,
): Promise<AnnouncementListDto> {
  const rows = await ctx.db
    .select()
    .from(announcement)
    .where(eq(announcement.workspaceId, ctx.workspaceId))
    .orderBy(desc(announcement.updatedAt))
    .limit(500);
  const counts: Record<AnnouncementState, number> = { draft: 0, scheduled: 0, live: 0, expired: 0 };
  for (const r of rows) counts[announcementState(r, now)]++;
  if (!full) {
    counts.draft = 0;
    counts.scheduled = 0;
    counts.expired = 0;
  }
  const wanted = full ? status : "live";
  const picked =
    wanted === "all"
      ? rows
      : sortForState(
          wanted,
          rows.filter((r) => announcementState(r, now) === wanted),
        );
  return { now, counts, items: await toDtos(ctx, picked, now) };
}

/** Live announcements for staff (Today's card), pinned first then newest. */
export async function liveAnnouncements(
  ctx: StaffCtx,
  now: number,
  limit = 10,
): Promise<AnnouncementDto[]> {
  const rows = await ctx.db
    .select()
    .from(announcement)
    .where(and(eq(announcement.workspaceId, ctx.workspaceId), liveAt(now)))
    .limit(200);
  return toDtos(ctx, rows.sort(compareLive).slice(0, limit), now);
}

export async function announcementDetail(ctx: StaffCtx, id: string, now: number) {
  const [dto] = await toDtos(ctx, [await rowOf(ctx, id)], now);
  return dto as AnnouncementDto;
}

/** A program (group) or event must be one of this academy's. */
async function checkAudience(ctx: StaffCtx, audience: AnnouncementAudience, id: string | null) {
  if (audience === "all") return;
  const found =
    audience === "program"
      ? await ctx.db.query.trainingGroup.findFirst({
          where: and(
            eq(trainingGroup.id, id ?? ""),
            eq(trainingGroup.workspaceId, ctx.workspaceId),
          ),
          columns: { id: true },
        })
      : await ctx.db.query.event.findFirst({
          where: and(eq(event.id, id ?? ""), eq(event.workspaceId, ctx.workspaceId)),
          columns: { id: true },
        });
  if (!found) {
    const message =
      audience === "program" ? "Pick one of your programs." : "Pick one of your events.";
    throw badRequest(message, { fields: { audienceId: message } });
  }
}

function announcementAudit(
  ctx: Pick<Ctx, "db" | "workspaceId" | "userId">,
  action: "create" | "update" | "unpublish" | "delete",
  row: Pick<Row, "id" | "audience" | "audienceId" | "publishedAt" | "expiresAt" | "pinned">,
  now: number,
) {
  return ctx.db.insert(auditLog).values({
    id: uuidv7(),
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action,
    entity: "announcement",
    entityId: row.id,
    data: {
      state: announcementState(row, now),
      audience: row.audience,
      ...(row.audienceId ? { audienceId: row.audienceId } : {}),
      pinned: row.pinned,
    },
  });
}

/**
 * Creates (no `id`) or saves an announcement from the composer: the audience must be this
 * academy's, and `resolvePublish` decides when it goes live. One that is live once saved is
 * announced at once (`announceIfDue`: the publish hook runs once per announcement, ever).
 */
export async function saveAnnouncement(
  ctx: Ctx,
  input: AnnouncementInput,
  id: string | null,
  now: number,
): Promise<AnnouncementDto> {
  const current = id ? await rowOf(ctx, id) : null;
  const audienceId = input.audience === "all" ? null : (input.audienceId ?? null);
  await checkAudience(ctx, input.audience, audienceId);
  const check = resolvePublish({
    mode: input.publish,
    publishAt: input.publishAt ?? null,
    expiresAt: input.expiresAt ?? null,
    current,
    now,
  });
  if (!check.ok) throw badRequest(check.message, { fields: { [check.field]: check.message } });
  const values = {
    title: input.title,
    body: input.body,
    audience: input.audience,
    audienceId,
    pinned: input.pinned,
    publishedAt: check.publishedAt,
    expiresAt: check.expiresAt,
  };
  const rowId = current?.id ?? uuidv7();
  await ctx.db.batch([
    current
      ? ctx.db
          .update(announcement)
          .set(values)
          .where(and(eq(announcement.id, rowId), eq(announcement.workspaceId, ctx.workspaceId)))
      : ctx.db
          .insert(announcement)
          .values({ id: rowId, workspaceId: ctx.workspaceId, createdBy: ctx.userId, ...values }),
    announcementAudit(ctx, current ? "update" : "create", { id: rowId, ...values }, now),
  ]);
  if (announcementState(values, now) === "live") await announceIfDue(ctx.db, ctx.env, rowId, now);
  return announcementDetail(ctx, rowId, now);
}

/** Back to a draft: families stop seeing it (it isn't announced again if it's published again). */
export async function unpublishAnnouncement(ctx: Ctx, id: string, now: number) {
  const row = await rowOf(ctx, id);
  if (row.publishedAt !== null) {
    await ctx.db.batch([
      ctx.db
        .update(announcement)
        .set({ publishedAt: null })
        .where(and(eq(announcement.id, id), eq(announcement.workspaceId, ctx.workspaceId))),
      announcementAudit(ctx, "unpublish", { ...row, publishedAt: null }, now),
    ]);
  }
  return announcementDetail(ctx, id, now);
}

export async function deleteAnnouncement(ctx: Ctx, id: string, now: number) {
  const row = await rowOf(ctx, id);
  await ctx.db.batch([
    ctx.db
      .delete(announcement)
      .where(and(eq(announcement.id, id), eq(announcement.workspaceId, ctx.workspaceId))),
    announcementAudit(ctx, "delete", row, now),
  ]);
}

// --- Going live: the publish hook, once per announcement -----------------------------------------

/**
 * The family accounts an announcement reaches, by its audience: everyone with an active link to a
 * student of the academy, to a current member of the program, or to a student registered for the
 * event (not cancelled). For the publish hook (family push, WS5b).
 */
export async function familyRecipients(
  db: Db,
  a: Pick<Row, "workspaceId" | "audience" | "audienceId">,
): Promise<string[]> {
  const audience =
    a.audience === "program"
      ? sql`exists (select 1 from ${groupMember} where ${groupMember.clientId} = ${clientAccess.clientId} and ${groupMember.workspaceId} = ${clientAccess.workspaceId} and ${groupMember.groupId} = ${a.audienceId ?? ""} and ${groupMember.leftOn} is null)`
      : a.audience === "event"
        ? sql`exists (select 1 from ${eventRegistration} where ${eventRegistration.clientId} = ${clientAccess.clientId} and ${eventRegistration.workspaceId} = ${clientAccess.workspaceId} and ${eventRegistration.eventId} = ${a.audienceId ?? ""} and ${eventRegistration.status} != 'cancelled')`
        : undefined;
  const rows = await db
    .select({ userId: clientAccess.userId })
    .from(clientAccess)
    .where(
      and(eq(clientAccess.workspaceId, a.workspaceId), isNull(clientAccess.revokedAt), audience),
    );
  return unique(rows.map((r) => r.userId));
}

/**
 * The publish hook: runs exactly once per announcement, when it goes live (published now from the
 * composer, or a scheduled one reaching its time, picked up by the 5-minute cron). WS5b sends the
 * family push from here (`familyRecipients` says to whom; the payload is the family DTO's title
 * and a link to /my/announcements). Until then it only logs how many families it would reach.
 */
export async function announcementPublished(
  ctx: { db: Db; env: Env },
  a: Row,
): Promise<{ recipients: number }> {
  const recipients = await familyRecipients(ctx.db, a);
  console.log(
    JSON.stringify({
      event: "announcement_published",
      announcementId: a.id,
      workspaceId: a.workspaceId,
      audience: a.audience,
      recipients: recipients.length,
    }),
  );
  return { recipients: recipients.length };
}

/**
 * Claims a live announcement that hasn't been announced (one guarded UPDATE: whoever sets
 * `notified_at` first wins), then runs the publish hook. False when it isn't due or was already
 * announced, so calling it twice, or from two places at once, announces once.
 */
export async function announceIfDue(db: Db, env: Env, id: string, now: number): Promise<boolean> {
  const [row] = await db
    .update(announcement)
    .set({ notifiedAt: now })
    .where(and(eq(announcement.id, id), isNull(announcement.notifiedAt), liveAt(now)))
    .returning();
  if (!row) return false;
  try {
    await announcementPublished({ db, env }, row);
  } catch (err) {
    console.error("The announcement publish hook failed", err);
  }
  return true;
}

/**
 * The 5-minute cron: announces scheduled announcements whose time has come (oldest first, at most
 * 100 a run). One that ended before it was announced is marked handled without announcing it.
 * Returns the ids it announced.
 */
export async function runAnnouncements(db: Db, env: Env, now: number): Promise<string[]> {
  await db
    .update(announcement)
    .set({ notifiedAt: now })
    .where(
      and(
        isNull(announcement.notifiedAt),
        isNotNull(announcement.publishedAt),
        lte(announcement.publishedAt, now),
        isNotNull(announcement.expiresAt),
        lte(announcement.expiresAt, now),
      ),
    );
  const due = await db
    .select({ id: announcement.id })
    .from(announcement)
    .where(and(isNull(announcement.notifiedAt), liveAt(now)))
    .orderBy(asc(announcement.publishedAt))
    .limit(100);
  const fired: string[] = [];
  for (const d of due) if (await announceIfDue(db, env, d.id, now)) fired.push(d.id);
  return fired;
}

// --- The family's feed -----------------------------------------------------------------------------

/**
 * What the caller's linked students belong to: their academies, the programs they're current
 * members of (`left_on` empty), and the events they're registered for (not cancelled), each in
 * the student's own academy.
 */
export async function familyAudience(
  db: Db,
  links: readonly PortalLink[],
): Promise<FamilyAudience> {
  const ids = unique(links.map((l) => l.clientId));
  const linked = (r: { workspaceId: string; clientId: string }) =>
    links.some((l) => l.clientId === r.clientId && l.workspaceId === r.workspaceId);
  const [members, registrations] = ids.length
    ? await Promise.all([
        db
          .select({
            workspaceId: groupMember.workspaceId,
            clientId: groupMember.clientId,
            groupId: groupMember.groupId,
          })
          .from(groupMember)
          .where(and(inList(groupMember.clientId, ids), isNull(groupMember.leftOn))),
        db
          .select({
            workspaceId: eventRegistration.workspaceId,
            clientId: eventRegistration.clientId,
            eventId: eventRegistration.eventId,
          })
          .from(eventRegistration)
          .where(
            and(inList(eventRegistration.clientId, ids), ne(eventRegistration.status, "cancelled")),
          ),
      ])
    : [[], []];
  return {
    workspaceIds: new Set(links.map((l) => l.workspaceId)),
    programs: new Set(members.filter(linked).map((m) => audienceKey(m.workspaceId, m.groupId))),
    events: new Set(registrations.filter(linked).map((r) => audienceKey(r.workspaceId, r.eventId))),
  };
}

/**
 * The live announcements that reach the caller's students (`reachesFamily`), pinned first then
 * newest, as families see them (never who wrote them). Drafts, scheduled ones, ended ones, other
 * academies', and programs or events the family isn't in never appear.
 */
export async function familyAnnouncements(
  db: Db,
  links: readonly PortalLink[],
  now: number,
  limit?: number,
): Promise<PortalAnnouncementDto[]> {
  if (!links.length) return [];
  const workspaces = unique(links.map((l) => l.workspaceId));
  const [rows, audience] = await Promise.all([
    db
      .select()
      .from(announcement)
      .where(and(inList(announcement.workspaceId, workspaces), liveAt(now)))
      .limit(500),
    familyAudience(db, links),
  ]);
  const reached = rows.filter((r) => reachesFamily(r, audience, now)).sort(compareLive);
  const shown = limit ? reached.slice(0, limit) : reached;
  const names = await audienceNames(db, shown);
  return shown.flatMap((r) => {
    const dto = toPortalAnnouncement(r, nameOf(names, r));
    return dto ? [dto] : [];
  });
}
