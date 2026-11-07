import type {
  AcademyDto,
  ConsentDocumentDto,
  GroupDto,
  LessonDetailDto,
  MeDto,
  PackageTemplateDto,
  PortalHomeDto,
  PortalMoneyDto,
  PortalPaymentProofsDto,
  PortalProgressDto,
  ProgressDto,
  TodayDto,
} from "../src/shared/api-types";
import { chooseNewChild, continueTo, fillContact, pickLevel } from "./enroll-support";
import { screenshot } from "./proof-support";
import {
  pushes,
  type SinkPush,
  sinkOf,
  subscribeFamily,
  subscribeStaff,
  userIdOf,
} from "./push-support";
import {
  bornYearsAgo,
  expect,
  inviteToken,
  portalGet,
  signIn,
  submitSheet,
  test,
  testEmail,
  toggle,
  uuid,
  visit,
  watchErrors,
} from "./support";

// The academy journey: the whole product story, end to end, with real people in their own
// browsers. An owner sets up the academy and its page, publishes a program with three tiers and a
// consent form, and invites a coach; a parent finds the page and enrolls a new child; the owner
// approves; the parent pays with a screenshot and the owner confirms it; the coach checks the
// child in and writes a shared comment and a handoff note; the parent sees the session, the
// credits, and the comment (never the handoff note), and renews for next month. Pushes land in the
// test sink at each moment that matters.
//
// It runs against a deployed environment too (E2E_BASE_URL, with the test bypass and its secret
// set there): it signs in only through /api/test/sign-in, reads pushes through /api/test/push-sink,
// and everything it makes is new for this run and deleted with the owner's academy at the end.

test.use({ serviceWorkers: "block" });

/** Pushes about one thing, by tag. */
const tagged = (tag: string) => (p: SinkPush) => p.payload.tag === tag;

test(
  "an academy's whole story, from setup to renewal",
  { tag: ["@journey", "@smoke"] },
  async ({ browser, personas }, info) => {
    test.setTimeout(10 * 60_000);
    const run = uuid().slice(0, 6);
    const academyName = `Riverside Pickleball ${run}`;
    const slug = `journey-${info.project.name}-${run}`;
    // Only the handoff note carries this marker: it must never reach the family.
    const handoffMark = uuid().replace(/-/g, "").slice(0, 12);
    const HANDOFF = `Handoff ${handoffMark}: Mia is working on her third-shot drop; her knee was sore today.`;
    const COMMENT = "Mia kept her resets low all session. Great footwork!";

    // The people. Each has their own browser; the parent starts signed out.
    const owner = await personas.open({
      email: testEmail("journey-owner", info),
      name: "Robin Reyes",
      persona: "coach",
    });
    const coachEmail = testEmail("journey-coach", info);
    const parentEmail = testEmail("journey-parent", info);
    const visitor = await browser.newContext({ serviceWorkers: "block" });
    const family = await visitor.newPage();
    const ownerErrors = watchErrors(owner.page);
    const familyErrors = watchErrors(family);
    const parentApi = visitor.request;
    const o = owner.page;

    try {
      await owner.api.post("/workspace/onboard", {
        name: academyName,
        currency: "PHP",
        timezone: "Asia/Manila",
        locale: "en-PH",
        withSampleData: false,
      });
      await owner.api.patch("/workspace", { paymentMethods: ["GCash", "Bank transfer", "Cash"] });
      const ownerId = (await owner.api.get<MeDto>("/me")).user.id;
      await subscribeStaff(owner.api);

      await test.step("1. The owner sets up the academy profile and its address, lists it, and opens enrollment", async () => {
        await visit(o, "/settings");
        const profile = o.getByRole("region", { name: "Academy profile" });
        await expect(profile.getByLabel("Academy name")).toHaveValue(academyName);
        await profile.getByLabel("Tagline").fill("No noise, all game");
        await profile.getByLabel("Public address").fill(slug);
        await profile
          .getByLabel("How to pay")
          .fill(
            "GCash 0917 555 0142 (Riverside). Send the screenshot in CoachMan once you've paid.",
          );
        for (const name of ["Show the academy page", "Take enrollment requests"]) {
          const control = profile.getByRole("switch", { name });
          await toggle(control);
          await expect(control).toBeChecked();
        }
        await profile.getByRole("button", { name: "Save changes" }).click();
        await expect(o.getByText("Academy profile saved")).toBeVisible();
        const academy = await owner.api.get<AcademyDto>("/academy");
        expect(academy).toMatchObject({ slug, listed: true, enrollmentOpen: true });
      });

      const program =
        await test.step("2. The owner publishes a program with three tiers, and a required consent form", async () => {
          const made = await owner.api.post<GroupDto>("/groups", {
            name: "Evening program",
            level: "All levels",
            capacity: 16,
            scheduleNote: "Tue & Thu, 7–10pm",
            publicDescription: "Three hours of drills and games under the lights.",
          });
          const tier = (body: Record<string, unknown>) =>
            owner.api.post<PackageTemplateDto>("/packages", {
              programId: made.id,
              isPublic: true,
              ...body,
            });
          await tier({
            name: "Trial",
            credits: 1,
            priceMinor: 150000,
            validityDays: 30,
            sessionsLabel: "1 session",
            audience: "First-timers",
            inclusions: ["One coached session", "Court fee included"],
          });
          await tier({
            name: "Monthly",
            credits: 6,
            priceMinor: 600000,
            validityMode: "month_end",
            sessionsLabel: "4–6 sessions",
            inclusions: ["Three-hour coached sessions", "Court fees included", "Training uniform"],
            includesUniform: true,
            asksSelfRating: true,
          });
          await tier({
            name: "Monthly plus",
            credits: 9,
            priceMinor: 700000,
            validityMode: "month_end",
            sessionsLabel: "7–9 sessions",
            commitmentNote: "Best over at least 2 months",
            highlight: true,
          });

          // The program goes on the academy page from Packages → Academy page.
          await visit(o, "/packages?tab=public");
          const card = o.getByRole("region", { name: "Evening program", exact: true });
          const published = card.getByRole("switch", {
            name: "Public: Evening program on the academy page",
          });
          await toggle(published);
          await expect(published).toBeChecked();
          // The switch flips at once; wait for the server to confirm before the page reloads, or
          // a slower network (a deployed environment) loses the save mid-flight.
          await expect(o.getByText("Evening program is on your academy page")).toBeVisible();
          await expect(
            o.getByRole("list", { name: "Evening program tiers" }).getByRole("listitem"),
          ).toHaveCount(3);

          // Settings → Consent forms: the starter waiver, switched on.
          await visit(o, "/settings");
          const forms = o.getByRole("region", { name: "Consent forms" });
          await forms.getByRole("button", { name: "Start from a template" }).click();
          await o
            .getByRole("dialog", { name: "Start from a template" })
            .getByRole("button", { name: "Add Activity waiver and release" })
            .click();
          const editor = o.getByRole("dialog", { name: "Edit consent form" });
          const active = editor.getByRole("switch", { name: /^Active/ });
          await toggle(active);
          await expect(active).toBeChecked();
          await submitSheet(editor, editor.getByRole("button", { name: "Save", exact: true }));
          await expect(
            forms.getByRole("listitem").filter({ hasText: "Activity waiver and release" }),
          ).toContainText("Active");
          const docs = await owner.api.get<ConsentDocumentDto[]>("/consent-documents");
          expect(docs.map((d) => [d.title, d.required, d.active])).toEqual([
            ["Activity waiver and release", true, true],
          ]);
          return made;
        });

      const coach =
        await test.step("3. The owner invites a coach, who joins through the link", async () => {
          await visit(o, "/team");
          await o.getByRole("button", { name: "Invite someone" }).first().click();
          const form = o.getByRole("dialog", { name: "Invite someone" });
          await form.getByLabel("Their Google email").fill(coachEmail);
          await expect(form.getByRole("radio", { name: /^Coach/ })).toBeChecked();
          await form.getByRole("button", { name: "Create invite link" }).click();
          const ready = o.getByRole("dialog", { name: "Invite link ready" });
          const link = await ready.getByLabel("Invite link").inputValue();
          await ready.getByRole("button", { name: "Done" }).click();

          const sam = await personas.open({
            email: coachEmail,
            name: "Sam Rivera",
            persona: "none",
          });
          await visit(sam.page, `/join/${inviteToken(link)}`);
          await expect(sam.page.getByText("You'll join as a coach.")).toBeVisible();
          await sam.page.getByRole("button", { name: `Join ${academyName}` }).click();
          await expect(
            sam.page.getByRole("heading", { name: "Today", exact: true }).first(),
          ).toBeVisible();
          const me = await sam.api.get<MeDto>("/me");
          expect([me.role, me.workspace.name, me.can.money]).toEqual(["coach", academyName, false]);
          await subscribeStaff(sam.api);
          // Sam leads the program, so its new students are Sam's.
          await owner.api.patch(`/groups/${program.id}`, { coachUserId: me.user.id });
          return { ...sam, userId: me.user.id };
        });

      await test.step("4. A parent finds the academy page and enrolls a new child in Monthly", async () => {
        await visit(family, `/a/${slug}`);
        // The academy's name leads, its own line under it.
        await expect(family.getByRole("heading", { level: 1 })).toHaveText(academyName);
        await expect(family.getByRole("main")).toContainText("No noise, all game");
        // The landing page leads to Enroll now, where the packages from the admin site wait.
        await family.getByRole("main").getByRole("link", { name: "Enroll now" }).first().click();
        await expect(family).toHaveURL(new RegExp(`/a/${slug}/enroll$`));
        for (const tier of ["Trial", "Monthly", "Monthly plus"]) {
          await expect(family.getByRole("article", { name: tier, exact: true })).toBeVisible();
        }
        await family.getByRole("link", { name: "Enroll in Monthly", exact: true }).click();
        await expect(family.getByRole("heading", { name: "Sign in to enroll" })).toBeVisible();
        // Google can't be automated: the test sign-in stands in for it, then the wizard comes back.
        await signIn(parentApi, { email: parentEmail, name: "Pat Santos", persona: "none" });
        await subscribeFamily(parentApi);
        const wizard = new URL(family.url());
        expect(wizard.pathname).toBe(`/a/${slug}/enroll`);
        await visit(family, `${wizard.pathname}${wizard.search}`);
        await expect(family.getByRole("heading", { name: "Who's training?" })).toBeVisible();
        await chooseNewChild(family, {
          firstName: "Mia",
          lastName: "Santos",
          birthDate: bornYearsAgo(12),
        });
        await continueTo(family, "About Mia's game");
        await pickLevel(family, "3.0", "Kids M");
        await continueTo(family, "Contact and safety");
        await fillContact(family);
        await continueTo(family, "Which month?");
        const thisMonth = family.getByRole("radio", { name: /^This month/ });
        await toggle(thisMonth);
        await expect(thisMonth).toBeChecked();
        await continueTo(family, "Consent forms");
        await toggle(family.getByRole("checkbox", { name: /Activity waiver and release/ }));
        await expect(family.getByLabel("Type your full name to sign")).toHaveValue("Pat Santos");
        await continueTo(family, "Check and send");
        await family.getByRole("button", { name: "Send request" }).click();
        await expect(family.getByRole("heading", { name: "Request sent" })).toBeVisible();
        await family.getByRole("button", { name: "See it in My family" }).click();
        await expect(family).toHaveURL(/\/my\/?$/);
        await expect(family.getByRole("article", { name: /^Monthly/ }).first()).toContainText(
          "Requested",
        );
      });

      const home = await portalGet<PortalHomeDto>(parentApi, "/home");
      const mia = home.students[0];
      const requestId = home.enrollments?.[0]?.id ?? "";
      if (!mia || !requestId) throw new Error("The request didn't reach the portal");
      const parentId = await userIdOf(parentApi);

      await test.step("…and the request is in the owner's inbox, with a push", async () => {
        const [alert] = await pushes(
          owner.context.request,
          ownerId,
          tagged(`staff-enrollment:${requestId}`),
        );
        expect(alert?.payload).toMatchObject({
          title: "New enrollment request",
          url: `/enrollments/${requestId}`,
        });
        await visit(o, "/enrollments");
        await o.getByRole("link", { name: /Mia Santos/ }).click();
        await expect(o.getByRole("heading", { level: 1, name: "Mia Santos" })).toBeVisible();
        await expect(o.getByRole("region", { name: "Consents" })).toContainText(
          "Activity waiver and release",
        );
      });

      await test.step("5. The owner approves it", async () => {
        await o.getByRole("button", { name: "Approve" }).click();
        const sheet = o.getByRole("dialog", { name: "Approve Mia?" });
        await expect(sheet).toContainText("Adds Mia to Evening program");
        await submitSheet(sheet, sheet.getByRole("button", { name: "Approve" }));
        await expect(o.getByRole("heading", { name: "Approved" })).toBeVisible();
        await expect(o.getByRole("region", { name: "Payment" })).toContainText("Unpaid");
        const [approved] = await pushes(
          owner.context.request,
          parentId,
          tagged(`enrollment:${requestId}`),
        );
        expect(approved?.payload.title).toBe("Enrollment approved");
        expect(`${approved?.payload.title} ${approved?.payload.body}`).not.toMatch(/\d|₱|PHP/);
      });

      await test.step("6. The parent pays with a screenshot; the owner confirms; nothing is owed", async () => {
        await visit(family, "/my");
        const request = family.getByRole("article", { name: /^Monthly/ }).first();
        await expect(request).toContainText("Approved");
        await expect(request).toContainText("Unpaid");
        await request.getByRole("link", { name: /^Pay ₱6,000/ }).click();
        await expect(family).toHaveURL((u) => u.pathname === `/my/${mia.clientId}/pay`);
        await family.getByLabel("Screenshot of the payment").setInputFiles({
          name: "gcash.png",
          mimeType: "image/png",
          buffer: screenshot(),
        });
        await expect(family.getByText("Ready to send")).toBeVisible();
        await expect(family.getByLabel("Amount paid")).toHaveValue("6000.00");
        await family.getByRole("button", { name: /Paid with/ }).click();
        await family.getByRole("option", { name: "GCash", exact: true }).click();
        await family.getByLabel("Reference number").fill(`GC-${run}-0001`);
        await family.getByRole("button", { name: "Send proof" }).click();
        await expect(family).toHaveURL((u) => u.pathname === `/my/${mia.clientId}/payments`);
        await expect(family.getByRole("region", { name: "Payment proofs" })).toContainText(
          "Pending review",
        );
        const proofs = await portalGet<PortalPaymentProofsDto>(
          parentApi,
          `/students/${mia.clientId}/payment-proofs`,
        );
        const proofId = proofs.proofs[0]?.id ?? "";
        await pushes(owner.context.request, ownerId, tagged(`staff-proof:${proofId}`));

        await visit(o, "/money");
        const queue = o.getByRole("region", { name: "Payments to review" });
        const item = queue.getByRole("article", { name: /Mia Santos/ });
        await expect(item).toContainText(`Ref GC-${run}-0001`);
        await item.getByRole("button", { name: "Confirm" }).click();
        const confirm = o.getByRole("dialog", { name: "Confirm Mia's payment" });
        await submitSheet(confirm, confirm.getByRole("button", { name: /^Record ₱6,000/ }));
        await expect(queue).toContainText("Nothing to review.");
        const [paid] = await pushes(owner.context.request, parentId, (p) =>
          p.payload.tag.startsWith(`proof:${proofId}`),
        );
        expect(paid?.payload.title).toBe("Payment confirmed");

        await visit(family, `/my/${mia.clientId}/payments`);
        await expect(family.getByRole("region", { name: "Balance" })).toContainText("₱0.00");
        await expect(family.getByRole("region", { name: "Payment proofs" })).toContainText(
          "Confirmed",
        );
        const money = await portalGet<PortalMoneyDto>(parentApi, `/students/${mia.clientId}/money`);
        expect(money.balanceMinor).toBe(0);
      });

      const commentId =
        await test.step("7. The coach finds Mia under My students, checks her in, and writes a shared comment and a handoff note", async () => {
          const c = coach.page;
          const coachErrors = watchErrors(c);
          await visit(c, "/clients?mine=1");
          await expect(c.getByText("Mia Santos").first()).toBeVisible();
          const { date } = await coach.api.get<TodayDto>("/today");
          const session = await coach.api.post<{ lesson: LessonDetailDto }>("/lessons", {
            kind: "group",
            groupId: program.id,
            date,
            startTime: "06:00",
            durationMinutes: 180,
          });
          await visit(c, `/sessions/${session.lesson.lesson.id}`);
          await expect(
            c.getByRole("button", { name: /^Mia Santos: Booked\. 6 of 6 left · Monthly\./ }),
          ).toBeVisible();
          await c.getByRole("button", { name: "Check in Mia Santos", exact: true }).click();
          await expect(
            c.getByRole("button", { name: /^Mia Santos: Checked in\. 5 of 6 left · Monthly\./ }),
          ).toBeVisible();
          // Check-in shows at once (it works offline); wait for the server to record it before the
          // page reloads, so a slower network can't lose it mid-flight.
          await expect
            .poll(async () => {
              const detail = await coach.api.get<LessonDetailDto>(
                `/lessons/${session.lesson.lesson.id}`,
              );
              return detail.roster.find((r) => r.clientId === mia.clientId)?.status;
            })
            .toBe("present");
          expect(await c.locator("body").innerText()).not.toContain("₱");

          await visit(c, `/clients/${mia.clientId}?tab=progress`);
          const timeline = c.getByRole("region", { name: "Coaching timeline" });
          await timeline.getByLabel("Note about Mia").fill(COMMENT);
          const share = timeline.getByRole("switch", { name: "Share with student & parents" });
          await toggle(share);
          await expect(share).toBeChecked();
          await timeline.getByRole("button", { name: "Save and share" }).click();
          await expect(timeline.getByText("Shared with family")).toHaveCount(1);
          // The note shows at once (it works offline); wait for the server to have it before the
          // page reloads, so a slower network can't lose it mid-flight.
          await expect
            .poll(async () =>
              (await coach.api.get<ProgressDto>(`/clients/${mia.clientId}/progress`)).notes.some(
                (n) => n.visibility === "shared" && n.body === COMMENT,
              ),
            )
            .toBe(true);

          // Sam hands Mia to Robin, with a note for the next coach.
          await visit(c, `/clients/${mia.clientId}`);
          const coaches = c.getByRole("region", { name: "Coaches" });
          await coaches.getByRole("button", { name: "Change" }).click();
          const sheet = c.getByRole("dialog", { name: "Mia's coaches" });
          await sheet.getByRole("button", { name: /Primary coach/ }).click();
          await c.getByRole("option", { name: /Robin Reyes/ }).click();
          await sheet.getByRole("button", { name: "Save coaches" }).click();
          const prompt = c.getByRole("dialog", { name: "Write a handoff note?" });
          await expect(prompt).toContainText("Mia moves from you to Robin Reyes");
          await prompt.getByLabel("Handoff note").fill(HANDOFF);
          await prompt.getByRole("button", { name: "Save handoff note" }).click();
          await expect(prompt).toBeHidden();
          let shared = "";
          await expect
            .poll(async () => {
              const notes = (await owner.api.get<ProgressDto>(`/clients/${mia.clientId}/progress`))
                .notes;
              shared = notes.find((n) => n.visibility === "shared")?.id ?? "";
              return notes.map((n) => [n.kind, n.visibility, n.author?.name]).sort();
            })
            .toEqual(
              [
                ["comment", "shared", "Sam Rivera"],
                ["handoff", "staff", "Sam Rivera"],
              ].sort(),
            );
          expect(coachErrors).toEqual([]);
          return shared;
        });

      await test.step("8. The parent sees the session, the credits left, and the comment, never the handoff note", async () => {
        const [push] = await pushes(owner.context.request, parentId, tagged(`note:${commentId}`));
        expect(push?.payload.title).toBe("Coach Sam shared a comment");

        await visit(family, `/my/${mia.clientId}/schedule`);
        await expect(
          family.getByRole("listitem").filter({ hasText: "Evening program" }).first(),
        ).toContainText("Checked in");
        await visit(family, "/my");
        await expect(
          family.getByRole("link", { name: "Credits: 5 of 6 left. Open packages and payments." }),
        ).toBeVisible();
        await visit(family, `/my/${mia.clientId}/progress`);
        await expect(family.getByText(COMMENT)).toBeVisible();
        await family.waitForLoadState("networkidle");
        expect(await family.content()).not.toContain(handoffMark);

        const progress = await portalGet<PortalProgressDto>(
          parentApi,
          `/students/${mia.clientId}/progress`,
        );
        expect(progress.comments.map((c) => [c.body, c.author?.name])).toEqual([
          [COMMENT, "Sam Rivera"],
        ]);
        for (const path of [
          "/home",
          `/students/${mia.clientId}`,
          `/students/${mia.clientId}/progress`,
        ]) {
          expect(JSON.stringify(await portalGet(parentApi, path)), path).not.toContain(handoffMark);
        }
      });

      await test.step("9. The parent renews for next month in one tap; the owner approves the renewal", async () => {
        await visit(family, "/my");
        const offer = family.getByRole("region", { name: /^Renew for/ });
        await expect(offer).toContainText("Monthly");
        await offer.getByRole("button", { name: "Renew for next month" }).click();
        await expect(offer).toHaveCount(0);
        await expect(
          family.getByRole("article").filter({ hasText: "Renewal" }).first(),
        ).toContainText("Requested");
        const renewal = (await portalGet<PortalHomeDto>(parentApi, "/home")).enrollments?.find(
          (r) => r.renewal,
        );
        if (!renewal) throw new Error("No renewal on the parent's home");
        await pushes(owner.context.request, ownerId, tagged(`staff-enrollment:${renewal.id}`));

        await visit(o, "/enrollments");
        await o.getByRole("link", { name: /Mia Santos/ }).click();
        await expect(o.getByRole("heading", { level: 1, name: "Mia Santos" })).toBeVisible();
        await o.getByRole("button", { name: "Approve" }).click();
        const sheet = o.getByRole("dialog", { name: "Approve Mia?" });
        await submitSheet(sheet, sheet.getByRole("button", { name: "Approve" }));
        await expect(o.getByRole("heading", { name: "Approved" })).toBeVisible();
        await pushes(owner.context.request, parentId, tagged(`enrollment:${renewal.id}`));
        await visit(family, "/my");
        await expect(
          family.getByRole("article").filter({ hasText: "Renewal" }).first(),
        ).toContainText("Approved");
      });

      await test.step("10. Pushes went to the right people at each moment, and never said too much", async () => {
        const toOwner = (await sinkOf(owner.context.request, ownerId)).items;
        const toParent = (await sinkOf(owner.context.request, parentId)).items;
        const toCoach = (await sinkOf(owner.context.request, coach.userId)).items;
        expect(toOwner.every((p) => p.surface === "staff")).toBe(true);
        expect(toParent.every((p) => p.surface === "family")).toBe(true);
        expect(toOwner.filter((p) => p.payload.tag.startsWith("staff-enrollment:"))).toHaveLength(
          2,
        );
        expect(toParent.filter((p) => p.payload.title === "Enrollment approved")).toHaveLength(2);
        // Coaches don't hear about enrollments or money; the handoff note reaches no one.
        expect(toCoach.filter((p) => /^staff-(enrollment|proof):/.test(p.payload.tag))).toEqual([]);
        for (const p of [...toOwner, ...toParent, ...toCoach]) {
          const text = JSON.stringify(p.payload);
          expect(text).not.toContain(handoffMark);
          expect(text).not.toContain("knee");
          expect(text).not.toContain("₱");
        }
        expect(ownerErrors).toEqual([]);
        // Signed out, the wizard asked who's there (401); nothing else failed.
        expect(familyErrors.filter((e) => e !== "401 GET /api/account")).toEqual([]);
      });
    } finally {
      await visitor.close();
    }
  },
);
