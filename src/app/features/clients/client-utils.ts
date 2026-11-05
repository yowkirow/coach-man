import type { ClientListItemDto, GroupDto } from "@shared/api-types";
import type { AttendanceStatus, ChargeKind, ClientStatus, RatingSource } from "@shared/domain";
import { ageOn, daysBetween } from "@shared/time";
import type { PillTone } from "../../components/ui/display";
import { type Format, fullName, plural } from "../../lib/format";

export const STATUS_LABELS: Record<ClientStatus, string> = {
  active: "Active",
  lead: "Lead",
  paused: "Paused",
  archived: "Archived",
};

export const STATUS_TONES: Record<ClientStatus, PillTone> = {
  active: "mint",
  lead: "sky",
  paused: "amber",
  archived: "outline",
};

export const HAND_LABELS: Record<string, string> = {
  right: "Right-handed",
  left: "Left-handed",
  ambidextrous: "Plays both hands",
};

/** Same window Today uses for "expires soon". */
export const EXPIRY_WINDOW_DAYS = 7;

/** Sample clients are tagged "sample" by the seeder; they must read as synthetic. */
export const SAMPLE_TAG = "sample";

export type CreditTone = "ok" | "low" | "out" | "none";

export interface CreditState {
  remaining: number;
  total: number;
  tone: CreditTone;
  /** "6 of 10 left", "No package" */
  label: string;
  /** "6 credits", "No package" */
  short: string;
}

export function creditState(
  c: Pick<ClientListItemDto, "creditsRemaining" | "creditsTotal" | "activePackages">,
): CreditState {
  const remaining = Math.max(0, c.creditsRemaining);
  const total = Math.max(c.creditsTotal ?? (c.activePackages > 0 ? remaining : 0), remaining);
  if (total === 0) {
    return { remaining: 0, total: 0, tone: "none", label: "No package", short: "No package" };
  }
  const tone: CreditTone = remaining <= 0 ? "out" : remaining <= 1 ? "low" : "ok";
  return {
    remaining,
    total,
    tone,
    label: remaining <= 0 ? `Used up · 0 of ${total}` : `${remaining} of ${total} left`,
    short: remaining <= 0 ? "No credits left" : plural(remaining, "credit"),
  };
}

export const CREDIT_PILL: Record<CreditTone, PillTone> = {
  ok: "sky",
  low: "amber",
  out: "coral",
  none: "outline",
};

/** Text colour for a credit figure on white (AA contrast). */
export const CREDIT_TEXT: Record<CreditTone, string> = {
  ok: "text-ink",
  low: "text-[#8a5300]",
  out: "text-[#b42318]",
  none: "text-ink-2",
};

export function expiresSoon(c: Pick<ClientListItemDto, "nextExpiryOn">, today: string) {
  return Boolean(c.nextExpiryOn && daysBetween(today, c.nextExpiryOn) <= EXPIRY_WINDOW_DAYS);
}

/** Needs a new package soon: one credit or fewer left, used up, or expiring within a week. */
export function needsPackage(c: ClientListItemDto, today: string): boolean {
  if (c.status === "archived") return false;
  const credit = creditState(c);
  if (credit.tone === "low" || credit.tone === "out") return true;
  return c.creditsRemaining > 0 && expiresSoon(c, today);
}

export const owesMoney = (c: Pick<ClientListItemDto, "balanceMinor">) => c.balanceMinor > 0;

export function isNewThisMonth(c: Pick<ClientListItemDto, "joinedOn">, today: string) {
  return Boolean(c.joinedOn && c.joinedOn.slice(0, 7) === today.slice(0, 7));
}

export const isSample = (c: { tags: string[] }) => c.tags.includes(SAMPLE_TAG);

export function matchesQuery(c: ClientListItemDto, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/[^\d]/g, "");
  return (
    fullName(c).toLowerCase().includes(needle) ||
    `${c.lastName} ${c.firstName}`.toLowerCase().includes(needle) ||
    Boolean(c.email?.toLowerCase().includes(needle)) ||
    Boolean(digits.length >= 3 && c.phone?.replace(/[^\d]/g, "").includes(digits)) ||
    c.tags.some((t) => t.toLowerCase() === needle) ||
    Boolean(c.level && c.level.toLowerCase() === needle)
  );
}

export function groupNamesOf(
  c: Pick<ClientListItemDto, "groupIds">,
  groups: Map<string, GroupDto>,
) {
  return c.groupIds.map((id) => groups.get(id)?.name).filter((n): n is string => Boolean(n));
}

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", "4 months ago". */
export function relativeDay(ymd: string, today: string): string {
  const d = daysBetween(ymd, today);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d === -1) return "Tomorrow";
  if (d < 0) return `In ${plural(-d, "day")}`;
  if (d < 7) return `${d} days ago`;
  if (d < 30) return `${plural(Math.round(d / 7), "week")} ago`;
  if (d < 365) return `${plural(Math.max(1, Math.round(d / 30)), "month")} ago`;
  return `${plural(Math.round(d / 365), "year")} ago`;
}

function weekdayFormatter(locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
}

function shortDateFormatter(locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

function asUtc(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** "Oct 14" (no weekday, no year) for timeline nodes and compact lists. */
export function shortDate(ymd: string, fmt: Format): string {
  return shortDateFormatter(fmt.locale).format(asUtc(ymd));
}

/** Compact "when" for a session: "On court now", "Today 4:00 PM", "Fri 7:00 AM", "Oct 30". */
export function whenLabel(startsAt: number, endsAt: number | null, fmt: Format, now: number) {
  if (startsAt <= now && (endsAt === null || endsAt > now)) return "On court now";
  const day = fmt.dayOf(startsAt);
  const diff = daysBetween(fmt.today(), day);
  if (diff === 0) return `Today ${fmt.time(startsAt)}`;
  if (diff === 1) return `Tomorrow ${fmt.time(startsAt)}`;
  if (diff > 1 && diff < 7)
    return `${weekdayFormatter(fmt.locale).format(asUtc(day))} ${fmt.time(startsAt)}`;
  return `${shortDate(day, fmt)}, ${fmt.time(startsAt)}`;
}

export function ageText(birthDate: string | null, today: string): string | null {
  if (!birthDate) return null;
  const age = ageOn(birthDate, today);
  return age >= 0 && age < 120 ? `Age ${age}` : null;
}

/** Normalises a phone number for duplicate checks (digits and a leading plus). */
export const normPhone = (p: string | null | undefined) => (p ? p.replace(/[^\d+]/g, "") : "");

export type StatusFilter = "active" | "lead" | "paused" | "archived";
export type QuickFilter = "low" | "owes" | "new";

/** Search params of the client list (/clients). */
export interface ListSearch {
  q?: string;
  status?: StatusFilter;
  group?: string;
  filter?: QuickFilter;
  /** "My students": the ones you coach (primary or assistant). */
  mine?: "1";
}

const STATUS_FILTERS: readonly string[] = ["active", "lead", "paused", "archived"];
const QUICK_FILTERS: readonly string[] = ["low", "owes", "new"];

export function parseListSearch(s: Record<string, unknown>): ListSearch {
  const out: ListSearch = {};
  if (typeof s.q === "string" && s.q.trim()) out.q = s.q;
  if (typeof s.status === "string" && STATUS_FILTERS.includes(s.status))
    out.status = s.status as StatusFilter;
  if (typeof s.group === "string" && s.group) out.group = s.group;
  if (typeof s.filter === "string" && QUICK_FILTERS.includes(s.filter))
    out.filter = s.filter as QuickFilter;
  if (s.mine === "1" || s.mine === 1) out.mine = "1";
  return out;
}

/** What each rubric score means, shown beside the 1–5 dots and bars. */
export const SCORE_LABELS: Record<number, string> = {
  1: "Emerging",
  2: "Developing",
  3: "Consistent",
  4: "Strong",
  5: "Advanced",
};

export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  package: "Package",
  session: "Session",
  event: "Event",
  adjustment: "Adjustment",
  other: "Other",
};

export const ATTENDANCE_PILL: Record<AttendanceStatus, PillTone> = {
  booked: "panel",
  present: "mint",
  late: "violet",
  absent: "panel",
  no_show: "coral",
  late_cancel: "amber",
  excused: "outline",
};

export const RATING_SOURCE_LABELS: Record<RatingSource, string> = {
  dupr: "DUPR",
  coach: "Coach",
  self: "Self",
};

/** Common pickleball levels offered as suggestions; any text is still allowed. */
export const LEVEL_SUGGESTIONS = ["2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5"];

/** Skills grouped by category, keeping the coach's sort order. */
export function skillsByCategory<T extends { category: string }>(skills: T[]) {
  const groups = new Map<string, T[]>();
  for (const s of skills) {
    const list = groups.get(s.category);
    if (list) list.push(s);
    else groups.set(s.category, [s]);
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }));
}

export const average = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export type ProfileTab = "overview" | "progress" | "sessions" | "money";

/** Search params of a client profile (/clients/$clientId). */
export interface ProfileSearch {
  tab?: ProfileTab;
  sell?: "1";
  pay?: "1";
}

const TABS: readonly string[] = ["overview", "progress", "sessions", "money"];

export function parseProfileSearch(s: Record<string, unknown>): ProfileSearch {
  const out: ProfileSearch = {};
  if (typeof s.tab === "string" && TABS.includes(s.tab) && s.tab !== "overview")
    out.tab = s.tab as ProfileTab;
  if (s.sell === "1" || s.sell === 1) out.sell = "1";
  if (s.pay === "1" || s.pay === 1) out.pay = "1";
  return out;
}
