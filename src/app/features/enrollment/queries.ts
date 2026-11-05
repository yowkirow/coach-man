import type {
  EnrollmentContextDto,
  EnrollmentDetailDto,
  EnrollmentListDto,
  PortalEnrollAcademyDto,
  PortalStudentEnrollmentsDto,
  PublicConsentDocumentDto,
  PublicSessionDto,
  RenewalsDueDto,
} from "@shared/api-types";
import type { EnrollmentStatus } from "@shared/domain";
import { useQuery } from "@tanstack/react-query";
import { api, portalApi, publicApi } from "../../lib/api";
import { useCan } from "../../lib/hooks";
import { keys } from "../../lib/query";
import { usePortalAccount } from "../portal/queries";

// Reads for enrolling: the wizard's (public data and the signed-in person's choices), the
// family's (the Enroll page, a student's requests), and the staff inbox's.

/** Who the signed-in person can enroll at a listed academy (null while signed out). */
export function useEnrollmentContext(slug: string, signedIn: boolean) {
  return useQuery({
    queryKey: keys.enrollmentContext(slug),
    queryFn: () =>
      portalApi.get<EnrollmentContextDto>(`/enrollment-context?slug=${encodeURIComponent(slug)}`),
    enabled: signedIn,
    staleTime: 0,
    retry: false,
  });
}

/** The texts of the academy's required consents (public). */
export function usePublicConsents(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.publicConsents(slug),
    queryFn: () =>
      publicApi.get<PublicConsentDocumentDto[]>(`/academies/${encodeURIComponent(slug)}/consents`),
    enabled,
    staleTime: 60_000,
  });
}

/** Upcoming sessions of a public program, with places left (public, never who's booked). */
export function usePublicSessions(slug: string, programId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: keys.publicSessions(slug, programId ?? ""),
    queryFn: () =>
      publicApi.get<PublicSessionDto[]>(
        `/academies/${encodeURIComponent(slug)}/programs/${encodeURIComponent(programId ?? "")}/sessions`,
      ),
    enabled: enabled && Boolean(programId),
    staleTime: 0,
  });
}

/** The portal's Enroll page: tiers of the academies the person's students train at. */
export function usePortalEnroll() {
  const userId = usePortalAccount().data?.user.id ?? "";
  return useQuery({
    queryKey: keys.portal.enroll(userId),
    queryFn: () => portalApi.get<PortalEnrollAcademyDto[]>("/enroll"),
    enabled: Boolean(userId),
    staleTime: 0,
  });
}

/** One student's requests and renewal (the portal's Payments page). */
export function usePortalStudentEnrollments(clientId: string) {
  const userId = usePortalAccount().data?.user.id ?? "";
  return useQuery({
    queryKey: keys.portal.enrollments(userId, clientId),
    queryFn: () =>
      portalApi.get<PortalStudentEnrollmentsDto>(
        `/students/${encodeURIComponent(clientId)}/enrollments`,
      ),
    enabled: Boolean(userId && clientId),
    staleTime: 0,
  });
}

/** The staff inbox: requests in a status (or all), newest first, with counts. */
export function useEnrollments(status: EnrollmentStatus | "all") {
  const can = useCan();
  return useQuery({
    queryKey: keys.enrollments(status),
    queryFn: () => api.get<EnrollmentListDto>(`/enrollments?status=${status}`),
    enabled: can.enrollment,
    placeholderData: (prev) => prev,
  });
}

export function useEnrollment(id: string) {
  const can = useCan();
  return useQuery({
    queryKey: keys.enrollment(id),
    queryFn: () => api.get<EnrollmentDetailDto>(`/enrollments/${encodeURIComponent(id)}`),
    enabled: can.enrollment && Boolean(id),
  });
}

export function useRenewalsDue(enabled = true) {
  const can = useCan();
  return useQuery({
    queryKey: keys.renewalsDue,
    queryFn: () => api.get<RenewalsDueDto>("/enrollments/renewals"),
    enabled: can.enrollment && enabled,
  });
}
