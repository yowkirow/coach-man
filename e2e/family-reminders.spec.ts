import type {
  AnnouncementDto,
  EnrollmentDetailDto,
  FamilyNotificationsDto,
  GroupDto,
  LessonDetailDto,
  PaymentProofDto,
  PortalPaymentProofsDto,
  PushDeviceStateDto,
  TodayDto,
} from "../src/shared/api-types";
import { newChildBody, openEnrollment, sendOk } from "./enroll-support";
import { METHODS, PAY_INSTRUCTIONS, sendProofOk } from "./proof-support";
import {
  localParts,
  pushes,
  runReminders,
  type SinkPush,
  setFamilyPrefs,
  settle,
  sinkEndpoint,
  sinkOf,
  subscribeFamily,
  subscribeStaff,
  userIdOf,
} from "./push-support";
import {
  addMember,
  bornYearsAgo,
  type Coach,
  expect,
  linkFamily,
  type Personas,
  portalCall,
  portalGet,
  signIn,
  test,
  testEmail,
  toggle,
  uuid,
  visit,
  watchErrors,
} from "./support";

// Family reminders (WS5b): push notifications for students and parents (sessions, packages,
// enrollment and payments, coaches' comments and progress, announcements) and the staff alerts
// for new enrollment requests and payment proofs. Devices are registered with test-sink endpoints
// (`https://push-sink.invalid/…`): the Worker records each push instead of sending it, and the
// specs read what was recorded. Service workers are blocked (see family.spec.ts).
test.use({ serviceWorkers: "block" });

const MANILA = "Asia/Manila";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** A student, and a family member linked to them, signed in in their own browser. */
async function family(
  seeded: Coach,
  personas: Personas,
  info: import("@playwright/test").TestInfo,
  student: { firstName: string; lastName: string; age: number },
  member: { name: string; relation?: "guardian" | "self" } = { name: "Pat Santos" },
) {
  const kid = await seeded.api.post<{ id: string }>("/clients", {
    firstName: student.firstName,
    lastName: student.lastName,
    birthDate: bornYearsAgo(student.age),
    isJunior: student.age < 18,
  });
  const email = testEmail(`push-${student.firstName.toLowerCase()}`, info);
  const linked = await linkFamily(seeded.request, {
    clientId: kid.id,
    email,
    name: member.name,
    relation: member.relation ?? "guardian",
  });
  expect(linked.status).toBe(201);
  const userId = (linked.body as { userId: string }).userId;
  const session = await personas.open({ email, name: member.name, persona: "none" });
  return { clientId: kid.id, userId, ...session };
}

/** Pushes about one thing (by its tag). */
const tagged = (tag: string) => (p: SinkPush) => p.payload.tag === tag;

test.describe("family reminders", () => {
  test("enrollment decisions and payment proofs reach the parent, without amounts or reasons", async ({
    seeded,
    personas,
  }, info) => {
    test.skip(info.project.name !== "desktop", "An API flow: one browser is enough");
    test.slow();
    await seeded.api.patch("/workspace", { paymentMethods: METHODS });
    const setup = await openEnrollment(seeded, info, {
      name: "Riverside Pickleball Academy",
      paymentInstructions: PAY_INSTRUCTIONS,
    });
    const parent = await personas.open({
      email: testEmail("push-enroll", info),
      name: "Pat Santos",
      persona: "none",
    });
    const request = parent.context.request;
    const parentId = await userIdOf(request);
    await subscribeFamily(request);
    const sent = await sendOk(
      request,
      newChildBody(setup, {
        firstName: "Mia",
        lastName: "Santos",
        birthDate: bornYearsAgo(12),
        startMonth: setup.thisMonth,
      }),
    );
    const requestId = sent.request.id;

    // Approved: the push says so, and that something is owed (never how much); it opens Pay.
    const detail = await seeded.api.post<EnrollmentDetailDto>(
      `/enrollments/${requestId}/approve`,
      {},
    );
    expect(detail.payment?.dueMinor ?? 0).toBeGreaterThan(0);
    const clientId = detail.student.clientId;
    const [approved] = await pushes(seeded.request, parentId, tagged(`enrollment:${requestId}`));
    expect(approved?.surface).toBe("family");
    expect(approved?.payload.title).toBe("Enrollment approved");
    expect(approved?.payload.body).toContain("Mia is in Monthly");
    expect(approved?.payload.body).toContain("You have an amount due");
    expect(`${approved?.payload.title} ${approved?.payload.body}`).not.toMatch(/\d|₱|PHP|Santos/);
    expect(approved?.payload.url).toBe(`/my/${clientId}/pay?request=${requestId}`);

    // A proof confirmed.
    const today = setup.academy.today;
    const first = await sendProofOk(request, clientId, {
      amountMinor: 300000,
      method: "GCash",
      reference: "GC-7001",
      paidOn: today,
      enrollmentId: requestId,
    });
    await seeded.api.post(`/payment-proofs/${first.id}/confirm`, {});
    const [confirmed] = await pushes(seeded.request, parentId, (p) =>
      p.payload.tag.startsWith(`proof:${first.id}`),
    );
    expect(confirmed?.payload).toEqual({
      title: "Payment confirmed",
      body: "Riverside Pickleball Academy confirmed the payment for Mia.",
      url: `/my/${clientId}/payments`,
      tag: `proof:${first.id}`,
    });

    // A proof not accepted: the push never carries the academy's reason; the portal does.
    const second = await sendProofOk(request, clientId, {
      amountMinor: 300000,
      method: "GCash",
      reference: "GC-7002",
      paidOn: today,
      enrollmentId: requestId,
    });
    const REASON = "The reference number doesn't match our records";
    await seeded.api.post(`/payment-proofs/${second.id}/reject`, { reason: REASON });
    const [rejected] = await pushes(seeded.request, parentId, tagged(`proof:${second.id}`));
    expect(rejected?.payload.title).toBe("Payment proof not accepted");
    expect(rejected?.payload.url).toBe(`/my/${clientId}/payments`);
    expect(JSON.stringify(rejected?.payload)).not.toMatch(/reference number|records/);
    const proofs = await portalGet<PortalPaymentProofsDto>(
      request,
      `/students/${clientId}/payment-proofs`,
    );
    expect(proofs.proofs.find((p) => p.id === second.id)?.rejectReason).toBe(REASON);

    // The payment the confirmed proof recorded is voided.
    const staffView = await seeded.api.get<PaymentProofDto>(`/payment-proofs/${first.id}`);
    const paymentId = staffView.payment?.id as string;
    await seeded.api.post(`/payments/${paymentId}/void`, { reason: "Recorded twice" });
    const [voided] = await pushes(seeded.request, parentId, tagged(`payment:${paymentId}`));
    expect(voided?.payload.title).toBe("Payment voided");
    expect(JSON.stringify(voided?.payload)).not.toContain("twice");

    // Each went out once: approving again is a replay.
    await seeded.api.post(`/enrollments/${requestId}/approve`, {});
    await settle();
    const all = (await sinkOf(seeded.request, parentId)).items;
    expect(all.filter(tagged(`enrollment:${requestId}`))).toHaveLength(1);
    expect(all.filter((p) => p.payload.title === "Payment confirmed")).toHaveLength(1);
    expect(all.every((p) => p.payload.url.startsWith("/my"))).toBe(true);
  });

  test("shared comments and assessments notify the family; staff-only notes never do", async ({
    seeded,
    personas,
  }, info) => {
    test.skip(info.project.name !== "desktop", "An API flow: one browser is enough");
    const { api } = seeded;
    const fam = await family(seeded, personas, info, {
      firstName: "Leo",
      lastName: "Cruz",
      age: 10,
    });
    await subscribeFamily(fam.context.request);
    const { date: today } = await api.get<TodayDto>("/today");

    // A comment shared with the family: who shared it and about whom, never what it says.
    const shared = await api.post<{ id: string }>("/notes", {
      clientId: fam.clientId,
      body: "Great footwork today. Knee pain after the drill, so we stopped early.",
      visibility: "shared",
    });
    const [comment] = await pushes(seeded.request, fam.userId, tagged(`note:${shared.id}`));
    expect(comment?.payload).toEqual({
      title: "Coach Robin shared a comment",
      body: "About Leo's training. Open CoachMan to read it.",
      url: `/my/${fam.clientId}/progress`,
      tag: `note:${shared.id}`,
    });

    // Coaches-only notes, handoffs, edits, and unshared assessments stay quiet.
    const staffOnly = await api.post<{ id: string }>("/notes", {
      clientId: fam.clientId,
      body: "Staff only: tired today.",
      visibility: "staff",
    });
    await api.post("/notes", {
      clientId: fam.clientId,
      body: "Handoff: Leo is working on resets.",
      kind: "handoff",
    });
    await api.patch(`/notes/${shared.id}`, { body: "Great footwork today, and better resets." });
    const skills = await api.get<{ id: string }[]>("/skills");
    const scores = skills.slice(0, 2).map((s) => ({ skillId: s.id, score: 3 }));
    await api.post(`/clients/${fam.clientId}/assessments`, {
      assessedOn: today,
      scores,
      sharedWithFamily: false,
    });

    // A shared assessment, and a staff note switched to shared, do notify (once each).
    const assessmentId = uuid();
    await api.post(`/clients/${fam.clientId}/assessments`, {
      id: assessmentId,
      assessedOn: today,
      overallLevel: "2.5",
      scores,
      sharedWithFamily: true,
    });
    const [report] = await pushes(seeded.request, fam.userId, tagged(`assessment:${assessmentId}`));
    expect(report?.payload).toMatchObject({
      title: "Coach Robin shared a skills assessment",
      url: `/my/${fam.clientId}/progress`,
    });
    await api.patch(`/notes/${staffOnly.id}`, { visibility: "shared" });
    await pushes(seeded.request, fam.userId, tagged(`note:${staffOnly.id}`));
    await api.patch(`/notes/${staffOnly.id}`, { visibility: "staff" });
    await api.patch(`/notes/${staffOnly.id}`, { visibility: "shared" });
    await settle();
    const items = (await sinkOf(seeded.request, fam.userId)).items;
    expect(items.map((p) => p.payload.tag).sort()).toEqual(
      [`assessment:${assessmentId}`, `note:${shared.id}`, `note:${staffOnly.id}`].sort(),
    );
    expect(JSON.stringify(items)).not.toMatch(/Knee|tired|resets|Cruz/);
  });

  test("an announcement reaches the families of its program, and no one else", async ({
    seeded,
    personas,
  }, info) => {
    test.skip(info.project.name !== "desktop", "An API flow: one browser is enough");
    const { api } = seeded;
    const tag = uuid().slice(0, 6);
    const squad = await api.post<GroupDto>("/groups", { name: `Junior squad ${tag}` });
    const league = await api.post<GroupDto>("/groups", { name: `Adult league ${tag}` });
    const fam = await family(seeded, personas, info, {
      firstName: "Mia",
      lastName: "Santos",
      age: 11,
    });
    await subscribeFamily(fam.context.request);
    await api.patch(`/clients/${fam.clientId}`, { groupIds: [squad.id] });

    const elsewhere = await api.post<AnnouncementDto>("/announcements", {
      title: `League night moves to Friday ${tag}`,
      body: "See you on Friday.",
      audience: "program",
      audienceId: league.id,
      publish: "now",
    });
    const ours = await api.post<AnnouncementDto>("/announcements", {
      title: `Bring water on Saturday ${tag}`,
      body: "It will be hot on Saturday.\n\nWe'll take more breaks between drills.",
      audience: "program",
      audienceId: squad.id,
      publish: "now",
    });
    const [push] = await pushes(seeded.request, fam.userId, tagged(`announcement:${ours.id}`));
    expect(push?.payload).toEqual({
      title: ours.title,
      body: "It will be hot on Saturday.",
      url: "/my/announcements",
      tag: `announcement:${ours.id}`,
    });
    await settle();
    expect(
      (await sinkOf(seeded.request, fam.userId)).items.filter(
        tagged(`announcement:${elsewhere.id}`),
      ),
    ).toHaveLength(0);
  });

  test("session reminders come through the cron at the lead time; quiet hours and categories are respected", async ({
    seeded,
    personas,
  }, info) => {
    test.skip(info.project.name !== "desktop", "An API flow: one browser is enough");
    test.slow();
    const { api } = seeded;
    const fam = await family(seeded, personas, info, {
      firstName: "Ana",
      lastName: "Reyes",
      age: 11,
    });
    const request = fam.context.request;
    await subscribeFamily(request);

    // A session starting in 40 minutes: within the one-hour lead time.
    const { date, time } = localParts(Date.now() + 40 * 60_000, MANILA);
    const created = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "private",
      date,
      startTime: time,
      durationMinutes: 60,
      clientIds: [fam.clientId],
    });
    const lessonId = created.lesson.lesson.id;
    await runReminders(seeded.request, { steps: ["sessions"] });
    const [reminder] = await pushes(seeded.request, fam.userId, tagged(`session:${lessonId}`));
    expect(reminder?.payload.title).toMatch(/^Session (today|tomorrow) at \d{1,2}:\d{2}/);
    expect(reminder?.payload.body).toContain("Ana");
    expect(reminder?.payload.body).not.toContain("Reyes");
    expect(reminder?.payload.url).toBe(`/my/${fam.clientId}/schedule`);
    // Once per person per session.
    await runReminders(seeded.request, { steps: ["sessions"] });
    await settle(500);
    expect(
      (await sinkOf(seeded.request, fam.userId)).items.filter(tagged(`session:${lessonId}`)),
    ).toHaveLength(1);

    // Cancelled after the reminder: word that it's off, which replaces the reminder (same tag).
    await api.post(`/lessons/${lessonId}/cancel`, { reason: "Court maintenance" });
    const [cancelled] = await pushes(
      seeded.request,
      fam.userId,
      (p) => p.payload.title === "Session cancelled",
    );
    expect(cancelled?.payload.tag).toBe(`session:${lessonId}`);
    expect(JSON.stringify(cancelled?.payload)).not.toContain("maintenance");

    // Quiet hours (the academy's time) hold news back until they end.
    const now = Date.now();
    await setFamilyPrefs(request, {
      quietStart: localParts(now - 60 * 60_000, MANILA).time,
      quietEnd: localParts(now + 60 * 60_000, MANILA).time,
    });
    const held = await api.post<{ id: string }>("/notes", {
      clientId: fam.clientId,
      body: "Lovely serve today.",
      visibility: "shared",
    });
    let sendAfter = 0;
    await expect
      .poll(async () => {
        sendAfter =
          (await sinkOf(seeded.request, fam.userId)).queued.find((q) => q.refKey === held.id)
            ?.sendAfter ?? 0;
        return sendAfter;
      })
      .toBeGreaterThan(now);
    expect(
      (await sinkOf(seeded.request, fam.userId)).items.filter(tagged(`note:${held.id}`)),
    ).toHaveLength(0);
    await runReminders(seeded.request, { at: sendAfter + 1000, steps: ["queue"] });
    await pushes(seeded.request, fam.userId, tagged(`note:${held.id}`));

    // A category turned off: nothing now, nothing later.
    await setFamilyPrefs(request, { progress: false });
    const muted = await api.post<{ id: string }>("/notes", {
      clientId: fam.clientId,
      body: "Good session.",
      visibility: "shared",
    });
    await settle();
    const after = await sinkOf(seeded.request, fam.userId);
    expect(after.items.filter(tagged(`note:${muted.id}`))).toHaveLength(0);
    expect(after.queued.filter((q) => q.refKey === muted.id)).toHaveLength(0);
  });

  test("someone who is staff and family gets one push per event", async ({
    seeded,
    personas,
  }, info) => {
    test.skip(info.project.name !== "desktop", "An API flow: one browser is enough");
    test.slow();
    const { api } = seeded;
    const email = testEmail("push-both", info);
    const member = await addMember(seeded.request, { email, name: "Kim Reyes", role: "admin" });
    const kid = await api.post<{ id: string }>("/clients", {
      firstName: "Lia",
      lastName: "Reyes",
      birthDate: bornYearsAgo(9),
      isJunior: true,
    });
    const linked = await linkFamily(seeded.request, {
      clientId: kid.id,
      email,
      name: "Kim Reyes",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    expect((linked.body as { userId: string }).userId).toBe(member.userId);
    const both = await personas.open({ email, name: "Kim Reyes", persona: "none" });

    // One phone, turned on in the coach app and in the portal: one endpoint in both registries.
    const endpoint = sinkEndpoint();
    await subscribeStaff(both.api, endpoint);
    await subscribeFamily(both.context.request, {}, endpoint);
    const device = `/notifications/device?endpoint=${encodeURIComponent(endpoint)}`;
    expect(await portalGet<PushDeviceStateDto>(both.context.request, device)).toEqual({
      staff: true,
      family: true,
    });

    // Kim coaches Lia's session in 42 minutes: due as a coach (45 minutes ahead) and as a parent
    // (an hour ahead).
    await both.api.put("/notification-prefs", {
      sessionReminderMinutes: 45,
      dailyDigestTime: null,
      packageExpiryDays: 7,
    });
    const { date, time } = localParts(Date.now() + 42 * 60_000 + 30_000, MANILA);
    const created = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "private",
      date,
      startTime: time,
      durationMinutes: 60,
      clientIds: [kid.id],
      coachUserId: member.userId,
    });
    const lessonId = created.lesson.lesson.id;
    const aboutLesson = (p: SinkPush) =>
      p.payload.url.includes(lessonId) || p.payload.tag.includes(lessonId.slice(-12));
    await runReminders(seeded.request, { steps: ["staff", "sessions"] });
    await pushes(seeded.request, member.userId, aboutLesson);
    await runReminders(seeded.request, { steps: ["staff", "sessions"] });

    // Family news: a shared comment and an announcement.
    const tag = uuid().slice(0, 6);
    const note = await api.post<{ id: string }>("/notes", {
      clientId: kid.id,
      body: "Lia's backhand is coming along.",
      visibility: "shared",
    });
    const news = await api.post<AnnouncementDto>("/announcements", {
      title: `Holiday hours ${tag}`,
      body: "We're closed on the 25th.",
      audience: "all",
      publish: "now",
    });
    await pushes(seeded.request, member.userId, tagged(`note:${note.id}`));
    await pushes(seeded.request, member.userId, tagged(`announcement:${news.id}`));
    await settle();
    const items = (await sinkOf(seeded.request, member.userId)).items;
    expect(items.filter(aboutLesson)).toHaveLength(1);
    expect(items.filter(tagged(`note:${note.id}`))).toHaveLength(1);
    expect(items.filter(tagged(`announcement:${news.id}`))).toHaveLength(1);
    expect(new Set(items.map((p) => p.endpoint))).toEqual(new Set([endpoint]));

    // Turning family reminders off in the portal leaves coach notifications on (and says so).
    const off = await portalCall(both.context.request, "DELETE", "/notifications/devices", {
      endpoint,
    });
    expect(off.json).toEqual({ staff: true, family: false });
  });

  test("owners and admins hear about new enrollment requests and payment proofs; coaches don't", async ({
    seeded,
    personas,
  }, info) => {
    test.skip(info.project.name !== "desktop", "An API flow: one browser is enough");
    test.slow();
    await seeded.api.patch("/workspace", { paymentMethods: METHODS });
    const setup = await openEnrollment(seeded, info, { name: "Riverside Pickleball Academy" });
    const ownerId = await userIdOf(seeded.request);
    await subscribeStaff(seeded.api);

    const staff = async (role: "admin" | "coach", name: string) => {
      const email = testEmail(`push-${role}`, info);
      const added = await addMember(seeded.request, { email, name, role });
      const session = await personas.open({ email, name, persona: "none" });
      await subscribeStaff(session.api);
      return { ...added, ...session };
    };
    const admin = await staff("admin", "Ari Admin");
    const coach = await staff("coach", "Casey Coach");
    const quietAdmin = await staff("admin", "Quinn Admin");
    // "Enrollments & payments" off in the staff app's notification settings.
    await quietAdmin.api.put("/notification-prefs", {
      sessionReminderMinutes: 30,
      dailyDigestTime: null,
      packageExpiryDays: 7,
      enrollmentAlerts: false,
    });

    const parent = await personas.open({
      email: testEmail("push-applicant", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, {
        firstName: "Mia",
        lastName: "Santos",
        birthDate: bornYearsAgo(12),
        startMonth: setup.thisMonth,
      }),
    );
    const isRequest = tagged(`staff-enrollment:${sent.request.id}`);
    const [toOwner] = await pushes(seeded.request, ownerId, isRequest);
    expect(toOwner?.surface).toBe("staff");
    expect(toOwner?.payload).toMatchObject({
      title: "New enrollment request",
      url: `/enrollments/${sent.request.id}`,
    });
    expect(toOwner?.payload.body).toContain("Mia");
    expect(toOwner?.payload.body).not.toContain("Santos");
    await pushes(seeded.request, admin.userId, isRequest);

    const detail = await seeded.api.post<EnrollmentDetailDto>(
      `/enrollments/${sent.request.id}/approve`,
      {},
    );
    const proof = await sendProofOk(parent.context.request, detail.student.clientId, {
      amountMinor: 600000,
      method: "GCash",
      reference: "GC-8801",
      paidOn: setup.academy.today,
      enrollmentId: sent.request.id,
    });
    const isProof = tagged(`staff-proof:${proof.id}`);
    const [proofToOwner] = await pushes(seeded.request, ownerId, isProof);
    expect(proofToOwner?.payload).toMatchObject({
      title: "Payment proof to review",
      url: "/money",
    });
    expect(`${proofToOwner?.payload.title} ${proofToOwner?.payload.body}`).not.toMatch(/\d/);
    await pushes(seeded.request, admin.userId, isProof);

    await settle();
    expect((await sinkOf(seeded.request, coach.userId)).items).toEqual([]);
    expect((await sinkOf(seeded.request, quietAdmin.userId)).items).toEqual([]);
  });

  test("the Notifications page renders and saves; a laptop turns reminders on, tests, and off", async ({
    seeded,
    personas,
    browser,
  }, info) => {
    test.slow();
    const fam = await family(seeded, personas, info, {
      firstName: "Noa",
      lastName: "Lim",
      age: 12,
    });
    const desktop = info.project.name === "desktop";
    const endpoint = sinkEndpoint();
    if (desktop) {
      // A stand-in for the browser's push service (service workers are blocked in tests): the
      // page subscribes to a sink endpoint, and notifications are allowed.
      await fam.context.grantPermissions(["notifications"]);
      await fam.context.addInitScript(fakePush, endpoint);
    }
    const page = fam.page;
    const errors = watchErrors(page);

    // Home offers reminders once; "Not now" puts it away for good.
    await visit(page, "/my");
    const offer = page.getByRole("region", { name: /^Get reminders on this (phone|computer)$/ });
    await expect(offer).toBeVisible();
    await offer.getByRole("button", { name: "Not now" }).click();
    await expect(offer).toHaveCount(0);
    await visit(page, "/my");
    await expect(page.getByRole("heading", { name: "Hi, Pat" })).toBeVisible();
    await expect(offer).toHaveCount(0);

    await visit(page, "/my/notifications");
    await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    const what = page.getByRole("region", { name: "What you get" });
    const quiet = page.getByRole("region", { name: "Quiet hours" });
    for (const label of [
      /^Sessions/,
      /^Packages & renewals/,
      /^Enrollment & payments/,
      /^Coach comments & progress/,
      /^Announcements/,
    ]) {
      await expect(what.getByRole("switch", { name: label })).toBeChecked();
    }
    await expect(what.getByRole("radio", { name: "1 hour before" })).toBeChecked();
    await expect(quiet.getByLabel("From", { exact: true })).toHaveValue("21:00");
    await expect(quiet.getByLabel("Until", { exact: true })).toHaveValue("07:00");

    // Changes save as they're made.
    await toggle(what.getByRole("switch", { name: /^Announcements/ }));
    await expect(what.getByText("Saved")).toBeVisible();
    await toggle(what.getByRole("radio", { name: "2 hours before" }));
    await expect(what.getByText("Saved")).toBeVisible();
    await quiet.getByLabel("From", { exact: true }).fill("22:30");
    await expect(quiet.getByText("Saved")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await portalGet<FamilyNotificationsDto>(fam.context.request, "/notifications")).prefs,
      )
      .toMatchObject({
        announcements: false,
        sessionLead: "2h",
        quietStart: "22:30",
        quietEnd: "07:00",
        sessions: true,
      });
    await visit(page, "/my/notifications");
    await expect(what.getByRole("switch", { name: /^Announcements/ })).not.toBeChecked();
    await expect(what.getByRole("radio", { name: "2 hours before" })).toBeChecked();
    await expect(quiet.getByLabel("From", { exact: true })).toHaveValue("22:30");

    const device = page.getByRole("region", { name: "This device" });
    if (desktop) {
      await expect(device.getByText("Off for this device.")).toBeVisible();
      await device.getByRole("button", { name: "Turn on" }).click();
      await expect(device.getByText(/^On for this device\./)).toBeVisible();
      await device.getByRole("button", { name: "Send a test notification" }).click();
      const [sample] = await pushes(seeded.request, fam.userId, tagged("test"));
      expect(sample?.endpoint).toBe(endpoint);
      expect(sample?.payload).toMatchObject({
        title: "Reminders are on",
        url: "/my/notifications",
      });
      await device.getByRole("button", { name: "Turn off" }).click();
      await expect(device.getByText("Off for this device.")).toBeVisible();
      expect(
        await portalGet<PushDeviceStateDto>(
          fam.context.request,
          `/notifications/device?endpoint=${encodeURIComponent(endpoint)}`,
        ),
      ).toEqual({ staff: false, family: false });
    } else {
      await expect(device.getByRole("button", { name: "Turn on" })).toBeVisible();
    }
    expect(errors).toEqual([]);

    // On an iPhone in Safari, the page explains Add to Home Screen before anything else.
    const iphone = await browser.newContext({
      serviceWorkers: "block",
      userAgent: IPHONE_UA,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      await signIn(iphone.request, { email: fam.email, name: "Pat Santos", persona: "none" });
      const phone = await iphone.newPage();
      const phoneErrors = watchErrors(phone);
      await visit(phone, "/my/notifications");
      const steps = phone.getByRole("list", { name: "Add CoachMan to your Home Screen" });
      await expect(steps).toBeVisible();
      await expect(steps.getByText("Tap Share, then Add to Home Screen.")).toBeVisible();
      await expect(phone.getByText(/needs iOS 16\.4 or later/)).toBeVisible();
      await expect(phone.getByRole("button", { name: "Turn on" })).toHaveCount(0);
      expect(phoneErrors).toEqual([]);
    } finally {
      await iphone.close();
    }
  });
});

/**
 * Runs in the page before the app: a push subscription the page can make and drop, at a sink
 * endpoint, standing in for the browser's push service.
 */
function fakePush(endpoint: string) {
  let current: unknown = null;
  const subscription = {
    endpoint,
    expirationTime: null,
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: "BTestP256dhKeyForTheSinkOnly", auth: "testAuthSecret" },
    }),
    unsubscribe: async () => {
      current = null;
      return true;
    },
  };
  const registration = {
    pushManager: {
      getSubscription: async () => current,
      subscribe: async () => {
        current = subscription;
        return subscription;
      },
    },
  };
  const container = navigator.serviceWorker;
  if (!container) return;
  Object.defineProperty(container, "ready", {
    configurable: true,
    get: () => Promise.resolve(registration),
  });
  Object.defineProperty(container, "getRegistration", {
    configurable: true,
    value: async () => registration,
  });
}
