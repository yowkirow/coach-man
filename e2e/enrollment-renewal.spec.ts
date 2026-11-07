import type {
  ClientConsentsDto,
  EnrollmentDetailDto,
  PortalStudentEnrollmentsDto,
  ProgressDto,
  RenewalsDueDto,
  TodayDto,
} from "../src/shared/api-types";
import { isLastWeekOfMonth } from "../src/shared/enrollment";
import {
  addConsents,
  answersFor,
  codeOf,
  newChildBody,
  openEnrollment,
  sendOk,
} from "./enroll-support";
import {
  bornYearsAgo,
  expect,
  lastDayOfMonth,
  portalCall,
  portalGet,
  submitSheet,
  test,
  testEmail,
  toggle,
  visit,
} from "./support";

// Monthly renewal (WS4b): a student whose month-end package ends this month renews for next
// month in one tap from the family portal; staff see who hasn't, with a reminder to paste.

test.use({ serviceWorkers: "block" });

test.describe("monthly renewal", () => {
  test("a monthly student renews in one tap and leaves Not yet renewed", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const { api } = seeded;
    const setup = await openEnrollment(seeded, info);
    const parent = await personas.open({
      email: testEmail("renew-parent", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, {
        firstName: "Mia",
        birthDate: bornYearsAgo(12),
        startMonth: setup.thisMonth,
        answers: answersFor({ shirtSize: "Kids L", selfRating: 3 }),
      }),
    );
    await api.post(`/enrollments/${sent.request.id}/approve`, {});

    // Staff: "Not yet renewed" lists Mia, with a reminder ready to paste.
    const due = await api.get<RenewalsDueDto>("/enrollments/renewals");
    expect(due.items.map((i) => [i.clientId, i.tierName, i.expiresOn])).toEqual([
      [sent.clientId, "Monthly", lastDayOfMonth(setup.thisMonth)],
    ]);
    expect(due.nextMonth).toBe(setup.nextMonth);
    expect(due.portalUrl).toMatch(/\/my$/);
    await visit(page, "/enrollments?view=renewals");
    const list = page.getByRole("region", { name: "Not yet renewed" });
    await expect(list).toContainText("Mia Santos");
    await list.getByRole("button", { name: /Copy reminder message/ }).click();
    await expect(list).toContainText("“Renew for next month”");
    await expect(list).toContainText(due.portalUrl);
    // Today counts them in the month's last week only.
    const today = await api.get<TodayDto>("/today");
    expect(today.alerts.enrollments?.notRenewed ?? null).toBe(
      isLastWeekOfMonth(setup.academy.today) ? 1 : null,
    );

    // The academy stops taking new students: renewing still works.
    await api.patch("/academy", { enrollmentOpen: false });
    const w = parent.page;
    await visit(w, "/my");
    const offer = w.getByRole("region", { name: /^Renew for/ });
    await expect(offer).toContainText("Monthly");
    await offer.getByRole("button", { name: "Renew for next month" }).click();
    await expect(offer).toHaveCount(0);
    await expect(w.getByRole("article").filter({ hasText: "Renewal" }).first()).toContainText(
      "Requested",
    );
    const theirs = await portalGet<PortalStudentEnrollmentsDto>(
      parent.context.request,
      `/students/${sent.clientId}/enrollments`,
    );
    expect(theirs.renewal).toBeNull();
    const renewal = theirs.requests.find((r) => r.renewal);
    expect(renewal).toMatchObject({
      status: "requested",
      startMonth: setup.nextMonth,
      mode: "month",
    });

    // Staff: Mia is off the list; the renewal carries her answers over.
    expect((await api.get<RenewalsDueDto>("/enrollments/renewals")).items).toEqual([]);
    const detail = await api.get<EnrollmentDetailDto>(`/enrollments/${renewal?.id}`);
    expect(detail.renewal).toBe(true);
    expect(detail.answers).toMatchObject({
      shirtSize: "Kids L",
      selfRating: 3,
      phone: "0917 555 0100",
      emergencyName: "Pat Santos",
    });
    // Approving it sells next month; the self-rating isn't saved a second time.
    const approved = await api.post<EnrollmentDetailDto>(`/enrollments/${renewal?.id}/approve`, {});
    expect(approved.period.expiresOn).toBe(lastDayOfMonth(setup.nextMonth));
    const progress = await api.get<ProgressDto>(`/clients/${sent.clientId}/progress`);
    expect(progress.ratings).toHaveLength(1);
    // Next month is covered: no second renewal.
    const again = await portalCall(
      parent.context.request,
      "POST",
      `/students/${sent.clientId}/renew`,
      {},
    );
    expect(again.status).toBe(409);
  });

  test("renewing asks for a changed consent form to be signed again first", async ({
    seeded,
    personas,
  }, info) => {
    const { api } = seeded;
    const setup = await openEnrollment(seeded, info);
    const { waiver, parental } = await addConsents(api);
    const parent = await personas.open({
      email: testEmail("renew-consent", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, {
        firstName: "Mia",
        birthDate: bornYearsAgo(12),
        startMonth: setup.thisMonth,
        signatures: [waiver, parental].map((d) => ({
          documentId: d.id,
          version: d.version,
          signerName: "Pat Santos",
        })),
      }),
    );
    await api.post(`/enrollments/${sent.request.id}/approve`, {});

    // The academy rewrites its waiver: a new version to sign.
    await api.patch(`/consent-documents/${waiver.id}`, {
      body: "Updated waiver text.\n\nRead it again before the new month.",
    });
    const offer = (
      await portalGet<PortalStudentEnrollmentsDto>(
        parent.context.request,
        `/students/${sent.clientId}/enrollments`,
      )
    ).renewal;
    expect(offer?.consents.map((d) => [d.title, d.version])).toEqual([["Waiver and release", 2]]);
    const unsigned = await portalCall(
      parent.context.request,
      "POST",
      `/students/${sent.clientId}/renew`,
      {},
    );
    expect([unsigned.status, codeOf(unsigned)]).toEqual([409, "consents_required"]);

    // The portal goes through the form first.
    const w = parent.page;
    await visit(w, "/my");
    const card = w.getByRole("region", { name: /^Renew for/ });
    await expect(card).toContainText("A form to sign first");
    await card.getByRole("button", { name: "Renew for next month" }).click();
    const sheet = w.getByRole("dialog", { name: /^Renew for/ });
    await expect(sheet).toContainText("Updated waiver text.");
    await expect(sheet.getByRole("button", { name: "Sign and renew" })).toBeDisabled();
    await toggle(sheet.getByRole("checkbox", { name: /Waiver and release/ }));
    await submitSheet(sheet, sheet.getByRole("button", { name: "Sign and renew" }));
    const after = await portalGet<PortalStudentEnrollmentsDto>(
      parent.context.request,
      `/students/${sent.clientId}/enrollments`,
    );
    expect(after.requests.find((r) => r.renewal)?.status).toBe("requested");
    const consents = await api.get<ClientConsentsDto>(`/clients/${sent.clientId}/consents`);
    expect(consents.missing).toBe(0);
  });
});
