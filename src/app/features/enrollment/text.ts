import type { EnrollmentPaymentDto } from "@shared/api-types";
import type { EnrollmentStatus } from "@shared/domain";
import { ENROLLMENT_STATUS_LABELS, type EnrollmentMode } from "@shared/enrollment";
import type { PillTone } from "../../components/ui/display";
import type { Format } from "../../lib/format";

/** A request's status as a pill: waiting (sky), waitlisted (amber), approved (mint), declined (coral). */
export function enrollmentStatusPill(status: EnrollmentStatus): { tone: PillTone; label: string } {
  const tone: Record<EnrollmentStatus, PillTone> = {
    requested: "sky",
    waitlisted: "amber",
    approved: "mint",
    declined: "coral",
    cancelled: "outline",
  };
  return { tone: tone[status], label: ENROLLMENT_STATUS_LABELS[status] };
}

/** What's owed for an approved request, as a pill. */
export function paymentPill(p: EnrollmentPaymentDto): { tone: PillTone; label: string } {
  if (p.status === "paid") return { tone: "mint", label: "Paid" };
  if (p.status === "partial") return { tone: "amber", label: "Part paid" };
  return { tone: "coral", label: "Unpaid" };
}

/** The period a request is for: "December 2026", "Tue 10 Nov · 7:00 PM", "From Thu 12 Nov". */
export function periodText(
  r: {
    mode: EnrollmentMode;
    startMonth: string | null;
    startDate: string | null;
    sessionStartsAt?: number | null;
  },
  fmt: Format,
): string {
  if (r.mode === "month" && r.startMonth) return fmt.month(r.startMonth);
  if (r.mode === "session" && r.sessionStartsAt) {
    return `${fmt.day(fmt.dayOf(r.sessionStartsAt))} · ${fmt.time(r.sessionStartsAt)}`;
  }
  if (r.startDate) return `From ${fmt.day(r.startDate)}`;
  return r.mode === "session" ? "Trial session" : "Start date to agree";
}

/** What families pick in the "When" step, by mode. */
export const MODE_QUESTION: Record<EnrollmentMode, string> = {
  month: "Which month?",
  session: "Which session?",
  date: "When do you want to start?",
};
