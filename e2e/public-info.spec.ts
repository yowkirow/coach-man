import { openEnrollment } from "./enroll-support";
import { expect, linkFamily, test, testEmail, visit, watchErrors } from "./support";

// CoachMan's own public pages (WS5a): /about (the home page Google's consent screen links to),
// /privacy, and /terms. They read signed out, carry their own title and description in the HTML
// for link previews, are linked wherever people sign in, enroll, or read an academy's page, and
// a signed-out visit to / meets /about first.

/** What a signed-out visitor's pages may ask and be refused: who's signed in. */
const SIGNED_OUT = new Set(["401 GET /api/account", "401 GET /api/v1/me"]);

test.describe("CoachMan's public pages", () => {
  test.use({ serviceWorkers: "block" });

  test("/about, /privacy, and /terms read signed out", { tag: "@smoke" }, async ({ page }) => {
    const errors = watchErrors(page);
    const { contactEmail } = (await (await page.request.get("/api/public/config")).json()) as {
      contactEmail: string;
    };
    expect(contactEmail).toMatch(/@/);

    await visit(page, "/about");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "One calm place for an academy's courts, players, and families.",
    );
    await expect(page).toHaveTitle(
      "CoachMan: for pickleball academies, coaches, students, and parents",
    );
    for (const name of ["For academies and coaches", "For students and parents", "How to start"]) {
      await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Set up your academy" }).first()).toHaveAttribute(
      "href",
      /^\/sign-in\?next=(%2F|\/)welcome$/,
    );
    const pages = page.getByRole("navigation", { name: "CoachMan", exact: true });
    await expect(pages.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(pages.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    await expect(page.getByRole("link", { name: contactEmail })).toHaveAttribute(
      "href",
      `mailto:${contactEmail}`,
    );

    // The privacy policy, from the footer.
    await page
      .getByRole("navigation", { name: "CoachMan pages" })
      .getByRole("link", { name: "Privacy policy" })
      .click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { name: "Privacy policy", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle("Privacy policy · CoachMan");
    await expect(page.getByText("Last updated November 10, 2026")).toBeVisible();
    await expect(page.getByText("Republic Act No. 10173", { exact: false })).toBeVisible();
    await expect(page.getByText("National Privacy Commission", { exact: false })).toBeVisible();
    const sections = page.getByRole("navigation", { name: "On this page" });
    await sections.getByRole("link", { name: "Children and teens" }).click();
    await expect(page.getByRole("heading", { name: "Children and teens", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: contactEmail }).first()).toHaveAttribute(
      "href",
      `mailto:${contactEmail}`,
    );

    // The terms.
    await visit(page, "/terms");
    await expect(page.getByRole("heading", { name: "Terms of use", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle("Terms of use · CoachMan");
    await expect(page.getByText("Last updated November 6, 2026")).toBeVisible();
    await expect(
      page.getByText("governed by the laws of the Republic of the Philippines", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("CoachMan doesn't process payments.")).toBeVisible();

    // Sign in from the masthead.
    await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(errors.filter((e) => !SIGNED_OUT.has(e))).toEqual([]);
  });

  test("signed out, / opens /about; deeper links go to sign-in and come back", async ({ page }) => {
    await visit(page, "/");
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole("link", { name: "Set up your academy" }).first()).toBeVisible();
    for (const path of ["/clients", "/schedule", "/my"]) {
      await visit(page, path);
      await expect(page).toHaveURL(/\/sign-in\?next=/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(path);
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    }
  });

  test("each page has its own title, description, and contact in the HTML", async ({ request }) => {
    const { contactEmail } = (await (await request.get("/api/public/config")).json()) as {
      contactEmail: string;
    };
    for (const [path, title] of [
      ["/about", "CoachMan: for pickleball academies, coaches, students, and parents"],
      ["/privacy", "Privacy policy · CoachMan"],
      ["/terms", "Terms of use · CoachMan"],
    ] as const) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/html");
      const html = await res.text();
      expect(html.match(/<title>/g)).toHaveLength(1);
      expect(html).toContain(`<title>${title}</title>`);
      expect(html.match(/<meta name="description"/g)).toHaveLength(1);
      expect(html).toMatch(/<meta name="description" content="[^"]{40,}" \/>/);
      expect(html).toContain(`<meta property="og:title" content="${title}" />`);
      expect(html).toMatch(new RegExp(`<link rel="canonical" href="[^"]*${path}" />`));
      expect(html).toContain(
        `<script type="application/json" id="cm-public-config">${JSON.stringify({ contactEmail })}</script>`,
      );
    }
  });

  test("the policies are linked from sign-in, the enrollment wizard, and an academy's page", async ({
    browser,
    seeded,
  }, info) => {
    const setup = await openEnrollment(seeded, info);
    const visitor = await browser.newContext({ serviceWorkers: "block" });
    const page = await visitor.newPage();

    await visit(page, "/sign-in");
    const legal = page.getByRole("navigation", { name: "About CoachMan" });
    await expect(legal.getByRole("link", { name: "About CoachMan" })).toHaveAttribute(
      "href",
      "/about",
    );
    await expect(legal.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    await expect(legal.getByRole("link", { name: "Terms of use" })).toHaveAttribute(
      "href",
      "/terms",
    );

    await visit(page, `/a/${setup.slug}`);
    const policies = page.getByRole("navigation", { name: "CoachMan policies" });
    await expect(policies.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    await expect(policies.getByRole("link", { name: "Terms of use" })).toHaveAttribute(
      "href",
      "/terms",
    );
    await expect(page.getByRole("link", { name: /Made with CoachMan/ })).toHaveAttribute(
      "href",
      "/about",
    );

    // The wizard opens them in a new tab, so the form isn't lost.
    await visit(page, `/a/${setup.slug}/enroll?package=${setup.monthly.id}`);
    await expect(page.getByRole("heading", { name: "Sign in to enroll" })).toBeVisible();
    for (const [name, href] of [
      [/^terms of use/, "/terms"],
      [/^privacy policy/, "/privacy"],
    ] as const) {
      const link = page.getByRole("link", { name });
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toHaveAttribute("target", "_blank");
    }
    await visitor.close();
  });

  test("staff and families find them in Settings and More", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const policyLinks = async (on: import("@playwright/test").Page) => {
      await expect(on.locator("h1").first()).toBeVisible();
      await expect(on.getByRole("link", { name: "Privacy policy", exact: true })).toHaveAttribute(
        "href",
        "/privacy",
      );
      await expect(on.getByRole("link", { name: "Terms of use", exact: true })).toHaveAttribute(
        "href",
        "/terms",
      );
    };
    for (const path of ["/settings", "/more"]) {
      await visit(page, path);
      await policyLinks(page);
    }
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      isJunior: true,
    });
    const email = testEmail("legal-parent", info);
    expect(
      (
        await linkFamily(seeded.request, {
          clientId: kid.id,
          email,
          name: "Pat Santos",
          relation: "guardian",
        })
      ).status,
    ).toBe(201);
    const parent = await personas.open({ email, name: "Pat Santos", persona: "none" });
    for (const path of ["/my/settings", "/my/more"]) {
      await visit(parent.page, path);
      await policyLinks(parent.page);
    }
  });
});

test.describe("CoachMan's public pages offline", () => {
  test.skip(({ isMobile }) => isMobile, "Precaching the app once is enough");

  test("the installed app's cached shell opens them without a connection", async ({
    page,
    context,
  }) => {
    test.slow();
    // The app (here its sign-in page) installs the service worker and its precache.
    await visit(page, "/sign-in");
    const ready = await page.evaluate(() =>
      Promise.race([
        navigator.serviceWorker.ready.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 90_000)),
      ]),
    );
    expect(ready).toBe(true);
    await context.setOffline(true);
    try {
      for (const [path, heading] of [
        ["/privacy", "Privacy policy"],
        ["/terms", "Terms of use"],
        ["/about", "One calm place for an academy's courts, players, and families."],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      }
    } finally {
      await context.setOffline(false);
    }
  });
});
