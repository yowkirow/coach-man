// Family reminders (push notifications for students and parents): the categories and their
// preferences, quiet hours, when a session reminder goes out, payment-reminder timing, the package
// sweeps, who hears about what, and what a push may say on a lock screen. Pure, so the Worker,
// the app, and the unit tests share one set of rules.
//
// Privacy on the lock screen: first names only; never medical notes, amounts ("You have an amount
// due" at most), a comment's text, or the academy's reasons for declining a request or not
// accepting a payment proof (those stay inside the app).

import type { FamilyRelation } from "./domain";
import { daysLeftInMonth } from "./enrollment";
import { type Capability, can } from "./roles";
import { addDays, daysBetween, localDate, localTime, TIME_RE, zonedToEpoch } from "./time";

// --- Categories and preferences --------------------------------------------------------------

export const FAMILY_CATEGORIES = [
  "sessions",
  "packages",
  "enrollment",
  "progress",
  "announcements",
] as const;
export type FamilyCategory = (typeof FAMILY_CATEGORIES)[number];

export const FAMILY_CATEGORY_LABELS: Record<FamilyCategory, string> = {
  sessions: "Sessions",
  packages: "Packages & renewals",
  enrollment: "Enrollment & payments",
  progress: "Coach comments & progress",
  announcements: "Announcements",
};

export const FAMILY_CATEGORY_HINTS: Record<FamilyCategory, string> = {
  sessions: "A reminder before each session, and word when one is cancelled.",
  packages: "Time to renew for next month, one session left, or a package about to end.",
  enrollment: "Enrollment decisions, payment proofs confirmed or not accepted, and amounts due.",
  progress: "A coach shares a comment or a skills assessment.",
  announcements: "News from your academy.",
};

export const SESSION_LEADS = ["1h", "2h", "evening"] as const;
export type SessionLead = (typeof SESSION_LEADS)[number];

export const SESSION_LEAD_LABELS: Record<SessionLead, string> = {
  "1h": "1 hour before",
  "2h": "2 hours before",
  evening: "The evening before, at 7pm",
};

/** "The evening before": this local time on the day before the session (academy time). */
export const EVENING_BEFORE_TIME = "19:00";

const LEAD_MS: Record<Exclude<SessionLead, "evening">, number> = {
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
};

export const DEFAULT_QUIET_START = "21:00";
export const DEFAULT_QUIET_END = "07:00";

export interface FamilyPrefs {
  sessions: boolean;
  sessionLead: SessionLead;
  packages: boolean;
  enrollment: boolean;
  progress: boolean;
  announcements: boolean;
  /** Local HH:MM in the academy's time zone; both null when quiet hours are off. */
  quietStart: string | null;
  quietEnd: string | null;
}

export const DEFAULT_FAMILY_PREFS: FamilyPrefs = {
  sessions: true,
  sessionLead: "1h",
  packages: true,
  enrollment: true,
  progress: true,
  announcements: true,
  quietStart: DEFAULT_QUIET_START,
  quietEnd: DEFAULT_QUIET_END,
};

const isLead = (v: unknown): v is SessionLead => SESSION_LEADS.includes(v as SessionLead);

/** A stored preference row (or none) as the rules read it: anything missing takes the default. */
export function familyPrefsOf(row: Partial<FamilyPrefs> | null | undefined): FamilyPrefs {
  if (!row) return { ...DEFAULT_FAMILY_PREFS };
  const flag = (v: boolean | undefined, d: boolean) => (typeof v === "boolean" ? v : d);
  const quietOn =
    typeof row.quietStart === "string" &&
    typeof row.quietEnd === "string" &&
    TIME_RE.test(row.quietStart) &&
    TIME_RE.test(row.quietEnd) &&
    row.quietStart !== row.quietEnd;
  const quietSet = row.quietStart !== undefined || row.quietEnd !== undefined;
  return {
    sessions: flag(row.sessions, true),
    sessionLead: isLead(row.sessionLead) ? row.sessionLead : DEFAULT_FAMILY_PREFS.sessionLead,
    packages: flag(row.packages, true),
    enrollment: flag(row.enrollment, true),
    progress: flag(row.progress, true),
    announcements: flag(row.announcements, true),
    quietStart: quietOn ? (row.quietStart as string) : quietSet ? null : DEFAULT_QUIET_START,
    quietEnd: quietOn ? (row.quietEnd as string) : quietSet ? null : DEFAULT_QUIET_END,
  };
}

export const categoryOn = (prefs: FamilyPrefs, category: FamilyCategory): boolean =>
  prefs[category];

// --- Quiet hours (academy time) --------------------------------------------------------------

export interface QuietHours {
  start: string;
  end: string;
}

export function quietOf(prefs: Pick<FamilyPrefs, "quietStart" | "quietEnd">): QuietHours | null {
  const { quietStart: start, quietEnd: end } = prefs;
  return start && end && start !== end ? { start, end } : null;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Whether an instant falls inside quiet hours (which may run past midnight). */
export function inQuietHours(ms: number, quiet: QuietHours | null, tz: string): boolean {
  if (!quiet) return false;
  const t = minutesOf(localTime(ms, tz));
  const s = minutesOf(quiet.start);
  const e = minutesOf(quiet.end);
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** The next moment quiet hours end, after `ms`. */
export function quietEndAfter(ms: number, quiet: QuietHours, tz: string): number {
  const date = localDate(ms, tz);
  const today = zonedToEpoch(date, quiet.end, tz);
  return today > ms ? today : zonedToEpoch(addDays(date, 1), quiet.end, tz);
}

/** When the quiet period holding `ms` began (the latest quiet start at or before it). */
export function quietStartBefore(ms: number, quiet: QuietHours, tz: string): number {
  const date = localDate(ms, tz);
  const today = zonedToEpoch(date, quiet.start, tz);
  return today <= ms ? today : zonedToEpoch(addDays(date, -1), quiet.start, tz);
}

/**
 * When a non-urgent notification may go out: now, or when quiet hours end. Urgent ones (a session
 * starting before the night is over is cancelled) go now.
 */
export function deliveryTime(
  now: number,
  quiet: QuietHours | null,
  tz: string,
  urgent = false,
): number {
  if (urgent || !quiet || !inQuietHours(now, quiet, tz)) return now;
  return quietEndAfter(now, quiet, tz);
}

// --- Session reminders -----------------------------------------------------------------------

/** A reminder moved out of quiet hours goes out this long before they start. */
export const QUIET_MARGIN_MS = 15 * 60_000;
/** No reminder for a session starting this soon (it would arrive too late to help). */
export const MIN_NOTICE_MS = 10 * 60_000;
/** A late reminder waits for quiet hours to end only if that still leaves this much time. */
export const LATE_NOTICE_MS = 30 * 60_000;
/** A reminder is never moved more than this far ahead of its session. */
export const MAX_EARLY_MS = 24 * 60 * 60_000;
/** The 5-minute cron looks this far ahead for sessions to remind about. */
export const REMINDER_LOOKAHEAD_MS = 48 * 60 * 60_000;

/** The moment the person's lead time asks for: N hours before, or 7pm the evening before. */
export function leadMoment(startsAt: number, lead: SessionLead, tz: string): number {
  if (lead === "evening") {
    return zonedToEpoch(addDays(localDate(startsAt, tz), -1), EVENING_BEFORE_TIME, tz);
  }
  return startsAt - LEAD_MS[lead];
}

/**
 * When a session's reminder is planned, kept out of quiet hours where possible: a lead time that
 * falls in quiet hours moves to when they end (if that still leaves at least half the lead), else
 * to just before they begin (the evening before, at most a day ahead). If neither works, the lead
 * time stands.
 */
export function plannedReminderAt(input: {
  startsAt: number;
  lead: SessionLead;
  quiet: QuietHours | null;
  tz: string;
}): number {
  const { startsAt, lead, quiet, tz } = input;
  const at = leadMoment(startsAt, lead, tz);
  if (!quiet || !inQuietHours(at, quiet, tz)) return at;
  if (lead !== "evening") {
    const end = quietEndAfter(at, quiet, tz);
    if (end <= startsAt - LEAD_MS[lead] / 2) return end;
  }
  const before = quietStartBefore(at, quiet, tz) - QUIET_MARGIN_MS;
  return startsAt - before <= MAX_EARLY_MS ? before : at;
}

/**
 * Whether a session's reminder should go out at `now` (the 5-minute cron asks; the log keeps it
 * to once per person per session). A reminder that's late (the session was booked after its
 * planned moment) and lands in quiet hours waits for them to end when that still leaves time;
 * otherwise it goes now.
 */
export function sessionReminderDue(input: {
  startsAt: number;
  lead: SessionLead;
  quiet: QuietHours | null;
  tz: string;
  now: number;
}): boolean {
  const { startsAt, now, quiet, tz } = input;
  if (now >= startsAt - MIN_NOTICE_MS) return false;
  if (now < plannedReminderAt(input)) return false;
  if (!quiet || !inQuietHours(now, quiet, tz)) return true;
  return quietEndAfter(now, quiet, tz) > startsAt - LATE_NOTICE_MS;
}

/** A cancelled session is worth a push when a reminder already went out, or it's within a day. */
export const CANCEL_NOTICE_MS = 24 * 60 * 60_000;

export function cancellationNotice(input: {
  startsAt: number;
  now: number;
  reminded: boolean;
}): boolean {
  if (input.startsAt <= input.now) return false;
  return input.reminded || input.startsAt - input.now <= CANCEL_NOTICE_MS;
}

/**
 * A cancellation can't wait for the morning when the session is before quiet hours end (or within
 * two hours after): the family might set off for it.
 */
export function cancellationUrgent(input: {
  startsAt: number;
  now: number;
  quiet: QuietHours | null;
  tz: string;
}): boolean {
  const { startsAt, now, quiet, tz } = input;
  if (!quiet || !inQuietHours(now, quiet, tz)) return false;
  return startsAt <= quietEndAfter(now, quiet, tz) + 2 * 60 * 60_000;
}

// --- Payment reminders, renewals, credits, expiry ---------------------------------------------

/** Days after approval when an unpaid (or partly paid) request gets a reminder. */
export const PAYMENT_REMINDER_DAYS = [2, 5] as const;
/** After this, the academy follows up itself. */
export const PAYMENT_REMINDER_STOP_DAYS = 7;

/**
 * Which payment reminder is due for an approved request (1 at two days, 2 at five), or null:
 * only while something is owed and no proof waits for review; never after a week.
 */
export function paymentReminderDue(input: {
  decidedAt: number;
  now: number;
  state: "unpaid" | "partial" | "proof_pending" | "paid" | null;
}): 1 | 2 | null {
  if (input.state !== "unpaid" && input.state !== "partial") return null;
  const days = (input.now - input.decidedAt) / 86_400_000;
  if (days >= PAYMENT_REMINDER_STOP_DAYS) return null;
  if (days >= PAYMENT_REMINDER_DAYS[1]) return 2;
  if (days >= PAYMENT_REMINDER_DAYS[0]) return 1;
  return null;
}

/** "Renew for next month" goes out once, from this many days before the month ends. */
export const RENEWAL_REMINDER_DAYS = 5;
export const renewalReminderDue = (today: string): boolean =>
  daysLeftInMonth(today) <= RENEWAL_REMINDER_DAYS;

/** A days-valid package within this many days of its end gets one warning. */
export const EXPIRY_WARNING_DAYS = 3;

export interface SweepPackage {
  id: string;
  clientId: string;
  name: string;
  creditsTotal: number;
  remaining: number;
  status: string;
  expiresOn: string | null;
  /** Month-end packages carry their month (renewal covers them); days-valid ones don't. */
  startMonth: string | null;
}

/** One session left (once per package; not for single-session packages such as a trial). */
export function lowOnCredits(p: SweepPackage, today: string): boolean {
  return (
    p.status === "active" &&
    p.creditsTotal > 1 &&
    p.remaining === 1 &&
    (p.expiresOn === null || p.expiresOn >= today)
  );
}

/** A days-valid package ending within three days with sessions still on it. */
export function endingSoon(p: SweepPackage, today: string): boolean {
  return (
    p.status === "active" &&
    p.startMonth === null &&
    p.expiresOn !== null &&
    p.expiresOn >= today &&
    daysBetween(today, p.expiresOn) <= EXPIRY_WARNING_DAYS &&
    p.remaining > 0
  );
}

// --- Who hears about it ----------------------------------------------------------------------

export interface StudentLink {
  userId: string;
  clientId: string;
  relation: FamilyRelation;
  /** The student is under 18 (or a junior without a birth date). */
  minor: boolean;
  revokedAt?: number | null;
}

/**
 * Who pays: parents and guardians, and adult students for themselves. A teen's own login follows
 * their training but isn't asked for money.
 */
export const isPayer = (l: Pick<StudentLink, "relation" | "minor">) =>
  l.relation === "guardian" || !l.minor;

/**
 * The people linked to a student who hear about something: everyone with an active link, or only
 * the payers (plus `also`, e.g. the teen who sent a payment proof); never `except` (whoever did it
 * themselves), each person once.
 */
export function linkRecipients(
  links: readonly StudentLink[],
  opts: {
    audience: "everyone" | "payers";
    also?: readonly (string | null | undefined)[];
    except?: readonly (string | null | undefined)[];
  },
): string[] {
  const also = new Set((opts.also ?? []).filter(Boolean));
  const except = new Set((opts.except ?? []).filter(Boolean));
  const out: string[] = [];
  for (const l of links) {
    if (l.revokedAt) continue;
    if (opts.audience === "payers" && !isPayer(l) && !also.has(l.userId)) continue;
    if (except.has(l.userId) || out.includes(l.userId)) continue;
    out.push(l.userId);
  }
  return out;
}

/**
 * Owners and admins who get a staff alert (a new enrollment request or payment proof): their role
 * has every capability it needs and they haven't turned "Enrollments & payments" off (on unless
 * they did); never the person who sent it.
 */
export function staffAlertRecipients(
  team: readonly { userId: string; role: string }[],
  opts: {
    needs: readonly Capability[];
    alertsOff: ReadonlySet<string>;
    except?: string | null;
  },
): string[] {
  const out: string[] = [];
  for (const m of team) {
    if (!opts.needs.every((cap) => can(m.role, cap))) continue;
    if (opts.alertsOff.has(m.userId) || m.userId === opts.except) continue;
    if (!out.includes(m.userId)) out.push(m.userId);
  }
  return out;
}

// --- Notices ---------------------------------------------------------------------------------

export const FAMILY_NOTICE_KINDS = [
  "session_reminder",
  "session_cancelled",
  "renewal",
  "low_credits",
  "package_ending",
  "enrollment_decision",
  "proof_confirmed",
  "proof_rejected",
  "payment_voided",
  "payment_reminder",
  "comment",
  "assessment",
  "announcement",
] as const;
export type FamilyNoticeKind = (typeof FAMILY_NOTICE_KINDS)[number];

export const NOTICE_CATEGORY: Record<FamilyNoticeKind, FamilyCategory> = {
  session_reminder: "sessions",
  session_cancelled: "sessions",
  renewal: "packages",
  low_credits: "packages",
  package_ending: "packages",
  enrollment_decision: "enrollment",
  proof_confirmed: "enrollment",
  proof_rejected: "enrollment",
  payment_voided: "enrollment",
  payment_reminder: "enrollment",
  comment: "progress",
  assessment: "progress",
  announcement: "announcements",
};

/**
 * Who among a student's links hears each kind: everyone (parents, a teen's own login, an adult
 * student), or only the payers (money: renewing, payment outcomes, amounts due; whoever sent a
 * payment proof hears how it went too).
 */
export const NOTICE_AUDIENCE: Record<FamilyNoticeKind, "everyone" | "payers"> = {
  session_reminder: "everyone",
  session_cancelled: "everyone",
  renewal: "payers",
  low_credits: "everyone",
  package_ending: "everyone",
  enrollment_decision: "everyone",
  proof_confirmed: "payers",
  proof_rejected: "payers",
  payment_voided: "payers",
  payment_reminder: "payers",
  comment: "everyone",
  assessment: "everyone",
  announcement: "everyone",
};

/** Whose news it is: the students' first names, and whether the reader is the student. */
export interface Who {
  names: string[];
  self: boolean;
}

/** The student(s) a reader follows in this notice: first names only. */
export function whoOf(students: readonly { firstName: string; self: boolean }[]): Who {
  const names: string[] = [];
  for (const s of students) {
    const name = s.firstName.trim();
    if (!s.self && name && !names.includes(name)) names.push(name);
  }
  return { names, self: students.some((s) => s.self) };
}

interface ItemBase {
  /** The academy's name (what families know it by). */
  academy: string;
  timezone: string;
  locale: string;
  /** The student the push opens (null when it's about several). */
  clientId: string | null;
}

interface SessionFields {
  lessonId: string;
  who: Who;
  title: string;
  startsAt: number;
  venue: string | null;
  court: string | null;
}

export type NoticeItem = ItemBase &
  (
    | ({ kind: "session_reminder" } & SessionFields)
    | ({ kind: "session_cancelled" } & SessionFields)
    | { kind: "renewal"; who: Who; tierName: string; endsOn: string; nextMonth: string }
    | { kind: "low_credits"; who: Who; packageId: string; packageName: string }
    | {
        kind: "package_ending";
        who: Who;
        packageId: string;
        packageName: string;
        endsOn: string;
        remaining: number;
      }
    | {
        kind: "enrollment_decision";
        who: Who;
        requestId: string;
        status: "approved" | "waitlisted" | "declined";
        tierName: string;
        startMonth: string | null;
        /** Something is owed for it (never how much). */
        amountDue: boolean;
      }
    | { kind: "proof_confirmed"; who: Who; proofId: string }
    | { kind: "proof_rejected"; who: Who; proofId: string }
    | { kind: "payment_voided"; who: Who; paymentId: string }
    | { kind: "payment_reminder"; who: Who; requestId: string; tierName: string }
    | { kind: "comment"; who: Who; itemId: string; coach: string | null }
    | { kind: "assessment"; who: Who; itemId: string; coach: string | null }
    | {
        kind: "announcement";
        announcementId: string;
        title: string;
        excerpt: string;
        /** The reader follows students at more than one academy: say which one. */
        multiAcademy: boolean;
      }
  );

export interface FamilyNotice {
  userId: string;
  workspaceId: string;
  kind: FamilyNoticeKind;
  /** With `kind`, what the notification log dedupes on: one push per person per thing. */
  refKey: string;
  /** Goes out even in quiet hours (a reminder already timed around them, an urgent cancellation). */
  urgent?: boolean;
  /** In quiet hours: wait in the queue (default), or skip (the 5-minute cron asks again). */
  whenQuiet?: "queue" | "skip";
  item: NoticeItem;
}

export const noticeKey = (n: Pick<FamilyNotice, "userId" | "kind" | "refKey">) =>
  `${n.userId}|${n.kind}|${n.refKey}`;

/**
 * Who gets what now, what waits for quiet hours to end, and what's dropped: each notice once per
 * person; only people with a device for family notifications; only categories they left on;
 * quiet hours (the academy's time) respected unless urgent.
 */
export function planDeliveries(input: {
  notices: readonly FamilyNotice[];
  prefs: ReadonlyMap<string, FamilyPrefs>;
  withDevices: ReadonlySet<string>;
  timezones: ReadonlyMap<string, string>;
  now: number;
}): { send: FamilyNotice[]; queue: { notice: FamilyNotice; sendAfter: number }[] } {
  const seen = new Set<string>();
  const send: FamilyNotice[] = [];
  const queue: { notice: FamilyNotice; sendAfter: number }[] = [];
  for (const n of input.notices) {
    const key = noticeKey(n);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!input.withDevices.has(n.userId)) continue;
    const prefs = input.prefs.get(n.userId) ?? DEFAULT_FAMILY_PREFS;
    if (!categoryOn(prefs, NOTICE_CATEGORY[n.kind])) continue;
    const tz = input.timezones.get(n.workspaceId) ?? n.item.timezone ?? "UTC";
    const at = deliveryTime(input.now, quietOf(prefs), tz, n.urgent);
    if (at <= input.now) send.push(n);
    else if (n.whenQuiet !== "skip") queue.push({ notice: n, sendAfter: at });
  }
  return { send, queue };
}

/** One push per person per kind at a time: several students' news of one kind travel together. */
export function batchNotices<T extends Pick<FamilyNotice, "userId" | "kind">>(
  notices: readonly T[],
): T[][] {
  const groups = new Map<string, T[]>();
  for (const n of notices) {
    const key = `${n.userId}|${n.kind}`;
    const list = groups.get(key);
    if (list) list.push(n);
    else groups.set(key, [n]);
  }
  return [...groups.values()];
}

export interface AcademyFacts {
  workspaceId: string;
  name: string;
  timezone: string;
  locale: string;
}

/** A month-end package ending this month with nothing for next month (see renewalFor). */
export interface SweepRenewal {
  clientId: string;
  fromClientPackageId: string;
  tierName: string;
  /** The last day of this month. */
  endsOn: string;
  /** YYYY-MM. */
  nextMonth: string;
}

/**
 * The daily package sweep for one academy: "Renew for next month" (from five days before the
 * month ends, to the payers), one session left, and a days-valid package ending within three days
 * (to everyone linked). One notice per person per package; the log keeps each to once.
 */
export function packageSweep(input: {
  academy: AcademyFacts;
  today: string;
  packages: readonly SweepPackage[];
  renewals: readonly SweepRenewal[];
  students: ReadonlyMap<string, { firstName: string }>;
  links: readonly StudentLink[];
}): FamilyNotice[] {
  const { academy, today } = input;
  const base = {
    academy: academy.name,
    timezone: academy.timezone,
    locale: academy.locale,
  };
  const out: FamilyNotice[] = [];
  const linksOf = (clientId: string) => input.links.filter((l) => l.clientId === clientId);
  const whoFor = (clientId: string, link: StudentLink) =>
    whoOf([
      {
        firstName: input.students.get(clientId)?.firstName ?? "",
        self: link.relation === "self",
      },
    ]);
  const push = (
    clientId: string,
    audience: "everyone" | "payers",
    make: (who: Who) => Pick<FamilyNotice, "kind" | "refKey" | "item">,
  ) => {
    const links = linksOf(clientId);
    for (const userId of linkRecipients(links, { audience })) {
      const link = links.find((l) => l.userId === userId) as StudentLink;
      out.push({ userId, workspaceId: academy.workspaceId, ...make(whoFor(clientId, link)) });
    }
  };
  for (const p of input.packages) {
    if (lowOnCredits(p, today)) {
      push(p.clientId, NOTICE_AUDIENCE.low_credits, (who) => ({
        kind: "low_credits",
        refKey: p.id,
        item: {
          ...base,
          kind: "low_credits",
          clientId: p.clientId,
          who,
          packageId: p.id,
          packageName: p.name,
        },
      }));
    }
    if (endingSoon(p, today)) {
      push(p.clientId, NOTICE_AUDIENCE.package_ending, (who) => ({
        kind: "package_ending",
        refKey: p.id,
        item: {
          ...base,
          kind: "package_ending",
          clientId: p.clientId,
          who,
          packageId: p.id,
          packageName: p.name,
          endsOn: p.expiresOn as string,
          remaining: p.remaining,
        },
      }));
    }
  }
  if (renewalReminderDue(today)) {
    for (const r of input.renewals) {
      push(r.clientId, NOTICE_AUDIENCE.renewal, (who) => ({
        kind: "renewal",
        refKey: r.fromClientPackageId,
        item: {
          ...base,
          kind: "renewal",
          clientId: r.clientId,
          who,
          tierName: r.tierName,
          endsOn: r.endsOn,
          nextMonth: r.nextMonth,
        },
      }));
    }
  }
  return out;
}

// --- What a push says ------------------------------------------------------------------------

export interface PushPayload {
  title: string;
  body: string;
  /** Opens in the app: /my/… for families, a staff path for staff. */
  url: string;
  tag: string;
}

export const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

function joinNames(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Ana", "Ana and Ben", "you", "you and Ana". */
export function whoText(who: Who): string {
  return joinNames([...(who.self ? ["you"] : []), ...who.names]) || "your student";
}

/** "Ana's", "your", or "Ana and Ben's". */
function whose(who: Who): string {
  if (who.self && !who.names.length) return "your";
  return `${whoText(who)}'s`;
}

/** "Ana has" / "You have" / "Ana and Ben have". */
function whoHas(who: Who): string {
  const plural = who.self || who.names.length > 1;
  return `${cap(whoText(who))} ${plural ? "have" : "has"}`;
}

/** "Ana is" / "You're" / "Ana and Ben are". */
function whoIs(who: Who): string {
  if (who.self && !who.names.length) return "You're";
  return `${cap(whoText(who))} ${who.names.length + (who.self ? 1 : 0) > 1 ? "are" : "is"}`;
}

function safeFormat(locale: string, options: Intl.DateTimeFormatOptions, value: number): string {
  let text: string;
  try {
    text = new Intl.DateTimeFormat(locale, options).format(value);
  } catch {
    text = new Intl.DateTimeFormat("en-US", options).format(value);
  }
  // Newer ICU puts a narrow no-break space before AM/PM; a plain space reads the same everywhere.
  return text.replace(/[\u202f\u00a0]/g, " ");
}

/** "5:00 PM" in the academy's time zone and locale. */
export function timeText(ms: number, tz: string, locale: string): string {
  return safeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: tz }, ms);
}

/** "today", "tomorrow", or "on Thu, Nov 6" (the academy's calendar). */
export function dayText(ms: number, now: number, tz: string, locale: string): string {
  const diff = daysBetween(localDate(now, tz), localDate(ms, tz));
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return `on ${safeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: tz }, ms)}`;
}

/** "Nov 30" for a calendar date. */
function dateText(ymd: string, locale: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return safeFormat(
    locale,
    { month: "short", day: "numeric", timeZone: "UTC" },
    Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1),
  );
}

/** "December" for a YYYY-MM month. */
function monthText(ym: string, locale: string): string {
  const [y, m] = ym.split("-").map(Number);
  return safeFormat(
    locale,
    { month: "long", timeZone: "UTC" },
    Date.UTC(y ?? 1970, (m ?? 1) - 1, 1),
  );
}

function place(venue: string | null, court: string | null): string {
  return [court ? `Court ${court}` : null, venue].filter(Boolean).join(", ");
}

/** The first line of an announcement, shortened for a lock screen. */
export function firstLine(body: string, max = 120): string {
  const line = (body.split(/\r?\n/).find((l) => l.trim()) ?? "").replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s.,;:!-]+$/, "")}…`;
}

const studentPath = (clientId: string | null, section: string) =>
  clientId ? `/my/${encodeURIComponent(clientId)}/${section}` : "/my";

/** Every item of a batch opens the same student's page, or the portal's home. */
function sharedClient(items: readonly NoticeItem[]): string | null {
  const ids = new Set(items.map((i) => i.clientId));
  return ids.size === 1 ? (items[0]?.clientId ?? null) : null;
}

type ItemOf<K extends NoticeItem["kind"]> = Extract<NoticeItem, { kind: K }>;

function sessionPayload(items: ItemOf<"session_reminder">[], now: number): PushPayload {
  const sorted = [...items].sort((a, b) => a.startsAt - b.startsAt);
  const first = sorted[0] as ItemOf<"session_reminder">;
  const tz = first.timezone;
  const loc = first.locale;
  if (sorted.length === 1) {
    const who = first.who.names.length ? cap(whoText(first.who)) : "";
    return {
      title: `Session ${dayText(first.startsAt, now, tz, loc)} at ${timeText(first.startsAt, tz, loc)}`,
      body: [who, first.title, place(first.venue, first.court)].filter(Boolean).join(" · "),
      url: studentPath(first.clientId, "schedule"),
      tag: `session:${first.lessonId}`,
    };
  }
  const days = new Set(sorted.map((i) => localDate(i.startsAt, i.timezone)));
  const sameDay = days.size === 1;
  return {
    title: sameDay
      ? `${sorted.length} sessions ${dayText(first.startsAt, now, tz, loc)}`
      : `${sorted.length} sessions coming up`,
    body: sorted
      .map((i) =>
        [
          cap(whoText(i.who)),
          sameDay
            ? timeText(i.startsAt, i.timezone, i.locale)
            : `${dayText(i.startsAt, now, i.timezone, i.locale).replace(/^on /, "")} ${timeText(i.startsAt, i.timezone, i.locale)}`,
          i.title,
        ].join(", "),
      )
      .join(" · "),
    url: studentPath(sharedClient(sorted), "schedule"),
    tag: `sessions:${localDate(first.startsAt, tz)}`,
  };
}

function cancelledPayload(items: ItemOf<"session_cancelled">[], now: number): PushPayload {
  const sorted = [...items].sort((a, b) => a.startsAt - b.startsAt);
  const first = sorted[0] as ItemOf<"session_cancelled">;
  const when = (i: ItemOf<"session_cancelled">) =>
    `${dayText(i.startsAt, now, i.timezone, i.locale)} at ${timeText(i.startsAt, i.timezone, i.locale)}`;
  if (sorted.length === 1) {
    const for_ = first.who.names.length ? ` (${whoText(first.who)})` : "";
    return {
      title: "Session cancelled",
      body: `${first.title} ${when(first)} is cancelled${for_}.`,
      url: studentPath(first.clientId, "schedule"),
      tag: `session:${first.lessonId}`,
    };
  }
  return {
    title: `${sorted.length} sessions cancelled`,
    body: sorted.map((i) => `${i.title}, ${when(i)}`).join(" · "),
    url: studentPath(sharedClient(sorted), "schedule"),
    tag: `cancelled:${localDate(first.startsAt, first.timezone)}`,
  };
}

function mergedWho(items: readonly { who: Who }[]): Who {
  const names: string[] = [];
  for (const i of items) for (const n of i.who.names) if (!names.includes(n)) names.push(n);
  return { names, self: items.some((i) => i.who.self) };
}

function renewalPayload(items: ItemOf<"renewal">[]): PushPayload {
  const first = items[0] as ItemOf<"renewal">;
  const loc = first.locale;
  const next = monthText(first.nextMonth, loc);
  const ends = dateText(first.endsOn, loc);
  const body =
    items.length === 1
      ? `${cap(whose(first.who))} ${first.tierName} ends on ${ends}. Renew in CoachMan to keep training in ${next}.`
      : `Packages for ${whoText(mergedWho(items))} end on ${ends}. Renew in CoachMan to keep training in ${next}.`;
  return {
    title: "Renew for next month",
    body,
    url: "/my",
    tag: `renewal:${first.nextMonth}`,
  };
}

function lowCreditsPayload(items: ItemOf<"low_credits">[]): PushPayload {
  const first = items[0] as ItemOf<"low_credits">;
  if (items.length === 1) {
    return {
      title: "1 session left",
      body: `${whoHas(first.who)} 1 session left on ${first.packageName}.`,
      url: studentPath(first.clientId, "payments"),
      tag: `credits:${first.packageId}`,
    };
  }
  return {
    title: "Sessions running low",
    body: items.map((i) => `${cap(whoText(i.who))}: 1 left on ${i.packageName}`).join(" · "),
    url: studentPath(sharedClient(items), "payments"),
    tag: "credits",
  };
}

function endingPayload(items: ItemOf<"package_ending">[]): PushPayload {
  const first = items[0] as ItemOf<"package_ending">;
  if (items.length === 1) {
    const left = first.remaining === 1 ? "1 session" : `${first.remaining} sessions`;
    return {
      title: "Package ends soon",
      body: `${cap(whose(first.who))} ${first.packageName} ends on ${dateText(first.endsOn, first.locale)}, with ${left} left.`,
      url: studentPath(first.clientId, "payments"),
      tag: `package:${first.packageId}`,
    };
  }
  return {
    title: "Packages ending soon",
    body: items
      .map((i) => `${cap(whoText(i.who))}: ${i.packageName} ends ${dateText(i.endsOn, i.locale)}`)
      .join(" · "),
    url: studentPath(sharedClient(items), "payments"),
    tag: "packages",
  };
}

function decisionPayload(items: ItemOf<"enrollment_decision">[]): PushPayload {
  const first = items[0] as ItemOf<"enrollment_decision">;
  if (items.length > 1) {
    return {
      title: "Enrollment updates",
      body: `For ${whoText(mergedWho(items))}. Open CoachMan for the details.`,
      url: "/my",
      tag: "enrollment",
    };
  }
  const tag = `enrollment:${first.requestId}`;
  if (first.status === "approved") {
    const period = first.startMonth ? ` for ${monthText(first.startMonth, first.locale)}` : "";
    return {
      title: "Enrollment approved",
      body: `${whoIs(first.who)} in ${first.tierName}${period}.${first.amountDue ? " You have an amount due: pay in CoachMan." : ""}`,
      url:
        first.amountDue && first.clientId
          ? `/my/${encodeURIComponent(first.clientId)}/pay?request=${encodeURIComponent(first.requestId)}`
          : "/my",
      tag,
    };
  }
  if (first.status === "waitlisted") {
    return {
      title: "Enrollment update",
      body: `${whoIs(first.who)} on the waitlist for ${first.tierName}.`,
      url: "/my",
      tag,
    };
  }
  // Declined: the academy's reason stays inside the app.
  return {
    title: "Your enrollment request was updated",
    body: `Open CoachMan to see ${first.academy}'s reply about ${whose(first.who)} request.`,
    url: "/my",
    tag,
  };
}

type PaymentItem = ItemOf<"proof_confirmed" | "proof_rejected" | "payment_voided">;

function paymentPayload(items: PaymentItem[]): PushPayload {
  const first = items[0] as PaymentItem;
  if (items.length > 1) {
    return {
      title: "Payment updates",
      body: `For ${whoText(mergedWho(items))}. Open CoachMan for the details.`,
      url: studentPath(sharedClient(items), "payments"),
      tag: "payments",
    };
  }
  const url = studentPath(first.clientId, "payments");
  const forWho = first.who.self && !first.who.names.length ? "you" : whoText(first.who);
  if (first.kind === "proof_confirmed") {
    return {
      title: "Payment confirmed",
      body: `${first.academy} confirmed the payment for ${forWho}.`,
      url,
      tag: `proof:${first.proofId}`,
    };
  }
  if (first.kind === "proof_rejected") {
    // Why it wasn't accepted stays inside the app.
    return {
      title: "Payment proof not accepted",
      body: `Open CoachMan to see why, and send a new proof for ${forWho}.`,
      url,
      tag: `proof:${first.proofId}`,
    };
  }
  return {
    title: "Payment voided",
    body: `${first.academy} voided a payment for ${forWho}. Open CoachMan for the details.`,
    url,
    tag: `payment:${first.paymentId}`,
  };
}

function reminderPayload(items: ItemOf<"payment_reminder">[]): PushPayload {
  const first = items[0] as ItemOf<"payment_reminder">;
  if (items.length === 1) {
    return {
      title: "Payment reminder",
      body: `You have an amount due for ${whose(first.who)} ${first.tierName}.`,
      url: first.clientId
        ? `/my/${encodeURIComponent(first.clientId)}/pay?request=${encodeURIComponent(first.requestId)}`
        : "/my",
      tag: `pay:${first.requestId}`,
    };
  }
  return {
    title: "Payment reminder",
    body: `You have amounts due for ${whoText(mergedWho(items))}.`,
    url: studentPath(sharedClient(items), "payments"),
    tag: "pay",
  };
}

const coachLabel = (coach: string | null) => (coach ? `Coach ${coach}` : "Your coach");

function progressPayload(items: ItemOf<"comment" | "assessment">[]): PushPayload {
  const first = items[0] as ItemOf<"comment" | "assessment">;
  const url = studentPath(sharedClient(items), "progress");
  if (items.length === 1) {
    // Never the comment's text: it can hold anything, health included.
    return first.kind === "comment"
      ? {
          title: `${coachLabel(first.coach)} shared a comment`,
          body: `About ${whose(first.who)} training. Open CoachMan to read it.`,
          url,
          tag: `note:${first.itemId}`,
        }
      : {
          title: `${coachLabel(first.coach)} shared a skills assessment`,
          body: `For ${whoText(first.who)}. Open CoachMan to see it.`,
          url,
          tag: `assessment:${first.itemId}`,
        };
  }
  const noun = first.kind === "comment" ? "comments" : "skills assessments";
  const coaches = [...new Set(items.map((i) => coachLabel(i.coach)))];
  return {
    title: `${items.length} new ${noun}`,
    body: `For ${whoText(mergedWho(items))}, from ${joinNames(coaches)}.`,
    url,
    tag: first.kind === "comment" ? "comments" : "assessments",
  };
}

function announcementPayload(items: ItemOf<"announcement">[]): PushPayload {
  const first = items[0] as ItemOf<"announcement">;
  if (items.length === 1) {
    return {
      title: first.title,
      body: `${first.multiAcademy ? `${first.academy}: ` : ""}${first.excerpt}`,
      url: "/my/announcements",
      tag: `announcement:${first.announcementId}`,
    };
  }
  return {
    title: `${items.length} new announcements`,
    body: firstLine(items.map((i) => i.title).join(" · "), 160),
    url: "/my/announcements",
    tag: "announcements",
  };
}

/** One push for a batch of one kind for one person (see batchNotices). */
export function familyPayload(items: readonly NoticeItem[], now: number): PushPayload | null {
  const first = items[0];
  if (!first) return null;
  const same = <K extends NoticeItem["kind"]>(...kinds: K[]) =>
    items.filter((i): i is ItemOf<K> => (kinds as string[]).includes(i.kind));
  switch (first.kind) {
    case "session_reminder":
      return sessionPayload(same("session_reminder"), now);
    case "session_cancelled":
      return cancelledPayload(same("session_cancelled"), now);
    case "renewal":
      return renewalPayload(same("renewal"));
    case "low_credits":
      return lowCreditsPayload(same("low_credits"));
    case "package_ending":
      return endingPayload(same("package_ending"));
    case "enrollment_decision":
      return decisionPayload(same("enrollment_decision"));
    case "proof_confirmed":
    case "proof_rejected":
    case "payment_voided":
      return paymentPayload(same("proof_confirmed", "proof_rejected", "payment_voided"));
    case "payment_reminder":
      return reminderPayload(same("payment_reminder"));
    case "comment":
    case "assessment":
      return progressPayload(same(first.kind));
    case "announcement":
      return announcementPayload(same("announcement"));
  }
}

// --- Staff alerts ----------------------------------------------------------------------------

/** A new enrollment request (or renewal) to review: owners, admins, and the front desk. */
export function staffEnrollmentPayload(input: {
  requestId: string;
  studentFirstName: string;
  tierName: string;
  renewal: boolean;
}): PushPayload {
  return {
    title: input.renewal ? "Renewal request" : "New enrollment request",
    body: `${firstNameOf(input.studentFirstName)} · ${input.tierName}`,
    url: `/enrollments/${encodeURIComponent(input.requestId)}`,
    tag: `staff-enrollment:${input.requestId}`,
  };
}

/** A new payment proof to review: owners, admins, and the front desk (never the amount). */
export function staffProofPayload(input: {
  proofId: string;
  studentFirstName: string;
}): PushPayload {
  return {
    title: "Payment proof to review",
    body: `For ${firstNameOf(input.studentFirstName)}. Review it in Money.`,
    url: "/money",
    tag: `staff-proof:${input.proofId}`,
  };
}

/** The test notification each surface sends from its settings. */
export const TEST_PAYLOAD = {
  family: {
    title: "Reminders are on",
    body: "This is how CoachMan reminders will look on this device.",
    url: "/my/notifications",
    tag: "test",
  },
  staff: {
    title: "CoachMan reminders are on",
    body: "This is how session reminders will look.",
    url: "/settings",
    tag: "test",
  },
} as const satisfies Record<string, PushPayload>;
