import type {
  AcademyDto,
  AccountDto,
  ClientListItemDto,
  CoachSummaryDto,
  EnrollmentCountDto,
  GroupDto,
  LessonDetailDto,
  LessonSummaryDto,
  MeDto,
  PackageTemplateDto,
  PaymentProofCountDto,
  RateDto,
  SkillDto,
  TeamDto,
  TodayDto,
  VenueDto,
} from "@shared/api-types";
import { CAPABILITY_NAMES, type Capabilities } from "@shared/roles";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { accountApi, api } from "./api";
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

const NO_CAPABILITIES = Object.fromEntries(CAPABILITY_NAMES.map((c) => [c, false])) as Capabilities;

/**
 * What the signed-in staff member may do here (see src/shared/roles.ts). Until the profile has
 * loaded, nothing: money and admin surfaces stay hidden rather than flash for a coach.
 */
export function useCan(): Capabilities {
  return useMe().data?.can ?? NO_CAPABILITIES;
}

/** Who is signed in and where they belong: staff academies and family links (no workspace needed). */
export const accountQuery = {
  queryKey: keys.account,
  queryFn: async () => {
    const account = await accountApi.get<AccountDto>();
    // Someone else behind the same cached app (a family phone passed around): start clean, keeping
    // only this person's account.
    const cached = queryClient.getQueryData<AccountDto>(keys.account);
    if (cached && cached.user.id !== account.user.id) {
      queryClient.setQueryData(keys.account, account);
      claimCache(account.user.id);
    }
    return account;
  },
  staleTime: 60_000,
};

export function useAccount() {
  return useQuery(accountQuery);
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

/** Everyone on the team (current staff), for coach pickers and avatars. Cached for offline use. */
export function useCoaches() {
  return useQuery({
    queryKey: keys.coaches,
    queryFn: () => api.get<CoachSummaryDto[]>("/coaches"),
    staleTime: 5 * 60_000,
  });
}

/** Coaches by user id. */
export function useCoachMap(): Map<string, CoachSummaryDto> {
  const coaches = useCoaches().data;
  return useMemo(() => new Map((coaches ?? []).map((c) => [c.userId, c])), [coaches]);
}

/** More than one person on the team: coach pickers and "Mine / Everyone" have a choice to offer. */
export function useHasTeam(): boolean {
  return (useCoaches().data?.length ?? 0) > 1;
}

export function useAcademy() {
  return useQuery({ queryKey: keys.academy, queryFn: () => api.get<AcademyDto>("/academy") });
}

export function useTeam() {
  return useQuery({ queryKey: keys.team, queryFn: () => api.get<TeamDto>("/team") });
}

/** Enrollment requests waiting for a decision: the nav badge (owners and admins). */
export function useEnrollmentCount() {
  const can = useCan();
  return useQuery({
    queryKey: keys.enrollmentCount,
    queryFn: () => api.get<EnrollmentCountDto>("/enrollments/count"),
    enabled: can.enrollment,
    refetchInterval: 120_000,
    staleTime: 30_000,
  });
}

/** Payment proofs waiting for review: the Money badge (owners and admins). */
export function useProofCount() {
  const can = useCan();
  return useQuery({
    queryKey: keys.proofCount,
    queryFn: () => api.get<PaymentProofCountDto>("/payment-proofs/count"),
    enabled: can.enrollment && can.money,
    refetchInterval: 120_000,
    staleTime: 30_000,
  });
}
