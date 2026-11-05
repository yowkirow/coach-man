import type { AccountDto, EnrollmentDetailDto, EnrollmentListDto } from "../src/shared/api-types";
import {
  chooseNewChild,
  continueTo,
  fillContact,
  openEnrollment,
  pickLevel,
} from "./enroll-support";
import {
  BYPASS_HEADER,
  bornYearsAgo,
  bypassSecret,
  expect,
  test,
  toggle,
  visit,
  watchErrors,
} from "./support";

// Enrolling without Google (WS4b): the wizard's "Create a passkey account" makes a passkey-only
// account with just a name, for a listed academy that takes new students. Uses Chromium's
// virtual WebAuthn authenticator (CDP), like passkey-account.spec.ts.

async function userExists(request: import("@playwright/test").APIRequestContext, userId: string) {
  const res = await request.post("/api/test/user-exists", {
    headers: { [BYPASS_HEADER]: bypassSecret() },
    data: { userId },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { exists: boolean }).exists;
}

/** Ages a passkey-only account by `hours`, then runs the daily cleanup (test bypass). */
async function cleanUp(
  request: import("@playwright/test").APIRequestContext,
  userId: string,
  hours: number,
) {
  const res = await request.post("/api/test/cleanup-accounts", {
    headers: { [BYPASS_HEADER]: bypassSecret() },
    data: { userId, hours },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

test.describe("enrolling with a passkey-only account", () => {
  test.skip(
    ({ browserName, isMobile }) => browserName !== "chromium" || isMobile,
    "Needs Chromium CDP; runs once",
  );

  test("a parent without Google makes a passkey account in the wizard and sends the request", async ({
    browser,
    seeded,
  }, info) => {
    const setup = await openEnrollment(seeded, info);
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    const errors = watchErrors(page);

    await visit(page, `/a/${setup.slug}/enroll?package=${setup.monthly.id}`);
    await page.getByRole("button", { name: "Create a passkey account" }).click();
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await page.getByLabel("Your name").fill("Pat Santos");
    const started = page.waitForResponse((r) =>
      r.url().endsWith("/api/auth/passkey-account/start"),
    );
    await page.getByRole("button", { name: "Create account and passkey" }).click();
    const startRes = await started;
    expect(startRes.request().postDataJSON()).toEqual({
      name: "Pat Santos",
      enrollment: { slug: setup.slug },
    });
    const { userId } = (await startRes.json()) as { userId: string };
    // Straight on with the wizard, signed in with the new passkey.
    await expect(page.getByRole("heading", { name: "Who's training?" })).toBeVisible();
    const account = (await (await context.request.get("/api/account")).json()) as AccountDto;
    expect(account.user.id).toBe(userId);
    expect(account).toMatchObject({ emailIsPlaceholder: true, passkeyCount: 1, hasGoogle: false });

    await chooseNewChild(page, {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(12),
    });
    await continueTo(page, "About Mia's game");
    await pickLevel(page, "2.5", "Kids M");
    await continueTo(page, "Contact and safety");
    await fillContact(page);
    // No email on a passkey account: the academy may get one here.
    await page.getByLabel("Email (optional)").fill("pat.santos@example.com");
    await continueTo(page, "Which month?");
    await toggle(page.getByRole("radio", { name: /^Next month/ }));
    await continueTo(page, "Check and send");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();

    const list = await seeded.api.get<EnrollmentListDto>("/enrollments");
    expect(
      list.items.map((i) => [i.student.firstName, i.submitter.name, i.submitter.relation]),
    ).toEqual([["Mia", "Pat Santos", "guardian"]]);
    const detail = await seeded.api.get<EnrollmentDetailDto>(`/enrollments/${list.items[0]?.id}`);
    // The academy never sees the placeholder address.
    expect(detail.submitter).toMatchObject({ signIn: "passkey", email: null });
    expect(detail.answers.email).toBe("pat.santos@example.com");
    expect(JSON.stringify(detail)).not.toContain("passkey.coachman.invalid");
    // An account that sent a request is in use: the daily cleanup keeps it.
    await cleanUp(seeded.request, userId, 48);
    expect(await userExists(seeded.request, userId)).toBe(true);
    // Signed out at first, the wizard asked who's there (401); nothing else failed.
    expect(errors.filter((e) => e !== "401 GET /api/account")).toEqual([]);
    await context.close();
  });

  test("a passkey that isn't made leaves no account, and starting one is limited", async ({
    browser,
    seeded,
  }, info) => {
    const setup = await openEnrollment(seeded, info);
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.addInitScript(() => {
      navigator.credentials.create = () =>
        Promise.reject(
          new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"),
        );
    });
    const page = await context.newPage();
    await visit(page, `/a/${setup.slug}/enroll?package=${setup.monthly.id}`);
    await page.getByRole("button", { name: "Create a passkey account" }).click();
    await page.getByLabel("Your name").fill("Lee Cruz");
    const started = page.waitForResponse((r) =>
      r.url().endsWith("/api/auth/passkey-account/start"),
    );
    const abandoned = page.waitForResponse((r) =>
      r.url().endsWith("/api/auth/passkey-account/abandon"),
    );
    await page.getByRole("button", { name: "Create account and passkey" }).click();
    const { userId } = (await (await started).json()) as { userId: string };
    expect(((await (await abandoned).json()) as { deleted: boolean }).deleted).toBe(true);
    await expect(page.getByText(/we didn't create your account/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    expect((await context.request.get("/api/account")).status()).toBe(401);
    expect(await userExists(seeded.request, userId)).toBe(false);
    const origin = new URL(page.url()).origin;
    await context.close();

    /** Starts an account in a fresh browser, then abandons it (no passkey) so none is left. */
    const start = async (data: Record<string, unknown>) => {
      const fresh = await browser.newContext({ serviceWorkers: "block" });
      const res = await fresh.request.post("/api/auth/passkey-account/start", {
        headers: { origin },
        data,
      });
      const status = res.status();
      const json = (await res.json().catch(() => ({}))) as { code?: string; userId?: string };
      if (status === 200) {
        const left = await fresh.request.post("/api/auth/passkey-account/abandon", {
          headers: { origin },
          data: {},
        });
        expect(await left.json(), "the started account is removed").toEqual({ deleted: true });
      }
      await fresh.close();
      return { status, code: json.code };
    };
    // Only for a listed academy's page, and only one way in at a time.
    expect(await start({ name: "Lee Cruz", enrollment: { slug: "no-such-academy-here" } })).toEqual(
      { status: 404, code: "academy_not_found" },
    );
    expect((await start({ name: "Lee Cruz" })).status).toBe(400);
    // A few per academy and connection in an hour (the one above counted).
    for (let i = 0; i < 4; i++) {
      expect((await start({ name: "Lee Cruz", enrollment: { slug: setup.slug } })).status).toBe(
        200,
      );
    }
    expect(await start({ name: "Lee Cruz", enrollment: { slug: setup.slug } })).toMatchObject({
      status: 429,
    });
  });
});
