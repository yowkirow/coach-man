import type {
  PaymentProofDto,
  PaymentProofListDto,
  PortalPaymentProofsDto,
} from "@shared/api-types";
import type { PaymentSubmissionStatus } from "@shared/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, portalApi } from "../../lib/api";
import { useCan } from "../../lib/hooks";
import { keys } from "../../lib/query";
import { usePortalAccount } from "../portal/queries";

// Reads for payment proofs: the staff queue (Money), a student's proofs (their Money tab), and the
// family's own (the portal's Payments and Pay pages).

export type ProofFilter = PaymentSubmissionStatus | "all";

/** Proofs in a status (pending by default: the queue, oldest first), with counts. */
export function usePaymentProofs(status: ProofFilter) {
  const can = useCan();
  return useQuery({
    queryKey: keys.paymentProofs(status),
    queryFn: () => api.get<PaymentProofListDto>(`/payment-proofs?status=${status}`),
    enabled: can.enrollment,
    placeholderData: (prev) => prev,
  });
}

/** One student's proofs, newest first. */
export function useClientProofs(clientId: string) {
  const can = useCan();
  return useQuery({
    queryKey: keys.clientProofs(clientId),
    queryFn: () =>
      api.get<PaymentProofDto[]>(`/clients/${encodeURIComponent(clientId)}/payment-proofs`),
    enabled: can.enrollment && Boolean(clientId),
  });
}

/** After a decision: every list and badge that shows proofs (money is refreshed separately). */
export function useInvalidateProofs() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["payment-proofs"] });
    void qc.invalidateQueries({ queryKey: keys.proofCount });
    void qc.invalidateQueries({ queryKey: ["client-proofs"] });
    void qc.invalidateQueries({ queryKey: ["enrollment"] });
    void qc.invalidateQueries({ queryKey: ["enrollments"] });
  };
}

/** The family's proofs for one student (the portal). */
export function usePortalProofs(clientId: string) {
  const userId = usePortalAccount().data?.user.id ?? "";
  return useQuery({
    queryKey: keys.portal.proofs(userId, clientId),
    queryFn: () =>
      portalApi.get<PortalPaymentProofsDto>(
        `/students/${encodeURIComponent(clientId)}/payment-proofs`,
      ),
    enabled: Boolean(userId && clientId),
    staleTime: 0,
  });
}

/** After sending or withdrawing a proof: the family's pages that show what's owed. */
export function useRefreshPortalPayments() {
  const qc = useQueryClient();
  const userId = usePortalAccount().data?.user.id ?? "";
  return () => {
    for (const part of ["home", "proofs", "enrollments", "money"]) {
      void qc.invalidateQueries({
        queryKey: part === "home" ? keys.portal.home(userId) : ["portal", userId, part],
      });
    }
  };
}
