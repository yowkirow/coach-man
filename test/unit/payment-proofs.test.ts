import { describe, expect, it } from "vitest";
import { PAYMENT_SUBMISSION_STATUSES } from "../../src/shared/domain";
import {
  accountNumberParts,
  canProofTransition,
  cashMethodOf,
  checkProofDetails,
  type DuplicateCandidate,
  type DuplicateTarget,
  findDuplicates,
  isCalendarDate,
  isCashMethod,
  isReviewableProof,
  nextProofStatus,
  normalizeReference,
  PROOF_STATUS_LABELS,
  PROOF_TRANSITIONS,
  REQUEST_PAY_LABELS,
  requestPayState,
} from "../../src/shared/payment-proofs";
import {
  paymentProofConfirmSchema,
  paymentProofListQuerySchema,
  paymentProofRejectSchema,
  paymentProofSubmitSchema,
} from "../../src/shared/schemas";
import type { paymentSubmission } from "../../src/worker/db/schema";
import { toPortalProof } from "../../src/worker/lib/portal-dto";
import { canReadPortalFile, isProofKey, type PortalScope } from "../../src/worker/lib/portal-scope";
import { hasImageSignature, sniffImageType } from "../../src/worker/lib/uploads";
import { paymentSummary } from "../../src/worker/services/enrollment-core";

const TODAY = "2026-11-05";
const METHODS = ["Cash", "Bank transfer", "Card", "GCash"];
const ID = "0196f3a2-7c41-7d2e-9a10-3b5c7d9e1f20";

describe("the payment proof state machine", () => {
  it("lets a pending proof be confirmed, not accepted, or withdrawn, and nothing else", () => {
    expect(PROOF_TRANSITIONS.pending).toEqual(["confirmed", "rejected", "withdrawn"]);
    expect(canProofTransition("pending", "confirmed")).toBe(true);
    expect(canProofTransition("pending", "voided")).toBe(false);
    // Not accepted and withdrawn are final.
    for (const done of ["rejected", "withdrawn"] as const) {
      for (const to of PAYMENT_SUBMISSION_STATUSES)
        expect(canProofTransition(done, to)).toBe(false);
    }
    // A confirmed proof only changes when its payment is voided; then staff review it again.
    expect(PROOF_TRANSITIONS.confirmed).toEqual(["voided"]);
    expect(PROOF_TRANSITIONS.voided).toEqual(["confirmed", "rejected"]);
    expect(isReviewableProof("pending")).toBe(true);
    expect(isReviewableProof("voided")).toBe(true);
    expect(isReviewableProof("confirmed")).toBe(false);
    expect(Object.keys(PROOF_STATUS_LABELS).sort()).toEqual(
      [...PAYMENT_SUBMISSION_STATUSES].sort(),
    );
    expect(PROOF_STATUS_LABELS.rejected).toBe("Not accepted");
    expect(PROOF_STATUS_LABELS.voided).toBe("Payment voided");
  });

  it("confirms once: confirming again is a replay, never a second payment", () => {
    expect(nextProofStatus("pending", "confirm", "staff")).toEqual({
      ok: true,
      status: "confirmed",
      replay: false,
    });
    expect(nextProofStatus("confirmed", "confirm", "staff")).toEqual({
      ok: true,
      status: "confirmed",
      replay: true,
    });
    // After the payment was voided, staff may confirm it again (a new payment).
    expect(nextProofStatus("voided", "confirm", "staff")).toEqual({
      ok: true,
      status: "confirmed",
      replay: false,
    });
  });

  it("refuses decisions that don't fit, with a reason", () => {
    const rejectConfirmed = nextProofStatus("confirmed", "reject", "staff");
    expect(rejectConfirmed).toMatchObject({ ok: false, code: "invalid_transition" });
    expect(rejectConfirmed.ok ? "" : rejectConfirmed.message).toMatch(/Void the payment first/);
    expect(nextProofStatus("rejected", "confirm", "staff")).toMatchObject({ ok: false });
    expect(nextProofStatus("withdrawn", "confirm", "staff")).toMatchObject({
      ok: false,
      message: "The family withdrew this proof.",
    });
    expect(nextProofStatus("rejected", "reject", "staff")).toMatchObject({
      ok: true,
      replay: true,
    });
    expect(nextProofStatus("voided", "reject", "staff")).toMatchObject({ ok: true, replay: false });
  });

  it("lets only the family withdraw, and only while it waits", () => {
    expect(nextProofStatus("pending", "withdraw", "family")).toEqual({
      ok: true,
      status: "withdrawn",
      replay: false,
    });
    expect(nextProofStatus("withdrawn", "withdraw", "family")).toMatchObject({ replay: true });
    for (const s of ["confirmed", "rejected", "voided"] as const) {
      expect(nextProofStatus(s, "withdraw", "family")).toMatchObject({
        ok: false,
        code: "invalid_transition",
      });
    }
    // Staff don't withdraw; families don't confirm or reject.
    expect(nextProofStatus("pending", "withdraw", "staff")).toMatchObject({ code: "forbidden" });
    expect(nextProofStatus("pending", "confirm", "family")).toMatchObject({ code: "forbidden" });
    expect(nextProofStatus("pending", "reject", "family")).toMatchObject({ code: "forbidden" });
  });

  it("voids only a confirmed proof", () => {
    expect(nextProofStatus("confirmed", "void", "staff")).toMatchObject({
      ok: true,
      status: "voided",
    });
    expect(nextProofStatus("pending", "void", "staff")).toMatchObject({ ok: false });
    expect(nextProofStatus("voided", "void", "staff")).toMatchObject({ replay: true });
  });
});

describe("what a family sends", () => {
  const ok = {
    amountMinor: 600000,
    method: "GCash",
    methods: METHODS,
    paidOn: TODAY,
    today: TODAY,
    reference: "1234 567 890123",
    hasImage: true,
  };

  it("takes an amount, one of the academy's methods, a sane date, and a screenshot", () => {
    expect(checkProofDetails(ok)).toEqual({ ok: true });
    expect(checkProofDetails({ ...ok, reference: null })).toEqual({ ok: true });
    // A day ahead is allowed (the family's phone may be in another time zone).
    expect(checkProofDetails({ ...ok, paidOn: "2026-11-06" })).toEqual({ ok: true });
    expect(checkProofDetails({ ...ok, paidOn: "2025-11-04" })).toEqual({ ok: true });
  });

  it("refuses a missing amount, another method, and impossible dates", () => {
    expect(checkProofDetails({ ...ok, amountMinor: 0 })).toMatchObject({
      ok: false,
      field: "amountMinor",
    });
    expect(checkProofDetails({ ...ok, amountMinor: -500 })).toMatchObject({ field: "amountMinor" });
    expect(checkProofDetails({ ...ok, amountMinor: 1.5 })).toMatchObject({ field: "amountMinor" });
    // The method must be one of the academy's own (the academy names them: "GCash").
    expect(checkProofDetails({ ...ok, method: "E-wallet" })).toMatchObject({
      ok: false,
      field: "method",
      code: "unknown_method",
    });
    expect(checkProofDetails({ ...ok, method: "gcash" })).toMatchObject({ field: "method" });
    expect(checkProofDetails({ ...ok, paidOn: "2026-11-07" })).toMatchObject({
      field: "paidOn",
      code: "future_date",
    });
    expect(checkProofDetails({ ...ok, paidOn: "2025-11-03" })).toMatchObject({
      field: "paidOn",
      code: "old_date",
    });
    expect(checkProofDetails({ ...ok, paidOn: "2026-02-30" })).toMatchObject({
      field: "paidOn",
      code: "bad_date",
    });
  });

  it("wants a reference of 3 to 64 characters when there is one", () => {
    expect(checkProofDetails({ ...ok, reference: "12" })).toMatchObject({ field: "reference" });
    expect(checkProofDetails({ ...ok, reference: "x".repeat(65) })).toMatchObject({
      field: "reference",
    });
    expect(checkProofDetails({ ...ok, reference: "  " })).toEqual({ ok: true });
  });

  it("needs a screenshot, except for cash at the court", () => {
    expect(checkProofDetails({ ...ok, hasImage: false })).toMatchObject({
      ok: false,
      field: "proof",
      code: "proof_required",
    });
    expect(checkProofDetails({ ...ok, method: "Cash", hasImage: false })).toEqual({ ok: true });
    expect(isCashMethod("Cash at the court")).toBe(true);
    expect(isCashMethod("Cashless transfer")).toBe(false);
    expect(cashMethodOf(METHODS)).toBe("Cash");
    expect(cashMethodOf(["GCash", "Bank transfer"])).toBeNull();
  });

  it("knows a real calendar date", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("05/11/2026")).toBe(false);
  });

  it("validates the request bodies", () => {
    const sent = paymentProofSubmitSchema.safeParse({
      id: ID,
      amountMinor: 600000,
      method: " GCash ",
      reference: " 1234 567 890123 ",
      paidOn: TODAY,
      note: "",
      enrollmentId: null,
    });
    expect(sent.success).toBe(true);
    expect(sent.data).toMatchObject({
      method: "GCash",
      reference: "1234 567 890123",
      note: null,
      enrollmentId: null,
    });
    expect(paymentProofSubmitSchema.safeParse({ ...sent.data, amountMinor: 0 }).success).toBe(
      false,
    );
    expect(paymentProofSubmitSchema.safeParse({ ...sent.data, reference: "ab" }).success).toBe(
      false,
    );
    expect(
      paymentProofSubmitSchema.safeParse({ ...sent.data, reference: "" }).data?.reference,
    ).toBe(null);
    expect(paymentProofSubmitSchema.safeParse({ ...sent.data, paidOn: "Nov 5" }).success).toBe(
      false,
    );
    expect(paymentProofSubmitSchema.safeParse({ ...sent.data, enrollmentId: "x" }).success).toBe(
      false,
    );
    expect(paymentProofConfirmSchema.safeParse({}).success).toBe(true);
    expect(paymentProofConfirmSchema.safeParse({ amountMinor: 0 }).success).toBe(false);
    expect(paymentProofRejectSchema.safeParse({ reason: " " }).success).toBe(false);
    expect(paymentProofRejectSchema.safeParse({ reason: "Wrong amount" }).success).toBe(true);
    expect(paymentProofListQuerySchema.safeParse({ status: "voided" }).success).toBe(true);
    expect(paymentProofListQuerySchema.safeParse({ status: "lost" }).success).toBe(false);
  });
});

describe("duplicate warnings", () => {
  const target: DuplicateTarget = {
    id: "p-new",
    clientId: "c1",
    amountMinor: 600000,
    paidOn: TODAY,
    reference: "1234 567 890123",
    paymentId: null,
    resubmitOf: null,
  };
  const proof = (over: Partial<DuplicateCandidate>): DuplicateCandidate => ({
    kind: "proof",
    id: "p-old",
    clientId: "c2",
    amountMinor: 150000,
    paidOn: "2026-10-01",
    reference: null,
    status: "confirmed",
    ...over,
  });
  const paid = (over: Partial<DuplicateCandidate>): DuplicateCandidate => ({
    kind: "payment",
    id: "pay-1",
    clientId: "c2",
    amountMinor: 150000,
    paidOn: "2026-10-01",
    reference: null,
    status: "recorded",
    ...over,
  });

  it("compares references without spaces, separators, or case", () => {
    expect(normalizeReference(" 1234-567.890 123 ")).toBe("1234567890123");
    expect(normalizeReference("ref#ab:12_3/4")).toBe("REFAB1234");
    expect(normalizeReference("  ")).toBeNull();
    expect(normalizeReference(null)).toBeNull();
    expect(findDuplicates(target, [proof({ reference: "1234567890123" })])).toEqual([
      { kind: "proof", id: "p-old", reason: "reference" },
    ]);
    // Another academy's student with the same reference still counts (the reference is the money).
    expect(findDuplicates(target, [paid({ reference: "1234-567-890123" })])).toEqual([
      { kind: "payment", id: "pay-1", reason: "reference" },
    ]);
  });

  it("flags the same student, amount, and date", () => {
    const same = { clientId: "c1", amountMinor: 600000, paidOn: TODAY };
    expect(findDuplicates(target, [paid(same)])).toEqual([
      { kind: "payment", id: "pay-1", reason: "same_details" },
    ]);
    expect(findDuplicates(target, [paid({ ...same, paidOn: "2026-11-04" })])).toEqual([]);
    expect(findDuplicates(target, [paid({ ...same, clientId: "c2" })])).toEqual([]);
    expect(findDuplicates(target, [paid({ ...same, amountMinor: 599900 })])).toEqual([]);
  });

  it("leaves out itself, its own payment, the proof it resends, withdrawn proofs, and voided payments", () => {
    const sameRef = { reference: "1234567890123" };
    const t = { ...target, paymentId: "pay-own", resubmitOf: "p-rejected" };
    expect(
      findDuplicates(t, [
        proof({ ...sameRef, id: "p-new" }),
        paid({ ...sameRef, id: "pay-own" }),
        proof({ ...sameRef, id: "p-rejected", status: "rejected" }),
        proof({ ...sameRef, id: "p-later", resubmitOf: "p-new" }),
        proof({ ...sameRef, id: "p-withdrawn", status: "withdrawn" }),
        paid({ ...sameRef, id: "pay-voided", status: "voided" }),
      ]),
    ).toEqual([]);
    // A proof that wasn't accepted, and isn't the one this resends, still warns.
    expect(findDuplicates(t, [proof({ ...sameRef, id: "p-other", status: "rejected" })])).toEqual([
      { kind: "proof", id: "p-other", reason: "reference" },
    ]);
  });

  it("warns once for a payment recorded from a proof that already warns", () => {
    const sameRef = { reference: "1234567890123" };
    expect(
      findDuplicates(target, [
        paid({ ...sameRef, id: "pay-1", fromProofId: "p-old" }),
        proof({ ...sameRef, id: "p-old" }),
        paid({ clientId: "c1", amountMinor: 600000, paidOn: TODAY, id: "pay-2" }),
      ]),
    ).toEqual([
      { kind: "proof", id: "p-old", reason: "reference" },
      { kind: "payment", id: "pay-2", reason: "same_details" },
    ]);
  });
});

describe("a request's payment state", () => {
  const charged = paymentSummary("ch1", 600000, 0);
  it("is unpaid, proof pending, partly paid, or paid", () => {
    expect(requestPayState(null, [])).toBeNull();
    expect(requestPayState(charged, [])).toBe("unpaid");
    expect(requestPayState(charged, [{ status: "pending" }])).toBe("proof_pending");
    expect(requestPayState(paymentSummary("ch1", 600000, 200000), [])).toBe("partial");
    expect(requestPayState(paymentSummary("ch1", 600000, 200000), [{ status: "pending" }])).toBe(
      "proof_pending",
    );
    expect(requestPayState(paymentSummary("ch1", 600000, 600000), [{ status: "pending" }])).toBe(
      "paid",
    );
    // A free tier is paid from the start.
    expect(requestPayState(paymentSummary(null, 0, 0), [])).toBe("paid");
    expect(REQUEST_PAY_LABELS.partial).toBe("Partly paid");
  });

  it("goes back to unpaid when a confirmed proof's payment is voided", () => {
    // Confirmed: the allocation covers the charge.
    expect(requestPayState(paymentSummary("ch1", 600000, 600000), [{ status: "confirmed" }])).toBe(
      "paid",
    );
    // Voided: the allocations are rebuilt without it, and the proof no longer counts.
    expect(requestPayState(paymentSummary("ch1", 600000, 0), [{ status: "voided" }])).toBe(
      "unpaid",
    );
    expect(
      requestPayState(paymentSummary("ch1", 600000, 0), [
        { status: "voided" },
        { status: "rejected" },
        { status: "withdrawn" },
      ]),
    ).toBe("unpaid");
  });
});

describe("who may read a proof", () => {
  const scope: PortalScope = {
    userId: "u1",
    links: [
      { accessId: "a1", clientId: "c1", workspaceId: "ws1", relation: "guardian" },
      { accessId: "a3", clientId: "c9", workspaceId: "ws2", relation: "self" },
    ],
  };
  const key = "ws/ws1/clients/c1/payments/0196f3a2.jpg";

  it("needs the proof the key belongs to, of one of the caller's students", () => {
    expect(isProofKey(key)).toBe(true);
    expect(isProofKey("ws/ws1/clients/c1/pickups/0196.jpg")).toBe(false);
    expect(isProofKey("ws/ws1/clients/c1/0196.jpg")).toBe(false);
    expect(canReadPortalFile(scope, key, { workspaceId: "ws1", clientId: "c1" })).toBe(true);
    // A guessed key (no proof has it): refused, even in the caller's own student's folder.
    expect(canReadPortalFile(scope, key, null)).toBe(false);
    expect(canReadPortalFile(scope, key)).toBe(false);
    // Another family's proof, or one claiming another academy.
    expect(canReadPortalFile(scope, key, { workspaceId: "ws1", clientId: "c2" })).toBe(false);
    expect(canReadPortalFile(scope, key, { workspaceId: "ws2", clientId: "c1" })).toBe(false);
    expect(
      canReadPortalFile(scope, "ws/ws2/clients/c1/payments/0196.jpg", {
        workspaceId: "ws2",
        clientId: "c1",
      }),
    ).toBe(false);
    // Someone linked to nobody.
    expect(
      canReadPortalFile({ userId: "u2", links: [] }, key, { workspaceId: "ws1", clientId: "c1" }),
    ).toBe(false);
  });

  it("never opens other folders or malformed keys through a proof", () => {
    const owner = { workspaceId: "ws1", clientId: "c1" };
    expect(canReadPortalFile(scope, "ws/ws1/clients/c1/pickups/0196.jpg", owner)).toBe(false);
    expect(canReadPortalFile(scope, "ws/ws1/clients/c1/payments/../c2/0196.jpg", owner)).toBe(
      false,
    );
    expect(canReadPortalFile(scope, "ws/ws1/clients/c1/payments//0196.jpg", owner)).toBe(false);
  });
});

describe("the family's view of a proof", () => {
  const row: typeof paymentSubmission.$inferSelect = {
    id: "p1",
    workspaceId: "ws1",
    clientId: "c1",
    submittedBy: "u-parent",
    enrollmentId: "r1",
    amountMinor: 600000,
    method: "GCash",
    reference: "1234567890123",
    paidOn: TODAY,
    proofKey: "ws/ws1/clients/c1/payments/0196.jpg",
    note: "Paid from my sister's account",
    status: "confirmed",
    reviewedBy: "staff-user-LEAK",
    reviewedAt: 1_700_000_000_000,
    rejectReason: "LEAK-old-reason",
    paymentId: "payment-LEAK",
    resubmitOf: null,
    createdAt: 1_699_000_000_000,
    updatedAt: 1_700_000_000_000,
  };

  it("carries no reviewer, staff ids, or the payment's internal note", () => {
    const dto = toPortalProof(row, {
      viewerUserId: "u-parent",
      sentByName: "Pat Santos",
      payment: { amountMinor: 550000, paidOn: TODAY, voidedAt: null },
      resubmitted: false,
    });
    expect(JSON.stringify(dto)).not.toContain("LEAK");
    expect(Object.keys(dto)).not.toContain("reviewedBy");
    expect(dto).toMatchObject({
      status: "confirmed",
      decidedAt: 1_700_000_000_000,
      rejectReason: null,
      recorded: { amountMinor: 550000, paidOn: TODAY },
      sentBy: { name: "Pat Santos", you: true },
      canWithdraw: false,
    });
  });

  it("shows the reason only when not accepted, and lets only the sender withdraw", () => {
    const rejected = toPortalProof(
      { ...row, status: "rejected", rejectReason: "The amount doesn't match.", paymentId: null },
      {
        viewerUserId: "u-other-parent",
        sentByName: "Pat Santos",
        payment: null,
        resubmitted: true,
      },
    );
    expect(rejected).toMatchObject({
      rejectReason: "The amount doesn't match.",
      recorded: null,
      sentBy: { you: false },
      resubmitted: true,
    });
    const pending = { ...row, status: "pending" as const, reviewedBy: null, reviewedAt: null };
    const ctx = { sentByName: "Pat Santos", payment: null, resubmitted: false };
    expect(toPortalProof(pending, { ...ctx, viewerUserId: "u-parent" }).canWithdraw).toBe(true);
    expect(toPortalProof(pending, { ...ctx, viewerUserId: "u-co-parent" }).canWithdraw).toBe(false);
    // Voided: nothing counts as recorded any more.
    const voided = toPortalProof(
      { ...row, status: "voided" },
      { ...ctx, viewerUserId: "u-parent", payment: { amountMinor: 1, paidOn: TODAY, voidedAt: 5 } },
    );
    expect(voided.recorded).toBeNull();
    expect(voided.rejectReason).toBeNull();
  });
});

describe("account numbers in payment instructions", () => {
  it("offers to copy account and mobile numbers", () => {
    expect(accountNumberParts("GCash 0917 555 0142 (Riverside)")).toEqual([
      { text: "GCash " },
      { text: "0917 555 0142", copy: "09175550142" },
      { text: " (Riverside)" },
    ]);
    expect(accountNumberParts("BPI 1234-5678-90, BDO 0012 3456 7890\nPay by the 5th")).toEqual([
      { text: "BPI " },
      { text: "1234-5678-90", copy: "1234567890" },
      { text: ", BDO " },
      { text: "0012 3456 7890", copy: "001234567890" },
      { text: "\nPay by the 5th" },
    ]);
    expect(accountNumberParts("Maya +63 917 555 0100")).toContainEqual({
      text: "+63 917 555 0100",
      copy: "+639175550100",
    });
  });

  it("leaves dates, short numbers, and anything unclear as plain text", () => {
    for (const text of [
      "Pay by 2026-11-30 at the front desk.",
      "Tue & Thu, 7-10pm, court 3",
      "Fees: 1,500 per session",
      "Call (0917) 555-0142",
    ]) {
      expect(accountNumberParts(text)).toEqual([{ text }]);
    }
  });
});

describe("screenshots by their bytes", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
  it("knows JPEG, PNG, and WebP, whatever the upload claims", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(webp)).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38))).toBeNull();
    expect(hasImageSignature(bytes(0xff, 0xd8, 0xff), "image/png")).toBe(false);
  });
});
