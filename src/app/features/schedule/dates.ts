import { addDays, compareDates, localTime, weekdayOf } from "@shared/time";

// Calendar helpers for YYYY-MM-DD dates in the workspace timezone (see @shared/time).

const asUtc = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

/** First day of the week containing `date`, given the workspace's first weekday (0 = Sunday). */
export function startOfWeek(date: string, weekStartsOn: number): string {
  return addDays(date, -((weekdayOf(date) - weekStartsOn + 7) % 7));
}

export function daysFrom(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Six full weeks covering a month, starting on the workspace's first weekday. */
export function monthGrid(ym: string, weekStartsOn: number): string[] {
  return daysFrom(startOfWeek(`${ym}-01`, weekStartsOn), 42);
}

/** Weekday numbers (0 = Sunday) in display order for the workspace. */
export function orderedWeekdays(weekStartsOn: number): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
}

/** Localised weekday name; 2023-01-01 was a Sunday. */
export function weekdayName(
  day: number,
  locale: string,
  style: "long" | "short" | "narrow" = "short",
): string {
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(
    Date.UTC(2023, 0, 1 + day),
  );
}

export function dayNumber(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

/** Minutes since local midnight for an instant in the workspace timezone. */
export function minutesOf(epoch: number, tz: string): number {
  const [h, m] = localTime(epoch, tz).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "7:00 AM" for an "HH:MM" wall-clock time. */
export function clockLabel(hhmm: string, locale: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(1970, 0, 1, h ?? 0, m ?? 0));
}

/** "6 AM" style hour label for the week grid gutter. */
export function hourLabel(hour: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" }).format(
    Date.UTC(1970, 0, 1, hour % 24),
  );
}

/** "Oct 12 – 18, 2026" (the year is dropped when it is the current one unless `withYear`). */
export function dateRangeLabel(
  from: string,
  to: string,
  locale: string,
  opts: { weekday?: boolean; withYear?: boolean; today?: string } = {},
): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const showYear =
    opts.withYear ||
    !sameYear ||
    (opts.today ? from.slice(0, 4) !== opts.today.slice(0, 4) : false);
  const f = new Intl.DateTimeFormat(locale, {
    weekday: opts.weekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: showYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
  if (from === to) return f.format(asUtc(from));
  return f.formatRange(asUtc(from), asUtc(to));
}

/** "Tue & Thu" / "Mon, Wed & Fri". */
export function joinDays(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

/** Weekday summary in the workspace's week order, e.g. "Wed & Fri" or "Every day". */
export function weekdaysLabel(days: number[], locale: string, weekStartsOn: number): string {
  const set = new Set(days);
  if (set.size === 7) return "Every day";
  const ordered = orderedWeekdays(weekStartsOn).filter((d) => set.has(d));
  if (ordered.length === 5 && !set.has(0) && !set.has(6)) return "Weekdays";
  if (ordered.length === 2 && set.has(0) && set.has(6)) return "Weekends";
  return joinDays(ordered.map((d) => weekdayName(d, locale, "short")));
}

export function clampDate(date: string, min: string, max: string): string {
  if (compareDates(date, min) < 0) return min;
  if (compareDates(date, max) > 0) return max;
  return date;
}

/** Weekdays that occur between two dates (inclusive), at most a week's worth. */
export function weekdaysBetween(from: string, to: string): number[] {
  const out = new Set<number>();
  for (let d = from, i = 0; compareDates(d, to) <= 0 && i < 7; d = addDays(d, 1), i++) {
    out.add(weekdayOf(d));
  }
  return [...out];
}
