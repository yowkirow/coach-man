import type { EventDto } from "@shared/api-types";
import type { EventKind, EventStatus, RegistrationStatus } from "@shared/domain";
import { currencyDigits } from "@shared/money";
import { compareDates, daysBetween } from "@shared/time";
import {
  CalendarRange,
  GraduationCap,
  type LucideIcon,
  PartyPopper,
  Target,
  Tent,
  Trophy,
} from "lucide-react";
import type { PillTone } from "../../components/ui/display";
import type { Format } from "../../lib/format";
import { dateRangeLabel } from "../schedule/dates";

export const EVENT_KIND_ORDER: EventKind[] = [
  "camp",
  "academy",
  "clinic",
  "tournament",
  "social",
  "other",
];

export const EVENT_KIND_TONE: Record<EventKind, PillTone> = {
  camp: "amber",
  academy: "violet",
  clinic: "sky",
  tournament: "lavender",
  social: "mint",
  other: "white",
};

/** Icon circle fill per kind (ink icon on every fill). */
export const EVENT_KIND_FILL: Record<EventKind, string> = {
  camp: "bg-amber",
  academy: "bg-violet",
  clinic: "bg-sky",
  tournament: "bg-lavender",
  social: "bg-mint",
  other: "bg-panel",
};

export const EVENT_KIND_ICON: Record<EventKind, LucideIcon> = {
  camp: Tent,
  academy: GraduationCap,
  clinic: Target,
  tournament: Trophy,
  social: PartyPopper,
  other: CalendarRange,
};

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Registration closed",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const EVENT_STATUS_TONE: Record<EventStatus, PillTone> = {
  draft: "outline",
  open: "mint",
  closed: "panel",
  completed: "sky",
  cancelled: "coral",
};

export const REG_STATUS_LABEL: Record<RegistrationStatus, string> = {
  registered: "Registered",
  waitlisted: "Waitlisted",
  cancelled: "Cancelled",
};

export const REG_STATUS_TONE: Record<RegistrationStatus, PillTone> = {
  registered: "lime",
  waitlisted: "amber",
  cancelled: "panel",
};

export type EventTiming = "upcoming" | "on" | "ended";

export function eventTiming(e: Pick<EventDto, "startsOn" | "endsOn">, today: string): EventTiming {
  if (compareDates(today, e.startsOn) < 0) return "upcoming";
  if (compareDates(today, e.endsOn) > 0) return "ended";
  return "on";
}

/** "Starts in 5 days", "On now · day 3 of 5", "Ended Sat, Oct 17". */
export function timingLabel(
  e: Pick<EventDto, "startsOn" | "endsOn" | "status">,
  today: string,
  fmt: Format,
): string {
  if (e.status === "cancelled") return "Cancelled";
  const t = eventTiming(e, today);
  if (t === "ended") return `Ended ${fmt.day(e.endsOn)}`;
  if (t === "on") {
    const total = daysBetween(e.startsOn, e.endsOn) + 1;
    return total > 1
      ? `On now · day ${daysBetween(e.startsOn, today) + 1} of ${total}`
      : "On today";
  }
  const n = daysBetween(today, e.startsOn);
  if (n === 1) return "Starts tomorrow";
  return n <= 14 ? `Starts in ${n} days` : `Starts ${fmt.day(e.startsOn)}`;
}

export function eventDates(
  e: Pick<EventDto, "startsOn" | "endsOn">,
  fmt: Format,
  opts: { weekday?: boolean } = {},
): string {
  return dateRangeLabel(e.startsOn, e.endsOn, fmt.locale, { ...opts, today: fmt.today() });
}

/** What a new registration pays today: the early-bird price until its last day. */
export function currentPrice(
  e: Pick<EventDto, "priceMinor" | "earlyBirdPriceMinor" | "earlyBirdUntil">,
  today: string,
): { priceMinor: number; earlyBird: boolean } {
  if (
    e.earlyBirdPriceMinor !== null &&
    e.earlyBirdUntil &&
    compareDates(today, e.earlyBirdUntil) <= 0
  ) {
    return { priceMinor: e.earlyBirdPriceMinor, earlyBird: true };
  }
  return { priceMinor: e.priceMinor, earlyBird: false };
}

/** "Ages 9–14", "Ages 9+", "Up to age 14", or null. */
export function agesLabel(e: Pick<EventDto, "ageMin" | "ageMax">): string | null {
  if (e.ageMin !== null && e.ageMax !== null) return `Ages ${e.ageMin}–${e.ageMax}`;
  if (e.ageMin !== null) return `Ages ${e.ageMin}+`;
  if (e.ageMax !== null) return `Up to age ${e.ageMax}`;
  return null;
}

/** Compact amount for KPI tiles, e.g. "₱12.5K"; small amounts stay whole. */
export function moneyCompact(minor: number, fmt: Format): string {
  const major = minor / 10 ** currencyDigits(fmt.currency);
  if (Math.abs(major) < 10_000) return fmt.moneyShort(minor);
  try {
    return new Intl.NumberFormat(fmt.locale, {
      style: "currency",
      currency: fmt.currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(major);
  } catch {
    return fmt.moneyShort(minor);
  }
}

/** Amount without the currency symbol, for placeholders in money fields that already show it. */
export function plainAmount(minor: number, fmt: Format): string {
  const digits = currencyDigits(fmt.currency);
  try {
    return new Intl.NumberFormat(fmt.locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** digits);
  } catch {
    return (minor / 10 ** digits).toFixed(digits);
  }
}

/** Closed for new registrations on the server (cancelled or completed). */
export function registrationsLocked(e: Pick<EventDto, "status">): boolean {
  return e.status === "cancelled" || e.status === "completed";
}
