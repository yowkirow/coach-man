import type { PaymentSubmissionStatus } from "./domain";
import { addDays, compareDates, DATE_RE } from "./time";

// Payment proofs (WS4c): families pay outside CoachMan (GCash, a bank transfer, cash at the court)
// and send a screenshot with the amount and reference; owners and admins confirm it, which records
// a real payment, or don't accept it, with a reason the family reads. Everything here is pure so
// the Worker, the app, and the unit tests share one set of rules.

// --- Status ------------------------------------------------------------------------------------

/** The words families and staff both read. */
export const PROOF_STATUS_LABELS: Record<PaymentSubmissionStatus, string> = {
  pending: "Pending review",
  confirmed: "Confirmed",
  rejected: "Not accepted",
  withdrawn: "Withdrawn",
  voided: "Payment voided",
};

/**
 * Proofs staff can still act on: waiting for review, or confirmed once and then the payment it
 * recorded was voided (staff confirm it again with a new payment, or don't accept it).
 */
export const REVIEWABLE_PROOF_STATUSES = ["pending", "voided"] as const;

export const isReviewableProof = (status: PaymentSubmissionStatus) =>
  (REVIEWABLE_PROOF_STATUSES as readonly string[]).includes(status);

/** Where a proof may go from each status. Not accepted and withdrawn are final. */
export const PROOF_TRANSITIONS: Record<
  PaymentSubmissionStatus,
  readonly PaymentSubmissionStatus[]
> = {
  pending: ["confirmed", "rejected", "withdrawn"],
  confirmed: ["voided"],
  rejected: [],
  withdrawn: [],
  voided: ["confirmed", "rejected"],
};

export function canProofTransition(
  from: PaymentSubmissionStatus,
  to: PaymentSubmissionStatus,
): boolean {
  return PROOF_TRANSITIONS[from].includes(to);
}

/**
 * `confirm` and `reject` are staff decisions, `withdraw` is the family's, and `void` follows staff
 * voiding the payment a confirmation recorded.
 */
export type ProofAction = "confirm" | "reject" | "withdraw" | "void";

const ACTION_TARGET: Record<ProofAction, PaymentSubmissionStatus> = {
  confirm: "confirmed",
  reject: "rejected",
  withdraw: "withdrawn",
  void: "voided",
};

const ACTION_ACTOR: Record<ProofAction, "staff" | "family"> = {
  confirm: "staff",
  reject: "staff",
  withdraw: "family",
  void: "staff",
};

export type ProofTransition =
  | { ok: true; status: PaymentSubmissionStatus; replay: boolean }
  | { ok: false; code: "invalid_transition" | "forbidden"; message: string };

function refusal(current: PaymentSubmissionStatus, action: ProofAction): string {
  if (current === "withdrawn") return "The family withdrew this proof.";
  if (action === "withdraw") {
    if (current === "confirmed") return "The academy already confirmed this payment.";
    if (current === "rejected") {
      return "The academy didn't accept this proof. Send a new one instead.";
    }
    return "The academy is reviewing this payment again.";
  }
  if (action === "confirm") {
    return "This proof wasn't accepted. Ask the family to send it again, or record the payment yourself.";
  }
  if (action === "reject") {
    return "This proof was confirmed and its payment recorded. Void the payment first.";
  }
  return "Only a confirmed proof's payment can be voided.";
}

/**
 * What an action does to a proof in `current`: the new status, or why it can't happen. Doing an
 * action again (confirming a confirmed proof) is a replay, not an error: the caller answers with
 * what happened the first time and changes nothing, so confirming twice never records twice.
 */
export function nextProofStatus(
  current: PaymentSubmissionStatus,
  action: ProofAction,
  actor: "staff" | "family",
): ProofTransition {
  if (ACTION_ACTOR[action] !== actor) {
    return {
      ok: false,
      code: "forbidden",
      message:
        actor === "family"
          ? "Only the academy can confirm a payment."
          : "Only the family can withdraw their proof.",
    };
  }
  const target = ACTION_TARGET[action];
  if (current === target) return { ok: true, status: target, replay: true };
  if (canProofTransition(current, target)) return { ok: true, status: target, replay: false };
  return { ok: false, code: "invalid_transition", message: refusal(current, action) };
}

// --- What a proof says -------------------------------------------------------------------------

/** A reference number is 3 to 64 characters (GCash shows 13 digits; banks vary). */
export const REFERENCE_MIN = 3;
export const REFERENCE_MAX = 64;

/** A payment date at most this many days back (and at most a day ahead, for time zones). */
export const PROOF_MAX_DAYS_BACK = 366;

/** Proofs one student may have waiting at once (enough for a family, few enough to stop spam). */
export const MAX_PENDING_PROOFS = 10;

/** Separators that don't change a reference: "1234 567-890" and "1234567890" are the same. */
const REFERENCE_NOISE = /[ \t\r\n\-./#:_]/g;

/**
 * A reference as compared for duplicates: upper case, without spaces and separators. The Worker
 * runs the same normalization in SQL (`referenceKeySql`), so keep the two in step.
 */
export function normalizeReference(reference: string | null | undefined): string | null {
  if (!reference) return null;
  const key = reference.replace(/[a-z]/g, (ch) => ch.toUpperCase()).replace(REFERENCE_NOISE, "");
  return key || null;
}

/** "Cash", "Cash at the court", "Cash (front desk)": a method where the money is handed over. */
export function isCashMethod(method: string): boolean {
  return /\bcash\b/i.test(method);
}

/** The academy's cash method, if it takes cash (the name is the academy's own). */
export function cashMethodOf(methods: readonly string[]): string | null {
  return methods.find(isCashMethod) ?? null;
}

/** A real calendar date (2026-02-31 is not). */
export function isCalendarDate(ymd: string): boolean {
  if (!DATE_RE.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

export type ProofField = "amountMinor" | "method" | "paidOn" | "reference" | "proof";

export type ProofCheck =
  | { ok: true }
  | { ok: false; field: ProofField; code: string; message: string };

/**
 * The server's checks of what a family sends (the app checks the same before sending): an amount,
 * one of the academy's own payment methods, a sane date (not ahead of the academy's today by more
 * than a day, not more than a year back), a reference of 3 to 64 characters when given, and a
 * screenshot unless the money is cash handed over at the court.
 */
export function checkProofDetails(input: {
  amountMinor: number;
  method: string;
  methods: readonly string[];
  paidOn: string;
  today: string;
  reference: string | null | undefined;
  hasImage: boolean;
}): ProofCheck {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    return {
      ok: false,
      field: "amountMinor",
      code: "bad_amount",
      message: "Enter the amount you paid.",
    };
  }
  if (input.amountMinor > 1_000_000_000) {
    return {
      ok: false,
      field: "amountMinor",
      code: "bad_amount",
      message: "That amount is too large.",
    };
  }
  if (!input.methods.includes(input.method)) {
    return {
      ok: false,
      field: "method",
      code: "unknown_method",
      message: "Pick one of the ways the academy takes payments.",
    };
  }
  if (!isCalendarDate(input.paidOn)) {
    return { ok: false, field: "paidOn", code: "bad_date", message: "Enter the date you paid." };
  }
  if (compareDates(input.paidOn, addDays(input.today, 1)) > 0) {
    return {
      ok: false,
      field: "paidOn",
      code: "future_date",
      message: "The payment date can't be in the future.",
    };
  }
  if (compareDates(input.paidOn, addDays(input.today, -PROOF_MAX_DAYS_BACK)) < 0) {
    return {
      ok: false,
      field: "paidOn",
      code: "old_date",
      message: "That date is more than a year ago. Ask the academy about older payments.",
    };
  }
  const reference = input.reference?.trim() ?? "";
  if (reference && (reference.length < REFERENCE_MIN || reference.length > REFERENCE_MAX)) {
    return {
      ok: false,
      field: "reference",
      code: "bad_reference",
      message: `A reference number has ${REFERENCE_MIN} to ${REFERENCE_MAX} characters.`,
    };
  }
  if (!input.hasImage && !isCashMethod(input.method)) {
    return {
      ok: false,
      field: "proof",
      code: "proof_required",
      message: "Add a screenshot of the payment, or choose cash at the court.",
    };
  }
  return { ok: true };
}

// --- Duplicates ----------------------------------------------------------------------------------

/** The proof being reviewed. */
export interface DuplicateTarget {
  id: string;
  clientId: string;
  amountMinor: number;
  paidOn: string;
  reference: string | null;
  /** The payment its confirmation recorded (never a duplicate of itself). */
  paymentId: string | null;
  /** The proof it resends (the family sending the same payment again after a refusal). */
  resubmitOf: string | null;
}

/** Another proof or a payment of the same academy that might be the same money. */
export interface DuplicateCandidate {
  kind: "proof" | "payment";
  id: string;
  clientId: string;
  amountMinor: number;
  paidOn: string;
  reference: string | null;
  /** Proofs: their status. Payments: whether they're voided. */
  status: PaymentSubmissionStatus | "recorded" | "voided";
  /** Proofs: the proof they resend. */
  resubmitOf?: string | null;
  /** Payments: the proof whose confirmation recorded them. */
  fromProofId?: string | null;
}

export interface DuplicateMatch {
  kind: "proof" | "payment";
  id: string;
  /** The same reference number, or the same student, amount, and date. */
  reason: "reference" | "same_details";
}

/**
 * Proofs and payments that look like the same money as `target`: the same reference number
 * (compared without spaces and separators), or the same student, amount, and date. Left out: the
 * proof itself and the payment its confirmation recorded, the proof it resends (or that resends
 * it), withdrawn proofs, voided payments, and a payment recorded from a proof that's already
 * listed (one payment, one warning).
 */
export function findDuplicates(
  target: DuplicateTarget,
  candidates: readonly DuplicateCandidate[],
): DuplicateMatch[] {
  const ref = normalizeReference(target.reference);
  const matches: DuplicateMatch[] = [];
  for (const c of candidates) {
    if (c.kind === "proof") {
      if (c.id === target.id || c.id === target.resubmitOf || c.resubmitOf === target.id) continue;
      if (c.status === "withdrawn") continue;
    } else {
      if (c.id === target.paymentId || c.status === "voided") continue;
    }
    const sameRef = ref !== null && normalizeReference(c.reference) === ref;
    const sameDetails =
      c.clientId === target.clientId &&
      c.amountMinor === target.amountMinor &&
      c.paidOn === target.paidOn;
    if (sameRef || sameDetails) {
      matches.push({ kind: c.kind, id: c.id, reason: sameRef ? "reference" : "same_details" });
    }
  }
  const proofIds = new Set(matches.filter((m) => m.kind === "proof").map((m) => m.id));
  return matches
    .filter((m) => {
      if (m.kind !== "payment") return true;
      const from = candidates.find((c) => c.kind === "payment" && c.id === m.id)?.fromProofId;
      return !(from && proofIds.has(from));
    })
    .sort(
      (a, b) =>
        Number(a.reason !== "reference") - Number(b.reason !== "reference") ||
        Number(a.kind !== "proof") - Number(b.kind !== "proof"),
    );
}

// --- A request's payment -----------------------------------------------------------------------

/** What an approved request's payment card says. */
export type RequestPayState = "unpaid" | "proof_pending" | "partial" | "paid";

export const REQUEST_PAY_LABELS: Record<RequestPayState, string> = {
  unpaid: "Unpaid",
  proof_pending: "Proof pending",
  partial: "Partly paid",
  paid: "Paid",
};

/**
 * An approved request's payment state from its charge (what payments cover, allocated oldest
 * first) and the proofs sent for it: paid once nothing is due; "proof pending" while a proof for
 * it waits for review; partly paid; else unpaid. A proof whose payment was voided counts for
 * nothing (the charge is owed again). Null when there's nothing to pay yet (not approved).
 */
export function requestPayState(
  payment: { amountMinor: number; paidMinor: number; dueMinor: number } | null,
  proofs: readonly { status: PaymentSubmissionStatus }[],
): RequestPayState | null {
  if (!payment) return null;
  if (payment.dueMinor <= 0) return "paid";
  if (proofs.some((p) => p.status === "pending")) return "proof_pending";
  if (payment.paidMinor > 0) return "partial";
  return "unpaid";
}

// --- Payment instructions -------------------------------------------------------------------------

export interface InstructionPart {
  text: string;
  /** An account or mobile number to offer a copy button for (digits, and a leading +). */
  copy?: string;
}

const NUMBER_RUN = /\+?\d[\d -]*\d/g;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Splits an academy's payment instructions into plain text and the account numbers in it, so each
 * number can get a copy button: runs of 8 to 24 digits, with single spaces or dashes between
 * groups ("GCash 0917 555 0142", "BPI 1234-5678-90"). Dates and short numbers stay plain text;
 * anything harder to read stays as written.
 */
export function accountNumberParts(text: string): InstructionPart[] {
  const parts: InstructionPart[] = [];
  let last = 0;
  for (const match of text.matchAll(NUMBER_RUN)) {
    const raw = match[0].replace(/[ -]+$/, "");
    const at = match.index ?? 0;
    const digits = raw.replace(/\D/g, "");
    const tidy = !/[ -]{2,}/.test(raw);
    if (digits.length < 8 || digits.length > 24 || !tidy || DATE_LIKE.test(raw)) continue;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: raw, copy: `${raw.startsWith("+") ? "+" : ""}${digits}` });
    last = at + raw.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length ? parts : [{ text }];
}

/** Reasons staff pick from (or edit) when a proof isn't accepted; the family reads them. */
export const PROOF_REJECT_REASONS = [
  "The amount doesn't match what's due.",
  "We can't find this payment in our account yet.",
  "The screenshot isn't clear. Please send a clearer one.",
  "This payment was already counted.",
] as const;
