import type { Page } from "@playwright/test";
import {
  BYPASS_HEADER,
  bornYearsAgo,
  bypassSecret,
  expect,
  linkFamily,
  onboard,
  test,
  testEmail,
  visit,
} from "./support";

// Shared family devices (plan: "Security and privacy"): the portal keeps an offline copy of what
// a family opened, and a phone gets passed around. When one person's session ends and someone else
// signs in on the same device, the next person never sees the previous family's data, not even
// for a frame while the app catches up.

/** Whether the offline cache saved in IndexedDB mentions `text`. */
function persistedHas(page: Page, text: string) {
  return page.evaluate(
    (needle) =>
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
            resolve(typeof get.result === "string" && get.result.includes(needle));
          };
          get.onerror = () => {
            db.close();
            resolve(false);
          };
        };
      }),
    text,
  );
}

test.describe("a family phone passed around", () => {
  test.use({ serviceWorkers: "block" });

  test("the next person to sign in never sees the previous family's cached portal", async ({
    browser,
    coach,
  }, info) => {
    const { api, request } = coach;
    await onboard(api);
    const mia = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Villanueva",
      birthDate: bornYearsAgo(10),
      isJunior: true,
    });
    const leo = await api.post<{ id: string }>("/clients", {
      firstName: "Leo",
      lastName: "Bautista",
      birthDate: bornYearsAgo(11),
      isJunior: true,
    });
    const first = testEmail("device-parent-a", info);
    const second = testEmail("device-parent-b", info);
    for (const [clientId, email, name] of [
      [mia.id, first, "Pat Villanueva"],
      [leo.id, second, "Lee Bautista"],
    ] as const) {
      expect(
        (await linkFamily(request, { clientId, email, name, relation: "guardian" })).status,
      ).toBe(201);
    }
    // One phone (a browser context with its own storage), passed from one parent to another.
    const phone = await browser.newContext({ serviceWorkers: "block" });
    const page = await phone.newPage();
    const signInAs = async (email: string, name: string) => {
      const res = await phone.request.post("/api/test/sign-in", {
        headers: { [BYPASS_HEADER]: bypassSecret() },
        data: { email, name, persona: "none" },
      });
      expect(res.ok(), await res.text()).toBe(true);
    };

    try {
      // Pat opens the portal on this phone; Mia's page is now in its offline copy.
      await signInAs(first, "Pat Villanueva");
      await visit(page, "/my");
      await expect(page.getByRole("heading", { name: "Mia Villanueva" })).toBeVisible();
      await expect.poll(() => persistedHas(page, "Villanueva"), { timeout: 10_000 }).toBe(true);

      // Pat's session ends (it expired, or the cookies were cleared); the app asks to sign in.
      // Signing in takes a moment (Google is a round trip): by then the offline copy no longer says
      // who was signed in (the persister writes at most once a second; what failed isn't kept).
      await phone.clearCookies();
      await page.reload();
      await expect(page).toHaveURL(/\/sign-in/);
      await expect
        .poll(() => persistedHas(page, '"queryKey":["account"]'), { timeout: 10_000 })
        .toBe(false);

      // Lee signs in on the same phone, in the same app (a passkey sign-in stays on the page and
      // then opens the portal). Record whether Mia's name shows, even for a single frame.
      await signInAs(second, "Lee Bautista");
      const watchForPrevious = () => {
        const w = window as unknown as { __sawPrevious: boolean };
        w.__sawPrevious = false;
        new MutationObserver(() => {
          if (document.body?.textContent?.includes("Villanueva")) w.__sawPrevious = true;
        }).observe(document, { childList: true, subtree: true, characterData: true });
      };
      const sawPrevious = () =>
        page.evaluate(() => (window as unknown as { __sawPrevious: boolean }).__sawPrevious);
      await page.evaluate(watchForPrevious);
      // What the sign-in page does after a passkey sign-in: router.history.push("/my").
      await page.evaluate(() => {
        window.history.pushState(null, "", "/my");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect(page.getByRole("heading", { name: "Hi, Lee" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Leo Bautista" })).toBeVisible();
      expect(await sawPrevious()).toBe(false);

      // Opened again later (a Google sign-in comes back to a fresh page): still only Lee's family,
      // and Pat's is gone from this phone's offline copy.
      await page.addInitScript(watchForPrevious);
      await visit(page, "/my");
      await expect(page.getByRole("heading", { name: "Leo Bautista" })).toBeVisible();
      expect(await sawPrevious()).toBe(false);
      await expect.poll(() => persistedHas(page, "Villanueva"), { timeout: 10_000 }).toBe(false);
    } finally {
      await phone.close();
    }
  });
});
