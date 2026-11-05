import type {
  ClientConsentsDto,
  ClientDetailDto,
  EnrollmentDetailDto,
  EnrollmentListDto,
  FamilyAccessDto,
  GroupDetailDto,
  LessonDetailDto,
  PortalHomeDto,
  PortalMoneyDto,
  PortalStudentEnrollmentsDto,
  ProgressDto,
  TodayDto,
} from "../src/shared/api-types";
import {
  addConsents,
  answersFor,
  chooseNewChild,
  codeOf,
  continueTo,
  fillContact,
  newChildBody,
  openEnrollment,
  pickLevel,
  publicSessions,
  sendOk,
  sendRequest,
} from "./enroll-support";
import {
  auditLog,
  bornYearsAgo,
  expect,
  lastDayOfMonth,
  linkFamily,
  portalCall,
  portalGet,
  signIn,
  submitSheet,
  test,
  testEmail,
  toggle,
  visit,
  watchErrors,
} from "./support";

// Enrollment (WS4b): families enroll from the academy page through the wizard; owners and admins
// decide in the Enrollments inbox; approving sells the tier and enrolls the student.

test.use({ serviceWorkers: "block" });

test.describe("enrolling from the academy page", () => {
  test("a parent enrolls a new child, and approving it enrolls her for next month", async ({
    page,
    seeded,
    browser,
  }, info) => {
    test.setTimeout(180_000);
    const { api } = seeded;
    const setup = await openEnrollment(seeded, info);
    await addConsents(api);
    const enrollUrl = `/a/${setup.slug}/enroll?package=${setup.monthly.id}`;

    // A parent opens the academy page and taps Enroll on Monthly: signing in comes first.
    const context = await browser.newContext({ serviceWorkers: "block" });
    const w = await context.newPage();
    const errors = watchErrors(w);
    await visit(w, `/a/${setup.slug}`);
    await w.getByRole("link", { name: "Enroll in Monthly", exact: true }).click();
    await expect(w).toHaveURL((url) => url.pathname === `/a/${setup.slug}/enroll`);
    await expect(w.getByRole("heading", { name: "Sign in to enroll" })).toBeVisible();
    await expect(w.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(w.getByRole("button", { name: "Create a passkey account" })).toBeVisible();
    // Google can't be automated: the test sign-in stands in for it, then the page comes back.
    await signIn(context.request, {
      email: testEmail("enroll-parent", info),
      name: "Pat Santos",
      persona: "none",
    });
    await visit(w, enrollUrl);
    await expect(w.getByRole("heading", { name: "Who's training?" })).toBeVisible();

    // Who's training: a new child. Nothing goes on until it's answered.
    await w.getByRole("button", { name: "Continue" }).click();
    await expect(w.getByText("Choose who's training.")).toBeVisible();
    await chooseNewChild(w, { firstName: "Mia", lastName: "Santos", birthDate: bornYearsAgo(12) });
    await continueTo(w, "About Mia's game");
    // Back keeps every answer.
    await w.getByRole("button", { name: "Back" }).click();
    await expect(w.getByLabel("Child's first name")).toHaveValue("Mia");
    await continueTo(w, "About Mia's game");

    // Level and uniform, both required by this tier.
    await w.getByRole("button", { name: "Continue" }).click();
    await expect(w.getByText("Pick a level, or “Not sure”.")).toBeVisible();
    await expect(w.getByText("Pick a shirt size.")).toBeVisible();
    await pickLevel(w, "3.0", "Kids M");
    await continueTo(w, "Contact and safety");

    // Contact, health, emergency, and who may pick her up.
    await fillContact(w);
    await w.getByLabel("Health notes (optional)").fill("Mild asthma");
    await w.getByRole("button", { name: "Add a person" }).click();
    await w.getByLabel("Name", { exact: true }).fill("Lola Santos");
    await w.getByLabel("Relationship").fill("Grandmother");
    await w.getByLabel("Phone", { exact: true }).fill("0917 555 0102");
    // The draft is kept on the device: a reload comes back to the same step, answers and all.
    await expect
      .poll(() =>
        w.evaluate(() =>
          Object.keys(localStorage).some(
            (k) =>
              k.startsWith("coachman.enroll.v1:") &&
              (localStorage.getItem(k) ?? "").includes("0917 555 0102"),
          ),
        ),
      )
      .toBe(true);
    await visit(w, enrollUrl);
    await expect(w.getByRole("heading", { name: "Contact and safety" })).toBeVisible();
    await expect(w.getByLabel("Name", { exact: true })).toHaveValue("Lola Santos");

    // When: next month, with the month-end advice.
    await continueTo(w, "Which month?");
    await expect(w.getByText(/Best to enroll early in the month/)).toBeVisible();
    await toggle(w.getByRole("radio", { name: /^Next month/ }));
    await expect(w.getByRole("radio", { name: /^Next month/ })).toBeChecked();

    // Consents: the one for everyone and the parental one, signed by the parent.
    await continueTo(w, "Consent forms");
    await w.getByRole("button", { name: "Continue" }).click();
    await expect(w.getByText("Read “Waiver and release” and tick that you agree.")).toBeVisible();
    await toggle(w.getByRole("checkbox", { name: /Waiver and release/ }));
    await toggle(w.getByRole("checkbox", { name: /Parental consent/ }));
    await expect(w.getByLabel("Type your full name to sign")).toHaveValue("Pat Santos");
    await expect(w.getByText(/as Mia's parent or guardian/)).toBeVisible();

    // Check and send.
    await continueTo(w, "Check and send");
    await expect(w.getByText("Lola Santos, Grandmother")).toBeVisible();
    await expect(w.getByText("Kids M")).toBeVisible();
    await expect(w.getByText("Nothing to pay yet")).toBeVisible();
    await w.getByRole("button", { name: "Send request" }).click();
    await expect(w.getByRole("heading", { name: "Request sent" })).toBeVisible();
    await expect(w.getByRole("heading", { name: "What happens next" })).toBeVisible();
    await w.getByRole("button", { name: "See it in My family" }).click();
    await expect(w).toHaveURL(/\/my\/?$/);
    const requestCard = w.getByRole("article", { name: /^Monthly/ }).first();
    await expect(requestCard).toContainText("Requested");
    await expect(requestCard.getByRole("button", { name: "Cancel request" })).toBeVisible();

    // Today tells the owner there's a request to review.
    const today = await api.get<TodayDto>("/today");
    expect(today.alerts.enrollments?.requested).toBe(1);
    await visit(page, "/");
    await expect(page.getByRole("link", { name: /^1 enrollment request to review/ })).toBeVisible();
    // And the inbox carries a badge: on the rail (desktop), on More (phones).
    await expect(
      info.project.name === "mobile"
        ? page.getByRole("link", { name: /^More.*1 enrollment request to review/ })
        : page.getByRole("link", { name: "Enrollments, 1 to review" }),
    ).toBeVisible();

    // The owner reviews it in the inbox.
    await visit(page, "/enrollments");
    const row = page.getByRole("link", { name: /Mia Santos/ });
    await expect(row).toContainText("New student");
    await row.click();
    await expect(page.getByRole("heading", { level: 1, name: "Mia Santos" })).toBeVisible();
    const answers = page.getByRole("region", { name: "Answers" });
    await expect(answers).toContainText("3.0");
    await expect(answers).toContainText("Kids M");
    await expect(answers).toContainText("Mild asthma");
    await expect(page.getByRole("region", { name: "Authorized pickups" })).toContainText(
      "Lola Santos",
    );
    await expect(page.getByRole("region", { name: "Consents" })).toContainText("Parental consent");
    await expect(page.getByRole("region", { name: "Program places" })).toContainText("of 16");
    await expect(page.getByRole("region", { name: "Payment" })).toContainText("Not charged yet");
    await page.getByRole("button", { name: "Approve" }).click();
    const sheet = page.getByRole("dialog", { name: "Approve Mia?" });
    await expect(sheet).toContainText("Adds Mia to Evening program");
    await expect(sheet).toContainText("Saves their self-rating of 3.0");
    await submitSheet(sheet, sheet.getByRole("button", { name: "Approve" }));
    await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Payment" })).toContainText("Unpaid");

    // What approving did: one package for next month, its charge, the program, the rating.
    const list = await api.get<EnrollmentListDto>("/enrollments?status=approved");
    const id = list.items[0]?.id ?? "";
    const detail = await api.get<EnrollmentDetailDto>(`/enrollments/${id}`);
    expect(detail.status).toBe("approved");
    expect(detail.period.startMonth).toBe(setup.nextMonth);
    expect(detail.created.chargeId).toBeTruthy();
    expect(detail.payment).toEqual({
      chargeId: detail.created.chargeId,
      amountMinor: setup.monthly.priceMinor,
      paidMinor: 0,
      dueMinor: setup.monthly.priceMinor,
      status: "unpaid",
    });
    const clientId = detail.student.clientId;
    const client = await api.get<ClientDetailDto>(`/clients/${clientId}`);
    expect(client.client.status).toBe("active");
    expect(client.client.balanceMinor).toBe(setup.monthly.priceMinor);
    expect(client.packages).toHaveLength(1);
    expect(client.packages[0]).toMatchObject({
      id: detail.created.clientPackageId,
      startMonth: setup.nextMonth,
      expiresOn: lastDayOfMonth(setup.nextMonth),
      includesUniform: true,
      uniformSize: "Kids M",
    });
    const group = await api.get<GroupDetailDto>(`/groups/${setup.program.id}`);
    expect(group.members.find((m) => m.clientId === clientId)?.joinedOn).toBe(
      `${setup.nextMonth}-01`,
    );
    const progress = await api.get<ProgressDto>(`/clients/${clientId}/progress`);
    expect(progress.ratings.map((r) => [r.source, r.value])).toEqual([["self", 3]]);
    // Approving again changes nothing: still one package and one charge.
    const again = await api.post<EnrollmentDetailDto>(`/enrollments/${id}/approve`, {});
    expect(again.created).toEqual(detail.created);
    expect((await api.get<ClientDetailDto>(`/clients/${clientId}`)).packages).toHaveLength(1);
    const audit = await auditLog(seeded.request);
    const actions = audit.filter((e) => e.entity === "enrollment_request").map((e) => e.action);
    expect(actions.sort()).toEqual(["approve", "request"]);
    expect(
      audit.filter((e) => e.action === "sell" && e.entityId === detail.created.clientPackageId),
    ).toHaveLength(1);

    // The family sees the approval, the package, and what to pay.
    await visit(w, "/my");
    const approved = w.getByRole("article", { name: /^Monthly/ }).first();
    await expect(approved).toContainText("Approved");
    await expect(approved).toContainText("Unpaid");
    await expect(approved).toContainText(/6,000\.00\s*due/);
    await approved.getByRole("link", { name: "How to pay" }).click();
    await expect(w).toHaveURL(new RegExp(`/my/${clientId}/payments$`));
    await expect(w.getByRole("region", { name: "To pay", exact: true })).toContainText("6,000.00");
    const money = await portalGet<PortalMoneyDto>(context.request, `/students/${clientId}/money`);
    expect(money.packages.map((p) => [p.name, p.expiresOn])).toEqual([
      ["Monthly", lastDayOfMonth(setup.nextMonth)],
    ]);
    expect(money.charges.map((ch) => [ch.amountMinor, ch.paidMinor])).toEqual([
      [setup.monthly.priceMinor, 0],
    ]);
    // The portal's Enroll page starts the same wizard, now with Mia to choose.
    await visit(w, "/my/enroll");
    await w.getByRole("link", { name: "Enroll in Monthly plus", exact: true }).click();
    await expect(w.getByRole("heading", { name: "Who's training?" })).toBeVisible();
    await expect(w.getByRole("radio", { name: /^Mia Santos/ })).toBeEnabled();
    // Signed out, the wizard asked who's there (401); nothing else failed.
    expect(errors.filter((e) => e !== "401 GET /api/account")).toEqual([]);
    await context.close();
  });

  test("an adult enrolls themself", async ({ seeded, personas }, info) => {
    const setup = await openEnrollment(seeded, info);
    const { waiver } = await addConsents(seeded.api);
    const adult = await personas.open({
      email: testEmail("enroll-adult", info),
      name: "Alex Reyes",
      persona: "none",
    });
    const w = adult.page;
    await visit(w, `/a/${setup.slug}/enroll?package=${setup.monthlyPlus.id}`);
    await expect(w.getByRole("heading", { name: "Who's training?" })).toBeVisible();
    await toggle(w.getByRole("radio", { name: /^Me/ }));
    await expect(w.getByLabel("First name")).toHaveValue("Alex");
    await expect(w.getByLabel("Last name")).toHaveValue("Reyes");
    // Under 18 can't enroll themself.
    await w.getByLabel("Your birth date").fill(bornYearsAgo(16));
    await w.getByRole("button", { name: "Continue" }).click();
    await expect(w.getByText(/Ask your parent or guardian to enroll you/)).toBeVisible();
    await w.getByLabel("Your birth date").fill(bornYearsAgo(30));
    await continueTo(w, "About your game");
    await pickLevel(w, "Not sure", "Adult M");
    await continueTo(w, "Contact and safety");
    // Pickups are for juniors only.
    await expect(w.getByRole("button", { name: "Add a person" })).toHaveCount(0);
    await fillContact(w, "Sam Reyes");
    await continueTo(w, "Which month?");
    await toggle(w.getByRole("radio", { name: /^This month/ }));
    await continueTo(w, "Consent forms");
    // Adults sign the form for everyone; the parental one isn't theirs.
    await expect(w.getByRole("checkbox", { name: /Parental consent/ })).toHaveCount(0);
    await toggle(w.getByRole("checkbox", { name: /Waiver and release/ }));
    await expect(w.getByText(/for yourself/)).toBeVisible();
    await continueTo(w, "Check and send");
    await w.getByRole("button", { name: "Send request" }).click();
    await expect(w.getByRole("heading", { name: "Request sent" })).toBeVisible();

    const list = await seeded.api.get<EnrollmentListDto>("/enrollments");
    const item = list.items.find((i) => i.student.firstName === "Alex");
    expect(item).toMatchObject({
      submitter: { name: "Alex Reyes", relation: "self" },
      student: { isNew: true, minor: false },
      startMonth: setup.thisMonth,
    });
    const detail = await seeded.api.get<EnrollmentDetailDto>(`/enrollments/${item?.id}`);
    expect(detail.answers).toMatchObject({
      selfRating: null,
      selfRatingUnsure: true,
      shirtSize: "Adult M",
      emergencyName: "Sam Reyes",
    });
    expect(detail.consents.map((c) => [c.documentId, c.relation, c.signerName])).toEqual([
      [waiver.id, "self", "Alex Reyes"],
    ]);
    expect(detail.pickups).toEqual([]);

    // Approved: "Not sure" saves no rating; the portal shows the student as themself.
    await seeded.api.post(`/enrollments/${item?.id}/approve`, {});
    const progress = await seeded.api.get<ProgressDto>(
      `/clients/${detail.student.clientId}/progress`,
    );
    expect(progress.ratings).toEqual([]);
    const home = await portalGet<PortalHomeDto>(adult.context.request, "/home");
    expect(home.students.map((s) => [s.firstName, s.relation])).toEqual([["Alex", "self"]]);
  });

  test("a teen with their own login is sent to a parent, and the API refuses under-18s too", async ({
    seeded,
    personas,
  }, info) => {
    const setup = await openEnrollment(seeded, info);
    const teen = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Leo",
      lastName: "Cruz",
      birthDate: bornYearsAgo(15),
      isJunior: true,
    });
    const email = testEmail("enroll-teen", info);
    const linked = await linkFamily(seeded.request, {
      clientId: teen.id,
      email,
      name: "Leo Cruz",
      relation: "self",
      force: true,
    });
    expect(linked.status).toBe(201);
    const t = await personas.open({ email, name: "Leo Cruz", persona: "none" });
    await visit(t.page, `/a/${setup.slug}/enroll?package=${setup.monthly.id}`);
    await expect(
      t.page.getByRole("heading", { name: "Ask your parent or guardian" }),
    ).toBeVisible();
    await expect(t.page.getByText(/Ask your parent or guardian to enroll you/)).toBeVisible();
    await expect(t.page.getByRole("button", { name: "Continue" })).toHaveCount(0);

    const asSelf = await sendRequest(t.context.request, {
      slug: setup.slug,
      packageId: setup.monthly.id,
      who: { kind: "self" },
      startMonth: setup.nextMonth,
      answers: answersFor(),
    });
    expect([asSelf.status, codeOf(asSelf)]).toEqual([403, "ask_guardian"]);
    const asParent = await sendRequest(
      t.context.request,
      newChildBody(setup, { firstName: "Kai", birthDate: bornYearsAgo(9) }),
    );
    expect([asParent.status, codeOf(asParent)]).toEqual([403, "ask_guardian"]);

    // Someone new claiming to be under 18 can't enroll themself, and a "child" can't be an adult.
    const other = await personas.open({
      email: testEmail("enroll-young", info),
      name: "Max Lim",
      persona: "none",
    });
    const young = await sendRequest(other.context.request, {
      slug: setup.slug,
      packageId: setup.monthly.id,
      who: { kind: "self", firstName: "Max", birthDate: bornYearsAgo(16) },
      startMonth: setup.nextMonth,
      answers: answersFor(),
    });
    expect([young.status, codeOf(young)]).toEqual([403, "minor_self"]);
    const grown = await sendRequest(
      other.context.request,
      newChildBody(setup, { firstName: "Ana", birthDate: bornYearsAgo(20) }),
    );
    expect([grown.status, codeOf(grown)]).toEqual([403, "not_a_minor"]);
    const all = await seeded.api.get<EnrollmentListDto>("/enrollments?status=all");
    expect(all.items).toEqual([]);
  });

  test("a trial books the session the family picked", async ({ seeded, personas }, info) => {
    const setup = await openEnrollment(seeded, info);
    const sessions = await publicSessions(seeded.request, setup.slug, setup.program.id);
    expect(sessions.length).toBeGreaterThan(1);
    const picked = sessions[1];
    if (!picked) throw new Error("No second session");
    const parent = await personas.open({
      email: testEmail("enroll-trial", info),
      name: "Pat Santos",
      persona: "none",
    });
    const w = parent.page;
    await visit(w, `/a/${setup.slug}/enroll?package=${setup.trial.id}`);
    await chooseNewChild(w, { firstName: "Mia", lastName: "Santos", birthDate: bornYearsAgo(12) });
    await continueTo(w, "About Mia's game");
    await pickLevel(w, "2.0");
    await continueTo(w, "Contact and safety");
    await fillContact(w);
    await continueTo(w, "Which session?");
    await w.getByRole("button", { name: "Continue" }).click();
    await expect(w.getByText("Pick a session.")).toBeVisible();
    await toggle(w.getByRole("radio").nth(1));
    await continueTo(w, "Check and send");
    await w.getByRole("button", { name: "Send request" }).click();
    await expect(w.getByRole("heading", { name: "Request sent" })).toBeVisible();

    const item = (await seeded.api.get<EnrollmentListDto>("/enrollments")).items[0];
    expect(item?.mode).toBe("session");
    const detail = await seeded.api.get<EnrollmentDetailDto>(`/enrollments/${item?.id}`);
    expect(detail.period.session?.lessonId).toBe(picked.id);
    expect(detail.capacity?.kind).toBe("session");
    const approved = await seeded.api.post<EnrollmentDetailDto>(
      `/enrollments/${item?.id}/approve`,
      {},
    );
    expect(approved.status).toBe("approved");
    const lesson = await seeded.api.get<LessonDetailDto>(`/lessons/${picked.id}`);
    expect(lesson.roster.map((r) => [r.clientId, r.status])).toContainEqual([
      detail.student.clientId,
      "booked",
    ]);
    // A trial books that one session: the student isn't added to the program.
    const group = await seeded.api.get<GroupDetailDto>(`/groups/${setup.program.id}`);
    expect(group.members.map((m) => m.clientId)).not.toContain(detail.student.clientId);
    const after = await publicSessions(seeded.request, setup.slug, setup.program.id);
    if (picked.seatsLeft !== null) {
      expect(after.find((s) => s.id === picked.id)?.seatsLeft).toBe(picked.seatsLeft - 1);
    }
    const client = await seeded.api.get<ClientDetailDto>(`/clients/${detail.student.clientId}`);
    expect(client.packages.map((p) => [p.name, p.remaining])).toEqual([["Trial", 1]]);
  });
});

test.describe("deciding requests", () => {
  test("a request waitlisted with a note is approved later", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const setup = await openEnrollment(seeded, info);
    const parent = await personas.open({
      email: testEmail("enroll-wait", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, { firstName: "Mia", birthDate: bornYearsAgo(11) }),
    );
    await visit(page, `/enrollments/${sent.request.id}`);
    await expect(page.getByRole("heading", { name: "Waiting for you" })).toBeVisible();
    await page.getByRole("button", { name: "Waitlist" }).click();
    const sheet = page.getByRole("dialog", { name: "Waitlist Mia?" });
    await sheet
      .getByLabel("Note for the family (optional)")
      .fill("A place usually opens at the start of the month.");
    await submitSheet(sheet, sheet.getByRole("button", { name: "Waitlist" }));
    await expect(page.getByRole("heading", { name: "On the waitlist" })).toBeVisible();

    // The family sees it, and the academy's note.
    const theirs = await portalGet<PortalStudentEnrollmentsDto>(
      parent.context.request,
      `/students/${sent.clientId}/enrollments`,
    );
    expect(theirs.requests[0]).toMatchObject({
      status: "waitlisted",
      note: "A place usually opens at the start of the month.",
      canCancel: true,
    });
    await visit(parent.page, "/my");
    const card = parent.page.getByRole("article", { name: /^Monthly/ }).first();
    await expect(card).toContainText("Waitlisted");
    await expect(card).toContainText("A place usually opens at the start of the month.");

    // Later, from the Waitlisted list: approved.
    await visit(page, "/enrollments?status=waitlisted");
    await page.getByRole("link", { name: /Mia Santos/ }).click();
    await page.getByRole("button", { name: "Approve" }).click();
    const approve = page.getByRole("dialog", { name: "Approve Mia?" });
    await submitSheet(approve, approve.getByRole("button", { name: "Approve" }));
    await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();
    const after = await portalGet<PortalStudentEnrollmentsDto>(
      parent.context.request,
      `/students/${sent.clientId}/enrollments`,
    );
    expect(after.requests[0]).toMatchObject({ status: "approved", note: null, canCancel: false });
  });

  test("a declined request tells the family why", async ({ page, seeded, personas }, info) => {
    const setup = await openEnrollment(seeded, info);
    const parent = await personas.open({
      email: testEmail("enroll-decline", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, { firstName: "Mia", birthDate: bornYearsAgo(8) }),
    );
    await visit(page, `/enrollments/${sent.request.id}`);
    // The program is for 10 and up: staff are told, not stopped.
    await expect(page.getByRole("region", { name: "Decision" })).toContainText(/ages?/i);
    await page.getByRole("button", { name: "Decline" }).click();
    const sheet = page.getByRole("dialog", { name: "Decline Mia's request?" });
    await sheet.getByRole("button", { name: "Decline" }).click();
    await expect(sheet.getByText("Say why, so the family knows.")).toBeVisible();
    await sheet.getByLabel("Reason").fill("This program is for ages 10 and up.");
    await submitSheet(sheet, sheet.getByRole("button", { name: "Decline" }));
    await expect(page.getByRole("heading", { name: "Declined" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Decision" })).toContainText(
      "This program is for ages 10 and up.",
    );

    await visit(parent.page, "/my");
    const card = parent.page.getByRole("article", { name: /^Monthly/ }).first();
    await expect(card).toContainText("Declined");
    await expect(card).toContainText("This program is for ages 10 and up.");
    await expect(card.getByRole("button", { name: "Cancel request" })).toHaveCount(0);
    // A decided request can't be approved after all.
    const late = await seeded.api.raw("POST", `/enrollments/${sent.request.id}/approve`, {});
    expect(late.status).toBe(409);
  });

  test("the family cancels a request while it waits", async ({ seeded, personas }, info) => {
    const setup = await openEnrollment(seeded, info);
    const parent = await personas.open({
      email: testEmail("enroll-cancel", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, { firstName: "Mia", birthDate: bornYearsAgo(12) }),
    );
    const w = parent.page;
    await visit(w, "/my");
    const card = w.getByRole("article", { name: /^Monthly/ }).first();
    await card.getByRole("button", { name: "Cancel request" }).click();
    const confirm = w.getByRole("dialog", { name: "Cancel this request?" });
    await submitSheet(confirm, confirm.getByRole("button", { name: "Cancel request" }));
    await expect(card).toContainText("Cancelled");
    await expect(card).toContainText("You cancelled this request.");

    const again = await portalCall(
      parent.context.request,
      "POST",
      `/enrollments/${sent.request.id}/cancel`,
    );
    // Cancelling again changes nothing (a retried tap); approving it now is refused.
    expect(again.status).toBe(200);
    expect((again.json as { status: string }).status).toBe("cancelled");
    const approve = await seeded.api.raw("POST", `/enrollments/${sent.request.id}/approve`, {});
    expect(approve.status).toBe(409);
    const list = await seeded.api.get<EnrollmentListDto>("/enrollments");
    expect(list.counts).toMatchObject({ requested: 0, cancelled: 1 });
  });

  test("a second request for the same student, tier, and month is refused", async ({
    seeded,
    personas,
  }, info) => {
    const setup = await openEnrollment(seeded, info);
    const parent = await personas.open({
      email: testEmail("enroll-dup", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, { firstName: "Mia", birthDate: bornYearsAgo(12) }),
    );
    const repeat = await sendRequest(parent.context.request, {
      ...newChildBody(setup, { firstName: "Mia", birthDate: bornYearsAgo(12) }),
      who: { kind: "child", clientId: sent.clientId },
    });
    expect([repeat.status, codeOf(repeat)]).toEqual([409, "duplicate_request"]);
    // Resending the same request (a retry) isn't a duplicate: it answers with the one made.
    const retry = await sendRequest(parent.context.request, {
      ...newChildBody(setup, { firstName: "Mia", birthDate: bornYearsAgo(12) }),
      id: sent.request.id,
    });
    expect(retry.status).toBe(200);
    expect((retry.json as { replay: boolean }).replay).toBe(true);

    // The wizard says so before sending.
    const w = parent.page;
    await visit(w, `/a/${setup.slug}/enroll?package=${setup.monthly.id}`);
    await toggle(w.getByRole("radio", { name: /^Mia Santos/ }));
    await continueTo(w, "About Mia's game");
    await pickLevel(w, "2.5", "Kids S");
    await continueTo(w, "Contact and safety");
    await fillContact(w);
    await continueTo(w, "Which month?");
    await toggle(w.getByRole("radio", { name: /^Next month/ }));
    await expect(w.getByRole("note").filter({ hasText: "Already asked for" })).toContainText(
      "Mia already has a request for Monthly",
    );
    await w.getByRole("button", { name: "Continue" }).click();
    await expect(w.getByText("Pick another option, or check your portal.")).toBeVisible();
    // Another month is fine.
    await toggle(w.getByRole("radio", { name: /^This month/ }));
    await continueTo(w, "Check and send");
    const all = await seeded.api.get<EnrollmentListDto>("/enrollments?status=all");
    expect(all.items).toHaveLength(1);
  });

  test("with enrollment closed, new students are refused but renewing still works", async ({
    browser,
    seeded,
    personas,
  }, info) => {
    const setup = await openEnrollment(seeded, info);
    const parent = await personas.open({
      email: testEmail("enroll-closed", info),
      name: "Pat Santos",
      persona: "none",
    });
    // Mia already trains here this month.
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, {
        firstName: "Mia",
        birthDate: bornYearsAgo(12),
        startMonth: setup.thisMonth,
      }),
    );
    await seeded.api.post(`/enrollments/${sent.request.id}/approve`, {});
    await seeded.api.patch("/academy", { enrollmentOpen: false });

    // The page shows no Enroll buttons, and the wizard says it's closed.
    const visitor = await browser.newContext({ serviceWorkers: "block" });
    const v = await visitor.newPage();
    await visit(v, `/a/${setup.slug}`);
    await expect(v.getByText("Enrollment is closed for now").first()).toBeVisible();
    await expect(v.getByRole("link", { name: /^Enroll in/ })).toHaveCount(0);
    await visit(v, `/a/${setup.slug}/enroll?package=${setup.monthly.id}`);
    await expect(v.getByRole("heading", { name: "Enrollment is closed for now" })).toBeVisible();
    // And no passkey account can be started for it.
    const start = await visitor.request.post("/api/auth/passkey-account/start", {
      headers: { origin: new URL(v.url()).origin },
      data: { name: "Lee Cruz", enrollment: { slug: setup.slug } },
    });
    expect(start.status()).toBe(409);
    expect(((await start.json()) as { code?: string }).code).toBe("enrollment_closed");
    await visitor.close();

    // A new child is refused; Mia (already here) isn't.
    const fresh = await sendRequest(
      parent.context.request,
      newChildBody(setup, { firstName: "Leo", birthDate: bornYearsAgo(9) }),
    );
    expect([fresh.status, codeOf(fresh)]).toEqual([409, "enrollment_closed"]);
    await visit(parent.page, `/a/${setup.slug}/enroll?package=${setup.monthlyPlus.id}`);
    await expect(parent.page.getByRole("radio", { name: /^Add another child/ })).toBeDisabled();
    await expect(parent.page.getByRole("radio", { name: /^Mia Santos/ })).toBeEnabled();
    await expect(parent.page.getByRole("note").filter({ hasText: "closed for now" })).toBeVisible();

    // Renewing next month goes through.
    const renewed = await portalCall(
      parent.context.request,
      "POST",
      `/students/${sent.clientId}/renew`,
      {},
    );
    expect(renewed.status, renewed.text).toBe(201);
    expect(
      (renewed.json as { request: { startMonth: string; renewal: boolean } }).request,
    ).toMatchObject({
      startMonth: setup.nextMonth,
      renewal: true,
    });
  });

  test("a new student's request can be approved onto someone already training here", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const { api } = seeded;
    const setup = await openEnrollment(seeded, info);
    const { waiver, parental } = await addConsents(api);
    const birthDate = bornYearsAgo(12);
    const existing = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate,
      isJunior: true,
    });
    const parent = await personas.open({
      email: testEmail("enroll-link", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, {
        firstName: "Mia",
        birthDate,
        answers: { pickups: [{ name: "Lola Santos", relationship: "Grandmother", phone: "0917" }] },
        signatures: [waiver, parental].map((d) => ({
          documentId: d.id,
          version: d.version,
          signerName: "Pat Santos",
        })),
      }),
    );
    const leadId = sent.clientId;
    expect(leadId).not.toBe(existing.id);

    await visit(page, `/enrollments/${sent.request.id}`);
    await expect(page.getByRole("region", { name: "Student" })).toContainText(
      "already training here may be Mia",
    );
    await page.getByRole("button", { name: "Approve" }).click();
    const sheet = page.getByRole("dialog", { name: "Approve Mia?" });
    await sheet.getByRole("button", { name: /This is Mia Santos/ }).click();
    await expect(sheet).toContainText("This is Mia Santos, who already trains here");
    await expect(sheet).toContainText("Pat Santos will see Mia's record in their family portal");
    const confirm = sheet.getByRole("button", { name: "Link and approve" });
    await expect(confirm).toBeDisabled();
    await toggle(
      sheet.getByRole("checkbox", { name: /Pat Santos is Mia Santos's parent or guardian/ }),
    );
    await submitSheet(sheet, confirm);
    await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();

    // The request, signatures, pickups, and access moved to Mia's record; the lead is gone.
    const detail = await api.get<EnrollmentDetailDto>(`/enrollments/${sent.request.id}`);
    expect(detail.student.clientId).toBe(existing.id);
    expect(detail.student.isNew).toBe(false);
    expect(detail.pickups.map((p) => p.name)).toEqual(["Lola Santos"]);
    expect(detail.consents).toHaveLength(2);
    expect((await api.raw("GET", `/clients/${leadId}`)).status).toBe(404);
    const consents = await api.get<ClientConsentsDto>(`/clients/${existing.id}/consents`);
    expect(consents.missing).toBe(0);
    const access = await api.get<FamilyAccessDto>(`/clients/${existing.id}/family`);
    expect(access.links.map((l) => [l.name, l.relation])).toEqual([["Pat Santos", "guardian"]]);
    const client = await api.get<ClientDetailDto>(`/clients/${existing.id}`);
    expect(client.client.status).toBe("active");
    expect(client.packages).toHaveLength(1);
    // The family now sees Mia's own record.
    const home = await portalGet<PortalHomeDto>(parent.context.request, "/home");
    expect(home.students.map((s) => s.clientId)).toEqual([existing.id]);
  });
});
