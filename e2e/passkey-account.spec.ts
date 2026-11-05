import type { AccountDto, FamilyAccessDto, FamilyInviteCreatedDto } from "../src/shared/api-types";
import {
  acceptInvite,
  BYPASS_HEADER,
  bornYearsAgo,
  bypassSecret,
  expect,
  inviteToken,
  test,
  visit,
  watchErrors,
} from "./support";

// Passkey-only family accounts: no Google needed. Someone holding a family invite gives their
// name, the account is created, the device makes a passkey, and the invite is accepted. Uses
// Chromium's virtual WebAuthn authenticator (CDP), like passkey.spec.ts.

/** Whether an account still exists (test bypass). */
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

test.describe("passkey-only family accounts", () => {
  test.skip(
    ({ browserName, isMobile }) => browserName !== "chromium" || isMobile,
    "Needs Chromium CDP; runs once",
  );

  test("a parent without Google makes a passkey account from the invite, and signs back in with it", async ({
    browser,
    seeded,
  }) => {
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
    const token = inviteToken(created.link);

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

    await visit(page, `/join/${token}`);
    await expect(page.getByRole("heading", { name: "Follow Mia's training" })).toBeVisible();
    await page.getByRole("button", { name: "Create a passkey account" }).click();
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    // A name is all it asks for.
    await page.getByRole("button", { name: "Create account and passkey" }).click();
    await expect(page.getByText("Enter your name so the academy knows who you are.")).toBeVisible();
    await page.getByLabel("Your name").fill("Pat Santos");
    const started = page.waitForResponse((r) =>
      r.url().endsWith("/api/auth/passkey-account/start"),
    );
    await page.getByRole("button", { name: "Create account and passkey" }).click();
    const { userId } = (await (await started).json()) as { userId: string };

    await expect(page).toHaveURL(/\/my\/?$/);
    await expect(page.getByRole("heading", { name: "Hi, Pat" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mia Santos" })).toBeVisible();
    const account = (await (await context.request.get("/api/account")).json()) as AccountDto;
    expect(account.user.id).toBe(userId);
    expect(account.emailIsPlaceholder).toBe(true);
    expect(account.user.email).toMatch(/^u-[0-9a-f-]{36}@passkey\.coachman\.invalid$/);
    expect(account.passkeyCount).toBe(1);
    expect(account.hasGoogle).toBe(false);
    expect(account.family[0]?.students.map((s) => s.clientId)).toEqual([kid.id]);

    // The academy sees a passkey-only parent, never the placeholder address.
    const access = await seeded.api.get<FamilyAccessDto>(`/clients/${kid.id}/family`);
    expect(access.links.map((l) => [l.name, l.signIn, l.email])).toEqual([
      ["Pat Santos", "passkey", null],
    ]);

    // Settings: Google can be linked later; the only passkey can't be removed.
    await visit(page, "/my/settings");
    const signIn = page.getByRole("region", { name: "Signing in" });
    await expect(signIn).toContainText("Not linked");
    await expect(signIn.getByRole("button", { name: "Link Google" })).toBeVisible();
    await expect(signIn).toContainText("Your passkey is the only way into this account");
    await expect(signIn.getByRole("button", { name: /^Remove / })).toBeDisabled();
    const removeLast = await context.request.post("/api/auth/passkey/delete-passkey", {
      headers: { origin: new URL(page.url()).origin },
      data: { id: "any" },
    });
    expect(removeLast.status()).toBe(409);
    // Linking Google is offered to this account (the request goes on to Google)…
    const link = await context.request.post("/api/auth/link-social", {
      headers: { origin: new URL(page.url()).origin },
      data: { provider: "google", callbackURL: "/my/settings" },
    });
    expect(link.status(), await link.text()).toBe(200);
    expect(((await link.json()) as { url?: string }).url).toContain("accounts.google.com");
    // …and refused to an account that already has a real address.
    const staffLink = await seeded.request.post("/api/auth/link-social", {
      headers: { origin: new URL(page.url()).origin },
      data: { provider: "google", callbackURL: "/settings" },
    });
    expect(staffLink.status()).toBe(403);
    expect(((await staffLink.json()) as { code?: string }).code).toBe("google_link_not_allowed");

    // The daily cleanup leaves a finished account alone.
    await cleanUp(seeded.request, userId, 48);
    expect(await userExists(seeded.request, userId)).toBe(true);

    // Sign out, then back in with the passkey.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page).toHaveURL(/\/my\/?$/);
    await expect(page.getByRole("heading", { name: "Mia Santos" })).toBeVisible();
    // Signed out, the join and sign-in pages ask who's there (401); nothing else failed, and
    // nothing asked the staff API as this parent.
    const signedOut = new Set(["401 GET /api/account", "401 GET /api/v1/me"]);
    expect(errors.filter((e) => !signedOut.has(e))).toEqual([]);
    await context.close();
  });

  test("a passkey that isn't made leaves no account behind", async ({ browser, seeded }) => {
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Leo",
      lastName: "Cruz",
      birthDate: bornYearsAgo(11),
      isJunior: true,
    });
    const created = await seeded.api.post<FamilyInviteCreatedDto>(
      `/clients/${kid.id}/family/invites`,
      { relation: "guardian" },
    );
    const token = inviteToken(created.link);

    // The device refuses to make the passkey (cancelled, or no screen lock).
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.addInitScript(() => {
      navigator.credentials.create = () =>
        Promise.reject(
          new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"),
        );
    });
    const page = await context.newPage();
    await visit(page, `/join/${token}`);
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

    // The person is told plainly, stays on the invite, and no account is left.
    await expect(page.getByText(/we didn't create your account/)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/join/${token}$`));
    expect((await context.request.get("/api/account")).status()).toBe(401);
    expect(await userExists(seeded.request, userId)).toBe(false);
    // The invite still works for a second try.
    const preview = await context.request.get(`/api/invites/${token}`);
    expect(((await preview.json()) as { status: string }).status).toBe("valid");

    // An account started and then left (the tab closed before the passkey): it can't accept the
    // invite, and the daily cleanup removes it once it's a day old.
    const left = await browser.newContext({ serviceWorkers: "block" });
    const origin = new URL(page.url()).origin;
    const start = await left.request.post("/api/auth/passkey-account/start", {
      headers: { origin },
      data: { name: "Lee Cruz", inviteToken: token },
    });
    expect(start.status(), await start.text()).toBe(200);
    const leftId = ((await start.json()) as { userId: string }).userId;
    const refused = await acceptInvite(left.request, token);
    expect([refused.status, refused.code]).toEqual([409, "passkey_required"]);
    // Signed in already: no second account from the same browser.
    const again = await left.request.post("/api/auth/passkey-account/start", {
      headers: { origin },
      data: { name: "Lee Cruz", inviteToken: token },
    });
    expect(again.status()).toBe(409);
    await cleanUp(seeded.request, leftId, 1);
    expect(await userExists(seeded.request, leftId)).toBe(true);
    await cleanUp(seeded.request, leftId, 24);
    expect(await userExists(seeded.request, leftId)).toBe(false);
    expect((await left.request.get("/api/account")).status()).toBe(401);

    // Without a family invite that works, no account is made at all.
    const stranger = await browser.newContext({ serviceWorkers: "block" });
    await seeded.api.del(`/clients/${kid.id}/family/invites/${created.invite.id}`);
    const withdrawn = await stranger.request.post("/api/auth/passkey-account/start", {
      headers: { origin },
      data: { name: "Lee Cruz", inviteToken: token },
    });
    expect(withdrawn.status()).toBe(410);
    expect((await stranger.request.get("/api/account")).status()).toBe(401);
    await Promise.all([context.close(), left.close(), stranger.close()]);
  });
});
