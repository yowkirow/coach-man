import AxeBuilder from "@axe-core/playwright";
import type {
  ConsentDocumentDto,
  FamilyInviteCreatedDto,
  MeDto,
  StaffInviteCreatedDto,
} from "../src/shared/api-types";
import {
  addConsents,
  chooseNewChild,
  continueTo,
  fillContact,
  newChildBody,
  openEnrollment,
  pickLevel,
  sendOk,
} from "./enroll-support";
import { approvedEnrollment, screenshot, sendProofOk } from "./proof-support";
import {
  addMember,
  bornYearsAgo,
  expect,
  linkFamily,
  listAcademy,
  pngImage,
  signIn,
  test,
  testEmail,
  toggle,
  uploadPng,
  visit,
} from "./support";

const SCREENS = [
  "/",
  "/schedule",
  "/clients",
  "/groups",
  "/events",
  "/money",
  "/packages",
  "/packages?tab=public",
  "/settings",
  "/more",
  "/team",
];

async function seriousViolations(page: import("@playwright/test").Page) {
  // Let entrance animations (a sheet sliding up, a fade) finish first: axe measures contrast as
  // painted, and text mid-fade reads as too faint. Endless ones (spinners) are left alone.
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => {
      const iterations = a.effect?.getComputedTiming().iterations;
      return iterations !== undefined && Number.isFinite(iterations);
    });
    await Promise.race([
      Promise.all(finite.map((a) => a.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  });
  const results = await new AxeBuilder({ page })
    // React Aria's live announcer is assistive-technology plumbing, not page content. It announces
    // a pending button through a short-lived role="img" node labelled by that button, which axe
    // flags once the button is gone (after a request is sent, say), whenever the node lands.
    .exclude("[data-live-announcer]")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    }));
}

test.describe("accessibility", () => {
  test("sign-in has no serious violations", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  for (const path of SCREENS) {
    test(`${path} has no serious violations`, async ({ page, seeded }) => {
      void seeded;
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });
  }

  test("/welcome has no serious violations", async ({ personas }, info) => {
    const { page } = await personas.open({
      email: testEmail("a11y-welcome", info),
      name: "Jordan Lake",
      persona: "none",
    });
    await visit(page, "/welcome");
    await expect(page.getByRole("heading", { name: "Welcome, Jordan" })).toBeVisible();
    await page.getByRole("button", { name: /I'm a student or a parent/ }).click();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("/my has no serious violations", async ({ seeded, personas }, info) => {
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      isJunior: true,
    });
    const email = testEmail("a11y-parent", info);
    const linked = await linkFamily(seeded.request, {
      clientId: kid.id,
      email,
      name: "Pat Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    const { page } = await personas.open({ email, name: "Pat Santos", persona: "none" });
    await visit(page, "/my");
    await expect(page.getByRole("heading", { name: "Hi, Pat" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("/join/<token> has no serious violations, signed out or in", async ({
    browser,
    seeded,
    personas,
  }, info) => {
    const email = testEmail("a11y-join", info);
    const created = await seeded.api.post<StaffInviteCreatedDto>("/team/invites", {
      email,
      role: "coach",
    });
    const path = new URL(created.link).pathname;

    const signedOut = await browser.newContext({ serviceWorkers: "block" });
    const outPage = await signedOut.newPage();
    await visit(outPage, path);
    await expect(outPage.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(await seriousViolations(outPage)).toEqual([]);
    await signedOut.close();

    const { page } = await personas.open({ email, name: "Sam Rivera", persona: "none" });
    await visit(page, path);
    await expect(page.getByRole("button", { name: /^Join / })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("the invite and role sheets, with the front desk among the roles, have no serious violations", async ({
    page,
    seeded,
  }, info) => {
    await addMember(seeded.request, {
      email: testEmail("a11y-role", info),
      name: "Sam Rivera",
      role: "coach",
    });
    await visit(page, "/team?invite=1");
    const invite = page.getByRole("dialog", { name: "Invite someone" });
    await toggle(invite.getByRole("radio", { name: /^Front desk/ }));
    await expect(invite.getByRole("radio", { name: /^Front desk/ })).toBeChecked();
    expect(await seriousViolations(page)).toEqual([]);
    await invite.getByRole("button", { name: "Cancel" }).click();
    await expect(invite).toBeHidden();

    // Moving a coach to the front desk: the sheet says they stop coaching.
    await page.getByRole("button", { name: "Options for Sam Rivera" }).click();
    await page.getByRole("menuitem", { name: "Change role" }).click();
    const role = page.getByRole("dialog", { name: "Change role" });
    await toggle(role.getByRole("radio", { name: /^Front desk/ }));
    await expect(role.getByText(/Sam Rivera stops coaching/)).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test.describe("accessibility of the family portal", () => {
  // Offline use isn't what's checked here; see family.spec.ts on service workers in tests.
  test.use({ serviceWorkers: "block" });

  test("the family portal's pages have no serious violations", async ({
    seeded,
    personas,
  }, info) => {
    const { api } = seeded;
    // Fourteen: the settings page also shows the parent's controls for a teen's own login.
    const kid = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(14),
      isJunior: true,
      medicalNotes: "Mild asthma.",
    });
    const pack = await api.post<{ id: string }>("/packages", {
      name: "5-session pack",
      credits: 5,
      priceMinor: 250000,
      validityDays: 60,
    });
    await api.post(`/clients/${kid.id}/packages`, { packageId: pack.id });
    await api.post("/notes", { clientId: kid.id, body: "Lovely footwork.", visibility: "shared" });
    const email = testEmail("a11y-portal", info);
    const linked = await linkFamily(seeded.request, {
      clientId: kid.id,
      email,
      name: "Pat Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    const { page } = await personas.open({ email, name: "Pat Santos", persona: "none" });

    const found: Record<string, unknown> = {};
    for (const path of [
      "/my",
      `/my/${kid.id}/progress`,
      `/my/${kid.id}/schedule`,
      `/my/${kid.id}/coaches`,
      `/my/${kid.id}/payments`,
      `/my/${kid.id}/profile`,
      "/my/more",
      "/my/settings",
    ]) {
      await visit(page, path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("h1").first()).toBeVisible();
      const violations = await seriousViolations(page);
      if (violations.length) found[path] = violations;
    }
    expect(found).toEqual({});
  });

  test("notification settings and Home's reminders offer have no serious violations", async ({
    browser,
    seeded,
    personas,
  }, info) => {
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(10),
      isJunior: true,
    });
    const email = testEmail("a11y-reminders", info);
    const linked = await linkFamily(seeded.request, {
      clientId: kid.id,
      email,
      name: "Pat Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    const { page } = await personas.open({ email, name: "Pat Santos", persona: "none" });
    const found: Record<string, unknown> = {};
    await visit(page, "/my");
    await expect(
      page.getByRole("region", { name: /^Get reminders on this (phone|computer)$/ }),
    ).toBeVisible();
    const home = await seriousViolations(page);
    if (home.length) found["/my (offer)"] = home;
    await visit(page, "/my/notifications");
    await expect(page.getByRole("region", { name: "What you get" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const settings = await seriousViolations(page);
    if (settings.length) found["/my/notifications"] = settings;

    // On an iPhone in Safari, the Add to Home Screen steps come first.
    const iphone = await browser.newContext({
      serviceWorkers: "block",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      await signIn(iphone.request, { email, name: "Pat Santos", persona: "none" });
      const phone = await iphone.newPage();
      await visit(phone, "/my/notifications");
      await expect(
        phone.getByRole("list", { name: "Add CoachMan to your Home Screen" }),
      ).toBeVisible();
      const ios = await seriousViolations(phone);
      if (ios.length) found["/my/notifications (iPhone)"] = ios;
    } finally {
      await iphone.close();
    }
    expect(found).toEqual({});
  });

  test("a family /join/<token> has no serious violations, signed out or in", async ({
    browser,
    page,
    seeded,
    personas,
  }, info) => {
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(9),
      isJunior: true,
    });
    const created = await seeded.api.post<FamilyInviteCreatedDto>(
      `/clients/${kid.id}/family/invites`,
      { relation: "guardian" },
    );
    const path = new URL(created.link).pathname;

    // The staff side: the student's profile with its family access card and a waiting link.
    await visit(page, `/clients/${kid.id}`);
    await expect(page.getByRole("region", { name: "Family access" })).toContainText(
      "Parent or guardian link",
    );
    expect(await seriousViolations(page)).toEqual([]);

    const signedOut = await browser.newContext({ serviceWorkers: "block" });
    const outPage = await signedOut.newPage();
    await visit(outPage, path);
    await expect(outPage.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(await seriousViolations(outPage)).toEqual([]);
    await outPage.getByRole("button", { name: "Create a passkey account" }).click();
    await expect(outPage.getByLabel("Your name")).toBeVisible();
    expect(await seriousViolations(outPage)).toEqual([]);
    await signedOut.close();

    const parent = await personas.open({
      email: testEmail("a11y-family-join", info),
      name: "Pat Santos",
      persona: "none",
    });
    await visit(parent.page, path);
    await expect(parent.page.getByRole("button", { name: "Accept invite" })).toBeVisible();
    expect(await seriousViolations(parent.page)).toEqual([]);
  });
});

test.describe("accessibility of the academy page and consents", () => {
  test.use({ serviceWorkers: "block" });

  test("/a/<slug>, Enroll now, its rates sheet, and its team page have no serious violations", async ({
    browser,
    seeded,
  }, info) => {
    const me = await seeded.api.get<MeDto>("/me");
    await seeded.api.patch(`/coaches/${me.user.id}`, {
      isPublic: true,
      title: "Head coach",
      certifications: ["RPO licensed coach"],
      highlights: ["Gold, Mixed Doubles 4.0, Manila Open 2025"],
      yearsCoaching: 8,
      duprRating: 4.25,
      languages: ["English", "Filipino"],
    });
    await uploadPng(seeded.request, `/coaches/${me.user.id}/portrait`, pngImage(40));
    await seeded.api.post("/team-page/people", {
      name: "Lia Santos",
      title: "Junior program coordinator",
      highlights: ["Ran 12 summer camps"],
    });
    const slug = await listAcademy(seeded.api, info, {
      tagline: "Train with purpose, play with joy",
      about: "Evening training with drills, live play, and honest feedback.",
      contactPhone: "+63 917 555 0100",
      address: "Riverside Park Courts, Quezon City",
      socials: { facebook: "https://www.facebook.com/riversidepickleball" },
      policies: "Missed sessions can be made up within the same month.",
    });
    const visitor = await browser.newContext({ serviceWorkers: "block" });
    const page = await visitor.newPage();
    const found: Record<string, unknown> = {};
    for (const path of [
      `/a/${slug}`,
      `/a/${slug}/enroll`,
      `/a/${slug}/rates`,
      `/a/${slug}/team`,
      `/a/${slug}/team?program=all`,
    ]) {
      await visit(page, path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("h1").first()).toBeVisible();
      const violations = await seriousViolations(page);
      if (violations.length) found[path] = violations;
    }
    expect(found).toEqual({});
    await visitor.close();
  });

  test("the consent screens have no serious violations", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const { api } = seeded;
    await api.post<ConsentDocumentDto>("/consent-documents/templates", { kind: "waiver" });
    await api.post<ConsentDocumentDto>("/consent-documents", {
      kind: "privacy",
      title: "Data privacy consent",
      body: "We keep your contact details to run your training.\n\nAsk us to see or correct them.",
    });
    const kid = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(12),
      isJunior: true,
    });
    const email = testEmail("a11y-consents", info);
    const linked = await linkFamily(seeded.request, {
      clientId: kid.id,
      email,
      name: "Pat Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);

    const found: Record<string, unknown> = {};
    const check = async (where: string) => {
      const violations = await seriousViolations(page);
      if (violations.length) found[where] = violations;
    };
    // Staff: the consent forms in Settings, the templates sheet, a student's consents card and
    // the paper signature sheet.
    await visit(page, "/settings");
    const section = page.getByRole("region", { name: "Consent forms" });
    await expect(section.getByText("Data privacy consent")).toBeVisible();
    await check("settings");
    await section.getByRole("button", { name: "Start from a template" }).click();
    await expect(page.getByRole("dialog", { name: "Start from a template" })).toBeVisible();
    await check("templates sheet");
    await page.keyboard.press("Escape");
    await visit(page, `/clients/${kid.id}`);
    const card = page.getByRole("region", { name: "Consents" });
    await expect(card).toContainText("Data privacy consent");
    await check("client consents card");
    await card.getByRole("button", { name: /Record paper signature/ }).click();
    await expect(page.getByRole("dialog", { name: "Record a paper signature" })).toBeVisible();
    await check("paper signature sheet");

    // The family portal: the consents page and the read-and-sign sheet.
    const parent = await personas.open({ email, name: "Pat Santos", persona: "none" });
    await visit(parent.page, `/my/${kid.id}/consents`);
    await expect(parent.page.getByRole("heading", { name: "1 form to sign" })).toBeVisible();
    const portalViolations = await seriousViolations(parent.page);
    if (portalViolations.length) found.portal = portalViolations;
    await parent.page.getByRole("button", { name: /Read and sign/ }).click();
    await expect(parent.page.getByRole("dialog", { name: "Data privacy consent" })).toBeVisible();
    const sheetViolations = await seriousViolations(parent.page);
    if (sheetViolations.length) found["portal sign sheet"] = sheetViolations;
    expect(found).toEqual({});
  });
});

test.describe("accessibility of enrolling", () => {
  test.use({ serviceWorkers: "block" });

  test("each step of the enrollment wizard has no serious violations", async ({
    browser,
    seeded,
  }, info) => {
    const setup = await openEnrollment(seeded, info);
    await addConsents(seeded.api);
    const url = `/a/${setup.slug}/enroll?package=${setup.monthly.id}`;
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const found: Record<string, unknown> = {};
    const check = async (step: string) => {
      const violations = await seriousViolations(page);
      if (violations.length) found[step] = violations;
    };

    // Signed out: signing in, and the passkey account form.
    await visit(page, url);
    await expect(page.getByRole("heading", { name: "Sign in to enroll" })).toBeVisible();
    await check("sign in");
    await page.getByRole("button", { name: "Create a passkey account" }).click();
    await expect(page.getByLabel("Your name")).toBeVisible();
    await check("create account");

    await signIn(context.request, {
      email: testEmail("a11y-enroll", info),
      name: "Pat Santos",
      persona: "none",
    });
    await visit(page, url);
    await expect(page.getByRole("heading", { name: "Who's training?" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Choose who's training.")).toBeVisible();
    await check("who (with an error)");
    await chooseNewChild(page, {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(12),
    });
    await check("who");
    await continueTo(page, "About Mia's game");
    await check("level");
    await pickLevel(page, "3.0", "Kids M");
    await continueTo(page, "Contact and safety");
    await fillContact(page);
    await page.getByRole("button", { name: "Add a person" }).click();
    await check("contact");
    await page.getByLabel("Name", { exact: true }).fill("Lola Santos");
    await continueTo(page, "Which month?");
    await check("when");
    await toggle(page.getByRole("radio", { name: /^Next month/ }));
    await continueTo(page, "Consent forms");
    await check("consents");
    await toggle(page.getByRole("checkbox", { name: /Waiver and release/ }));
    await toggle(page.getByRole("checkbox", { name: /Parental consent/ }));
    await continueTo(page, "Check and send");
    await check("review");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
    await check("sent");
    await visit(page, "/my/enroll");
    await expect(page.getByRole("heading", { name: "Enroll", level: 1 })).toBeVisible();
    await check("portal enroll page");
    expect(found).toEqual({});
    await context.close();
  });

  test("the Enrollments inbox and a request have no serious violations", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const setup = await openEnrollment(seeded, info);
    const { waiver, parental } = await addConsents(seeded.api);
    const parent = await personas.open({
      email: testEmail("a11y-inbox", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, {
        firstName: "Mia",
        birthDate: bornYearsAgo(12),
        startMonth: setup.thisMonth,
        answers: { pickups: [{ name: "Lola Santos", relationship: "Grandmother", phone: "0917" }] },
        signatures: [waiver, parental].map((d) => ({
          documentId: d.id,
          version: d.version,
          signerName: "Pat Santos",
        })),
      }),
    );
    const found: Record<string, unknown> = {};
    const check = async (where: string) => {
      const violations = await seriousViolations(page);
      if (violations.length) found[where] = violations;
    };
    await visit(page, "/enrollments");
    await expect(page.getByRole("link", { name: /Mia Santos/ })).toBeVisible();
    await check("inbox");
    await visit(page, `/enrollments/${sent.request.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Mia Santos" })).toBeVisible();
    await check("request");
    for (const [button, dialog] of [
      ["Approve", "Approve Mia?"],
      ["Waitlist", "Waitlist Mia?"],
      ["Decline", "Decline Mia's request?"],
    ] as const) {
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(page.getByRole("dialog", { name: dialog })).toBeVisible();
      await check(`${button} sheet`);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    // Approved this month: the request's decided view, and Not yet renewed with a reminder.
    await seeded.api.post(`/enrollments/${sent.request.id}/approve`, {});
    await visit(page, `/enrollments/${sent.request.id}`);
    await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();
    await check("approved request");
    await visit(page, "/enrollments?view=renewals");
    await page.getByRole("button", { name: /Copy reminder message/ }).click();
    await check("not yet renewed");
    // The family's side: the approved request with what to pay, and the renewal offer.
    await visit(parent.page, "/my");
    await expect(parent.page.getByRole("region", { name: /^Renew for/ })).toBeVisible();
    const portal = await seriousViolations(parent.page);
    if (portal.length) found.portal = portal;
    expect(found).toEqual({});
  });
});

test.describe("accessibility of payment proofs", () => {
  test.use({ serviceWorkers: "block" });

  test("the Pay screen, the review queue, and a request's payment have no serious violations", async ({
    page,
    seeded,
    personas,
  }, info) => {
    test.setTimeout(180_000);
    const { parent, requestId, clientId, today } = await approvedEnrollment(seeded, personas, info);
    const found: Record<string, unknown> = {};
    const check = async (on: import("@playwright/test").Page, where: string) => {
      const violations = await seriousViolations(on);
      if (violations.length) found[where] = violations;
    };

    // The family's Pay screen: the form, a screenshot ready to send, and cash at the court.
    const w = parent.page;
    await visit(w, `/my/${clientId}/pay?request=${requestId}`);
    await expect(w.getByRole("heading", { name: "Pay", level: 1 })).toBeVisible();
    await w.getByRole("button", { name: "Send proof" }).click();
    await expect(
      w.getByText("Add a screenshot of the payment, or choose cash at the court."),
    ).toBeVisible();
    await check(w, "pay (with an error)");
    await w.getByLabel("Screenshot of the payment").setInputFiles({
      name: "gcash.png",
      mimeType: "image/png",
      buffer: screenshot(),
    });
    await expect(w.getByText("Ready to send")).toBeVisible();
    await check(w, "pay with a screenshot");
    await toggle(w.getByRole("radio", { name: /Cash at the court/ }));
    await expect(w.getByRole("button", { name: "Tell the academy" })).toBeVisible();
    await check(w, "pay cash");

    // Proofs sent: one waiting (flagged as a possible duplicate), one not accepted.
    const waiting = await sendProofOk(parent.context.request, clientId, {
      amountMinor: 600000,
      method: "GCash",
      reference: "GC-4242",
      paidOn: today,
      enrollmentId: requestId,
    });
    await sendProofOk(parent.context.request, clientId, {
      amountMinor: 600000,
      method: "GCash",
      reference: "GC-4243",
      paidOn: today,
    });
    const refused = await sendProofOk(parent.context.request, clientId, {
      amountMinor: 1000,
      method: "Bank transfer",
      reference: "BPI-77",
      paidOn: today,
    });
    await seeded.api.post(`/payment-proofs/${refused.id}/reject`, {
      reason: "We can't find this payment in our account yet.",
    });
    await visit(w, `/my/${clientId}/payments`);
    await expect(w.getByRole("region", { name: "Payment proofs" })).toContainText("Not accepted");
    await check(w, "portal payments with proofs");
    await visit(w, "/my");
    await expect(w.getByRole("article", { name: /^Monthly/ }).first()).toContainText(
      "Proof pending",
    );
    await check(w, "portal home with a proof pending");

    // Staff: the queue on Money, the screenshot viewer, and the two decision sheets.
    await visit(page, "/money");
    const item = page
      .getByRole("region", { name: "Payments to review" })
      .getByRole("article", { name: /Mia Santos/ })
      .filter({ hasText: "Ref GC-4242 · Paid" });
    await expect(item).toContainText("Possible duplicate");
    await check(page, "review queue");
    await item.getByRole("button", { name: "View Mia Santos's payment screenshot" }).click();
    await expect(
      page.getByRole("dialog", { name: "Mia Santos's payment screenshot" }),
    ).toBeVisible();
    await check(page, "screenshot viewer");
    await page.keyboard.press("Escape");
    await item.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("dialog", { name: "Confirm Mia's payment" })).toBeVisible();
    await check(page, "confirm sheet");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await item.getByRole("button", { name: "Not accepted" }).click();
    await expect(page.getByRole("dialog", { name: "Not accepted" })).toBeVisible();
    await check(page, "not accepted sheet");
    await page.keyboard.press("Escape");

    // The request's payment card with its proof, and the student's proofs on their Money tab.
    await visit(page, `/enrollments/${requestId}`);
    await expect(page.getByRole("region", { name: "Payment", exact: true })).toContainText(
      "Proof pending",
    );
    await check(page, "request payment card");
    await visit(page, `/clients/${clientId}?tab=money`);
    await expect(page.getByRole("region", { name: "Payment proofs" })).toContainText("GC-4242");
    await check(page, "client payment proofs");
    expect(waiting.status).toBe("pending");
    expect(found).toEqual({});
  });
});

test.describe("accessibility of kids' safety, announcements, and CoachMan's pages", () => {
  test.use({ serviceWorkers: "block" });

  test("/about, /privacy, and /terms have no serious violations", async ({ page }) => {
    const found: Record<string, unknown> = {};
    for (const path of ["/about", "/privacy", "/terms"]) {
      await visit(page, path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("h1").first()).toBeVisible();
      const violations = await seriousViolations(page);
      if (violations.length) found[path] = violations;
    }
    expect(found).toEqual({});
  });

  test("a family editing a Profile, and their announcements, have no serious violations", async ({
    seeded,
    personas,
  }, info) => {
    const { api, request } = seeded;
    const kid = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(10),
      isJunior: true,
      medicalNotes: "Mild asthma.",
    });
    const pickup = await request.post(`/api/v1/clients/${kid.id}/pickups`, {
      multipart: {
        data: JSON.stringify({
          name: "Rosa Dela Cruz",
          relationship: "Grandmother",
          phone: "0917",
        }),
        photo: { name: "rosa.png", mimeType: "image/png", buffer: pngImage(64) },
      },
    });
    expect(pickup.status(), await pickup.text()).toBe(201);
    await api.post("/announcements", {
      title: "Courts closed on Saturday",
      body: "Courts 1 to 4 are being resurfaced. Details: https://example.com/courts",
      audience: "all",
      pinned: true,
      publish: "now",
    });
    const email = testEmail("a11y-profile", info);
    const linked = await linkFamily(request, {
      clientId: kid.id,
      email,
      name: "Pat Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    const { page } = await personas.open({ email, name: "Pat Santos", persona: "none" });
    const found: Record<string, unknown> = {};
    const check = async (where: string) => {
      const violations = await seriousViolations(page);
      if (violations.length) found[where] = violations;
    };

    await visit(page, `/my/${kid.id}/profile`);
    await expect(page.getByRole("region", { name: "Pickup" })).toContainText("Rosa Dela Cruz");
    await check("profile");
    await page.getByRole("button", { name: "Edit health and emergency details" }).click();
    await expect(page.getByRole("dialog", { name: "Health and emergency" })).toBeVisible();
    await check("health and emergency sheet");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByRole("dialog", { name: "Add a pickup person" })).toBeVisible();
    await check("add pickup sheet");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Edit Rosa Dela Cruz" }).click();
    await expect(page.getByRole("dialog", { name: "Edit Rosa Dela Cruz" })).toBeVisible();
    await check("edit pickup sheet");
    await page.keyboard.press("Escape");

    await visit(page, "/my/announcements");
    await expect(page.getByRole("article", { name: "Courts closed on Saturday" })).toBeVisible();
    await check("announcements");
    expect(found).toEqual({});
  });

  test("the announcements composer, Today, and a roster with safety flags have no serious violations", async ({
    page,
    seeded,
  }) => {
    const { api, request } = seeded;
    const { date: today } = await api.get<{ date: string }>("/today");
    const kid = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(10),
      isJunior: true,
      medicalNotes: "Peanut allergy: EpiPen in her bag.",
      emergencyName: "Lola Santos",
      emergencyPhone: "0917 222 3333",
    });
    const pickup = await request.post(`/api/v1/clients/${kid.id}/pickups`, {
      multipart: {
        data: JSON.stringify({
          name: "Rosa Dela Cruz",
          relationship: "Grandmother",
          phone: "0917",
        }),
        photo: { name: "rosa.png", mimeType: "image/png", buffer: pngImage(64) },
      },
    });
    expect(pickup.status(), await pickup.text()).toBe(201);
    const clinic = await api.post<{ lesson: { lesson: { id: string } } }>("/lessons", {
      kind: "group",
      title: "Junior clinic",
      date: today,
      startTime: "17:00",
      durationMinutes: 60,
      clientIds: [kid.id],
    });
    await api.post("/announcements", {
      title: "Courts closed on Saturday",
      body: "Courts 1 to 4 are being resurfaced.",
      audience: "all",
      pinned: true,
      publish: "now",
    });
    const found: Record<string, unknown> = {};
    const check = async (where: string) => {
      const violations = await seriousViolations(page);
      if (violations.length) found[where] = violations;
    };

    await visit(page, "/announcements");
    await expect(page.getByRole("article", { name: "Courts closed on Saturday" })).toBeVisible();
    await check("announcements");
    await page.getByRole("button", { name: "New announcement" }).first().click();
    const composer = page.getByRole("dialog", { name: "New announcement" });
    await expect(composer).toBeVisible();
    await check("composer");
    await toggle(composer.getByRole("radio", { name: "Program", exact: true }));
    await toggle(composer.getByRole("radio", { name: "Schedule" }));
    await toggle(composer.getByRole("checkbox", { name: "Take it down on a set day" }));
    await expect(composer.getByLabel("Ends on")).toBeVisible();
    await check("composer, scheduled for a program");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await visit(page, `/sessions/${clinic.lesson.lesson.id}`);
    await page.getByRole("button", { name: "Medical note for Mia Santos" }).click();
    await expect(page.getByRole("dialog", { name: "Mia Santos" })).toBeVisible();
    await check("medical sheet");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await check("roster with flags");
    await page.getByRole("button", { name: /^Who may pick up Mia Santos/ }).click();
    await expect(page.getByRole("dialog", { name: "Pickup for Mia" })).toBeVisible();
    await check("pickup sheet");
    await page.keyboard.press("Escape");

    await visit(page, "/");
    await expect(page.getByRole("region", { name: "Announcements" })).toBeVisible();
    await check("today with announcements and medical notes");
    await visit(page, `/clients/${kid.id}`);
    await expect(page.getByRole("region", { name: "Pickup" })).toContainText("Rosa Dela Cruz");
    await check("client profile with pickups");
    expect(found).toEqual({});
  });
});
