import AxeBuilder from "@axe-core/playwright";
import type { StaffInviteCreatedDto } from "../src/shared/api-types";
import { expect, linkFamily, test, testEmail, visit } from "./support";

const SCREENS = [
  "/",
  "/schedule",
  "/clients",
  "/groups",
  "/events",
  "/money",
  "/packages",
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
