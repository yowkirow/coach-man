import type { Page } from "@playwright/test";
import { Api, BYPASS_HEADER, bypassSecret, expect, onboard, test, uuid } from "./support";

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

/** Whether the offline cache saved in IndexedDB still holds a signed-in coach's profile. */
function persistedHasProfile(page: Page) {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open("keyval-store");
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("keyval")) {
            db.close();
            resolve(false);
            return;
          }
          const get = db.transaction("keyval").objectStore("keyval").get("coachman-query-cache");
          get.onsuccess = () => {
            db.close();
            resolve(typeof get.result === "string" && get.result.includes('"queryKey":["me"]'));
          };
          get.onerror = () => {
            db.close();
            resolve(false);
          };
        };
      }),
  );
}

test.describe("shared device", () => {
  test("a different coach never sees the previous coach's cached data", async ({
    page,
    context,
    seeded,
  }) => {
    void seeded;
    // Coach A's day is now cached on this device.
    await page.goto("/");
    const { name } = await firstOpenToggle(page);

    // A's session expires; the app notices and returns to sign-in.
    await context.clearCookies();
    await page.reload();
    await expect(page).toHaveURL(/\/sign-in/);
    // Signing in with Google takes a round trip; by then the cache no longer names a coach.
    await expect.poll(() => persistedHasProfile(page), { timeout: 10_000 }).toBe(false);

    // Coach B signs in on the same device.
    const res = await page.request.post("/api/test/sign-in", {
      headers: { [BYPASS_HEADER]: bypassSecret() },
      data: { email: `e2e-b-${uuid().slice(0, 8)}@coachman.test`, name: "Blair Coach" },
    });
    expect(res.ok(), await res.text()).toBe(true);
    await onboard(new Api(page.request));

    // Record whether A's player ever appears on screen, even for a single frame.
    await page.addInitScript((needle: string) => {
      const w = window as unknown as { __sawPrevious: boolean };
      w.__sawPrevious = false;
      new MutationObserver(() => {
        if (document.body?.textContent?.includes(needle)) w.__sawPrevious = true;
      }).observe(document, { childList: true, subtree: true, characterData: true });
    }, name);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Nothing on court today" })).toBeVisible();
    const sawPrevious = await page.evaluate(
      () => (window as unknown as { __sawPrevious: boolean }).__sawPrevious,
    );
    expect(sawPrevious).toBe(false);
  });
});

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
