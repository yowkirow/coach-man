import type { ValidityMode } from "./domain";
import { addDays, compareDates } from "./time";

// Package validity. A package pays for sessions from the day it starts to the day it expires, both
// counted as local dates in the academy's time zone:
// - `days`: it starts the day it is bought (`purchasedOn`) and lasts `validityDays` days.
// - `month_end`: it runs for one calendar month (its `startMonth`, this month or next, no
//   proration): from the first of that month to its last day.

/** A calendar month, "YYYY-MM". */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** The month of a local date ("2026-11-05" → "2026-11"). */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** A month moved by `delta` months ("2026-12" + 1 → "2027-01"). */
export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function firstDayOf(ym: string): string {
  return `${ym}-01`;
}

/** The last day of a month ("2028-02" → "2028-02-29"). */
export function lastDayOf(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  const d = new Date(Date.UTC(y ?? 1970, m ?? 1, 0));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The months a month-end package can start in, given today's local date: this month and next. */
export function startMonthChoices(today: string): [string, string] {
  const current = monthOf(today);
  return [current, addMonths(current, 1)];
}

export function isAllowedStartMonth(ym: string, today: string): boolean {
  return MONTH_RE.test(ym) && startMonthChoices(today).includes(ym);
}

/** The first local date a sold package can pay for: the first of its start month, else its purchase day. */
export function packageStartsOn(p: { purchasedOn: string; startMonth: string | null }): string {
  return p.startMonth ? firstDayOf(p.startMonth) : p.purchasedOn;
}

/** Whether a package may pay for a session on this local date: within [start, expiry]. */
export function coversDate(
  p: { purchasedOn: string; startMonth: string | null; expiresOn: string | null },
  date: string,
): boolean {
  if (compareDates(date, packageStartsOn(p)) < 0) return false;
  return p.expiresOn === null || compareDates(date, p.expiresOn) <= 0;
}

export interface SaleTerms {
  purchasedOn: string;
  /** Month-end packages only. */
  startMonth: string | null;
  expiresOn: string | null;
}

export type SaleTermsResult =
  | { ok: true; terms: SaleTerms }
  | { ok: false; field: "startMonth"; message: string };

/**
 * The dates of a package being sold (or approved) today, from its template's validity.
 * Month-end packages take a start month (this month or next; this month when omitted) and expire
 * on its last day, whatever expiry was asked for. Day-based packages start on `purchasedOn`
 * (today by default) and expire `validityDays` later, unless an expiry is given.
 */
export function saleTerms(input: {
  validityMode: ValidityMode;
  validityDays: number | null;
  today: string;
  purchasedOn?: string;
  startMonth?: string | null;
  expiresOn?: string | null;
}): SaleTermsResult {
  const purchasedOn = input.purchasedOn ?? input.today;
  if (input.validityMode === "month_end") {
    const startMonth = input.startMonth ?? monthOf(input.today);
    if (!isAllowedStartMonth(startMonth, input.today)) {
      return {
        ok: false,
        field: "startMonth",
        message: "Monthly packages start this month or next month.",
      };
    }
    return { ok: true, terms: { purchasedOn, startMonth, expiresOn: lastDayOf(startMonth) } };
  }
  const expiresOn =
    input.expiresOn !== undefined
      ? input.expiresOn
      : input.validityDays
        ? addDays(purchasedOn, input.validityDays - 1)
        : null;
  return { ok: true, terms: { purchasedOn, startMonth: null, expiresOn } };
}
