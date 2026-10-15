import type { PackageTemplateDto, RateDto } from "@shared/api-types";
import { LESSON_KINDS, type LessonKind, RATE_KINDS, type RateKind } from "@shared/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PillTone } from "../../components/ui/display";
import { api, errorMessage } from "../../lib/api";
import type { Format } from "../../lib/format";
import { notify } from "../../lib/notify";
import { keys } from "../../lib/query";

export type CatalogTab = "packages" | "rates";

export const SESSION_TYPE_LABELS: Record<LessonKind, string> = {
  private: "Private",
  semi_private: "Semi-private",
  group: "Group",
  clinic: "Clinic",
  event: "Event sessions",
};

/** Same palette as the schedule's session blocks, so a type reads the same everywhere. */
export const SESSION_TYPE_TONES: Record<LessonKind, PillTone> = {
  private: "outline",
  semi_private: "mint",
  group: "violet",
  clinic: "sky",
  event: "amber",
};

export const RATE_KIND_LABELS: Record<RateKind, string> = {
  private: "Private",
  semi_private: "Semi-private",
  group: "Group",
  clinic: "Clinic",
  court_fee: "Court fees",
  other: "Other",
};

export const RATE_KIND_SINGULAR: Record<RateKind, string> = {
  private: "Private lesson",
  semi_private: "Semi-private lesson",
  group: "Group session",
  clinic: "Clinic",
  court_fee: "Court fee",
  other: "Other",
};

export const RATE_KIND_DOTS: Record<RateKind, string> = {
  private: "bg-card ring-1 ring-inset ring-ink/30",
  semi_private: "bg-mint",
  group: "bg-violet",
  clinic: "bg-sky",
  court_fee: "bg-amber",
  other: "bg-line-strong",
};

/** Session types in the canonical order (checkbox order), whatever order they were saved in. */
export function orderedKinds(kinds: readonly LessonKind[]): LessonKind[] {
  return LESSON_KINDS.filter((k) => kinds.includes(k));
}

export function rateKindsInOrder(rates: RateDto[]): RateKind[] {
  return RATE_KINDS.filter((k) => rates.some((r) => r.kind === k));
}

/** Price of one credit, rounded to the currency's smallest unit. */
export function perCredit(t: Pick<PackageTemplateDto, "priceMinor" | "credits">): number {
  return t.credits > 0 ? Math.round(t.priceMinor / t.credits) : 0;
}

export function validityText(days: number | null): string {
  if (!days) return "No expiry";
  if (days % 365 === 0) return days === 365 ? "Valid 1 year" : `Valid ${days / 365} years`;
  return `Valid ${days} days`;
}

export function durationText(minutes: number): string {
  if (minutes < 60 || minutes % 30 !== 0) return `${minutes} min`;
  const h = minutes / 60;
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}

/** "₱1,800 a session" for hourly rates, "₱1,000 an hour" for per-session ones. */
export function rateCounterpart(r: RateDto, fmt: Format): string | null {
  if (r.durationMinutes <= 0) return null;
  if (r.unit === "hour") {
    if (r.durationMinutes === 60) return null;
    return `${fmt.moneyShort(Math.round((r.priceMinor * r.durationMinutes) / 60))} a session`;
  }
  if (r.durationMinutes === 60) return null;
  return `${fmt.moneyShort(Math.round((r.priceMinor * 60) / r.durationMinutes))} an hour`;
}

/** Turns a package template or rate on or off for sale, updating the list right away. */
export function useToggleActive(kind: "package" | "rate") {
  const qc = useQueryClient();
  const key = kind === "package" ? keys.packages : keys.rates;
  return useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; name: string; active: boolean }) =>
      api.patch(`/${kind === "package" ? "packages" : "rates"}/${v.id}`, { active: v.active }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<(PackageTemplateDto | RateDto)[]>(key);
      qc.setQueryData<(PackageTemplateDto | RateDto)[]>(key, (old) =>
        old?.map((x) => (x.id === v.id ? { ...x, active: v.active } : x)),
      );
      return { prev };
    },
    onError: (err, v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      notify({
        tone: "danger",
        title: `Couldn't update ${v.name}`,
        body: errorMessage(err),
      });
    },
    onSuccess: (_d, v) => {
      notify({
        tone: "success",
        title:
          kind === "package"
            ? v.active
              ? `${v.name} is on sale`
              : `${v.name} is off sale`
            : v.active
              ? `${v.name} is back on the rate card`
              : `${v.name} is off the rate card`,
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      if (kind === "rate") {
        for (const k of [keys.today, ["lessons"], ["lesson"]])
          void qc.invalidateQueries({ queryKey: k });
      }
    },
  });
}
