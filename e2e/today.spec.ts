import type { Page } from "@playwright/test";
import { expect, onboard, test } from "./support";

/** The first player's check-in toggle that isn't checked in yet (not the "Check in all" button). */
async function firstOpenToggle(page: Page) {
  const toggle = page.locator('button[aria-pressed="false"][aria-label^="Check in "]').first();
  await expect(toggle).toBeVisible();
  const name = ((await toggle.getAttribute("aria-label")) ?? "").replace(/^Check in /, "");
  expect(name).not.toBe("");
  return { toggle, name, firstName: name.split(" ")[0] ?? name };
}

const checkedToggle = (page: Page, name: string) =>
  page.getByRole("button", { name: `${name} is checked in. Undo check-in`, exact: true }).first();

test.describe("on court", () => {
  test("check a player in from Today, then undo", async ({ page, seeded }) => {
    void seeded;
    await page.goto("/");
    const { toggle, name, firstName } = await firstOpenToggle(page);

    await toggle.click();
    await expect(checkedToggle(page, name)).toBeVisible();
    await expect(page.getByText(`${firstName} checked in`, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Check in ${name}`, exact: true }).first(),
    ).toBeVisible();
  });

  test("a check-in made offline syncs when the connection returns", async ({
    page,
    context,
    seeded,
  }) => {
    void seeded;
    await page.goto("/");
    const { toggle, name } = await firstOpenToggle(page);

    await context.setOffline(true);
    await toggle.click();
    await expect(checkedToggle(page, name)).toBeVisible();
    await expect(page.getByText("Waiting to sync").first()).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText("Waiting to sync")).toHaveCount(0, { timeout: 20_000 });
    await page.reload();
    await expect(checkedToggle(page, name)).toBeVisible();
  });

  test("a new coach without sessions sees a clear next step", async ({ page, coach }) => {
    await onboard(coach.api);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Nothing on court today" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New session" }).first()).toBeVisible();
  });
});

test.describe("first run", () => {
  test("signed-out visitors land on sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });

  test("a new coach is walked through onboarding", async ({ page, coach }) => {
    void coach;
    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel("Workspace name").fill("Robin's coaching");
    await page.getByText("Add sample clients and sessions").click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Add a passkey" })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByRole("heading", { name: "Stay a step ahead" })).toBeVisible();
    await page.getByRole("button", { name: "Go to Today" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
