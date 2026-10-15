import { expect, onboard, test } from "./support";

// Passkeys with Chromium's virtual WebAuthn authenticator (CDP). The origin must match the
// Worker's APP_URL / PASSKEY_RP_ID (http://localhost:5173 locally).
test.describe("passkeys", () => {
  test.skip(
    ({ browserName, isMobile }) => browserName !== "chromium" || isMobile,
    "Needs Chromium CDP; runs once",
  );

  test("add a passkey during onboarding, sign out, and sign back in with it", async ({
    page,
    context,
    coach,
  }) => {
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

    await onboard(coach.api);
    await page.goto("/onboarding?step=passkey");
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByRole("heading", { name: "Stay a step ahead" })).toBeVisible();

    await page.goto("/more");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page).not.toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { name: "Today", exact: true }).first()).toBeVisible();
  });
});
