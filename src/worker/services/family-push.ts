// Family reminders: push notifications for students and parents. The rules (who, when, what a push
// says) live in src/shared/notifications.ts; this file loads the facts, hands them to the rules,
// and delivers through services/push.ts. Immediate events (decisions, proofs, comments,
// announcements, cancellations) run after the response (lib/defer.ts); the 5-minute cron sends
// session and payment reminders and whatever waited for quiet hours to end; the daily maintenance
// runs the package sweeps. Every push is logged once per person and thing (notification_log).

import { and, asc, eq, gt, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { isOpenEnrollment } from "../../shared/enrollment";
import { isMinor } from "../../shared/family";
import { uuidv7 } from "../../shared/ids";
import { isFamilyVisible } from "../../shared/notes";
import {
  type AcademyFacts,
  batchNotices,
  cancellationNotice,
  cancellationUrgent,
  type FamilyNotice,
  type FamilyPrefs,
  familyPayload,
  familyPrefsOf,
  firstLine,
  firstNameOf,
  linkRecipients,
  NOTICE_AUDIENCE,
  noticeKey,
  packageSweep,
  paymentReminderDue,
  planDeliveries,
  quietOf,
  REMINDER_LOOKAHEAD_MS,
  type StudentLink,
  type SweepRenewal,
  sessionReminderDue,
  staffAlertRecipients,
  staffEnrollmentPayload,
  staffProofPayload,
  whoOf,
} from "../../shared/notifications";
import { requestPayState } from "../../shared/payment-proofs";
import { todayIn } from "../../shared/time";
import { addMonths, lastDayOf, monthOf } from "../../shared/validity";
import { chunkRows, type Db } from "../db/client";
import {
  type announcement,
  assessment,
  attendance,
  client,
  clientAccess,
  clientPackage,
  enrollmentRequest,
  event,
  familyNotificationPref,
  familyNotificationQueue,
  familyPushSubscription,
  lesson,
  member,
  note,
  notificationPref,
  organization,
  packageTemplate,
  paymentSubmission,
  trainingGroup,
  venue,
  workspaceSettings,
} from "../db/schema";
import { portalSessionTitle, toPortalAnnouncement } from "../lib/portal-dto";
import { inList, unique } from "../lib/sql";
import { coachRefs } from "./coaches";
import { remainingExpr } from "./credits";
import { isRenewal, paymentsFor } from "./enrollment-core";
import { renewalFacts, renewalOf } from "./enrollment-family";
import {
  canPush,
  claimLog,
  deliver,
  familyDevices,
  loggedKeys,
  logKey,
  notifyUser,
  type PushDevice,
} from "./push-delivery";

type AnnouncementRow = typeof announcement.$inferSelect;

// --- Facts -----------------------------------------------------------------------------------

/** Each academy's name, time zone, and locale (what a push's wording and timing use). */
export async function academyFacts(
  db: Db,
  workspaceIds: readonly string[],
): Promise<Map<string, AcademyFacts>> {
  const ids = unique(workspaceIds);
  const out = new Map<string, AcademyFacts>();
  if (!ids.length) return out;
  const rows = await db
    .select({
      workspaceId: organization.id,
      name: organization.name,
      timezone: workspaceSettings.timezone,
      locale: workspaceSettings.locale,
    })
    .from(organization)
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, organization.id))
    .where(inList(organization.id, ids));
  for (const r of rows) {
    out.set(r.workspaceId, {
      workspaceId: r.workspaceId,
      name: r.name,
      timezone: r.timezone ?? "UTC",
      locale: r.locale ?? "en-US",
    });
  }
  return out;
}

/** Each person's family notification settings (defaults for anyone who never saved any). */
export async function familyPrefsFor(
  db: Db,
  userIds: readonly string[],
): Promise<Map<string, FamilyPrefs>> {
  const ids = unique(userIds);
  const out = new Map<string, FamilyPrefs>();
  if (!ids.length) return out;
  const rows = await db
    .select()
    .from(familyNotificationPref)
    .where(inList(familyNotificationPref.userId, ids));
  for (const r of rows) out.set(r.userId, familyPrefsOf(r));
  return out;
}

export interface LinkedStudent extends StudentLink {
  workspaceId: string;
  firstName: string;
}

/** The active links to these students, with each student's first name and whether they're a minor. */
export async function studentLinks(
  db: Db,
  clientIds: readonly string[],
  now: number,
): Promise<LinkedStudent[]> {
  const ids = unique(clientIds);
  if (!ids.length) return [];
  const rows = await db
    .select({
      userId: clientAccess.userId,
      clientId: clientAccess.clientId,
      relation: clientAccess.relation,
      workspaceId: clientAccess.workspaceId,
      firstName: client.firstName,
      birthDate: client.birthDate,
      isJunior: client.isJunior,
      timezone: workspaceSettings.timezone,
    })
    .from(clientAccess)
    .innerJoin(
      client,
      and(eq(client.id, clientAccess.clientId), eq(client.workspaceId, clientAccess.workspaceId)),
    )
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, clientAccess.workspaceId))
    .where(and(inList(clientAccess.clientId, ids), isNull(clientAccess.revokedAt)));
  return rows.map((r) => ({
    userId: r.userId,
    clientId: r.clientId,
    relation: r.relation,
    workspaceId: r.workspaceId,
    firstName: r.firstName,
    minor: isMinor({
      birthDate: r.birthDate,
      isJunior: r.isJunior,
      today: todayIn(r.timezone ?? "UTC", now),
    }),
    revokedAt: null,
  }));
}

/** The reader's view of one student: their first name, or "you" when it's their own login. */
const whoFor = (link: LinkedStudent) =>
  whoOf([{ firstName: link.firstName, self: link.relation === "self" }]);

const baseOf = (academy: AcademyFacts, clientId: string | null) => ({
  academy: academy.name,
  timezone: academy.timezone,
  locale: academy.locale,
  clientId,
});

// --- Sending ---------------------------------------------------------------------------------

function devicesByUser(devices: readonly PushDevice[]): Map<string, PushDevice[]> {
  const out = new Map<string, PushDevice[]>();
  for (const d of devices) {
    const list = out.get(d.userId);
    if (list) list.push(d);
    else out.set(d.userId, [d]);
  }
  return out;
}

/**
 * Sends family notices: dropped for people without a family device or with the category off,
 * held in the queue during quiet hours (unless urgent), and otherwise claimed in the log and sent,
 * one push per person per kind. Returns how many pushes went out and how many wait.
 */
export async function sendFamilyNotices(
  db: Db,
  env: Env,
  notices: readonly FamilyNotice[],
  now: number,
): Promise<{ sent: number; queued: number }> {
  if (!notices.length || !canPush(env)) return { sent: 0, queued: 0 };
  const users = unique(notices.map((n) => n.userId));
  const [prefs, devices] = await Promise.all([familyPrefsFor(db, users), familyDevices(db, users)]);
  const byUser = devicesByUser(devices);
  const plan = planDeliveries({
    notices,
    prefs,
    withDevices: new Set(byUser.keys()),
    timezones: new Map(notices.map((n) => [n.workspaceId, n.item.timezone])),
    now,
  });
  if (plan.queue.length) {
    const rows = plan.queue.map(({ notice, sendAfter }) => ({
      id: uuidv7(),
      userId: notice.userId,
      workspaceId: notice.workspaceId,
      kind: notice.kind,
      refKey: notice.refKey,
      item: notice.item,
      sendAfter,
      createdAt: now,
    }));
    for (const chunk of chunkRows(rows, 8)) {
      await db.insert(familyNotificationQueue).values(chunk).onConflictDoNothing();
    }
  }
  const sent = await deliverNow(db, env, plan.send, byUser, now);
  return { sent, queued: plan.queue.length };
}

async function deliverNow(
  db: Db,
  env: Env,
  notices: readonly FamilyNotice[],
  byUser: ReadonlyMap<string, PushDevice[]>,
  now: number,
): Promise<number> {
  if (!notices.length) return 0;
  const claimed = await claimLog(
    db,
    notices.map((n) => ({
      userId: n.userId,
      workspaceId: n.workspaceId,
      kind: n.kind,
      refKey: n.refKey,
    })),
    now,
  );
  const fresh = notices.filter((n) => claimed.has(noticeKey(n)));
  let sent = 0;
  for (const batch of batchNotices(fresh)) {
    const first = batch[0];
    if (!first) continue;
    const payload = familyPayload(
      batch.map((n) => n.item),
      now,
    );
    if (!payload) continue;
    if ((await deliver(db, env, byUser.get(first.userId) ?? [], payload)) > 0) sent++;
  }
  return sent;
}

/**
 * The 5-minute cron: family notifications whose quiet hours have ended. Each run claims what's
 * due by deleting it (so two runs never send the same one), then sends it through the same rules
 * (settings changed since are respected; a notice still in someone's new quiet hours waits again).
 */
export async function runFamilyQueue(db: Db, env: Env, now: number): Promise<number> {
  const due = await db
    .select()
    .from(familyNotificationQueue)
    .where(lte(familyNotificationQueue.sendAfter, now))
    .orderBy(asc(familyNotificationQueue.sendAfter))
    .limit(200);
  if (!due.length) return 0;
  const taken = await db
    .delete(familyNotificationQueue)
    .where(
      inList(
        familyNotificationQueue.id,
        due.map((d) => d.id),
      ),
    )
    .returning({ id: familyNotificationQueue.id });
  const mine = new Set(taken.map((t) => t.id));
  const notices: FamilyNotice[] = due
    .filter((d) => mine.has(d.id))
    .map((d) => ({
      userId: d.userId,
      workspaceId: d.workspaceId,
      kind: d.kind,
      refKey: d.refKey,
      item: d.item,
    }));
  const { sent } = await sendFamilyNotices(db, env, notices, now);
  return sent;
}

// --- Session reminders (5-minute cron) -------------------------------------------------------

/** Users with at least one device for family notifications (a SQL fragment for filters). */
const HAS_FAMILY_DEVICE = sql`(select ${familyPushSubscription.userId} from ${familyPushSubscription})`;

/**
 * Upcoming-session reminders: for each session a linked student is on the roster of (bookings and
 * program sessions alike, as the portal's schedule counts them: not cancelled, and the student not
 * excused or late-cancelled), at each person's lead time, kept out of quiet hours where possible.
 * Once per person per session; several due at once travel as one push.
 */
export async function runSessionReminders(db: Db, env: Env, now: number): Promise<number> {
  const rows = await db
    .select({
      lessonId: lesson.id,
      workspaceId: lesson.workspaceId,
      startsAt: lesson.startsAt,
      title: lesson.title,
      kind: lesson.kind,
      court: lesson.court,
      venueName: venue.name,
      groupName: trainingGroup.name,
      eventName: event.name,
      clientId: attendance.clientId,
      firstName: client.firstName,
      userId: clientAccess.userId,
      relation: clientAccess.relation,
    })
    .from(lesson)
    .innerJoin(
      attendance,
      and(eq(attendance.lessonId, lesson.id), eq(attendance.workspaceId, lesson.workspaceId)),
    )
    .innerJoin(
      clientAccess,
      and(
        eq(clientAccess.clientId, attendance.clientId),
        eq(clientAccess.workspaceId, lesson.workspaceId),
        isNull(clientAccess.revokedAt),
      ),
    )
    .innerJoin(
      client,
      and(eq(client.id, attendance.clientId), eq(client.workspaceId, lesson.workspaceId)),
    )
    .leftJoin(venue, eq(venue.id, lesson.venueId))
    .leftJoin(trainingGroup, eq(trainingGroup.id, lesson.groupId))
    .leftJoin(event, eq(event.id, lesson.eventId))
    .where(
      and(
        // Only academies with someone to remind: the (workspace, starts_at) index does the rest.
        sql`${lesson.workspaceId} in (select ca.workspace_id from ${clientAccess} ca where ca.revoked_at is null and ca.user_id in ${HAS_FAMILY_DEVICE})`,
        eq(lesson.status, "scheduled"),
        gt(lesson.startsAt, now),
        lte(lesson.startsAt, now + REMINDER_LOOKAHEAD_MS),
        sql`${attendance.status} not in ('excused', 'late_cancel')`,
        sql`${clientAccess.userId} in ${HAS_FAMILY_DEVICE}`,
      ),
    )
    .orderBy(asc(lesson.startsAt))
    .limit(5000);
  if (!rows.length) return 0;
  const users = unique(rows.map((r) => r.userId));
  const [prefs, academies] = await Promise.all([
    familyPrefsFor(db, users),
    academyFacts(
      db,
      rows.map((r) => r.workspaceId),
    ),
  ]);
  // One reminder per person per session, naming every student of theirs on it.
  const due = new Map<string, typeof rows>();
  for (const r of rows) {
    const p = prefs.get(r.userId) ?? familyPrefsOf(null);
    const academy = academies.get(r.workspaceId);
    if (!p.sessions || !academy) continue;
    const quiet = quietOf(p);
    if (
      !sessionReminderDue({
        startsAt: r.startsAt,
        lead: p.sessionLead,
        quiet,
        tz: academy.timezone,
        now,
      })
    ) {
      continue;
    }
    const key = `${r.userId}|${r.lessonId}`;
    const list = due.get(key);
    if (list) list.push(r);
    else due.set(key, [r]);
  }
  if (!due.size) return 0;
  const groups = [...due.values()];
  const logged = await loggedKeys(
    db,
    "session_reminder",
    groups.map((g) => (g[0] as (typeof rows)[number]).userId),
    groups.map((g) => (g[0] as (typeof rows)[number]).lessonId),
  );
  const notices: FamilyNotice[] = [];
  for (const group of groups) {
    const r = group[0] as (typeof rows)[number];
    if (logged.has(logKey({ userId: r.userId, kind: "session_reminder", refKey: r.lessonId }))) {
      continue;
    }
    const academy = academies.get(r.workspaceId) as AcademyFacts;
    const clientIds = unique(group.map((g) => g.clientId));
    notices.push({
      userId: r.userId,
      workspaceId: r.workspaceId,
      kind: "session_reminder",
      refKey: r.lessonId,
      // Already timed around quiet hours (sessionReminderDue).
      urgent: true,
      item: {
        ...baseOf(academy, clientIds.length === 1 ? (clientIds[0] as string) : null),
        kind: "session_reminder",
        lessonId: r.lessonId,
        who: whoOf(group.map((g) => ({ firstName: g.firstName, self: g.relation === "self" }))),
        title: portalSessionTitle({ title: r.title, kind: r.kind }, r.groupName, r.eventName),
        startsAt: r.startsAt,
        venue: r.venueName,
        court: r.court,
      },
    });
  }
  return (await sendFamilyNotices(db, env, notices, now)).sent;
}

// --- Cancelled sessions (right away) -----------------------------------------------------------

export interface CancelPlan {
  workspaceId: string;
  lessons: {
    id: string;
    startsAt: number;
    title: string;
    venue: string | null;
    court: string | null;
  }[];
  attendees: { lessonId: string; clientId: string }[];
  links: LinkedStudent[];
}

/**
 * Who was expected at sessions about to be cancelled or deleted (read before the change: a
 * deleted session takes its roster with it). Only sessions still ahead count.
 */
export async function planCancellations(
  db: Db,
  workspaceId: string,
  lessonIds: readonly string[],
  now: number,
): Promise<CancelPlan | null> {
  const ids = unique(lessonIds);
  if (!ids.length) return null;
  const lessons = await db
    .select({
      id: lesson.id,
      startsAt: lesson.startsAt,
      title: lesson.title,
      kind: lesson.kind,
      court: lesson.court,
      status: lesson.status,
      venueName: venue.name,
      groupName: trainingGroup.name,
      eventName: event.name,
    })
    .from(lesson)
    .leftJoin(venue, eq(venue.id, lesson.venueId))
    .leftJoin(trainingGroup, eq(trainingGroup.id, lesson.groupId))
    .leftJoin(event, eq(event.id, lesson.eventId))
    .where(
      and(eq(lesson.workspaceId, workspaceId), inList(lesson.id, ids), gt(lesson.startsAt, now)),
    );
  const live = lessons.filter((l) => l.status === "scheduled");
  if (!live.length) return null;
  const attendees = await db
    .select({ lessonId: attendance.lessonId, clientId: attendance.clientId })
    .from(attendance)
    .where(
      and(
        eq(attendance.workspaceId, workspaceId),
        inList(
          attendance.lessonId,
          live.map((l) => l.id),
        ),
        sql`${attendance.status} not in ('excused', 'late_cancel')`,
      ),
    );
  if (!attendees.length) return null;
  const links = await studentLinks(
    db,
    attendees.map((a) => a.clientId),
    now,
  );
  if (!links.length) return null;
  return {
    workspaceId,
    lessons: live.map((l) => ({
      id: l.id,
      startsAt: l.startsAt,
      title: portalSessionTitle({ title: l.title, kind: l.kind }, l.groupName, l.eventName),
      venue: l.venueName,
      court: l.court,
    })),
    attendees,
    links: links.filter((l) => l.workspaceId === workspaceId),
  };
}

/**
 * "Session cancelled" for each person linked to someone expected there, when a reminder already
 * went out or the session is within a day; urgent (through quiet hours) when it's before the night
 * ends. Several at once (a rain-out) travel as one push per person.
 */
export async function notifyCancellations(
  db: Db,
  env: Env,
  plan: CancelPlan | null,
  now: number,
): Promise<void> {
  if (!plan || !canPush(env)) return;
  const academy = (await academyFacts(db, [plan.workspaceId])).get(plan.workspaceId);
  if (!academy) return;
  const users = unique(plan.links.map((l) => l.userId));
  const [prefs, reminded] = await Promise.all([
    familyPrefsFor(db, users),
    loggedKeys(
      db,
      "session_reminder",
      users,
      plan.lessons.map((l) => l.id),
    ),
  ]);
  const notices: FamilyNotice[] = [];
  for (const l of plan.lessons) {
    const clients = new Set(
      plan.attendees.filter((a) => a.lessonId === l.id).map((a) => a.clientId),
    );
    const links = plan.links.filter((k) => clients.has(k.clientId));
    for (const userId of linkRecipients(links, { audience: NOTICE_AUDIENCE.session_cancelled })) {
      const wasReminded = reminded.has(logKey({ userId, kind: "session_reminder", refKey: l.id }));
      if (!cancellationNotice({ startsAt: l.startsAt, now, reminded: wasReminded })) continue;
      const mine = links.filter((k) => k.userId === userId);
      const p = prefs.get(userId) ?? familyPrefsOf(null);
      notices.push({
        userId,
        workspaceId: plan.workspaceId,
        kind: "session_cancelled",
        refKey: l.id,
        urgent: cancellationUrgent({
          startsAt: l.startsAt,
          now,
          quiet: quietOf(p),
          tz: academy.timezone,
        }),
        item: {
          ...baseOf(academy, mine.length === 1 ? (mine[0] as LinkedStudent).clientId : null),
          kind: "session_cancelled",
          lessonId: l.id,
          who: whoOf(mine.map((k) => ({ firstName: k.firstName, self: k.relation === "self" }))),
          title: l.title,
          startsAt: l.startsAt,
          venue: l.venue,
          court: l.court,
        },
      });
    }
  }
  await sendFamilyNotices(db, env, notices, now);
}

// --- Payment reminders (5-minute cron) --------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * Approved requests still unpaid or partly paid get a reminder two days after approval and again
 * at five, to the people who pay; never while a proof waits for review, and none once paid. In
 * quiet hours a reminder isn't queued: the next run after they end asks again (the facts may have
 * changed overnight).
 */
export async function runPaymentReminders(db: Db, env: Env, now: number): Promise<number> {
  const rows = await db
    .select({
      id: enrollmentRequest.id,
      workspaceId: enrollmentRequest.workspaceId,
      clientId: enrollmentRequest.clientId,
      status: enrollmentRequest.status,
      chargeId: enrollmentRequest.chargeId,
      decidedAt: enrollmentRequest.decidedAt,
      tierName: packageTemplate.name,
    })
    .from(enrollmentRequest)
    .leftJoin(
      packageTemplate,
      and(
        eq(packageTemplate.id, enrollmentRequest.packageId),
        eq(packageTemplate.workspaceId, enrollmentRequest.workspaceId),
      ),
    )
    .where(
      and(
        eq(enrollmentRequest.status, "approved"),
        isNotNull(enrollmentRequest.chargeId),
        gt(enrollmentRequest.decidedAt, now - 7 * DAY_MS),
        lte(enrollmentRequest.decidedAt, now - 2 * DAY_MS),
        sql`exists (select 1 from ${clientAccess} ca where ca.client_id = ${enrollmentRequest.clientId} and ca.revoked_at is null and ca.user_id in ${HAS_FAMILY_DEVICE})`,
      ),
    )
    .limit(500);
  if (!rows.length) return 0;
  const [pending, links, academies] = await Promise.all([
    db
      .select({ enrollmentId: paymentSubmission.enrollmentId })
      .from(paymentSubmission)
      .where(
        and(
          inList(
            paymentSubmission.enrollmentId,
            rows.map((r) => r.id),
          ),
          eq(paymentSubmission.status, "pending"),
        ),
      ),
    studentLinks(
      db,
      rows.map((r) => r.clientId),
      now,
    ),
    academyFacts(
      db,
      rows.map((r) => r.workspaceId),
    ),
  ]);
  const waiting = new Set(pending.map((p) => p.enrollmentId));
  const payments = new Map<string, Awaited<ReturnType<typeof paymentsFor>>>();
  for (const ws of unique(rows.map((r) => r.workspaceId))) {
    payments.set(
      ws,
      await paymentsFor(
        db,
        ws,
        rows.filter((r) => r.workspaceId === ws).map((r) => r.chargeId),
      ),
    );
  }
  const candidates: FamilyNotice[] = [];
  for (const r of rows) {
    const academy = academies.get(r.workspaceId);
    const payment = r.chargeId ? payments.get(r.workspaceId)?.get(r.chargeId) : undefined;
    if (!academy || !payment || r.decidedAt === null) continue;
    const state = requestPayState(payment, waiting.has(r.id) ? [{ status: "pending" }] : []);
    const which = paymentReminderDue({ decidedAt: r.decidedAt, now, state });
    if (!which) continue;
    const mine = links.filter((l) => l.clientId === r.clientId && l.workspaceId === r.workspaceId);
    for (const userId of linkRecipients(mine, { audience: NOTICE_AUDIENCE.payment_reminder })) {
      candidates.push({
        userId,
        workspaceId: r.workspaceId,
        kind: "payment_reminder",
        refKey: `${r.id}:${which}`,
        whenQuiet: "skip",
        item: {
          ...baseOf(academy, r.clientId),
          kind: "payment_reminder",
          who: whoFor(mine.find((l) => l.userId === userId) as LinkedStudent),
          requestId: r.id,
          tierName: r.tierName ?? "package",
        },
      });
    }
  }
  if (!candidates.length) return 0;
  const logged = await loggedKeys(
    db,
    "payment_reminder",
    candidates.map((c) => c.userId),
    candidates.map((c) => c.refKey),
  );
  const notices = candidates.filter((c) => !logged.has(noticeKey(c)));
  return (await sendFamilyNotices(db, env, notices, now)).sent;
}

/** Every 5 minutes, after announcements and staff reminders: the family side. */
export async function runFamilyReminders(db: Db, env: Env, now: number): Promise<void> {
  if (!canPush(env)) return;
  for (const [label, step] of [
    ["queue", runFamilyQueue],
    ["sessions", runSessionReminders],
    ["payments", runPaymentReminders],
  ] as const) {
    try {
      await step(db, env, now);
    } catch (err) {
      console.error(`Family reminders (${label}) failed`, err);
    }
  }
}

// --- Daily sweeps -----------------------------------------------------------------------------

/**
 * Daily (with the maintenance run): "Renew for next month", one session left, and days-valid
 * packages ending within three days, for students someone gets family notifications about.
 */
export async function runFamilySweeps(db: Db, env: Env, now: number): Promise<number> {
  if (!canPush(env)) return 0;
  const linked = await db
    .selectDistinct({ clientId: clientAccess.clientId, workspaceId: clientAccess.workspaceId })
    .from(clientAccess)
    .where(and(isNull(clientAccess.revokedAt), sql`${clientAccess.userId} in ${HAS_FAMILY_DEVICE}`))
    .limit(5000);
  if (!linked.length) return 0;
  const workspaces = unique(linked.map((l) => l.workspaceId));
  const academies = await academyFacts(db, workspaces);
  const notices: FamilyNotice[] = [];
  for (const ws of workspaces) {
    const academy = academies.get(ws);
    if (!academy) continue;
    const clientIds = unique(linked.filter((l) => l.workspaceId === ws).map((l) => l.clientId));
    const today = todayIn(academy.timezone, now);
    const [packages, facts, links] = await Promise.all([
      db
        .select({
          id: clientPackage.id,
          clientId: clientPackage.clientId,
          name: clientPackage.name,
          creditsTotal: clientPackage.creditsTotal,
          remaining: remainingExpr,
          status: clientPackage.status,
          expiresOn: clientPackage.expiresOn,
          startMonth: clientPackage.startMonth,
        })
        .from(clientPackage)
        .where(
          and(
            eq(clientPackage.workspaceId, ws),
            inList(clientPackage.clientId, clientIds),
            eq(clientPackage.status, "active"),
          ),
        ),
      renewalFacts(db, ws, clientIds, today),
      studentLinks(db, clientIds, now),
    ]);
    const renewals: SweepRenewal[] = [];
    const next = addMonths(monthOf(today), 1);
    for (const clientId of clientIds) {
      const found = renewalOf(facts, clientId, today);
      if (!found) continue;
      renewals.push({
        clientId,
        fromClientPackageId: found.offer.fromClientPackageId,
        tierName: found.tier.name,
        endsOn: lastDayOf(monthOf(today)),
        nextMonth: next,
      });
    }
    const mine = links.filter((l) => l.workspaceId === ws);
    notices.push(
      ...packageSweep({
        academy,
        today,
        packages: packages.map((p) => ({ ...p, remaining: Number(p.remaining) })),
        renewals,
        students: new Map(mine.map((l) => [l.clientId, { firstName: l.firstName }])),
        links: mine,
      }),
    );
  }
  if (!notices.length) return 0;
  const fresh: FamilyNotice[] = [];
  for (const kind of unique(notices.map((n) => n.kind))) {
    const ofKind = notices.filter((n) => n.kind === kind);
    const logged = await loggedKeys(
      db,
      kind,
      ofKind.map((n) => n.userId),
      ofKind.map((n) => n.refKey),
    );
    fresh.push(...ofKind.filter((n) => !logged.has(noticeKey(n))));
  }
  return (await sendFamilyNotices(db, env, fresh, now)).sent;
}

// --- Immediate events (after the response) ------------------------------------------------------

/** One student's news for everyone linked (or the payers), as notices of one kind. */
async function noticesForStudent(
  db: Db,
  input: {
    workspaceId: string;
    clientId: string;
    now: number;
    audience: "everyone" | "payers";
    also?: readonly (string | null | undefined)[];
    except?: readonly (string | null | undefined)[];
    make: (
      academy: AcademyFacts,
      link: LinkedStudent,
    ) => Pick<FamilyNotice, "kind" | "refKey" | "item">;
  },
): Promise<FamilyNotice[]> {
  const [academies, all] = await Promise.all([
    academyFacts(db, [input.workspaceId]),
    studentLinks(db, [input.clientId], input.now),
  ]);
  const academy = academies.get(input.workspaceId);
  if (!academy) return [];
  const links = all.filter((l) => l.workspaceId === input.workspaceId);
  return linkRecipients(links, input).map((userId) => ({
    userId,
    workspaceId: input.workspaceId,
    ...input.make(academy, links.find((l) => l.userId === userId) as LinkedStudent),
  }));
}

/** An enrollment request was approved, waitlisted, or declined: everyone linked to the student. */
export async function notifyEnrollmentDecision(
  db: Db,
  env: Env,
  input: { workspaceId: string; requestId: string; actorUserId: string | null },
  now = Date.now(),
): Promise<void> {
  if (!canPush(env)) return;
  const [req] = await db
    .select({ r: enrollmentRequest, tierName: packageTemplate.name })
    .from(enrollmentRequest)
    .leftJoin(
      packageTemplate,
      and(
        eq(packageTemplate.id, enrollmentRequest.packageId),
        eq(packageTemplate.workspaceId, enrollmentRequest.workspaceId),
      ),
    )
    .where(
      and(
        eq(enrollmentRequest.id, input.requestId),
        eq(enrollmentRequest.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  const status = req?.r.status;
  if (!req || (status !== "approved" && status !== "waitlisted" && status !== "declined")) return;
  let amountDue = false;
  if (status === "approved" && req.r.chargeId) {
    const payments = await paymentsFor(db, input.workspaceId, [req.r.chargeId]);
    amountDue = (payments.get(req.r.chargeId)?.dueMinor ?? 0) > 0;
  }
  const notices = await noticesForStudent(db, {
    workspaceId: input.workspaceId,
    clientId: req.r.clientId,
    now,
    audience: NOTICE_AUDIENCE.enrollment_decision,
    except: [input.actorUserId],
    make: (academy, link) => ({
      kind: "enrollment_decision",
      refKey: `${req.r.id}:${status}`,
      item: {
        ...baseOf(academy, req.r.clientId),
        kind: "enrollment_decision",
        who: whoFor(link),
        requestId: req.r.id,
        status,
        tierName: req.tierName ?? "the package",
        startMonth: req.r.startMonth,
        amountDue,
      },
    }),
  });
  await sendFamilyNotices(db, env, notices, now);
}

/** A payment proof was confirmed or not accepted: the payers, and whoever sent it. */
export async function notifyProofDecision(
  db: Db,
  env: Env,
  input: { workspaceId: string; proofId: string; actorUserId: string | null },
  now = Date.now(),
): Promise<void> {
  if (!canPush(env)) return;
  const proof = await db.query.paymentSubmission.findFirst({
    where: and(
      eq(paymentSubmission.id, input.proofId),
      eq(paymentSubmission.workspaceId, input.workspaceId),
    ),
  });
  if (!proof || (proof.status !== "confirmed" && proof.status !== "rejected")) return;
  const confirmed = proof.status === "confirmed";
  const notices = await noticesForStudent(db, {
    workspaceId: input.workspaceId,
    clientId: proof.clientId,
    now,
    audience: NOTICE_AUDIENCE[confirmed ? "proof_confirmed" : "proof_rejected"],
    also: [proof.submittedBy],
    except: [input.actorUserId],
    make: (academy, link) => ({
      kind: confirmed ? "proof_confirmed" : "proof_rejected",
      // Confirming again after a void records a new payment: worth a new push.
      refKey: confirmed ? `${proof.id}:${proof.paymentId ?? ""}` : proof.id,
      item: {
        ...baseOf(academy, proof.clientId),
        kind: confirmed ? "proof_confirmed" : "proof_rejected",
        who: whoFor(link),
        proofId: proof.id,
      },
    }),
  });
  await sendFamilyNotices(db, env, notices, now);
}

/** A payment recorded from a family's proof was voided: the payers, and whoever sent the proof. */
export async function notifyPaymentVoided(
  db: Db,
  env: Env,
  input: { workspaceId: string; paymentId: string; actorUserId: string | null },
  now = Date.now(),
): Promise<void> {
  if (!canPush(env)) return;
  const proofs = await db
    .select({ clientId: paymentSubmission.clientId, submittedBy: paymentSubmission.submittedBy })
    .from(paymentSubmission)
    .where(
      and(
        eq(paymentSubmission.workspaceId, input.workspaceId),
        eq(paymentSubmission.paymentId, input.paymentId),
        eq(paymentSubmission.status, "voided"),
      ),
    )
    .limit(1);
  const proof = proofs[0];
  if (!proof) return;
  const notices = await noticesForStudent(db, {
    workspaceId: input.workspaceId,
    clientId: proof.clientId,
    now,
    audience: NOTICE_AUDIENCE.payment_voided,
    also: [proof.submittedBy],
    except: [input.actorUserId],
    make: (academy, link) => ({
      kind: "payment_voided",
      refKey: input.paymentId,
      item: {
        ...baseOf(academy, proof.clientId),
        kind: "payment_voided",
        who: whoFor(link),
        paymentId: input.paymentId,
      },
    }),
  });
  await sendFamilyNotices(db, env, notices, now);
}

/**
 * A coach's comment became visible to the family (written shared, or switched to shared): once
 * per comment, whatever happens to it later. Handoff and staff-only notes never notify.
 */
export async function notifyNoteShared(
  db: Db,
  env: Env,
  input: { workspaceId: string; noteId: string; actorUserId: string | null },
  now = Date.now(),
): Promise<void> {
  if (!canPush(env)) return;
  const row = await db.query.note.findFirst({
    where: and(eq(note.id, input.noteId), eq(note.workspaceId, input.workspaceId)),
  });
  if (!row?.clientId || !isFamilyVisible(row)) return;
  const clientId = row.clientId;
  const authors = await coachRefs(db, input.workspaceId, [row.createdBy]);
  const coach = row.createdBy ? authors.get(row.createdBy) : undefined;
  const notices = await noticesForStudent(db, {
    workspaceId: input.workspaceId,
    clientId,
    now,
    audience: NOTICE_AUDIENCE.comment,
    except: [input.actorUserId],
    make: (academy, link) => ({
      kind: "comment",
      refKey: row.id,
      item: {
        ...baseOf(academy, clientId),
        kind: "comment",
        who: whoFor(link),
        itemId: row.id,
        coach: coach ? firstNameOf(coach.name) : null,
      },
    }),
  });
  await sendFamilyNotices(db, env, notices, now);
}

/** A skills assessment shared with the family (new, or switched to shared): once per assessment. */
export async function notifyAssessmentShared(
  db: Db,
  env: Env,
  input: { workspaceId: string; assessmentId: string; actorUserId: string | null },
  now = Date.now(),
): Promise<void> {
  if (!canPush(env)) return;
  const row = await db.query.assessment.findFirst({
    where: and(
      eq(assessment.id, input.assessmentId),
      eq(assessment.workspaceId, input.workspaceId),
    ),
  });
  if (!row?.sharedWithFamily) return;
  const authors = await coachRefs(db, input.workspaceId, [row.createdBy]);
  const coach = row.createdBy ? authors.get(row.createdBy) : undefined;
  const notices = await noticesForStudent(db, {
    workspaceId: input.workspaceId,
    clientId: row.clientId,
    now,
    audience: NOTICE_AUDIENCE.assessment,
    except: [input.actorUserId],
    make: (academy, link) => ({
      kind: "assessment",
      refKey: row.id,
      item: {
        ...baseOf(academy, row.clientId),
        kind: "assessment",
        who: whoFor(link),
        itemId: row.id,
        coach: coach ? firstNameOf(coach.name) : null,
      },
    }),
  });
  await sendFamilyNotices(db, env, notices, now);
}

/**
 * A live announcement, to every family it reaches (`recipients`, from familyRecipients): its title
 * and first line, linking to /my/announcements. Returns how many people it was for.
 */
export async function notifyAnnouncement(
  db: Db,
  env: Env,
  a: AnnouncementRow,
  recipients: readonly string[],
  now = Date.now(),
): Promise<void> {
  if (!canPush(env) || !recipients.length) return;
  // The family DTO decides what of an announcement a family may see (never who wrote it).
  const dto = toPortalAnnouncement(a, null);
  const academy = (await academyFacts(db, [a.workspaceId])).get(a.workspaceId);
  if (!dto || !academy) return;
  const academiesPerUser = await db
    .select({
      userId: clientAccess.userId,
      academies: sql<number>`count(distinct ${clientAccess.workspaceId})`,
    })
    .from(clientAccess)
    .where(and(inList(clientAccess.userId, recipients), isNull(clientAccess.revokedAt)))
    .groupBy(clientAccess.userId);
  const many = new Set(
    academiesPerUser.filter((r) => Number(r.academies) > 1).map((r) => r.userId),
  );
  const notices: FamilyNotice[] = recipients.map((userId) => ({
    userId,
    workspaceId: a.workspaceId,
    kind: "announcement",
    refKey: a.id,
    item: {
      ...baseOf(academy, null),
      kind: "announcement",
      announcementId: dto.id,
      title: dto.title,
      excerpt: firstLine(dto.body),
      multiAcademy: many.has(userId),
    },
  }));
  await sendFamilyNotices(db, env, notices, now);
}

// --- Staff alerts (owners and admins) ---------------------------------------------------------

/** Who turned "Enrollments & payments" off in the staff app's notification settings. */
async function alertsOff(db: Db, userIds: readonly string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const rows = await db
    .select({ userId: notificationPref.userId })
    .from(notificationPref)
    .where(
      and(
        inList(notificationPref.userId, unique(userIds)),
        eq(notificationPref.enrollmentAlerts, false),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

async function teamOf(db: Db, workspaceId: string) {
  return db
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, workspaceId));
}

/** A new enrollment request (or renewal) to review: owners and admins, never the sender. */
export async function notifyStaffEnrollmentRequest(
  db: Db,
  env: Env,
  input: { workspaceId: string; requestId: string; actorUserId: string | null },
): Promise<void> {
  if (!canPush(env)) return;
  const [req] = await db
    .select({ r: enrollmentRequest, firstName: client.firstName, tierName: packageTemplate.name })
    .from(enrollmentRequest)
    .innerJoin(client, eq(client.id, enrollmentRequest.clientId))
    .leftJoin(
      packageTemplate,
      and(
        eq(packageTemplate.id, enrollmentRequest.packageId),
        eq(packageTemplate.workspaceId, enrollmentRequest.workspaceId),
      ),
    )
    .where(
      and(
        eq(enrollmentRequest.id, input.requestId),
        eq(enrollmentRequest.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!req || !isOpenEnrollment(req.r.status)) return;
  const team = await teamOf(db, input.workspaceId);
  const users = staffAlertRecipients(team, {
    needs: ["enrollment"],
    alertsOff: await alertsOff(
      db,
      team.map((m) => m.userId),
    ),
    except: input.actorUserId,
  });
  const payload = staffEnrollmentPayload({
    requestId: req.r.id,
    studentFirstName: req.firstName,
    tierName: req.tierName ?? "a package",
    renewal: isRenewal(req.r),
  });
  for (const userId of users) {
    await notifyUser(db, env, { userId, workspaceId: input.workspaceId }, payload, {
      kind: "enrollment_request",
      refKey: req.r.id,
    });
  }
}

/** A new payment proof to review: owners and admins (they confirm it), never the sender. */
export async function notifyStaffProof(
  db: Db,
  env: Env,
  input: { workspaceId: string; proofId: string; actorUserId: string | null },
): Promise<void> {
  if (!canPush(env)) return;
  const [proof] = await db
    .select({ p: paymentSubmission, firstName: client.firstName })
    .from(paymentSubmission)
    .innerJoin(client, eq(client.id, paymentSubmission.clientId))
    .where(
      and(
        eq(paymentSubmission.id, input.proofId),
        eq(paymentSubmission.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (proof?.p.status !== "pending") return;
  const team = await teamOf(db, input.workspaceId);
  const users = staffAlertRecipients(team, {
    needs: ["enrollment", "money"],
    alertsOff: await alertsOff(
      db,
      team.map((m) => m.userId),
    ),
    except: input.actorUserId,
  });
  const payload = staffProofPayload({ proofId: proof.p.id, studentFirstName: proof.firstName });
  for (const userId of users) {
    await notifyUser(db, env, { userId, workspaceId: input.workspaceId }, payload, {
      kind: "proof_submitted",
      refKey: proof.p.id,
    });
  }
}
