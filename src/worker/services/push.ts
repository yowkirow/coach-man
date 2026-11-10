import { and, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { LESSON_KIND_LABELS } from "../../shared/domain";
import { can } from "../../shared/roles";
import { addDays, localDate, localTime, todayIn } from "../../shared/time";
import type { Db } from "../db/client";
import {
  session as authSession,
  clientCoach,
  clientPackage,
  familyNotificationQueue,
  idempotencyKey,
  lesson,
  member,
  notificationLog,
  notificationPref,
  pushSink,
  rateLimit,
  workspaceSettings,
} from "../db/schema";
import { deleteAbandonedPasskeyAccounts } from "../lib/passkey-accounts";
import { remainingExpr } from "./credits";
import { lessonSummaries } from "./lessons";
import { balancesFor } from "./money";
import { canPush, notifyUser } from "./push-delivery";
import { digestScope, digestSessions, isRecipient, type StaffRef } from "./reminders";

// Staff reminders and digests (every 5 minutes) and the daily maintenance. Delivery itself, and
// the device registries, live in push-delivery.ts.

export {
  canPush,
  notifyUser,
  type PushPayload,
  pushConfigured,
} from "./push-delivery";

function inWindow(localHHMM: string, targetHHMM: string, windowMinutes: number): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const diff = toMin(localHHMM) - toMin(targetHHMM);
  return diff >= 0 && diff < windowMinutes;
}

/** Every 5 minutes: staff session reminders and per-person daily digests. */
export async function runReminders(db: Db, env: Env, now: Date) {
  if (!canPush(env)) return;
  const targets = await db
    .select({
      userId: notificationPref.userId,
      workspaceId: notificationPref.workspaceId,
      lead: notificationPref.sessionReminderMinutes,
      digest: notificationPref.dailyDigestTime,
      expiryDays: notificationPref.packageExpiryDays,
      timezone: workspaceSettings.timezone,
      noShow: workspaceSettings.noShowUsesCredit,
      lateCancel: workspaceSettings.lateCancelUsesCredit,
      role: member.role,
    })
    .from(notificationPref)
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, notificationPref.workspaceId))
    .innerJoin(
      member,
      and(
        eq(member.userId, notificationPref.userId),
        eq(member.organizationId, notificationPref.workspaceId),
      ),
    )
    .where(
      sql`exists (select 1 from push_subscription ps where ps.user_id = "notification_pref"."user_id")`,
    );

  // Who is on each academy's team, for working out who hears about which session.
  const teams = new Map<string, StaffRef[]>();
  const teamOf = async (workspaceId: string) => {
    let team = teams.get(workspaceId);
    if (!team) {
      team = await db
        .select({ userId: member.userId, role: member.role })
        .from(member)
        .where(eq(member.organizationId, workspaceId));
      teams.set(workspaceId, team);
    }
    return team;
  };

  const t = now.getTime();
  for (const target of targets) {
    const scope = { db, workspaceId: target.workspaceId };
    const team = await teamOf(target.workspaceId);
    if (target.lead) {
      const from = t + (target.lead - 5) * 60_000;
      const to = t + target.lead * 60_000;
      const upcoming = await lessonSummaries(
        scope,
        and(eq(lesson.status, "scheduled"), gte(lesson.startsAt, from), lt(lesson.startsAt, to)),
      );
      // A session's lead and assistants hear about it; one without a coach goes to the owners,
      // admins, and front desk.
      for (const { summary, row } of upcoming.filter((u) =>
        isRecipient(u.row, target.userId, team),
      )) {
        const title =
          row.kind === "private" || row.kind === "semi_private"
            ? LESSON_KIND_LABELS[row.kind]
            : summary.title;
        const where = [summary.court ? `Court ${summary.court}` : null, summary.venueName]
          .filter(Boolean)
          .join(" · ");
        await notifyUser(
          db,
          env,
          target,
          {
            title: `Up next: ${title}`,
            body: `${localTime(summary.startsAt, target.timezone)}${where ? ` · ${where}` : ""} · ${summary.bookedCount} booked`,
            url: `/sessions/${summary.id}`,
            tag: `lesson-${summary.id.slice(-12)}`,
          },
          { kind: "session_reminder", refKey: summary.id },
        );
      }
    }

    if (target.digest && inWindow(localTime(t, target.timezone), target.digest, 5)) {
      const date = todayIn(target.timezone, t);
      const me = { userId: target.userId, role: target.role };
      // Owners, admins, and the front desk get the whole academy; a coach gets their sessions and
      // students.
      const academyWide = digestScope(target.role) === "academy";
      const [lessonsToday, expiring, balances, students] = await Promise.all([
        lessonSummaries(
          scope,
          and(
            sql`${lesson.status} != 'cancelled'`,
            gte(lesson.startsAt, t - 12 * 3_600_000),
            lt(lesson.startsAt, t + 24 * 3_600_000),
          ),
        ),
        db
          .select({
            id: clientPackage.id,
            clientId: clientPackage.clientId,
            remaining: remainingExpr,
          })
          .from(clientPackage)
          .where(
            and(
              eq(clientPackage.workspaceId, target.workspaceId),
              eq(clientPackage.status, "active"),
              isNotNull(clientPackage.expiresOn),
              sql`${clientPackage.expiresOn} >= ${date} and ${clientPackage.expiresOn} <= ${addDays(date, target.expiryDays)}`,
            ),
          ),
        // Who owes is money: only in the digest of roles that may see it.
        can(target.role, "money") ? balancesFor(scope) : Promise.resolve(new Map<string, number>()),
        academyWide
          ? Promise.resolve(null)
          : db
              .select({ clientId: clientCoach.clientId })
              .from(clientCoach)
              .where(
                and(
                  eq(clientCoach.workspaceId, target.workspaceId),
                  eq(clientCoach.coachUserId, target.userId),
                  isNull(clientCoach.endedOn),
                ),
              ),
      ]);
      const mine = students ? new Set(students.map((s) => s.clientId)) : null;
      const todays = digestSessions(
        lessonsToday
          .filter((l) => localDate(l.summary.startsAt, target.timezone) === date)
          .map((l) => ({ ...l.summary })),
        me,
        team,
      );
      const expiringCount = expiring.filter(
        (p) => Number(p.remaining) > 0 && (!mine || mine.has(p.clientId)),
      ).length;
      const owing = [...balances.values()].filter((b) => b > 0).length;
      const parts = [
        todays.length
          ? `${todays.length} ${todays.length === 1 ? "session" : "sessions"}, first at ${localTime(todays[0]?.startsAt ?? t, target.timezone)}`
          : "No sessions today",
        expiringCount
          ? `${expiringCount} ${expiringCount === 1 ? "package expires" : "packages expire"} soon`
          : null,
        owing ? `${owing} ${owing === 1 ? "balance" : "balances"} due` : null,
      ].filter(Boolean);
      await notifyUser(
        db,
        env,
        target,
        { title: "Your day in CoachMan", body: parts.join(" · "), url: "/", tag: "daily-digest" },
        { kind: "daily_digest", refKey: date },
      );
    }
  }
}

/** Daily: expire packages past their date, extend recurring series, and clean up old records. */
export async function runMaintenance(
  db: Db,
  now: Date,
  extend: (workspaceId: string) => Promise<void>,
) {
  const workspaces = await db
    .select({ workspaceId: workspaceSettings.workspaceId, timezone: workspaceSettings.timezone })
    .from(workspaceSettings);
  for (const ws of workspaces) {
    const today = todayIn(ws.timezone, now.getTime());
    await db
      .update(clientPackage)
      .set({ status: "expired", updatedAt: Date.now() })
      .where(
        and(
          eq(clientPackage.workspaceId, ws.workspaceId),
          eq(clientPackage.status, "active"),
          isNotNull(clientPackage.expiresOn),
          sql`${clientPackage.expiresOn} < ${today}`,
        ),
      );
    await extend(ws.workspaceId);
  }
  const cutoff = now.getTime() - 30 * 86_400_000;
  await db.delete(idempotencyKey).where(lt(idempotencyKey.createdAt, cutoff));
  await db
    .delete(notificationLog)
    .where(lt(notificationLog.sentAt, now.getTime() - 90 * 86_400_000));
  // Rate-limit counters (ours in lib/rate-limit.ts, and Better Auth's sign-in limits) last a minute
  // or an hour; a day-old one is clutter, and it holds an IP address (the privacy policy says so).
  await db.delete(rateLimit).where(lt(rateLimit.lastRequest, now.getTime() - 86_400_000));
  // A sign-in that ran out can't be used again, yet its row keeps the IP address and browser it
  // came from: delete it (signing out already deletes the row; the privacy policy says both).
  await db.delete(authSession).where(lt(authSession.expiresAt, now));
  // Family notifications held for quiet hours go out within a day; a week-old one is stale. The
  // test sink keeps a day of payloads (tests read theirs within minutes).
  await db
    .delete(familyNotificationQueue)
    .where(lt(familyNotificationQueue.sendAfter, now.getTime() - 7 * 86_400_000));
  await db.delete(pushSink).where(lt(pushSink.createdAt, now.getTime() - 86_400_000));
  // Passkey-only accounts whose passkey never arrived can't be signed into: remove them after a day.
  await deleteAbandonedPasskeyAccounts(db, now.getTime());
}
