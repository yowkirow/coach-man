import type {
  ClientListItemDto,
  GroupDetailDto,
  GroupDto,
  LessonSummaryDto,
  SeriesDto,
} from "@shared/api-types";
import { localTime, weekdayOf } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Format } from "../../lib/format";
import { keys } from "../../lib/query";
import { clockLabel, weekdaysLabel } from "../schedule/dates";

export function useGroupList(includeArchived: boolean) {
  return useQuery({
    queryKey: includeArchived ? [...keys.groups, "with-archived"] : keys.groups,
    queryFn: () => api.get<GroupDto[]>(includeArchived ? "/groups?archived=1" : "/groups"),
  });
}

export function useGroup(id: string) {
  return useQuery({
    queryKey: keys.group(id),
    queryFn: () => api.get<GroupDetailDto>(`/groups/${id}`),
  });
}

/** Group lists, the group, rosters it feeds, and session titles (which fall back to its name). */
export function useInvalidateGroups() {
  const qc = useQueryClient();
  return (groupId?: string, opts: { members?: boolean } = {}) => {
    void qc.invalidateQueries({ queryKey: keys.groups });
    if (groupId) void qc.invalidateQueries({ queryKey: keys.group(groupId) });
    void qc.invalidateQueries({ queryKey: ["lessons"] });
    void qc.invalidateQueries({ queryKey: keys.today });
    if (opts.members) {
      void qc.invalidateQueries({ queryKey: ["lesson"] });
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: ["client"] });
    }
  };
}

/**
 * Weekly pattern from upcoming sessions, e.g. "Wed & Fri · 7:00 AM". Uses the most common start
 * time; other times are counted as "+N more".
 */
export function weeklyPattern(lessons: LessonSummaryDto[], fmt: Format): string | null {
  const live = lessons.filter((l) => l.status !== "cancelled");
  if (!live.length) return null;
  const byTime = new Map<string, Set<number>>();
  for (const l of live) {
    const hhmm = localTime(l.startsAt, fmt.tz);
    const set = byTime.get(hhmm) ?? new Set<number>();
    set.add(weekdayOf(fmt.dayOf(l.startsAt)));
    byTime.set(hhmm, set);
  }
  const ranked = [...byTime.entries()].sort((a, b) => b[1].size - a[1].size);
  const top = ranked[0];
  if (!top) return null;
  const [time, days] = top;
  const base = `${weekdaysLabel([...days], fmt.locale, fmt.weekStartsOn)} · ${clockLabel(time, fmt.locale)}`;
  return ranked.length > 1 ? `${base} +${ranked.length - 1} more` : base;
}

/** Palette offered for group colours (design tokens plus a few stronger accents). */
export const GROUP_COLORS = [
  { hex: "#daee63", name: "Lime" },
  { hex: "#b3a8f5", name: "Lavender" },
  { hex: "#a9dceb", name: "Sky" },
  { hex: "#bfe9d0", name: "Mint" },
  { hex: "#f8d477", name: "Amber" },
  { hex: "#f87171", name: "Coral" },
  { hex: "#7cc4ff", name: "Blue" },
  { hex: "#ffb020", name: "Orange" },
] as const;

export function colorName(hex: string | null): string {
  if (!hex) return "No colour";
  return GROUP_COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name ?? "Custom";
}

/** Swatch colour for a group, falling back to the violet used for group sessions. */
export function groupColor(g: Pick<GroupDto, "color">): string {
  return g.color ?? "#c9befb";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "Tue & Thu · 7:00 AM–8:30 AM" for a weekly series. */
export function seriesLabel(s: SeriesDto, fmt: Format): string {
  const [h, m] = s.startTime.split(":").map(Number);
  const endMin = ((h ?? 0) * 60 + (m ?? 0) + s.durationMinutes) % (24 * 60);
  const end = `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`;
  const days = weekdaysLabel(s.weekdays, fmt.locale, fmt.weekStartsOn);
  return `${days} · ${clockLabel(s.startTime, fmt.locale)}–${clockLabel(end, fmt.locale)}`;
}

/** Members of each group, from the client list (which already leaves out archived clients). */
export function membersByGroup(clients: ClientListItemDto[] | undefined) {
  const map = new Map<string, ClientListItemDto[]>();
  for (const c of clients ?? []) {
    for (const g of c.groupIds) {
      const list = map.get(g);
      if (list) list.push(c);
      else map.set(g, [c]);
    }
  }
  return map;
}

export interface GroupScheduleInfo {
  /** e.g. "Wed & Fri · 7:00 AM", or null when nothing is scheduled. */
  pattern: string | null;
  next: LessonSummaryDto | null;
}

/** Weekly pattern and next session for every group, from a window of upcoming sessions. */
export function scheduleByGroup(
  lessons: LessonSummaryDto[] | undefined,
  fmt: Format,
  now: number,
): Map<string, GroupScheduleInfo> {
  const byGroup = new Map<string, LessonSummaryDto[]>();
  for (const l of lessons ?? []) {
    if (!l.groupId) continue;
    const list = byGroup.get(l.groupId);
    if (list) list.push(l);
    else byGroup.set(l.groupId, [l]);
  }
  const out = new Map<string, GroupScheduleInfo>();
  for (const [id, list] of byGroup) {
    out.set(id, {
      pattern: weeklyPattern(list, fmt),
      next: list.find((l) => l.status === "scheduled" && l.endsAt > now) ?? null,
    });
  }
  return out;
}
