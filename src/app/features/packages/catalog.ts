import type {
  GroupDto,
  PackageTemplateDto,
  PublicCoachRefDto,
  PublicPackageDto,
  RateDto,
} from "@shared/api-types";
import { LESSON_KINDS, type LessonKind, RATE_KINDS, type RateKind } from "@shared/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PillTone } from "../../components/ui/display";
import { api, errorMessage } from "../../lib/api";
import type { Format } from "../../lib/format";
import { notify } from "../../lib/notify";
import { keys } from "../../lib/query";

export type CatalogTab = "packages" | "rates" | "public";

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

/** Validity of a package template: a day count, or to the end of the month it starts in. */
export function templateValidityText(
  t: Pick<PackageTemplateDto, "validityDays" | "validityMode">,
): string {
  return t.validityMode === "month_end" ? "Valid to month end" : validityText(t.validityDays);
}

/** A package template as the public page shows it (prices only when the viewer may see them). */
export function tierPreview(
  t: PackageTemplateDto,
  coach: PublicCoachRefDto | null = null,
): PublicPackageDto {
  return {
    id: t.id,
    programId: t.programId ?? null,
    name: t.name,
    priceMinor: t.priceMinor,
    credits: t.credits,
    sessionsLabel: t.sessionsLabel ?? null,
    validityMode: t.validityMode ?? "days",
    validityDays: t.validityMode === "month_end" ? null : t.validityDays,
    inclusions: t.inclusions ?? [],
    audience: t.audience ?? null,
    commitmentNote: t.commitmentNote ?? null,
    includesUniform: t.includesUniform ?? false,
    asksSelfRating: t.asksSelfRating ?? false,
    highlight: t.highlight ?? false,
    coach,
  };
}

/** `ids` with `id` swapped with its neighbour among `siblings` (ids in the same list), by `by`. */
export function moveAmong(ids: string[], siblings: string[], id: string, by: -1 | 1): string[] {
  const at = siblings.indexOf(id);
  const other = siblings[at + by];
  if (at < 0 || !other) return ids;
  return ids.map((x) => (x === id ? other : x === other ? id : x));
}

/** Moves still saving, per list, sent one after another in the order they were made. */
const reorderQueues: Record<"groups" | "packages", { chain: Promise<unknown>; pending: number }> = {
  groups: { chain: Promise.resolve(), pending: 0 },
  packages: { chain: Promise.resolve(), pending: 0 },
};

/**
 * Saves a new order for programs (groups) or package tiers, showing it right away. A quick
 * series of moves is saved in order, each starting from the one before, and the list is
 * refetched once the last one lands (so it doesn't jump back in between).
 */
export function useReorder(kind: "groups" | "packages") {
  const qc = useQueryClient();
  const key = kind === "groups" ? keys.groups : keys.packages;
  const queue = reorderQueues[kind];
  return useMutation({
    meta: { silent: true },
    mutationFn: (ids: string[]) => {
      const run = queue.chain.then(() => api.post(`/${kind}/reorder`, { ids }));
      queue.chain = run.catch(() => undefined);
      return run;
    },
    onMutate: async (ids) => {
      queue.pending += 1;
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ id: string }[]>(key);
      qc.setQueryData<{ id: string; sortOrder?: number }[]>(key, (old) => {
        if (!old) return old;
        const rank = new Map(ids.map((id, i) => [id, i * 10]));
        const next = old.map((x) => (rank.has(x.id) ? { ...x, sortOrder: rank.get(x.id) } : x));
        // Packages come in their sort order; groups by name (the page sorts programs itself).
        return kind === "packages"
          ? next.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          : next;
      });
      return { prev };
    },
    onError: (err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      notify({ tone: "danger", title: "Couldn't change the order", body: errorMessage(err) });
    },
    onSettled: () => {
      queue.pending = Math.max(0, queue.pending - 1);
      if (queue.pending > 0) return;
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: keys.publicPreview });
    },
  });
}

/** Changes a package tier's public-page flags (on the page, featured) in place. */
export function useTierFlags() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; name: string; isPublic?: boolean; highlight?: boolean }) =>
      api.patch(`/packages/${v.id}`, {
        ...(v.isPublic === undefined ? {} : { isPublic: v.isPublic }),
        ...(v.highlight === undefined ? {} : { highlight: v.highlight }),
      }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: keys.packages });
      const prev = qc.getQueryData<PackageTemplateDto[]>(keys.packages);
      qc.setQueryData<PackageTemplateDto[]>(keys.packages, (old) =>
        old?.map((x) =>
          x.id === v.id
            ? {
                ...x,
                ...(v.isPublic === undefined ? {} : { isPublic: v.isPublic }),
                ...(v.highlight === undefined ? {} : { highlight: v.highlight }),
              }
            : x,
        ),
      );
      return { prev };
    },
    onError: (err, v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.packages, ctx.prev);
      notify({ tone: "danger", title: `Couldn't update ${v.name}`, body: errorMessage(err) });
    },
    onSuccess: (_d, v) => {
      if (v.isPublic !== undefined)
        notify({
          tone: "success",
          title: v.isPublic
            ? `${v.name} is on your academy page`
            : `${v.name} is off your academy page`,
        });
      else if (v.highlight !== undefined)
        notify({
          tone: "success",
          title: v.highlight ? `${v.name} is featured` : `${v.name} is no longer featured`,
        });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.packages });
      void qc.invalidateQueries({ queryKey: keys.publicPreview });
    },
  });
}

/** Puts a program (group) on the academy page or takes it off. */
export function useProgramPublic() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; name: string; isPublic: boolean }) =>
      api.patch(`/groups/${v.id}`, { isPublic: v.isPublic }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: keys.groups });
      const prev = qc.getQueryData<GroupDto[]>(keys.groups);
      qc.setQueryData<GroupDto[]>(keys.groups, (old) =>
        old?.map((g) => (g.id === v.id ? { ...g, isPublic: v.isPublic } : g)),
      );
      return { prev };
    },
    onError: (err, v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.groups, ctx.prev);
      notify({ tone: "danger", title: `Couldn't update ${v.name}`, body: errorMessage(err) });
    },
    onSuccess: (_d, v) =>
      notify({
        tone: "success",
        title: v.isPublic
          ? `${v.name} is on your academy page`
          : `${v.name} is off your academy page`,
      }),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: keys.groups });
      void qc.invalidateQueries({ queryKey: keys.group(v.id) });
      void qc.invalidateQueries({ queryKey: keys.publicPreview });
    },
  });
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
