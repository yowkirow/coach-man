import type { WorkspaceSettingsDto } from "@shared/api-types";
import { formatMoney, formatMoneyShort } from "@shared/money";
import { localDate, todayIn } from "@shared/time";
import { useMemo } from "react";
import { useMe } from "./hooks";

const FALLBACK: Pick<WorkspaceSettingsDto, "currency" | "timezone" | "locale" | "weekStartsOn"> = {
  currency: "USD",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
  weekStartsOn: 1,
};

export function makeFormat(
  s: Pick<WorkspaceSettingsDto, "currency" | "timezone" | "locale" | "weekStartsOn">,
) {
  const { currency, timezone: tz, locale } = s;
  const timeFmt = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  const dayFmt = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const longDayFmt = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const shortDateFmt = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const monthFmt = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const asUtc = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return {
    currency,
    tz,
    locale,
    weekStartsOn: s.weekStartsOn,
    today: () => todayIn(tz),
    money: (minor: number) => formatMoney(minor, currency, locale),
    moneyShort: (minor: number) => formatMoneyShort(minor, currency, locale),
    time: (epoch: number) => timeFmt.format(epoch),
    timeRange: (start: number, end: number) => `${timeFmt.format(start)}–${timeFmt.format(end)}`,
    /** "Tue 14 Oct" for a YYYY-MM-DD date. */
    day: (ymd: string) => dayFmt.format(asUtc(ymd)),
    longDay: (ymd: string) => longDayFmt.format(asUtc(ymd)),
    date: (ymd: string) => shortDateFmt.format(asUtc(ymd)),
    month: (ym: string) => monthFmt.format(asUtc(`${ym}-01`)),
    dayOf: (epoch: number) => localDate(epoch, tz),
    /** "in 1 h 30 min", "now", "12 min ago". */
    relative: (epoch: number, now = Date.now()) => {
      const mins = Math.round((epoch - now) / 60_000);
      const abs = Math.abs(mins);
      const span =
        abs < 60
          ? `${abs} min`
          : abs % 60 === 0
            ? `${abs / 60} h`
            : `${Math.floor(abs / 60)} h ${abs % 60} min`;
      if (abs <= 1) return "now";
      return mins > 0 ? `in ${span}` : `${span} ago`;
    },
  };
}

export type Format = ReturnType<typeof makeFormat>;

export function useFormat(): Format {
  const { currency, timezone, locale, weekStartsOn } = useMe().data?.settings ?? FALLBACK;
  return useMemo(
    () => makeFormat({ currency, timezone, locale, weekStartsOn }),
    [currency, timezone, locale, weekStartsOn],
  );
}

export function fullName(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName}`.trim();
}

export function initials(p: { firstName: string; lastName: string }) {
  return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
