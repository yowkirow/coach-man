import type { BalanceDto, ChargeListItemDto, MoneySummaryDto, PaymentDto } from "@shared/api-types";
import type { ChargeKind } from "@shared/domain";
import { currencyDigits } from "@shared/money";
import { useQuery } from "@tanstack/react-query";
import type { PillTone } from "../../components/ui/display";
import { api } from "../../lib/api";
import type { Format } from "../../lib/format";
import { keys } from "../../lib/query";

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-10" shifted by whole months. */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = (y ?? 1970) * 12 + ((m ?? 1) - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Whole months from a to b (b later = positive). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return ((by ?? 0) - (ay ?? 0)) * 12 + ((bm ?? 0) - (am ?? 0));
}

/** First and last calendar day of a month, as YYYY-MM-DD. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

export function monthLabel(ym: string, locale: string, style: "short" | "long" = "long"): string {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: style, timeZone: "UTC" }).format(
    Date.UTC(y ?? 1970, (m ?? 1) - 1, 1),
  );
}

/** "Sep 20" for a YYYY-MM-DD date (no weekday, so it fits tight rows). */
export function shortDate(ymd: string, locale: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/** Money that fits a KPI tile: full when short, compact ("₱12.5K") when long. */
export function compactMoney(minor: number, fmt: Format): string {
  const short = fmt.moneyShort(minor);
  if (short.length <= 7) return short;
  try {
    return new Intl.NumberFormat(fmt.locale, {
      style: "currency",
      currency: fmt.currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(minor / 10 ** currencyDigits(fmt.currency));
  } catch {
    return short;
  }
}

export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  package: "Packages",
  session: "Sessions",
  event: "Events",
  adjustment: "Adjustments",
  other: "Other",
};

export const CHARGE_KIND_SINGULAR: Record<ChargeKind, string> = {
  package: "Package",
  session: "Session",
  event: "Event",
  adjustment: "Adjustment",
  other: "Other",
};

export const CHARGE_KIND_TONES: Record<ChargeKind, PillTone> = {
  package: "violet",
  session: "sky",
  event: "amber",
  adjustment: "panel",
  other: "outline",
};

const METHOD_TONES: PillTone[] = ["mint", "sky", "violet", "amber", "lavender"];

/** Stable pastel per payment method, following the workspace's method order. */
export function methodTone(method: string, methods: readonly string[]): PillTone {
  const i = methods.indexOf(method);
  return i < 0 ? "outline" : (METHOD_TONES[i % METHOD_TONES.length] ?? "outline");
}

/** Splits a display name for initials (the list endpoints return "First Last"). */
export function personOf(name: string): { firstName: string; lastName: string } {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

export function useMoneySummary(month: string) {
  return useQuery({
    queryKey: keys.money(month),
    queryFn: () => api.get<MoneySummaryDto>(`/money/summary?month=${month}`),
    placeholderData: (prev) => prev,
  });
}

export function useBalances() {
  return useQuery({
    queryKey: keys.balances,
    queryFn: () => api.get<BalanceDto[]>("/money/balances"),
  });
}

export function usePayments(month: string) {
  const { from, to } = monthRange(month);
  return useQuery({
    queryKey: ["payments", from, to],
    queryFn: () => api.get<PaymentDto[]>(`/payments?from=${from}&to=${to}`),
  });
}

export function useCharges(month: string) {
  const { from, to } = monthRange(month);
  return useQuery({
    queryKey: ["charges", from, to],
    queryFn: () => api.get<ChargeListItemDto[]>(`/charges?from=${from}&to=${to}`),
  });
}

/** Balance wording used in toasts and hints. */
export function balanceText(name: string, balanceMinor: number, fmt: Format): string {
  if (balanceMinor > 0) return `${name} now owes ${fmt.money(balanceMinor)}.`;
  if (balanceMinor < 0) return `${name} has ${fmt.money(-balanceMinor)} in credit.`;
  return `${name} is all paid up.`;
}
