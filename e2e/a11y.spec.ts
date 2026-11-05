import AxeBuilder from "@axe-core/playwright";
import type {
  ConsentDocumentDto,
  FamilyInviteCreatedDto,
  StaffInviteCreatedDto,
} from "../src/shared/api-types";
import { bornYearsAgo, expect, linkFamily, listAcademy, test, testEmail, visit } from "./support";

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
  const results = await new AxeBuilder({ page })
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

  test("/a/<slug> and its rates sheet have no serious violations", async ({
    browser,
    seeded,
  }, info) => {
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
    for (const path of [`/a/${slug}`, `/a/${slug}/rates`]) {
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
