import type {
  EnrollmentDetailDto,
  PaymentProofCountDto,
  PaymentProofDto,
  PaymentProofListDto,
  PortalPaymentProofsDto,
  PortalStudentEnrollmentsDto,
  StatementDto,
} from "../src/shared/api-types";
import {
  approvedEnrollment,
  noisePng,
  proofOf,
  screenshot,
  sendProof,
  sendProofOk,
} from "./proof-support";
import {
  auditLog,
  expect,
  linkFamily,
  portalGet,
  submitSheet,
  test,
  testEmail,
  toggle,
  visit,
  watchErrors,
} from "./support";

// Payment proofs (WS4c): families pay outside CoachMan and send a screenshot (or say they'll pay
// cash at the court) from the portal; owners and admins confirm it, which records the payment, or
// don't accept it, with a reason the family reads.

test.use({ serviceWorkers: "block" });

/** An image element has loaded real pixels. */
async function loaded(img: import("@playwright/test").Locator) {
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
}

test.describe("paying with a screenshot", () => {
  test("a parent pays an approved enrollment, and the owner confirms another amount", async ({
    page,
    seeded,
    personas,
  }, info) => {
    test.setTimeout(240_000);
    const { api } = seeded;
    const { parent, requestId, clientId, dueMinor, today } = await approvedEnrollment(
      seeded,
      personas,
      info,
    );
    expect(dueMinor).toBe(600000);
    const w = parent.page;
    await parent.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const familyErrors = watchErrors(w);

    // The family sees what's due on the approved request and taps Pay.
    await visit(w, "/my");
    const card = w.getByRole("article", { name: /^Monthly/ }).first();
    await expect(card).toContainText("Unpaid");
    await expect(card).toContainText(/6,000\.00\s*due/);
    await card.getByRole("link", { name: "Pay ₱6,000" }).click();
    await expect(w).toHaveURL(
      (u) => u.pathname === `/my/${clientId}/pay` && u.searchParams.get("request") === requestId,
    );
    await expect(w.getByRole("heading", { name: "Pay", level: 1 })).toBeVisible();
    const due = w.getByRole("region", { name: "Monthly" });
    await expect(due).toContainText("₱6,000.00");

    // How to pay: the academy's words, its numbers to copy, and its own method names.
    const how = w.getByRole("region", { name: "How to pay" });
    await expect(how).toContainText("GCash 0917 555 0142 (Riverside)");
    await expect(how).toContainText("GCash");
    await how.getByRole("button", { name: "Copy 0917 555 0142" }).click();
    await expect(w.getByText("Number copied")).toBeVisible();
    expect(await w.evaluate(() => navigator.clipboard.readText())).toBe("09175550142");
    await expect(how.getByRole("button", { name: "Copy 1234-5678-90" })).toBeVisible();

    // The screenshot is a big photo (over 1.5 MB): the phone makes it smaller before sending.
    const big = noisePng(1100, 800);
    expect(big.length).toBeGreaterThan(1_500_000);
    await w.getByRole("button", { name: "Send proof" }).click();
    await expect(
      w.getByText("Add a screenshot of the payment, or choose cash at the court."),
    ).toBeVisible();
    await w.getByLabel("Screenshot of the payment").setInputFiles({
      name: "gcash-receipt.png",
      mimeType: "image/png",
      buffer: big,
    });
    await expect(w.getByText(/Made smaller to send/)).toBeVisible({ timeout: 20_000 });
    await expect(w.getByLabel("Amount paid")).toHaveValue("6000.00");
    // The academy's first online method is picked; GCash is its own name for it.
    await w.getByRole("button", { name: /Paid with/ }).click();
    await w.getByRole("option", { name: "GCash", exact: true }).click();
    await w.getByLabel("Reference number").fill("1234 567 890123");
    await expect(w.getByLabel("Date paid")).toHaveValue(today);
    await w.getByLabel("Note (optional)").fill("Paid from my sister's account");
    await w.getByRole("button", { name: "Send proof" }).click();
    await expect(w).toHaveURL((u) => u.pathname === `/my/${clientId}/payments`);
    const proofs = w.getByRole("region", { name: "Payment proofs" });
    await expect(proofs).toContainText("Pending review");
    await expect(proofs).toContainText("Ref 1234 567 890123");
    await loaded(
      proofs.getByRole("button", { name: /^View Payment screenshot sent/ }).locator("img"),
    );
    // The request now says a proof is waiting.
    await expect(w.getByRole("region", { name: "To pay", exact: true })).toContainText(
      "Proof pending",
    );

    // What was stored: a JPEG the app made smaller, under the student's payments folder.
    const sent = await portalGet<PortalPaymentProofsDto>(
      parent.context.request,
      `/students/${clientId}/payment-proofs`,
    );
    expect(sent.proofs).toHaveLength(1);
    const proof = sent.proofs[0];
    expect(proof).toMatchObject({
      enrollmentId: requestId,
      amountMinor: 600000,
      method: "GCash",
      reference: "1234 567 890123",
      paidOn: today,
      status: "pending",
      canWithdraw: true,
      sentBy: { name: "Pat Santos", you: true },
    });
    expect(proof?.proofKey).toMatch(
      new RegExp(`^ws/[^/]+/clients/${clientId}/payments/[\\w-]+\\.jpg$`),
    );
    const file = await seeded.request.get(`/api/v1/files/${proof?.proofKey}`);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toBe("image/jpeg");
    expect((await file.body()).length).toBeLessThanOrEqual(1_500_000);

    // The owner sees a badge on Money, and the proof in "Payments to review".
    await visit(page, "/");
    await expect(
      info.project.name === "mobile"
        ? page.getByRole("link", { name: /^Money.*1 payment proof to review/ })
        : page.getByRole("link", { name: "Money, 1 to review" }),
    ).toBeVisible();
    expect((await api.get<PaymentProofCountDto>("/payment-proofs/count")).pending).toBe(1);
    await visit(page, "/money");
    const queue = page.getByRole("region", { name: "Payments to review" });
    const item = queue.getByRole("article", { name: /Mia Santos/ });
    await expect(item).toContainText("₱6,000.00");
    await expect(item).toContainText("Pending review");
    await expect(item).toContainText("GCash · Ref 1234 567 890123");
    await expect(item).toContainText("Pat Santos, parent or guardian");
    await expect(item).toContainText("Paid from my sister's account");
    await expect(item).toContainText("For Monthly");
    await expect(item).toContainText("Mia now owes ₱6,000.00.");
    // The screenshot opens large, and at actual size.
    const thumb = item.getByRole("button", { name: "View Mia Santos's payment screenshot" });
    await loaded(thumb.locator("img"));
    await thumb.click();
    const viewer = page.getByRole("dialog", { name: "Mia Santos's payment screenshot" });
    await loaded(viewer.getByRole("img", { name: "Mia Santos's payment screenshot" }));
    await viewer.getByRole("button", { name: "Actual size" }).click();
    await expect(viewer.getByRole("button", { name: "Fit to screen" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();

    // Confirm, with the amount the screenshot really shows.
    await item.getByRole("button", { name: "Confirm" }).click();
    const sheet = page.getByRole("dialog", { name: "Confirm Mia's payment" });
    await expect(sheet.getByLabel("Amount received")).toHaveValue("6000.00");
    await sheet.getByLabel("Amount received").fill("5500");
    await expect(sheet).toContainText("Different from the ₱6,000.00 the family sent.");
    await submitSheet(sheet, sheet.getByRole("button", { name: "Record ₱5,500.00" }));
    await expect(page.getByText("₱5,500.00 recorded")).toBeVisible();
    await expect(queue).toContainText("Nothing to review.");

    // The payment is real: recorded with the reference, settling the charge, balance ₱500.
    const statement = await api.get<StatementDto>(`/clients/${clientId}/statement`);
    expect(statement.balanceMinor).toBe(50000);
    expect(statement.payments).toHaveLength(1);
    expect(statement.payments[0]).toMatchObject({
      amountMinor: 550000,
      method: "GCash",
      reference: "1234 567 890123",
      paidOn: today,
      voidedAt: null,
    });
    expect(statement.payments[0]?.note).toMatch(/^From the payment proof Pat Santos sent on /);
    const confirmed = await proofOf(seeded, proof?.id ?? "");
    expect(confirmed).toMatchObject({
      status: "confirmed",
      payment: { id: statement.payments[0]?.id, amountMinor: 550000 },
    });
    expect(confirmed.reviewedBy?.name).toBe("Robin Coach");
    const request = await api.get<EnrollmentDetailDto>(`/enrollments/${requestId}`);
    expect(request.payment).toMatchObject({
      paidMinor: 550000,
      dueMinor: 50000,
      status: "partial",
    });
    const audit = await auditLog(seeded.request);
    expect(audit.filter((e) => e.entity === "payment_submission").map((e) => e.action)).toEqual([
      "confirm",
      "submit",
    ]);
    expect(audit.filter((e) => e.entity === "payment" && e.action === "create")).toHaveLength(1);
    expect((await api.get<PaymentProofCountDto>("/payment-proofs/count")).pending).toBe(0);

    // The family sees it confirmed, what was recorded, and the new balance.
    await visit(w, `/my/${clientId}/payments`);
    const row = w.getByRole("article", { name: "₱6,000.00 · GCash" });
    await expect(row).toContainText("Confirmed");
    await expect(row).toContainText("Riverside Pickleball Academy recorded ₱5,500.00.");
    await expect(w.getByRole("region", { name: "Balance" })).toContainText("₱500.00");
    await visit(w, "/my");
    const after = w.getByRole("article", { name: /^Monthly/ }).first();
    await expect(after).toContainText("Partly paid");
    await expect(after).toContainText(/500\.00\s*due/);
    expect(familyErrors).toEqual([]);
  });

  test("a proof that isn't accepted tells the family why, and they send it again", async ({
    page,
    seeded,
    personas,
  }, info) => {
    test.setTimeout(180_000);
    const { parent, requestId, clientId, today } = await approvedEnrollment(seeded, personas, info);
    const first = await sendProofOk(parent.context.request, clientId, {
      amountMinor: 500000,
      method: "GCash",
      reference: "GC-1001",
      paidOn: today,
      enrollmentId: requestId,
    });

    // The owner doesn't accept it, with one of the common reasons.
    await visit(page, "/money");
    const item = page
      .getByRole("region", { name: "Payments to review" })
      .getByRole("article", { name: /Mia Santos/ });
    await item.getByRole("button", { name: "Not accepted" }).click();
    const sheet = page.getByRole("dialog", { name: "Not accepted" });
    await sheet.getByRole("button", { name: "The amount doesn't match what's due." }).click();
    await expect(sheet.getByLabel("Reason the family sees")).toHaveValue(
      "The amount doesn't match what's due.",
    );
    await submitSheet(sheet, sheet.getByRole("button", { name: "Mark not accepted" }));
    expect(await proofOf(seeded, first.id)).toMatchObject({
      status: "rejected",
      rejectReason: "The amount doesn't match what's due.",
    });
    // Not accepting twice is a replay; confirming it now is refused.
    const again = await seeded.api.raw("POST", `/payment-proofs/${first.id}/reject`, {
      reason: "Another reason",
    });
    expect(again.status).toBe(200);
    expect((again.json as PaymentProofDto).rejectReason).toBe(
      "The amount doesn't match what's due.",
    );
    const late = await seeded.api.raw("POST", `/payment-proofs/${first.id}/confirm`, {});
    expect(late.status).toBe(409);

    // The family reads the reason on the request and sends a new proof from there.
    const w = parent.page;
    await visit(w, "/my");
    const card = w.getByRole("article", { name: /^Monthly/ }).first();
    await expect(card).toContainText(
      "Your proof wasn't accepted: The amount doesn't match what's due.",
    );
    await card.getByRole("link", { name: "Send a new proof" }).click();
    await expect(w).toHaveURL(
      (u) => u.pathname === `/my/${clientId}/pay` && u.searchParams.get("resubmit") === first.id,
    );
    await expect(w.getByRole("region", { name: "Send a new proof" })).toContainText(
      "The amount doesn't match what's due.",
    );
    await expect(w.getByLabel("Reference number")).toHaveValue("GC-1001");
    await w.getByLabel("Amount paid").fill("6000");
    await w.getByLabel("Screenshot of the payment").setInputFiles({
      name: "gcash.png",
      mimeType: "image/png",
      buffer: screenshot([10, 140, 90]),
    });
    await expect(w.getByText("Ready to send")).toBeVisible();
    await w.getByRole("button", { name: "Send proof" }).click();
    await expect(w).toHaveURL((u) => u.pathname === `/my/${clientId}/payments`);
    const list = w.getByRole("region", { name: "Payment proofs" });
    await expect(list.getByRole("article", { name: "₱6,000.00 · GCash" })).toContainText(
      "Pending review",
    );
    await expect(list.getByRole("article", { name: "₱5,000.00 · GCash" })).toContainText(
      "You sent a new proof for it.",
    );

    // Linked for context, no duplicate warning against the proof it resends; confirmed: paid.
    const pending = await seeded.api.get<PaymentProofListDto>("/payment-proofs");
    expect(pending.items).toHaveLength(1);
    const second = pending.items[0];
    expect(second).toMatchObject({
      amountMinor: 600000,
      enrollment: { id: requestId },
      resubmitOf: { id: first.id, rejectReason: "The amount doesn't match what's due." },
      duplicates: [],
    });
    expect((await proofOf(seeded, first.id)).resubmittedBy).toBe(second?.id);
    await seeded.api.post(`/payment-proofs/${second?.id}/confirm`, {});
    await visit(w, "/my");
    await expect(w.getByRole("article", { name: /^Monthly/ }).first()).toContainText(
      "Approved and paid",
    );
  });

  test("the sender withdraws a proof while it waits; a co-parent sees it but can't", async ({
    seeded,
    personas,
  }, info) => {
    const { parent, clientId, today } = await approvedEnrollment(seeded, personas, info);
    const coParentEmail = testEmail("proof-coparent", info);
    const linked = await linkFamily(seeded.request, {
      clientId,
      email: coParentEmail,
      name: "Sam Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    const sent = await sendProofOk(parent.context.request, clientId, {
      amountMinor: 600000,
      method: "Bank transfer",
      reference: "BPI-555",
      paidOn: today,
    });
    expect((await seeded.api.get<PaymentProofCountDto>("/payment-proofs/count")).pending).toBe(1);

    // The other parent sees it (same student), without a Withdraw.
    const coParent = await personas.open({
      email: coParentEmail,
      name: "Sam Santos",
      persona: "none",
    });
    const seen = await portalGet<PortalPaymentProofsDto>(
      coParent.context.request,
      `/students/${clientId}/payment-proofs`,
    );
    expect(seen.proofs.map((p) => [p.id, p.canWithdraw, p.sentBy.you])).toEqual([
      [sent.id, false, false],
    ]);
    const refused = await coParent.context.request.post(
      `/api/portal/students/${clientId}/payment-proofs/${sent.id}/withdraw`,
    );
    expect(refused.status()).toBe(403);
    await visit(coParent.page, `/my/${clientId}/payments`);
    const theirs = coParent.page.getByRole("article", { name: "₱6,000.00 · Bank transfer" });
    await expect(theirs).toContainText("sent by Pat Santos");
    await expect(theirs.getByRole("button", { name: "Withdraw" })).toHaveCount(0);

    // The sender withdraws it from Payments.
    const w = parent.page;
    await visit(w, `/my/${clientId}/payments`);
    const row = w.getByRole("article", { name: "₱6,000.00 · Bank transfer" });
    await row.getByRole("button", { name: "Withdraw" }).click();
    const confirm = w.getByRole("dialog", { name: "Withdraw this proof?" });
    await submitSheet(confirm, confirm.getByRole("button", { name: "Withdraw" }));
    await expect(row).toContainText("Withdrawn by you.");
    // Gone from the queue; confirming it is refused; withdrawing again is a replay.
    expect((await seeded.api.get<PaymentProofCountDto>("/payment-proofs/count")).pending).toBe(0);
    expect((await proofOf(seeded, sent.id)).status).toBe("withdrawn");
    const late = await seeded.api.raw("POST", `/payment-proofs/${sent.id}/confirm`, {});
    expect(late.status).toBe(409);
    const replay = await parent.context.request.post(
      `/api/portal/students/${clientId}/payment-proofs/${sent.id}/withdraw`,
    );
    expect(replay.status()).toBe(200);
    const audit = await auditLog(seeded.request);
    expect(audit.filter((e) => e.entity === "payment_submission").map((e) => e.action)).toEqual([
      "withdraw",
      "submit",
    ]);
  });

  test("a family says they'll pay cash at the court, and the owner confirms it there", async ({
    page,
    seeded,
    personas,
  }, info) => {
    test.setTimeout(180_000);
    const { parent, clientId, today } = await approvedEnrollment(seeded, personas, info);
    const w = parent.page;
    await visit(w, `/my/${clientId}/payments`);
    await w.getByRole("link", { name: "Send a payment proof" }).click();
    await expect(w.getByRole("heading", { name: "Pay", level: 1 })).toBeVisible();
    await toggle(w.getByRole("radio", { name: /Cash at the court/ }));
    await expect(w.getByLabel("Screenshot of the payment")).toHaveCount(0);
    await expect(w.getByLabel("Amount you'll pay")).toHaveValue("6000.00");
    await w.getByLabel("Note (optional)").fill("Bringing it on Tuesday");
    await w.getByRole("button", { name: "Tell the academy" }).click();
    await expect(w).toHaveURL((u) => u.pathname === `/my/${clientId}/payments`);
    const row = w.getByRole("article", { name: "₱6,000.00 · Cash" });
    await expect(row).toContainText("Cash at the court");
    await expect(row).toContainText("Pending review");
    const [cash] = (
      await portalGet<PortalPaymentProofsDto>(
        parent.context.request,
        `/students/${clientId}/payment-proofs`,
      )
    ).proofs;
    expect(cash).toMatchObject({ method: "Cash", proofKey: null, reference: null, paidOn: today });

    // A screenshot is needed for anything but cash, and the method must be the academy's own.
    const noImage = await sendProof(
      parent.context.request,
      clientId,
      { amountMinor: 1000, method: "GCash", paidOn: today },
      null,
    );
    expect(noImage.status).toBe(400);
    expect(noImage.text).toContain("Add a screenshot of the payment");
    const otherMethod = await sendProof(parent.context.request, clientId, {
      amountMinor: 1000,
      method: "E-wallet",
      paidOn: today,
    });
    expect(otherMethod.status).toBe(400);

    // The owner confirms it when the cash is handed over (today).
    await visit(page, "/money");
    const item = page
      .getByRole("region", { name: "Payments to review" })
      .getByRole("article", { name: /Mia Santos/ });
    await expect(item).toContainText("Cash at the court, says Pat Santos");
    await expect(item).toContainText("Bringing it on Tuesday");
    await item.getByRole("button", { name: "Confirm" }).click();
    const sheet = page.getByRole("dialog", { name: "Confirm Mia's payment" });
    await expect(sheet.getByLabel("Date paid")).toHaveValue(today);
    await submitSheet(sheet, sheet.getByRole("button", { name: "Record ₱6,000.00" }));
    const statement = await seeded.api.get<StatementDto>(`/clients/${clientId}/statement`);
    expect(statement.balanceMinor).toBe(0);
    expect(statement.payments.map((p) => [p.method, p.amountMinor, p.reference])).toEqual([
      ["Cash", 600000, null],
    ]);
  });

  test("a reference or the same student, amount, and date already counted is flagged", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const { parent, clientId, today } = await approvedEnrollment(seeded, personas, info);
    // Another student's payment, recorded at the desk with the same reference (written differently).
    const other = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Ana",
      lastName: "Cruz",
    });
    await seeded.api.post("/payments", {
      clientId: other.id,
      amountMinor: 150000,
      method: "GCash",
      paidOn: today,
      reference: "gc-7788 991",
    });
    const sameRef = await sendProofOk(parent.context.request, clientId, {
      amountMinor: 600000,
      method: "GCash",
      reference: "GC 7788991",
      paidOn: today,
    });
    // The same proof sent twice (another reference): same student, amount, and date.
    const twice = await sendProofOk(parent.context.request, clientId, {
      amountMinor: 600000,
      method: "GCash",
      reference: "GC-0001",
      paidOn: today,
    });
    const first = await proofOf(seeded, sameRef.id);
    expect(first.duplicates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "payment", reason: "reference", clientName: "Ana Cruz" }),
        expect.objectContaining({ kind: "proof", id: twice.id, reason: "same_details" }),
      ]),
    );
    expect((await proofOf(seeded, twice.id)).duplicates).toEqual([
      expect.objectContaining({ kind: "proof", id: sameRef.id, reason: "same_details" }),
    ]);

    await visit(page, "/money");
    const queue = page.getByRole("region", { name: "Payments to review" });
    const flagged = queue.getByRole("article", { name: /Mia Santos/ }).filter({
      hasText: "GCash · Ref GC 7788991 · Paid",
    });
    await expect(flagged).toContainText("Possible duplicate");
    await expect(flagged).toContainText("Same reference as Ana Cruz's recorded payment");
    await expect(flagged).toContainText(
      "Same student, amount, and date as another proof (GCash · Ref GC-0001 · Pending review)",
    );
    // The warning follows into the confirm sheet.
    await flagged.getByRole("button", { name: "Confirm" }).click();
    const sheet = page.getByRole("dialog", { name: "Confirm Mia's payment" });
    await expect(sheet).toContainText("Check this isn't counted already");
    await page.keyboard.press("Escape");
  });
});

test.describe("deciding proofs", () => {
  test("confirming twice, even at once, records one payment", async ({
    seeded,
    personas,
  }, info) => {
    const { parent, clientId, today } = await approvedEnrollment(seeded, personas, info);
    const sent = await sendProofOk(parent.context.request, clientId, {
      amountMinor: 600000,
      method: "GCash",
      reference: "GC-2222",
      paidOn: today,
    });
    const both = await Promise.all([
      seeded.api.raw("POST", `/payment-proofs/${sent.id}/confirm`, {}),
      seeded.api.raw("POST", `/payment-proofs/${sent.id}/confirm`, {}),
    ]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    const again = await seeded.api.post<PaymentProofDto>(`/payment-proofs/${sent.id}/confirm`, {
      amountMinor: 100,
    });
    expect(again.payment?.amountMinor).toBe(600000);
    const statement = await seeded.api.get<StatementDto>(`/clients/${clientId}/statement`);
    expect(statement.payments).toHaveLength(1);
    expect(statement.balanceMinor).toBe(0);
    const audit = await auditLog(seeded.request);
    expect(
      audit.filter((e) => e.entity === "payment_submission" && e.action === "confirm"),
    ).toHaveLength(1);
    expect(audit.filter((e) => e.entity === "payment" && e.action === "create")).toHaveLength(1);
  });

  test("voiding the payment a proof recorded shows it as voided, and it can be confirmed again", async ({
    page,
    seeded,
    personas,
  }, info) => {
    test.setTimeout(180_000);
    const { parent, requestId, clientId, today } = await approvedEnrollment(seeded, personas, info);
    const sent = await sendProofOk(parent.context.request, clientId, {
      amountMinor: 600000,
      method: "GCash",
      reference: "GC-3333",
      paidOn: today,
      enrollmentId: requestId,
    });
    const confirmed = await seeded.api.post<PaymentProofDto>(
      `/payment-proofs/${sent.id}/confirm`,
      {},
    );
    const paymentId = confirmed.payment?.id ?? "";

    // The owner voids that payment from the student's Money tab.
    await visit(page, `/clients/${clientId}?tab=money`);
    const proofs = page.getByRole("region", { name: "Payment proofs" });
    await expect(proofs).toContainText("Confirmed");
    await page.getByRole("button", { name: /^Actions for the .* payment$/ }).click();
    await page.getByRole("menuitem", { name: "Void payment" }).click();
    const voidSheet = page.getByRole("dialog", { name: "Void payment" });
    await voidSheet.getByLabel("Reason").fill("Transfer bounced");
    await submitSheet(voidSheet, voidSheet.getByRole("button", { name: "Void payment" }));

    // The proof no longer claims "Confirmed" with a live payment: it's "Payment voided".
    await expect(proofs).toContainText("Payment voided");
    await expect(proofs.getByRole("button", { name: "Confirm again" })).toBeVisible();
    const voided = await proofOf(seeded, sent.id);
    expect(voided).toMatchObject({ status: "voided", payment: { id: paymentId } });
    expect(voided.payment?.voidedAt).not.toBeNull();
    const request = await seeded.api.get<EnrollmentDetailDto>(`/enrollments/${requestId}`);
    expect(request.payment).toMatchObject({ status: "unpaid", dueMinor: 600000 });
    const list = await seeded.api.get<PaymentProofListDto>("/payment-proofs?status=voided");
    expect(list.items.map((i) => i.id)).toEqual([sent.id]);
    expect(list.counts.voided).toBe(1);
    // The family sees it too, and the request is owed again.
    const family = await portalGet<PortalPaymentProofsDto>(
      parent.context.request,
      `/students/${clientId}/payment-proofs`,
    );
    expect(family.proofs[0]).toMatchObject({ status: "voided", recorded: null });
    const enrollments = await portalGet<PortalStudentEnrollmentsDto>(
      parent.context.request,
      `/students/${clientId}/enrollments`,
    );
    expect(enrollments.requests[0]?.payment).toMatchObject({ dueMinor: 600000 });
    await visit(parent.page, `/my/${clientId}/payments`);
    await expect(parent.page.getByRole("article", { name: "₱6,000.00 · GCash" })).toContainText(
      "Payment voided",
    );

    // Reviewed again: confirmed with a new payment.
    await proofs.getByRole("button", { name: "Confirm again" }).click();
    const sheet = page.getByRole("dialog", { name: "Confirm Mia's payment" });
    await submitSheet(sheet, sheet.getByRole("button", { name: "Record ₱6,000.00" }));
    const again = await proofOf(seeded, sent.id);
    expect(again.status).toBe("confirmed");
    expect(again.payment?.id).not.toBe(paymentId);
    const statement = await seeded.api.get<StatementDto>(`/clients/${clientId}/statement`);
    expect(statement.payments.filter((p) => !p.voidedAt)).toHaveLength(1);
    expect(statement.balanceMinor).toBe(0);
    const audit = await auditLog(seeded.request);
    expect(audit.filter((e) => e.entity === "payment_submission").map((e) => e.action)).toEqual([
      "confirm",
      "void",
      "confirm",
      "submit",
    ]);
  });

  test("the request page shows its proofs, and they can be confirmed there", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const { parent, requestId, clientId, today } = await approvedEnrollment(seeded, personas, info);
    await sendProofOk(parent.context.request, clientId, {
      amountMinor: 600000,
      method: "Bank transfer",
      reference: "BPI-4444",
      paidOn: today,
      enrollmentId: requestId,
    });
    const approved = await seeded.api.get<{ items: { id: string; proofsPending?: number }[] }>(
      "/enrollments?status=approved",
    );
    expect(approved.items.find((i) => i.id === requestId)?.proofsPending).toBe(1);
    await visit(page, "/enrollments?status=approved");
    await expect(page.getByRole("link", { name: /Mia Santos/ })).toContainText("Proof to review");
    await visit(page, `/enrollments/${requestId}`);
    const payment = page.getByRole("region", { name: "Payment", exact: true });
    await expect(payment).toContainText("Proof pending");
    const item = payment.getByRole("article", { name: /Mia Santos/ });
    await expect(item).toContainText("Bank transfer · Ref BPI-4444");
    await item.getByRole("button", { name: "Confirm" }).click();
    const sheet = page.getByRole("dialog", { name: "Confirm Mia's payment" });
    await submitSheet(sheet, sheet.getByRole("button", { name: "Record ₱6,000.00" }));
    await expect(payment).toContainText("Paid");
    await expect(payment).toContainText("Confirmed by Robin Coach");
  });
});
