import type {
  ClientListItemDto,
  GroupDto,
  LessonDetailDto,
  LessonSummaryDto,
  MeDto,
  PackageTemplateDto,
  RateDto,
  SkillDto,
  TodayDto,
  VenueDto,
} from "@shared/api-types";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";
import { claimCache } from "./offline";
import { keys, queryClient } from "./query";

/** Wall clock that re-renders on an interval (phases like "on court now" depend on it). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export const meQuery = {
  queryKey: keys.me,
  queryFn: async () => {
    const me = await api.get<MeDto>("/me");
    // A different coach behind the same cached app (session swapped underneath): start clean.
    const cached = queryClient.getQueryData<MeDto>(keys.me);
    if (cached && cached.user.id !== me.user.id) claimCache(me.user.id);
    return me;
  },
  staleTime: 60_000,
};

export function useMe() {
  return useQuery(meQuery);
}

export function useToday() {
  return useQuery({
    queryKey: keys.today,
    queryFn: () => api.get<TodayDto>("/today"),
    refetchInterval: 60_000,
  });
}

export function useLesson(id: string) {
  return useQuery({
    queryKey: keys.lesson(id),
    queryFn: () => api.get<LessonDetailDto>(`/lessons/${id}`),
  });
}

export function useLessons(from: string, to: string) {
  return useQuery({
    queryKey: keys.lessons(from, to),
    queryFn: () => api.get<LessonSummaryDto[]>(`/lessons?from=${from}&to=${to}`),
  });
}

export function useClients(filters: { q?: string; status?: string; groupId?: string } = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const qs = params.toString();
  return useQuery({
    queryKey: keys.clients(filters),
    queryFn: () => api.get<ClientListItemDto[]>(`/clients${qs ? `?${qs}` : ""}`),
    placeholderData: (prev) => prev,
  });
}

export function useGroups() {
  return useQuery({ queryKey: keys.groups, queryFn: () => api.get<GroupDto[]>("/groups") });
}

export function useRates() {
  return useQuery({ queryKey: keys.rates, queryFn: () => api.get<RateDto[]>("/rates") });
}

export function usePackageTemplates() {
  return useQuery({
    queryKey: keys.packages,
    queryFn: () => api.get<PackageTemplateDto[]>("/packages"),
  });
}

export function useVenues() {
  return useQuery({ queryKey: keys.venues, queryFn: () => api.get<VenueDto[]>("/venues") });
}

export function useSkills() {
  return useQuery({ queryKey: keys.skills, queryFn: () => api.get<SkillDto[]>("/skills") });
}
