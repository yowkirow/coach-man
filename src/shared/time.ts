import { TZDate } from "@date-fns/tz";

// Calendar dates are "YYYY-MM-DD" strings in the workspace timezone; instants are epoch ms (UTC).

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (n: number) => String(n).padStart(2, "0");

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
}

/** Local calendar date of an instant in a timezone. */
export function localDate(epochMs: number, tz: string): string {
  const d = new TZDate(epochMs, tz);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local wall-clock time (HH:MM) of an instant in a timezone. */
export function localTime(epochMs: number, tz: string): string {
  const d = new TZDate(epochMs, tz);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayIn(tz: string, now: number = Date.now()): string {
  return localDate(now, tz);
}

/** Instant for a local date + HH:MM in a timezone (DST-aware). */
export function zonedToEpoch(date: string, time: string, tz: string): number {
  const [y, m, d] = parts(date);
  const [hh, mm] = time.split(":").map(Number);
  return new TZDate(y, m - 1, d, hh ?? 0, mm ?? 0, 0, 0, tz).getTime();
}

export function startOfLocalDay(date: string, tz: string): number {
  return zonedToEpoch(date, "00:00", tz);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 0 = Sunday ... 6 = Saturday for a calendar date (timezone independent). */
export function weekdayOf(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Age in whole years on a given date. */
export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = parts(birthDate);
  const [y, m, d] = parts(onDate);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

/** Month-day key ("MM-DD") used for birthday matching. */
export function monthDay(date: string): string {
  return date.slice(5, 10);
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
