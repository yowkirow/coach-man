import type { MeDto, PaymentProofDto, PortalPaymentProofsDto } from "../src/shared/api-types";
import { approvedEnrollment, sendProof, sendProofOk } from "./proof-support";
import {
  Api,
  addMember,
  expect,
  linkFamily,
  portalCall,
  portalGet,
  test,
  testEmail,
  uuid,
  visit,
} from "./support";

// Who may see payment proofs (WS4c): owners and admins review them; coaches never see them (they
// see no money); a family sees its own students' proofs (both parents), never anyone else's; a
// screenshot is only served for a key a proof of the caller's student points at.

test.use({ serviceWorkers: "block" });

test.describe("payment proof access", () => {
  test("other families, coaches, and guessed keys get nothing; co-parents and admins see them", async ({
    seeded,
    personas,
  }, info) => {
    test.setTimeout(180_000);
    const { parent, requestId, clientId, today } = await approvedEnrollment(seeded, personas, info);
    const proof = await sendProofOk(parent.context.request, clientId, {
      amountMinor: 600000,
      method: "GCash",
      reference: "GC-9090",
      paidOn: today,
      enrollmentId: requestId,
    });
    const key = proof.proofKey ?? "";
    expect(key).toMatch(new RegExp(`/clients/${clientId}/payments/`));
    const me = await seeded.api.get<MeDto>("/me");
    const ws = me.workspace.id;

    // The sender reads their screenshot; private, never cached by anyone else.
    const own = await parent.context.request.get(`/api/portal/files/${key}`);
    expect(own.status()).toBe(200);
    expect(own.headers()["cache-control"]).toBe("no-store");
    expect(own.headers()["content-security-policy"]).toContain("sandbox");
    // A guessed key in the same student's folder: no proof has it.
    for (const guess of [
      `ws/${ws}/clients/${clientId}/payments/${uuid()}.png`,
      key.replace(/\.(png|jpg|webp)$/, ".jpg").replace(/[0-9a-f]{4}\./, "0000."),
      `ws/${ws}/clients/${clientId}/payments/..%2F${key.split("/").at(-1)}`,
    ]) {
      expect((await parent.context.request.get(`/api/portal/files/${guess}`)).status()).toBe(404);
    }
    // The public file route never serves it.
    expect((await seeded.request.get(`/api/public/files/${key}`)).status()).toBe(404);

    // Another family of the same academy: 404 for the screenshot, the list, and withdrawing.
    const sibling = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Leo",
      lastName: "Reyes",
      isJunior: true,
    });
    const otherEmail = testEmail("proof-other-family", info);
    expect(
      (
        await linkFamily(seeded.request, {
          clientId: sibling.id,
          email: otherEmail,
          name: "Kim Reyes",
          relation: "guardian",
        })
      ).status,
    ).toBe(201);
    const other = await personas.open({ email: otherEmail, name: "Kim Reyes", persona: "none" });
    const o = other.context.request;
    expect((await o.get(`/api/portal/files/${key}`)).status()).toBe(404);
    expect((await portalCall(o, "GET", `/students/${clientId}/payment-proofs`)).status).toBe(404);
    expect(
      (await portalCall(o, "POST", `/students/${clientId}/payment-proofs/${proof.id}/withdraw`))
        .status,
    ).toBe(404);
    // Their own student's path can't reach someone else's proof either.
    expect(
      (await portalCall(o, "POST", `/students/${sibling.id}/payment-proofs/${proof.id}/withdraw`))
        .status,
    ).toBe(404);
    const theirs = await portalGet<PortalPaymentProofsDto>(
      o,
      `/students/${sibling.id}/payment-proofs`,
    );
    expect(theirs.proofs).toEqual([]);
    // Sending for someone else's student, or resending someone else's proof: 404.
    expect(
      (
        await sendProof(o, clientId, {
          amountMinor: 1000,
          method: "GCash",
          reference: "GC-1",
          paidOn: today,
        })
      ).status,
    ).toBe(404);
    const resend = await sendProof(o, sibling.id, {
      amountMinor: 1000,
      method: "GCash",
      reference: "GC-12",
      paidOn: today,
      resubmitOf: proof.id,
    });
    expect(resend.status).toBe(404);
    // Paying for another student's request: 404.
    const wrongRequest = await sendProof(o, sibling.id, {
      amountMinor: 1000,
      method: "GCash",
      reference: "GC-13",
      paidOn: today,
      enrollmentId: requestId,
    });
    expect(wrongRequest.status).toBe(404);

    // The co-parent of the same student sees the proof and its screenshot.
    const coEmail = testEmail("proof-coparent", info);
    expect(
      (
        await linkFamily(seeded.request, {
          clientId,
          email: coEmail,
          name: "Sam Santos",
          relation: "guardian",
        })
      ).status,
    ).toBe(201);
    const co = await personas.open({ email: coEmail, name: "Sam Santos", persona: "none" });
    expect((await co.context.request.get(`/api/portal/files/${key}`)).status()).toBe(200);
    const seen = await portalGet<PortalPaymentProofsDto>(
      co.context.request,
      `/students/${clientId}/payment-proofs`,
    );
    expect(seen.proofs.map((p) => p.id)).toEqual([proof.id]);

    // A coach: 403 on the queue, the count, a proof, and decisions; 404 for the screenshot.
    const coachEmail = testEmail("proof-coach", info);
    await addMember(seeded.request, { email: coachEmail, name: "Casey Coach", role: "coach" });
    const coach = await personas.open({ email: coachEmail, name: "Casey Coach", persona: "none" });
    for (const [method, path, body] of [
      ["GET", "/payment-proofs", undefined],
      ["GET", "/payment-proofs/count", undefined],
      ["GET", `/payment-proofs/${proof.id}`, undefined],
      ["GET", `/clients/${clientId}/payment-proofs`, undefined],
      ["POST", `/payment-proofs/${proof.id}/confirm`, {}],
      ["POST", `/payment-proofs/${proof.id}/reject`, { reason: "No" }],
    ] as const) {
      const res = await coach.api.raw(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(Api.code(res)).toBe("forbidden");
    }
    expect((await coach.context.request.get(`/api/v1/files/${key}`)).status()).toBe(404);
    // The coach's screens don't ask for proofs either.
    await visit(coach.page, "/money");
    await expect(coach.page.getByRole("region", { name: "Payments to review" })).toHaveCount(0);
    expect((await proofOfAs(coach.api, proof.id)).status).toBe(403);

    // An admin reviews: sees the queue and the screenshot, and confirms.
    const adminEmail = testEmail("proof-admin", info);
    await addMember(seeded.request, { email: adminEmail, name: "Alex Admin", role: "admin" });
    const admin = await personas.open({ email: adminEmail, name: "Alex Admin", persona: "none" });
    expect((await admin.context.request.get(`/api/v1/files/${key}`)).status()).toBe(200);
    const confirmed = await admin.api.post<PaymentProofDto>(
      `/payment-proofs/${proof.id}/confirm`,
      {},
    );
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.reviewedBy?.name).toBe("Alex Admin");
  });

  test("the family's proof answers carry no reviewer and no staff notes", async ({
    seeded,
    personas,
  }, info) => {
    test.setTimeout(150_000);
    const { parent, requestId, clientId, today } = await approvedEnrollment(seeded, personas, info);
    const adminEmail = testEmail("proof-leak-admin", info);
    await addMember(seeded.request, {
      email: adminEmail,
      name: "LEAKREVIEWER Admin",
      role: "admin",
    });
    const admin = await personas.open({
      email: adminEmail,
      name: "LEAKREVIEWER Admin",
      persona: "none",
    });
    const adminMe = await admin.api.get<MeDto>("/me");
    const sent = await sendProofOk(parent.context.request, clientId, {
      amountMinor: 300000,
      method: "GCash",
      reference: "GC-5151",
      paidOn: today,
      enrollmentId: requestId,
    });
    const rejected = await sendProofOk(parent.context.request, clientId, {
      amountMinor: 100000,
      method: "GCash",
      reference: "GC-5152",
      paidOn: today,
    });
    const confirmed = await admin.api.post<PaymentProofDto>(`/payment-proofs/${sent.id}/confirm`, {
      note: "LEAKINTERNAL staff note",
    });
    expect(confirmed.payment).toBeTruthy();
    await admin.api.post(`/payment-proofs/${rejected.id}/reject`, {
      reason: "We can't find this payment in our account yet.",
    });
    // Staff see the reviewer and the internal note on the payment.
    expect(confirmed.reviewedBy?.userId).toBe(adminMe.user.id);

    const forbidden = [adminMe.user.id, adminEmail, "LEAKREVIEWER", "LEAKINTERNAL"];
    const reads = [
      await portalCall(parent.context.request, "GET", `/students/${clientId}/payment-proofs`),
      await portalCall(parent.context.request, "GET", `/students/${clientId}/enrollments`),
      await portalCall(parent.context.request, "GET", "/home"),
      await portalCall(parent.context.request, "GET", `/students/${clientId}/money`),
      await sendProof(parent.context.request, clientId, {
        amountMinor: 5000,
        method: "GCash",
        reference: "GC-5153",
        paidOn: today,
      }),
    ];
    for (const res of reads) {
      expect(res.status, res.text).toBeLessThan(300);
      for (const value of forbidden) expect(res.text).not.toContain(value);
      expect(res.text).not.toMatch(/"reviewedBy"|"paymentId"|"submittedBy"/);
    }
    const list = reads[0]?.json as PortalPaymentProofsDto;
    const byId = new Map(list.proofs.map((p) => [p.id, p]));
    expect(byId.get(sent.id)).toMatchObject({
      status: "confirmed",
      recorded: { amountMinor: 300000, paidOn: today },
      rejectReason: null,
    });
    expect(byId.get(rejected.id)).toMatchObject({
      status: "rejected",
      rejectReason: "We can't find this payment in our account yet.",
    });
    // The confirmed proof's withdraw answer (a refusal) carries nothing either.
    const late = await portalCall(
      parent.context.request,
      "POST",
      `/students/${clientId}/payment-proofs/${sent.id}/withdraw`,
    );
    expect(late.status).toBe(409);
    for (const value of forbidden) expect(late.text).not.toContain(value);
    // The family's pages show none of it.
    await visit(parent.page, `/my/${clientId}/payments`);
    await expect(parent.page.getByRole("region", { name: "Payment proofs" })).toBeVisible();
    const html = await parent.page.content();
    for (const value of forbidden) expect(html).not.toContain(value);
  });
});

async function proofOfAs(api: Api, id: string) {
  return api.raw("GET", `/payment-proofs/${id}`);
}
