import type { EnrollmentPaymentDto } from "@shared/api-types";
import type { PaymentSubmissionStatus } from "@shared/domain";
import {
  PROOF_STATUS_LABELS,
  REQUEST_PAY_LABELS,
  type RequestPayState,
  requestPayState,
} from "@shared/payment-proofs";
import type { PillTone } from "../../components/ui/display";

/** A proof's status as a pill: waiting (sky), confirmed (mint), not accepted (coral), voided (amber). */
export function proofStatusPill(status: PaymentSubmissionStatus): {
  tone: PillTone;
  label: string;
} {
  const tone: Record<PaymentSubmissionStatus, PillTone> = {
    pending: "sky",
    confirmed: "mint",
    rejected: "coral",
    withdrawn: "outline",
    voided: "amber",
  };
  return { tone: tone[status], label: PROOF_STATUS_LABELS[status] };
}

const PAY_TONES: Record<RequestPayState, PillTone> = {
  unpaid: "coral",
  proof_pending: "sky",
  partial: "amber",
  paid: "mint",
};

/** An approved request's payment as a pill: Unpaid, Proof pending, Partly paid, Paid. */
export function requestPayPill(
  payment: EnrollmentPaymentDto,
  proofs: readonly { status: PaymentSubmissionStatus }[] = [],
): { tone: PillTone; label: string; state: RequestPayState } {
  const state = requestPayState(payment, proofs) ?? "unpaid";
  return { tone: PAY_TONES[state], label: REQUEST_PAY_LABELS[state], state };
}
