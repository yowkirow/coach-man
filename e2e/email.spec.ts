import type {
  EnrollmentDetailDto,
  FamilyInviteCreatedDto,
  MeDto,
  StaffInviteCreatedDto,
} from "../src/shared/api-types";
import { placeholderEmail } from "../src/shared/domain";
import { monthLabel } from "../src/shared/time";
import { actionLink, emailSinkOf, emailsTo, firstEmailTo, pathOf } from "./email-support";
import { newChildBody, openEnrollment, sendOk } from "./enroll-support";
import { approvedEnrollment, METHODS, sendProofOk } from "./proof-support";
import { settle } from "./push-support";
import {
  addMember,
  bornYearsAgo,
  expect,
  linkFamily,
  test,
  testEmail,
  toggle,
  uuid,
  visit,
  watchErrors,
} from "./support";

// Email (Cloudflare Email Sending): invite links, enrollment and payment updates to families, and
// new requests and proofs to staff. With the E2E bypass on, the Worker records every email in its
// test sink instead of sending it, and these specs read the sink by address. Service workers are
// blocked (see family.spec.ts).
test.use({ serviceWorkers: "block" });

const ACADEMY = "Riverside Pickleball Academy";
const CONTACT = "hello@riverside-academy.test";

test.describe("invite emails", () => {
  test("a staff invite is emailed with its link, and the link joins", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const email = testEmail("email-desk", info);
    const owner = await seeded.api.get<MeDto>("/me");
    const academy = owner.workspace.name;
    // The email names the inviter as the team knows them: their coach profile's name.
    await seeded.api.patch(`/coaches/${owner.user.id}`, { displayName: "Coach Casey" });
    const errors = watchErrors(page);

    await visit(page, "/team");
    await page.getByRole("button", { name: "Invite someone" }).first().click();
    const form = page.getByRole("dialog", { name: "Invite someone" });
    await expect(
      form.getByText(
        "They sign in as this address, with Google or a code we email them. We email them the link, and you can share it too.",
      ),
    ).toBeVisible();
    await form.getByLabel("Their email").fill(email);
    const option = form.getByRole("radio", { name: /^Front desk/ });
    await toggle(option);
    await expect(option).toBeChecked();
    await form.getByRole("button", { name: "Create invite link" }).click();

    const ready = page.getByRole("dialog", { name: "Invite link ready" });
    await expect(ready.getByText(`We emailed the link to ${email}.`)).toBeVisible();
    const link = await ready.getByLabel("Invite link").inputValue();
    await ready.getByRole("button", { name: "Done" }).click();

    // One email, to the invited address, from the academy, with replies going to the owner.
    const sent = await firstEmailTo(seeded.request, email, "staff_invite");
    expect(sent.subject).toBe(`Join ${academy} on CoachMan`);
    expect(sent.fromName).toBe(`${academy} via CoachMan`);
    expect(sent.replyTo).toBe(seeded.email);
    expect(sent.text).toContain("1. Coach Casey invited you\nTo join as front desk staff.");
    expect(sent.text).not.toContain(owner.user.name);
    expect(sent.text).toContain(`2. Sign in\nAs ${email}, with Google or a code we email you.`);
    expect(sent.text).toContain("The link works once, until ");
    // The small print is one line.
    expect(sent.text.trimEnd().endsWith(`\n\nSent with CoachMan for ${academy}`)).toBe(true);
    expect(sent.text).not.toContain("Reply to this email");
    expect(actionLink(sent)).toBe(link);
    expect(sent.html).toContain(`href="${link}"`);
    expect(errors).toEqual([]);

    // Following the email's link joins the academy as front desk staff.
    const desk = await personas.open({ email, name: "Dana Desk", persona: "none" });
    await visit(desk.page, pathOf(actionLink(sent)));
    await expect(desk.page.getByText("You'll join as front desk staff.")).toBeVisible();
    await desk.page.getByRole("button", { name: `Join ${academy}` }).click();
    await expect(desk.page).toHaveURL(/\/$/);
    const me = await desk.api.get<MeDto>("/me");
    expect([me.role, me.workspace.id]).toEqual(["front_desk", owner.workspace.id]);

    // A coach's invite says "as a coach"; inviting again is a new link and a new email.
    const coach = testEmail("email-coach", info);
    const first = await seeded.api.post<StaffInviteCreatedDto>("/team/invites", {
      email: coach.toUpperCase(),
      role: "coach",
    });
    expect([first.emailedTo, first.emailError]).toEqual([coach, null]);
    const toCoach = await firstEmailTo(seeded.request, coach, "staff_invite");
    expect(toCoach.text).toContain("To join as a coach.");
    expect(actionLink(toCoach)).toBe(first.link);
    const again = await seeded.api.post<StaffInviteCreatedDto>("/team/invites", {
      email: coach,
      role: "coach",
    });
    const both = await emailsTo(seeded.request, coach, "staff_invite", 2);
    expect(both.map(actionLink)).toEqual([first.link, again.link]);
  });

  test("a family invite is emailed to the parent's address on file, and to nobody when it's cleared", async ({
    page,
    seeded,
  }, info) => {
    const guardianEmail = testEmail("email-guardian", info);
    const academy = (await seeded.api.get<MeDto>("/me")).workspace.name;
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(10),
      isJunior: true,
      guardianName: "Pat Santos",
      guardianEmail,
    });
    const errors = watchErrors(page);

    await visit(page, `/clients/${kid.id}`);
    const card = page.getByRole("region", { name: "Family access" });
    await card.getByRole("button", { name: "Invite parent / guardian" }).click();
    const sheet = page.getByRole("dialog", { name: "Invite a parent or guardian" });
    const field = sheet.getByLabel("Email the link to");
    await expect(field).toHaveValue(guardianEmail);
    await sheet.getByRole("button", { name: "Create invite link" }).click();

    const ready = page.getByRole("dialog", { name: "Invite link ready" });
    await expect(ready.getByText(`We emailed the link to ${guardianEmail}.`)).toBeVisible();
    const link = await ready.getByLabel("Invite link").inputValue();
    await ready.getByRole("button", { name: "Done" }).click();

    const sent = await firstEmailTo(seeded.request, guardianEmail, "family_invite");
    expect(sent.subject).toBe(`${academy} invited you to its family portal`);
    expect(sent.fromName).toBe(`${academy} via CoachMan`);
    expect(sent.text).toContain(`1. ${academy} invited you\nTo follow Mia's training on CoachMan.`);
    expect(sent.text).toContain(
      "Sign in with Google, a code by email, or a passkey on your phone.",
    );
    expect(sent.text).toContain(`Open the invite: ${link}`);
    // The academy has no contact email yet: replies reach nobody.
    expect(sent.replyTo).toBeNull();

    // Cleared: a link to share, and no email.
    await card.getByRole("button", { name: "Invite parent / guardian" }).click();
    await expect(field).toHaveValue(guardianEmail);
    await field.fill("");
    await sheet.getByRole("button", { name: "Create invite link" }).click();
    await expect(
      ready.getByText("Send it to Mia's parent or guardian on Messenger, Viber, or by text."),
    ).toBeVisible();
    await expect(ready.getByText(/We emailed/)).toHaveCount(0);
    await ready.getByRole("button", { name: "Done" }).click();
    await settle();
    expect(await emailSinkOf(seeded.request, guardianEmail)).toHaveLength(1);
    expect(errors).toEqual([]);

    // Through the API: a blank address means none; replies reach the academy once it has one.
    const none = await seeded.api.post<FamilyInviteCreatedDto>(
      `/clients/${kid.id}/family/invites`,
      { relation: "guardian", email: "  " },
    );
    expect([none.emailedTo, none.emailError]).toEqual([null, null]);
    await seeded.api.patch("/academy", { contactEmail: CONTACT });
    const other = testEmail("email-other-parent", info);
    const withReplies = await seeded.api.post<FamilyInviteCreatedDto>(
      `/clients/${kid.id}/family/invites`,
      { relation: "guardian", email: ` ${other.toUpperCase()} ` },
    );
    expect(withReplies.emailedTo).toBe(other);
    const replied = await firstEmailTo(seeded.request, other, "family_invite");
    expect(replied.replyTo).toBe(CONTACT);
  });
});

test.describe("enrollment and payment emails", () => {
  test("a new request emails whoever sent it, and the owner and front desk who review it", async ({
    seeded,
    personas,
  }, info) => {
    test.skip(info.project.name !== "desktop", "An API flow: one browser is enough");
    test.slow();
    const setup = await openEnrollment(seeded, info, { name: ACADEMY, contactEmail: CONTACT });
    const staff = async (role: "admin" | "front_desk" | "coach", name: string) => {
      const email = testEmail(`email-${role}`, info);
      await addMember(seeded.request, { email, name, role });
      return email;
    };
    const desk = await staff("front_desk", "Dana Desk");
    const coach = await staff("coach", "Casey Coach");
    const quietAdmin = await staff("admin", "Quinn Admin");
    // "Enrollments & payments" off in the staff app's notification settings.
    const quiet = await personas.open({ email: quietAdmin, name: "Quinn Admin", persona: "none" });
    await quiet.api.put("/notification-prefs", {
      sessionReminderMinutes: 30,
      dailyDigestTime: null,
      packageExpiryDays: 7,
      enrollmentAlerts: false,
    });

    const parentEmail = testEmail("email-applicant", info);
    const parent = await personas.open({ email: parentEmail, name: "Pat Santos", persona: "none" });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, {
        firstName: "Mia",
        lastName: "Santos",
        birthDate: bornYearsAgo(12),
        startMonth: setup.thisMonth,
      }),
    );
    const month = monthLabel(setup.thisMonth, "en-US");

    const received = await firstEmailTo(seeded.request, parentEmail, "enrollment_received");
    expect(received.subject).toBe("We got your request for Mia");
    expect(received.fromName).toBe(`${ACADEMY} via CoachMan`);
    expect(received.text).toContain(`You asked to enroll Mia in Monthly from ${month}.`);
    expect(received.text).toContain(`${ACADEMY} will review it and let you know.`);
    expect(pathOf(actionLink(received))).toBe(`/my/${sent.clientId}/payments`);
    expect(received.replyTo).toBe(CONTACT);

    for (const address of [seeded.email, desk]) {
      const alert = await firstEmailTo(seeded.request, address, "staff_enrollment_request");
      expect(alert.subject).toBe("New enrollment request for Mia");
      expect(alert.text).toContain("1. Request sent\nFor Mia: Monthly.");
      expect(alert.text).not.toContain("Santos");
      expect(pathOf(actionLink(alert))).toBe(`/enrollments/${sent.request.id}`);
      expect(alert.replyTo).toBeNull();
    }

    // Nobody else: not the coach, not the admin who turned alerts off, and each once.
    await settle();
    expect(await emailSinkOf(seeded.request, coach)).toEqual([]);
    expect(await emailSinkOf(seeded.request, quietAdmin)).toEqual([]);
    expect((await emailSinkOf(seeded.request, parentEmail)).map((e) => e.kind)).toEqual([
      "enrollment_received",
    ]);
    expect(await emailSinkOf(seeded.request, seeded.email)).toHaveLength(1);
    expect(await emailSinkOf(seeded.request, desk)).toHaveLength(1);
  });

  test("the family hears each decision once: one request approved, another declined", async ({
    seeded,
    personas,
  }, info) => {
    test.skip(info.project.name !== "desktop", "An API flow: one browser is enough");
    test.slow();
    const setup = await openEnrollment(seeded, info, { name: ACADEMY });
    const parentEmail = testEmail("email-decisions", info);
    const parent = await personas.open({ email: parentEmail, name: "Pat Santos", persona: "none" });
    const month = monthLabel(setup.thisMonth, "en-US");
    const request = (firstName: string, age: number) =>
      sendOk(
        parent.context.request,
        newChildBody(setup, {
          firstName,
          birthDate: bornYearsAgo(age),
          startMonth: setup.thisMonth,
        }),
      );

    const mia = await request("Mia", 12);
    const detail = await seeded.api.post<EnrollmentDetailDto>(
      `/enrollments/${mia.request.id}/approve`,
      {},
    );
    expect(detail.payment?.dueMinor ?? 0).toBeGreaterThan(0);
    const approved = await firstEmailTo(seeded.request, parentEmail, "enrollment_decision");
    expect(approved.subject).toBe(`Mia is in: Monthly from ${month}`);
    expect(approved.text).toContain("Pay from the portal");
    expect(pathOf(actionLink(approved))).toBe(
      `/my/${detail.student.clientId}/pay?request=${mia.request.id}`,
    );
    // Never the amount.
    expect(`${approved.subject}\n${approved.text}\n${approved.html}`).not.toMatch(
      /₱|PHP|6,000|6000/,
    );
    // Approving again is a replay.
    await seeded.api.post(`/enrollments/${mia.request.id}/approve`, {});

    const ben = await request("Ben", 9);
    const REASON = "The evening program is full this month";
    await seeded.api.post(`/enrollments/${ben.request.id}/decline`, { reason: REASON });
    await seeded.api.post(`/enrollments/${ben.request.id}/decline`, { reason: REASON });
    const decisions = await emailsTo(seeded.request, parentEmail, "enrollment_decision", 2);
    const declined = decisions.find((e) => e.subject === "Your request for Ben was updated");
    expect(declined?.text).toContain(
      `Open CoachMan to see ${ACADEMY}'s reply about Ben's request.`,
    );
    expect(`${declined?.text}\n${declined?.html}`).not.toContain("full this month");
    expect(declined && pathOf(actionLink(declined))).toBe("/my");

    // Each decision once, and none to the owner who made them.
    await settle();
    const all = await emailSinkOf(seeded.request, parentEmail);
    expect(all.filter((e) => e.kind === "enrollment_decision").map((e) => e.subject)).toEqual([
      `Mia is in: Monthly from ${month}`,
      "Your request for Ben was updated",
    ]);
    const toOwner = await emailSinkOf(seeded.request, seeded.email);
    expect(toOwner.filter((e) => e.kind === "enrollment_decision")).toEqual([]);
  });

  test("a payment proof emails the owner and the front desk; the family hears it was received or not accepted", async ({
    seeded,
    personas,
  }, info) => {
    test.skip(info.project.name !== "desktop", "An API flow: one browser is enough");
    test.slow();
    const desk = testEmail("email-proof-desk", info);
    await addMember(seeded.request, { email: desk, name: "Dana Desk", role: "front_desk" });
    const { parent, clientId, requestId, today } = await approvedEnrollment(seeded, personas, info);
    const proof = (reference: string) =>
      sendProofOk(parent.context.request, clientId, {
        amountMinor: 300000,
        method: "GCash",
        reference,
        paidOn: today,
        enrollmentId: requestId,
      });

    const first = await proof("GC-9101");
    for (const address of [seeded.email, desk]) {
      const alert = await firstEmailTo(seeded.request, address, "staff_proof");
      expect(alert.subject).toBe("Payment proof to review for Mia");
      expect(alert.text).toContain("1. Payment proof sent\nFor Mia.");
      expect(alert.text).toContain("Confirm it in Money, or mark it not accepted.");
      expect(pathOf(actionLink(alert))).toBe("/money");
      expect(`${alert.subject}\n${alert.text}\n${alert.html}`).not.toMatch(/3,000|3000|₱/);
    }

    await seeded.api.post(`/payment-proofs/${first.id}/confirm`, {});
    const received = await firstEmailTo(seeded.request, parent.email, "proof_confirmed");
    expect(received.subject).toBe("Payment received for Mia");
    expect(received.text).toContain(`${ACADEMY} confirmed the payment for Mia.`);
    expect(pathOf(actionLink(received))).toBe(`/my/${clientId}/payments`);

    const second = await proof("GC-9102");
    const REASON = "The reference number doesn't match our records";
    await seeded.api.post(`/payment-proofs/${second.id}/reject`, { reason: REASON });
    const rejected = await firstEmailTo(seeded.request, parent.email, "proof_rejected");
    expect(rejected.subject).toBe("Payment proof not accepted for Mia");
    expect(rejected.text).toContain(
      `${ACADEMY} couldn't accept the payment screenshot for Mia. Open the portal to see why and send another.`,
    );
    expect(`${rejected.text}\n${rejected.html}`).not.toContain("match our records");
    expect(pathOf(actionLink(rejected))).toBe(`/my/${clientId}/payments`);

    // Confirming again is a replay: one "Payment received", and a staff alert per proof.
    await seeded.api.post(`/payment-proofs/${first.id}/confirm`, {});
    await settle();
    const family = await emailSinkOf(seeded.request, parent.email);
    expect(family.filter((e) => e.kind === "proof_confirmed")).toHaveLength(1);
    expect(family.filter((e) => e.kind === "proof_rejected")).toHaveLength(1);
    const toDesk = await emailSinkOf(seeded.request, desk);
    expect(toDesk.filter((e) => e.kind === "staff_proof")).toHaveLength(2);
  });

  test("a passkey-only family account is never emailed", async ({ seeded, personas }, info) => {
    test.skip(info.project.name !== "desktop", "An API flow: one browser is enough");
    test.slow();
    await seeded.api.patch("/workspace", { paymentMethods: METHODS });
    const setup = await openEnrollment(seeded, info, { name: ACADEMY });
    const parentEmail = testEmail("email-real-parent", info);
    const parent = await personas.open({ email: parentEmail, name: "Pat Santos", persona: "none" });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, {
        firstName: "Mia",
        birthDate: bornYearsAgo(12),
        startMonth: setup.thisMonth,
      }),
    );
    // Mia's other parent uses a passkey-only account: its address is a placeholder.
    const placeholder = placeholderEmail(uuid());
    const linked = await linkFamily(seeded.request, {
      clientId: sent.clientId,
      email: placeholder,
      name: "Lee Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);

    // Both parents hear about the approval and the payment; only the one with an address is emailed.
    const detail = await seeded.api.post<EnrollmentDetailDto>(
      `/enrollments/${sent.request.id}/approve`,
      {},
    );
    await firstEmailTo(seeded.request, parentEmail, "enrollment_decision");
    const paid = await sendProofOk(parent.context.request, detail.student.clientId, {
      amountMinor: 600000,
      method: "GCash",
      reference: "GC-9201",
      paidOn: setup.academy.today,
      enrollmentId: sent.request.id,
    });
    await seeded.api.post(`/payment-proofs/${paid.id}/confirm`, {});
    await firstEmailTo(seeded.request, parentEmail, "proof_confirmed");

    // An invite to that address makes the link, and says why it wasn't emailed.
    const invite = await seeded.api.post<FamilyInviteCreatedDto>(
      `/clients/${detail.student.clientId}/family/invites`,
      { relation: "guardian", email: placeholder },
    );
    expect(invite.link).toContain("/join/");
    expect([invite.emailedTo, invite.emailError]).toEqual([
      null,
      "That address can't receive email.",
    ]);
    await settle();
    expect(await emailSinkOf(seeded.request, placeholder)).toEqual([]);
  });
});
