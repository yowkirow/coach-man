import type { APIResponse, Browser, Page } from "@playwright/test";
import type {
  AccountDto,
  FamilyAccessDto,
  FamilyInviteCreatedDto,
  MeDto,
  StaffInviteCreatedDto,
} from "../src/shared/api-types";
import { INVITE_HEADER } from "../src/shared/domain";
import { emailSinkOf, signInCodeTo } from "./email-support";
import { openEnrollment } from "./enroll-support";
import { settle } from "./push-support";
import {
  Api,
  addMember,
  bornYearsAgo,
  expect,
  inviteToken,
  linkFamily,
  signIn,
  test,
  testEmail,
  visit,
  watchErrors,
} from "./support";

// Codes by email ("Email me a code"): 6-digit codes, only to addresses CoachMan already knows (an
// account's, or one an invite lets in). The Worker records every email in its test sink (see
// email.spec.ts), and these specs read the codes there. With the test bypass on, the limit per
// connection is lifted (every test sends from one), so the flows that only need one browser run on
// desktop to keep the run short.
test.use({ serviceWorkers: "block" });

/** What a signed-out visitor's pages may ask and be refused: who's signed in. */
const SIGNED_OUT = new Set(["401 GET /api/account", "401 GET /api/v1/me"]);

const SIGN_IN_PATH = "/api/auth/sign-in/email-otp";
const SEND_PATH = "/api/auth/email-otp/send-verification-otp";

/** Someone opening a link or the sign-in page in a fresh, signed-out browser. */
async function signedOut(browser: Browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  return { context, page, errors: watchErrors(page) };
}

/** "Email me a code", then the form: a name (when asked), the address, and "Email me a code". */
async function askForCode(page: Page, email: string, name?: string) {
  await page.getByRole("button", { name: "Email me a code", exact: true }).click();
  if (name) await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Email me a code", exact: true }).click();
}

const codeField = (page: Page) => page.getByLabel("Code", { exact: true });

test.describe("codes by email", () => {
  test("a staff invite to any address: the invitee joins with a code, no Google needed", async ({
    browser,
    seeded,
  }, info) => {
    const email = testEmail("code-staff", info);
    const owner = await seeded.api.get<MeDto>("/me");
    const academy = owner.workspace.name;
    const created = await seeded.api.post<StaffInviteCreatedDto>("/team/invites", {
      email,
      role: "front_desk",
    });
    const { context, page, errors } = await signedOut(browser);

    await visit(page, new URL(created.link).pathname);
    await expect(page.getByRole("heading", { name: `Join ${academy}` })).toBeVisible();
    await expect(
      page.getByText(
        `${academy} invited you to CoachMan as front desk staff. Sign in with Google or a code by email, using the address the invite was sent to.`,
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Email me a code", exact: true }).click();
    await expect(page.getByText("The address the invite was sent to.")).toBeVisible();
    await page.getByLabel("Your name").fill("Dana Desk");
    await page.getByLabel("Your email").fill(email.toUpperCase());
    await page.getByRole("button", { name: "Email me a code", exact: true }).click();
    await expect(
      page.getByText(`We sent a 6-digit code to ${email}. It works for 10 minutes.`),
    ).toBeVisible();
    const field = codeField(page);
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("autocomplete", "one-time-code");
    await expect(field).toHaveAttribute("inputmode", "numeric");

    // From the academy, the code first in the subject, with no link and no Reply-To.
    const { code, email: sent } = await signInCodeTo(seeded.request, email);
    expect(sent.fromName).toBe(`${academy} via CoachMan`);
    expect([sent.replyTo, sent.workspaceId]).toEqual([null, owner.workspace.id]);
    expect(sent.text).toContain(
      `1. You asked for a code\nTo join ${academy} on CoachMan as ${email}.`,
    );
    expect(sent.text).toContain(
      `2. Enter this code\n${code}\nIt works once, for the next 10 minutes.`,
    );
    expect(sent.text).toContain(`3. You're signed in\nThen join ${academy}.`);
    expect(sent.html).not.toContain("href=");

    // The sixth digit sends it. Signed in, joining is still a choice they make.
    await field.fill(code);
    await expect(page.getByText("You'll join as front desk staff.")).toBeVisible();
    await page.getByRole("button", { name: `Join ${academy}` }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Today", exact: true }).first()).toBeVisible();
    const me = await new Api(context.request).get<MeDto>("/me");
    expect([me.role, me.workspace.id, me.user.name, me.user.email]).toEqual([
      "front_desk",
      owner.workspace.id,
      "Dana Desk",
      email,
    ]);
    expect(errors.filter((e) => !SIGNED_OUT.has(e))).toEqual([]);
    await context.close();
  });

  test("a returning account signs in on /sign-in with a code: staff land on Today, a parent in the portal", async ({
    browser,
    seeded,
  }, info) => {
    const staff = testEmail("code-back-staff", info);
    await addMember(seeded.request, { email: staff, name: "Kim Lee", role: "coach" });
    const parent = testEmail("code-back-parent", info);
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(10),
      isJunior: true,
    });
    const linked = await linkFamily(seeded.request, {
      clientId: kid.id,
      email: parent,
      name: "Pat Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);

    const signIn = async (address: string) => {
      const session = await signedOut(browser);
      await visit(session.page, "/sign-in");
      await askForCode(session.page, address);
      await expect(
        session.page.getByText(
          `If ${address} can sign in to CoachMan, a 6-digit code is on its way. It works for 10 minutes. Invited by an academy? Open your invite link instead.`,
        ),
      ).toBeVisible();
      const { code, email } = await signInCodeTo(seeded.request, address);
      await codeField(session.page).fill(code);
      return { ...session, email };
    };

    const coach = await signIn(staff);
    await expect(coach.page).toHaveURL(/\/$/);
    await expect(
      coach.page.getByRole("heading", { name: "Today", exact: true }).first(),
    ).toBeVisible();
    // CoachMan's own email, under the app icon, for no academy.
    expect([coach.email.fromName, coach.email.replyTo, coach.email.workspaceId]).toEqual([
      "CoachMan",
      null,
      null,
    ]);
    expect(coach.email.text).toContain(
      `1. You asked for a code\nTo sign in to CoachMan as ${staff}.`,
    );
    expect(coach.email.text.trimEnd()).toMatch(
      /\n\nDidn't ask for a code\? Ignore this email: nobody can sign in without it\.$/,
    );
    expect(coach.email.html).toContain("/icons/icon-192.png");
    expect(coach.email.html).not.toContain("via CoachMan");
    expect(coach.errors.filter((e) => !SIGNED_OUT.has(e))).toEqual([]);

    const family = await signIn(parent);
    await expect(family.page).toHaveURL(/\/my\/?$/);
    await expect(family.page.getByRole("heading", { name: "Hi, Pat" })).toBeVisible();
    await expect(family.page.getByRole("heading", { name: "Mia Santos" })).toBeVisible();
    expect(family.errors.filter((e) => !SIGNED_OUT.has(e))).toEqual([]);
    await Promise.all([coach.context.close(), family.context.close()]);
  });

  test("an unknown address gets the same answer, and nothing is sent", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "One browser is enough");
    const nobody = testEmail("code-nobody", info);
    const errors = watchErrors(page);
    await visit(page, "/sign-in");
    await page.getByRole("button", { name: "Email me a code", exact: true }).click();
    await expect(page.getByLabel("Your email")).toBeFocused();
    // Checked on the page before anything is asked for.
    await page.getByLabel("Your email").fill("pat@");
    await page.getByRole("button", { name: "Email me a code", exact: true }).click();
    await expect(page.getByText("Enter one email address, like name@example.com.")).toBeVisible();

    await page.getByLabel("Your email").fill(nobody);
    await page.getByRole("button", { name: "Email me a code", exact: true }).click();
    await expect(
      page.getByText(
        `If ${nobody} can sign in to CoachMan, a 6-digit code is on its way. It works for 10 minutes. Invited by an academy? Open your invite link instead.`,
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Send a new code in 0:\d\d$/ })).toBeDisabled();
    await settle();
    expect(await emailSinkOf(page.request, nobody)).toEqual([]);

    // "Use another email" goes back with the address kept.
    await page.getByRole("button", { name: "Use another email" }).click();
    await expect(page.getByLabel("Your email")).toHaveValue(nobody);
    await expect(page.getByLabel("Your email")).toBeFocused();
    expect(errors.filter((e) => !SIGNED_OUT.has(e))).toEqual([]);
  });

  test("three wrong tries spend a code, and a new one works once the wait is over", async ({
    browser,
    seeded,
    baseURL,
  }, info) => {
    const email = testEmail("code-wrong", info);
    await addMember(seeded.request, { email, name: "Sam Rivera", role: "coach" });
    const { context, page, errors } = await signedOut(browser);
    await page.clock.install();
    await visit(page, "/sign-in");
    await askForCode(page, email);
    const field = codeField(page);
    await expect(field).toBeFocused();
    const resend = page.getByRole("button", { name: /^Send a new code/ });
    await expect(resend).toHaveText(/^Send a new code in 0:[1-3]\d$/);
    await expect(resend).toBeDisabled();
    const { code } = await signInCodeTo(seeded.request, email);
    const wrong = code === "000000" ? "111111" : "000000";
    const signIn = page.getByRole("button", { name: "Sign in", exact: true });
    const tryCode = async (submit: () => Promise<void>) => {
      const answered = page.waitForResponse((r) => r.url().endsWith(SIGN_IN_PATH));
      await submit();
      return (await answered).status();
    };

    expect(await tryCode(() => field.fill(wrong))).toBe(400);
    await expect(
      page.getByText("That code isn't right. Check the newest email from CoachMan."),
    ).toBeVisible();
    expect(await tryCode(() => signIn.click())).toBe(400);
    await field.fill("");
    expect(await tryCode(() => field.fill(wrong))).toBe(403);
    await expect(
      page.getByText("That code was tried too many times. Send a new one."),
    ).toBeVisible();
    await expect(signIn).toBeDisabled();
    // Spent: even the right code no longer works.
    const origin = new URL(baseURL ?? page.url()).origin;
    const late = await context.request.post(SIGN_IN_PATH, {
      headers: { origin },
      data: { email, otp: code },
    });
    expect(late.status()).toBe(400);

    // Thirty seconds after the code went, a new one can be sent, and it signs in.
    await page.clock.fastForward("00:31");
    await expect(resend).toHaveText("Send a new code");
    await resend.click();
    await expect(
      page.getByText(`If ${email} can sign in to CoachMan, a new 6-digit code is on its way.`, {
        exact: false,
      }),
    ).toBeVisible();
    await expect(field).toBeFocused();
    await expect(resend).toBeDisabled();
    const fresh = await signInCodeTo(seeded.request, email, 2);
    await field.fill(fresh.code);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Today", exact: true }).first()).toBeVisible();
    // The wrong tries were the server's answers; nothing else failed.
    expect(errors.filter((e) => !SIGNED_OUT.has(e) && !e.endsWith(`POST ${SIGN_IN_PATH}`))).toEqual(
      [],
    );
    await context.close();
  });

  test("a staff invite takes only the address it was sent to", async ({
    browser,
    seeded,
  }, info) => {
    test.skip(info.project.name !== "desktop", "One browser is enough");
    const invited = testEmail("code-invited", info);
    const created = await seeded.api.post<StaffInviteCreatedDto>("/team/invites", {
      email: invited,
      role: "coach",
    });
    const other = testEmail("code-other", info);
    const { context, page, errors } = await signedOut(browser);

    await visit(page, new URL(created.link).pathname);
    await askForCode(page, other, "Lee Stranger");
    await expect(
      page.getByText(
        `This invite was sent to another address (${invited[0]}•••@coachman.test). Use that one.`,
      ),
    ).toBeVisible();
    // Still on the first step, with what they typed.
    await expect(page.getByLabel("Your email")).toHaveValue(other);
    await settle();
    expect(await emailSinkOf(seeded.request, other)).toEqual([]);
    expect((await emailSinkOf(seeded.request, invited)).map((e) => e.kind)).toEqual([
      "staff_invite",
    ]);
    // The other ways in are a tap away.
    await page.getByRole("button", { name: "Other ways to sign in" }).click();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(errors.filter((e) => !SIGNED_OUT.has(e) && e !== `403 POST ${SEND_PATH}`)).toEqual([]);
    await context.close();
  });

  test("a family invite: a code to any address makes the account, named as typed, and it accepts", async ({
    browser,
    seeded,
  }, info) => {
    const academy = (await seeded.api.get<MeDto>("/me")).workspace.name;
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(10),
      isJunior: true,
    });
    const created = await seeded.api.post<FamilyInviteCreatedDto>(
      `/clients/${kid.id}/family/invites`,
      { relation: "guardian" },
    );
    const parent = testEmail("code-parent", info);
    const { context, page, errors } = await signedOut(browser);

    await visit(page, new URL(created.link).pathname);
    await expect(page.getByRole("heading", { name: "Follow Mia's training" })).toBeVisible();
    await expect(page.getByText(/^No Google account\? Get a code by email/)).toBeVisible();
    await askForCode(page, parent, "  Pat Santos ");
    await expect(
      page.getByText(`We sent a 6-digit code to ${parent}. It works for 10 minutes.`),
    ).toBeVisible();
    const { code, email } = await signInCodeTo(seeded.request, parent);
    expect(email.fromName).toBe(`${academy} via CoachMan`);
    expect(email.text).toContain(
      `1. You asked for a code\nTo accept ${academy}'s invite as ${parent}.`,
    );
    expect(email.text).toContain("3. You're signed in\nThen accept the invite.");

    await codeField(page).fill(code);
    await expect(
      page.getByText("Accept to follow Mia's training as their parent or guardian."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Accept invite" }).click();
    await expect(page).toHaveURL(/\/my\/?$/);
    await expect(page.getByRole("heading", { name: "Hi, Pat" })).toBeVisible();
    const access = await seeded.api.get<FamilyAccessDto>(`/clients/${kid.id}/family`);
    expect(access.links.map((l) => [l.name, l.relation, l.email])).toEqual([
      ["Pat Santos", "guardian", parent],
    ]);
    expect(errors.filter((e) => !SIGNED_OUT.has(e))).toEqual([]);
    await context.close();
  });

  test("a returning family signs in with a code in the enrollment wizard, and it goes on", async ({
    browser,
    seeded,
  }, info) => {
    test.skip(info.project.name !== "desktop", "One browser is enough");
    const setup = await openEnrollment(seeded, info);
    // Someone who already has an account (made here as a Google sign-in would).
    const parent = testEmail("code-enroll", info);
    const first = await browser.newContext({ serviceWorkers: "block" });
    await signIn(first.request, { email: parent, name: "Pat Santos", persona: "none" });
    await first.close();
    const { context, page, errors } = await signedOut(browser);

    await visit(page, `/a/${setup.slug}/enroll?package=${setup.monthly.id}`);
    await expect(page.getByRole("heading", { name: "Sign in to enroll" })).toBeVisible();
    await page.getByRole("button", { name: "I have an account: email me a code" }).click();
    await expect(
      page.getByText("We'll email a code to the address of the CoachMan account you already have."),
    ).toBeVisible();
    await page.getByLabel("Your email").fill(parent);
    await page.getByRole("button", { name: "Email me a code", exact: true }).click();
    const { code } = await signInCodeTo(seeded.request, parent);
    await codeField(page).fill(code);
    await expect(page.getByRole("heading", { name: "Who's training?" })).toBeVisible();
    expect(errors.filter((e) => !SIGNED_OUT.has(e))).toEqual([]);
    await context.close();
  });

  test("the API: only sign-in codes, never an account without an invite, and limits per address", async ({
    browser,
    seeded,
    baseURL,
  }, info) => {
    test.skip(info.project.name !== "desktop", "An API flow: one browser is enough");
    const origin = new URL(baseURL ?? "http://localhost:5173").origin;
    const context = await browser.newContext({ serviceWorkers: "block" });
    const post = (path: string, data: unknown, headers: Record<string, string> = {}) =>
      context.request.post(`/api/auth${path}`, { headers: { origin, ...headers }, data });
    const answer = async (res: APIResponse) => [
      res.status(),
      ((await res.json().catch(() => ({}))) as { code?: string }).code,
    ];

    // The plugin's other endpoints, and other kinds of code, are shut.
    const someone = testEmail("code-api-someone", info);
    for (const [path, body] of [
      ["/email-otp/request-email-change", { newEmail: someone }],
      ["/email-otp/change-email", { newEmail: someone, otp: "123456" }],
      ["/forget-password/email-otp", { email: someone }],
      ["/email-otp/request-password-reset", { email: someone }],
      ["/email-otp/reset-password", { email: someone, otp: "123456", password: "x".repeat(16) }],
      ["/email-otp/verify-email", { email: someone, otp: "123456" }],
      ["/email-otp/check-verification-otp", { email: someone, type: "sign-in", otp: "123456" }],
    ] as const) {
      expect(await answer(await post(path, body)), path).toEqual([404, "not_found"]);
    }
    for (const type of ["email-verification", "forget-password", "change-email"]) {
      expect(
        await answer(await post("/email-otp/send-verification-otp", { email: someone, type })),
        type,
      ).toEqual([404, "not_found"]);
    }
    expect(
      await answer(
        await post("/email-otp/send-verification-otp", { email: "pat@", type: "sign-in" }),
      ),
    ).toEqual([400, "invalid_email"]);

    // A code through a family invite, to a new address...
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
    const invite = { [INVITE_HEADER]: inviteToken(created.link) };
    const fresh = testEmail("code-api-new", info);
    const sent = await post(
      "/email-otp/send-verification-otp",
      { email: fresh, type: "sign-in" },
      invite,
    );
    expect(sent.status(), await sent.text()).toBe(200);
    const { code } = await signInCodeTo(seeded.request, fresh);

    // ...makes no account without the invite: the answer is an account's wrong-code answer, word
    // for word, so it says nothing about who has an account.
    const bare = await post("/sign-in/email-otp", { email: fresh, otp: code, name: "Lee Cruz" });
    const account = await post("/sign-in/email-otp", { email: seeded.email, otp: "123456" });
    expect([bare.status(), account.status()]).toEqual([400, 400]);
    expect(await bare.text()).toBe(await account.text());
    expect(await bare.json()).toEqual({ message: "Invalid OTP", code: "INVALID_OTP" });
    // Nor without a name, nor with a picture.
    expect(
      await answer(await post("/sign-in/email-otp", { email: fresh, otp: code }, invite)),
    ).toEqual([400, "name_required"]);
    expect(
      await answer(
        await post(
          "/sign-in/email-otp",
          { email: fresh, otp: code, name: "Lee Cruz", image: "https://example.com/me.png" },
          invite,
        ),
      ),
    ).toEqual([400, "bad_request"]);
    expect((await context.request.get("/api/account")).status()).toBe(401);

    // With the invite and a name, the same code makes the account and signs it in, once.
    const ok = await post(
      "/sign-in/email-otp",
      { email: fresh.toUpperCase(), otp: code, name: "  Lee Cruz  " },
      invite,
    );
    expect(ok.status(), await ok.text()).toBe(200);
    const me = (await (await context.request.get("/api/account")).json()) as AccountDto;
    expect([me.user.name, me.user.email]).toEqual(["Lee Cruz", fresh]);
    expect(
      await answer(await post("/sign-in/email-otp", { email: fresh, otp: code }, invite)),
    ).toEqual([400, "INVALID_OTP"]);

    // Every request for an address counts, a code sent or not: the fourth in 15 minutes is refused.
    const busy = testEmail("code-api-busy", info);
    for (let i = 0; i < 3; i++) {
      const res = await post("/email-otp/send-verification-otp", { email: busy, type: "sign-in" });
      expect(res.status()).toBe(200);
    }
    const fourth = await post("/email-otp/send-verification-otp", { email: busy, type: "sign-in" });
    expect(fourth.status()).toBe(429);
    expect(await fourth.json()).toEqual({
      message: "Too many codes were asked for. Wait a few minutes, then try again.",
      code: "rate_limited",
    });
    expect(fourth.headers()["retry-after"]).toMatch(/^\d+$/);
    expect(await emailSinkOf(seeded.request, busy)).toEqual([]);
    await context.close();
  });
});
