import type {
  PublicAcademyDto,
  PublicPackageDto,
  PublicProgramDto,
  PublicVenueDto,
  PublicWeeklySessionDto,
} from "@shared/api-types";
import type { Format } from "../../lib/format";
import { plural } from "../../lib/format";
import { orderedWeekdays, weekdaysLabel } from "../schedule/dates";

/** The month-end rule as the rates sheet says it. */
export const MONTH_END_NOTE =
  "Valid until the end of the month; best to enroll early in the month.";
/** Its second half, under "Valid until the end of the month". */
export const MONTH_END_ADVICE = "Best to enroll early in the month.";

const pad = (n: number) => String(n).padStart(2, "0");

/** "7:00 – 10:00 PM" for a weekly session (formatRange drops the repeated AM/PM). */
export function sessionTimes(
  s: Pick<PublicWeeklySessionDto, "startTime" | "durationMinutes">,
  locale: string,
) {
  const [h = 0, m = 0] = s.startTime.split(":").map(Number);
  const start = Date.UTC(1970, 0, 1, h, m);
  const end = start + s.durationMinutes * 60_000;
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).formatRange(start, end);
  } catch {
    const endMin = (h * 60 + m + s.durationMinutes) % (24 * 60);
    return `${s.startTime}–${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`;
  }
}

/** "3-hour sessions", "90-minute sessions". */
export function sessionLength(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}-hour sessions`;
  if (minutes > 60 && minutes % 30 === 0) return `${minutes / 60}-hour sessions`;
  return `${minutes}-minute sessions`;
}

/** Every weekday a program meets on, in the academy's week order. */
export function trainingDays(
  p: Pick<PublicProgramDto, "schedule">,
  weekStartsOn: number,
): number[] {
  const days = new Set(p.schedule.flatMap((s) => s.weekdays));
  return orderedWeekdays(weekStartsOn).filter((d) => days.has(d));
}

/**
 * The program's schedule as lines: the academy's own label when it wrote one, else each weekly
 * session's days and times ("Tue & Thu · 7:00 – 10:00 PM").
 */
export function scheduleLines(p: Pick<PublicProgramDto, "schedule" | "scheduleNote">, fmt: Format) {
  if (p.scheduleNote?.trim()) return [p.scheduleNote.trim()];
  return p.schedule.map(
    (s) =>
      `${weekdaysLabel(s.weekdays, fmt.locale, fmt.weekStartsOn)} · ${sessionTimes(s, fmt.locale)}`,
  );
}

/** "Ages 9–14", "Ages 10 and up", "Up to age 14". */
export function agesLabel(min: number | null, max: number | null): string | null {
  if (min && max) return min === max ? `Age ${min}` : `Ages ${min}–${max}`;
  if (min) return `Ages ${min} and up`;
  if (max) return `Up to age ${max}`;
  return null;
}

/** How long a tier lasts. */
export function validityLine(t: Pick<PublicPackageDto, "validityMode" | "validityDays">): string {
  if (t.validityMode === "month_end") return "Valid until the end of the month";
  if (!t.validityDays) return "No expiry";
  return `Valid ${plural(t.validityDays, "day")} from the start date`;
}

/** "4–6 sessions" as the academy labels it, else the number of sessions it pays for. */
export function sessionsLabel(t: Pick<PublicPackageDto, "sessionsLabel" | "credits">): string {
  return t.sessionsLabel?.trim() || plural(t.credits, "session");
}

/** A maps search for a venue (the academy's own map link is used for its address). */
export function directionsUrl(v: PublicVenueDto): string {
  const q = [v.name, v.address].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

const digits = (phone: string) => phone.replace(/[^\d+]/g, "");

/** Messenger's link for a Facebook page address (facebook.com/<page>), when it has one. */
export function messengerUrl(facebook: string | undefined): string | null {
  if (!facebook) return null;
  try {
    const url = new URL(facebook);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
    const [page, ...rest] = url.pathname.split("/").filter(Boolean);
    if (!page || rest.length || /\.php$/i.test(page) || page === "pages") return null;
    return `https://m.me/${encodeURIComponent(page)}`;
  } catch {
    return null;
  }
}

export interface ContactAction {
  id: "messenger" | "text" | "call" | "email";
  label: string;
  href: string;
}

/** Ways to reach the academy, most direct first: Messenger, text, call, email. */
export function contactActions(
  a: Pick<PublicAcademyDto, "contactPhone" | "contactEmail" | "socials">,
): ContactAction[] {
  const out: ContactAction[] = [];
  const messenger = messengerUrl(a.socials.facebook);
  if (messenger) out.push({ id: "messenger", label: "Message on Messenger", href: messenger });
  if (a.contactPhone) {
    out.push({ id: "text", label: "Send a text", href: `sms:${digits(a.contactPhone)}` });
    out.push({ id: "call", label: "Call", href: `tel:${digits(a.contactPhone)}` });
  }
  if (a.contactEmail) out.push({ id: "email", label: "Email", href: `mailto:${a.contactEmail}` });
  return out;
}

/** The tiers of one program (or, with null, the ones in no program), in the academy's order. */
export function tiersOf(packages: PublicPackageDto[], programId: string | null) {
  return packages.filter((p) => (p.programId ?? null) === programId);
}
