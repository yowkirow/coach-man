import type {
  AccountDto,
  PortalAcademyDto,
  PortalAcademyRefDto,
  PortalHomeDto,
  PortalMoneyDto,
  PortalProgressDto,
  PortalScheduleDto,
  PortalStudentDto,
} from "@shared/api-types";
import type { FamilyRelation } from "@shared/domain";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { portalApi } from "../../lib/api";
import { type Format, makeFormat } from "../../lib/format";
import { accountQuery } from "../../lib/hooks";
import { keys } from "../../lib/query";

/**
 * The family portal's reads. Every key carries the signed-in person's id, so nobody else's cached
 * portal ever shows on a shared phone. They refetch whenever a page opens (access can be revoked
 * at any time) and show the cached copy meanwhile, also offline.
 */
const FRESH = { staleTime: 0, gcTime: 7 * 24 * 60 * 60 * 1000 };

/** The signed-in account (the portal shell rechecks it whenever the portal opens). */
export function usePortalAccount() {
  return useQuery(accountQuery);
}

export function usePortalHome() {
  const userId = usePortalAccount().data?.user.id ?? "";
  return useQuery({
    queryKey: keys.portal.home(userId),
    queryFn: () => portalApi.get<PortalHomeDto>("/home"),
    enabled: Boolean(userId),
    ...FRESH,
  });
}

export function usePortalStudent(clientId: string) {
  const userId = usePortalAccount().data?.user.id ?? "";
  return useQuery({
    queryKey: keys.portal.student(userId, clientId),
    queryFn: () => portalApi.get<PortalStudentDto>(`/students/${encodeURIComponent(clientId)}`),
    enabled: Boolean(userId && clientId),
    ...FRESH,
  });
}

export function usePortalSchedule(clientId: string, from: string, to: string) {
  const userId = usePortalAccount().data?.user.id ?? "";
  return useQuery({
    queryKey: keys.portal.schedule(userId, clientId, from, to),
    queryFn: () =>
      portalApi.get<PortalScheduleDto>(
        `/students/${encodeURIComponent(clientId)}/schedule?from=${from}&to=${to}`,
      ),
    enabled: Boolean(userId && clientId && from && to),
    placeholderData: (prev) => prev,
    ...FRESH,
  });
}

export function usePortalProgress(clientId: string) {
  const userId = usePortalAccount().data?.user.id ?? "";
  return useQuery({
    queryKey: keys.portal.progress(userId, clientId),
    queryFn: () =>
      portalApi.get<PortalProgressDto>(`/students/${encodeURIComponent(clientId)}/progress`),
    enabled: Boolean(userId && clientId),
    ...FRESH,
  });
}

export function usePortalMoney(clientId: string) {
  const userId = usePortalAccount().data?.user.id ?? "";
  return useQuery({
    queryKey: keys.portal.money(userId, clientId),
    queryFn: () => portalApi.get<PortalMoneyDto>(`/students/${encodeURIComponent(clientId)}/money`),
    enabled: Boolean(userId && clientId),
    ...FRESH,
  });
}

export function usePortalAcademy(workspaceId: string | null | undefined) {
  const userId = usePortalAccount().data?.user.id ?? "";
  return useQuery({
    queryKey: keys.portal.academy(userId, workspaceId ?? ""),
    queryFn: () =>
      portalApi.get<PortalAcademyDto>(`/academies/${encodeURIComponent(workspaceId ?? "")}`),
    enabled: Boolean(userId && workspaceId),
    ...FRESH,
  });
}

/** Formats money, dates, and times the way the student's academy does (never /api/v1/me). */
export function useAcademyFormat(academy: PortalAcademyRefDto | null | undefined): Format {
  const currency = academy?.currency ?? "USD";
  const timezone = academy?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const locale =
    academy?.locale ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
  const weekStartsOn = academy?.weekStartsOn ?? 1;
  return useMemo(
    () => makeFormat({ currency, timezone, locale, weekStartsOn }),
    [currency, timezone, locale, weekStartsOn],
  );
}

/** A linked student as the portal lists them, with their academy. */
export interface FamilyStudent {
  clientId: string;
  firstName: string;
  lastName: string;
  relation: FamilyRelation;
  workspaceId: string;
  academyName: string;
  logoKey: string | null;
}

/** Every linked student across academies, in the account's order. */
export function familyStudents(account: AccountDto | undefined): FamilyStudent[] {
  return (account?.family ?? []).flatMap((a) =>
    a.students.map((s) => ({
      ...s,
      workspaceId: a.workspaceId,
      academyName: a.academyName,
      logoKey: a.logoKey,
    })),
  );
}

const STUDENT_KEY = (userId: string) => `coachman.portal.student.${userId}`;

/** The student the tabs open, remembered on this device per person. */
export function rememberedStudent(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(STUDENT_KEY(userId));
  } catch {
    return null;
  }
}

export function rememberStudent(userId: string | undefined, clientId: string) {
  if (!userId) return;
  try {
    localStorage.setItem(STUDENT_KEY(userId), clientId);
  } catch {
    // Storage unavailable: the first student is used instead.
  }
}
