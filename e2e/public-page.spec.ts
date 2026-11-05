import type {
  AcademyDto,
  ClientListItemDto,
  ConsentDocumentDto,
  GroupDto,
  MeDto,
  PackageTemplateDto,
  PublicAcademyDto,
  PublicConsentDocumentDto,
} from "../src/shared/api-types";
import {
  expect,
  listAcademy,
  onboard,
  pngImage,
  test,
  uploadPng,
  uuid,
  visit,
  watchErrors,
} from "./support";

// The public academy page (WS4a): /a/<slug> and its printable rates sheet, the link-preview tags
// the Worker writes into the HTML, and the public API behind them (published data only).

/** Every key the public academy API may send (the page's DTOs, nothing else). */
const PUBLIC_KEYS = new Set([
  // PublicAcademyDto
  "slug",
  "name",
  "tagline",
  "about",
  "logoKey",
  "coverKey",
  "contactPhone",
  "contactEmail",
  "address",
  "mapUrl",
  "socials",
  "policies",
  "enrollmentOpen",
  "currency",
  "locale",
  "timezone",
  "weekStartsOn",
  "programs",
  "packages",
  "coaches",
  "consents",
  "today",
  "updatedAt",
  // programs, their weekly sessions, venues, coach refs
  "id",
  "description",
  "level",
  "ageMin",
  "ageMax",
  "capacity",
  "scheduleNote",
  "schedule",
  "weekdays",
  "startTime",
  "durationMinutes",
  "venue",
  "nextSessionAt",
  "title",
  "photoKey",
  // packages
  "programId",
  "priceMinor",
  "credits",
  "sessionsLabel",
  "validityMode",
  "validityDays",
  "inclusions",
  "audience",
  "commitmentNote",
  "includesUniform",
  "asksSelfRating",
  "highlight",
  "coach",
  // coaches
  "bio",
  "certifications",
  "specialties",
  "languages",
  "yearsCoaching",
  "duprRating",
  // consents
  "kind",
  "version",
  "appliesTo",
]);

/** Keys of a JSON value, recursively (the socials map's keys are its networks). */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      if (k !== "socials") keysOf(v, out);
    }
  }
  return out;
}

const PROFILE = {
  name: "Riverside Pickleball Academy",
  tagline: "Train with purpose, play with joy",
  about: "Evening training with drills, live play, and honest feedback.",
  contactPhone: "+63 917 555 0100",
  contactEmail: "hello@riverside.example",
  address: "Riverside Park Courts, Quezon City",
  mapUrl: "https://maps.google.com/?q=Riverside+Park+Courts",
  socials: { facebook: "https://www.facebook.com/riversidepickleball" },
  policies: "Missed sessions can be made up within the same month.",
};

test.describe("the public academy page", () => {
  test("a listed academy shows its program, tiers, coaches, and contact, and nothing unpublished @smoke", async ({
    browser,
    seeded,
  }, info) => {
    const { api } = seeded;
    const me = await api.get<MeDto>("/me");
    await api.patch(`/coaches/${me.user.id}`, {
      isPublic: true,
      title: "Head coach",
      certifications: ["RPO licensed coach"],
    });
    const program = (await api.get<GroupDto[]>("/groups")).find(
      (g) => g.name === "Evening program",
    );
    if (!program) throw new Error("The sample academy has no Evening program");
    const secret = await api.post<GroupDto>("/groups", { name: "Secret squad" });
    for (const tier of [
      { name: "Hidden tier", programId: secret.id, isPublic: true },
      { name: "Draft tier", programId: program.id, isPublic: false },
      { name: "Retired tier", programId: program.id, isPublic: true, active: false },
    ]) {
      await api.post<PackageTemplateDto>("/packages", { credits: 4, priceMinor: 100000, ...tier });
    }
    const slug = await listAcademy(api, info, PROFILE);

    const visitor = await browser.newContext({ serviceWorkers: "block" });
    const page = await visitor.newPage();
    const errors = watchErrors(page);
    await visit(page, `/a/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(PROFILE.name);
    await expect(page.getByText(PROFILE.tagline)).toBeVisible();
    await expect(page).toHaveTitle(`${PROFILE.name} · ${PROFILE.tagline}`);

    // The program: its days and times from the weekly sessions, venue, and coaches.
    const pass = page.locator("section", {
      has: page.getByRole("heading", { name: "Evening program", level: 2 }),
    });
    await expect(pass).toContainText("Tue");
    await expect(pass).toContainText("Thu");
    await expect(pass).toContainText("Riverside Park Courts");
    await expect(pass.getByRole("link", { name: /Directions/ })).toBeVisible();

    // Its tiers, the featured one marked, prices per head, month-end validity, inclusions.
    await expect(page.getByRole("heading", { name: "Rates", level: 2 })).toBeVisible();
    const tiers = page.getByRole("article");
    await expect(tiers).toHaveCount(3);
    await expect(page.getByRole("article", { name: "Trial" })).toContainText("₱1,500");
    const monthly = page.getByRole("article", { name: "Monthly", exact: true });
    await expect(monthly).toContainText("₱6,000");
    await expect(monthly).toContainText("4–6 sessions");
    await expect(monthly).toContainText("Valid until the end of the month");
    await expect(monthly).toContainText("Best to enroll early in the month.");
    await expect(monthly).toContainText("Court fees included");
    await expect(monthly).toContainText("Who it's for");
    const plus = page.getByRole("article", { name: "Monthly plus" });
    await expect(plus).toContainText("Featured");
    await expect(plus).toContainText("₱7,000");

    // About, coaches, contact, and policies.
    await expect(page.getByRole("region", { name: `About ${PROFILE.name}` })).toContainText(
      PROFILE.about,
    );
    const coaches = page.getByRole("region", { name: "Coaches" });
    await expect(coaches).toContainText("Robin Coach");
    await expect(coaches).toContainText("Head coach");
    await expect(coaches).toContainText("RPO licensed coach");
    const contact = page.getByRole("region", { name: "Contact" });
    await expect(contact.getByRole("link", { name: PROFILE.contactPhone })).toHaveAttribute(
      "href",
      "tel:+639175550100",
    );
    await expect(contact.getByRole("link", { name: /Open the map/ })).toHaveAttribute(
      "href",
      PROFILE.mapUrl,
    );
    await expect(contact.getByRole("link", { name: /Facebook/ })).toHaveAttribute(
      "href",
      PROFILE.socials.facebook,
    );
    await expect(page.getByRole("link", { name: "Message us" })).toHaveAttribute(
      "href",
      "https://m.me/riversidepickleball",
    );
    await expect(page.getByRole("region", { name: "Policies" })).toContainText(PROFILE.policies);

    // Nothing unpublished, and no enroll button while the academy isn't taking enrollments (its
    // tiers say enrollment is closed and how to get in touch instead).
    for (const hidden of [
      "Secret squad",
      "Hidden tier",
      "Draft tier",
      "Retired tier",
      "Beginners",
    ]) {
      await expect(page.getByText(hidden)).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /enrol/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /enrol/i })).toHaveCount(0);

    await page.getByRole("link", { name: "View printable rates" }).click();
    await expect(page).toHaveURL(new RegExp(`/a/${slug}/rates$`));
    await expect(page.getByRole("heading", { name: "Rates and packages" })).toBeVisible();
    expect(errors).toEqual([]);
    await visitor.close();
  });

  test("an unlisted academy isn't found, and its staff can preview it", async ({
    browser,
    page,
    coach,
    request,
  }) => {
    const { api } = coach;
    await onboard(api);
    const slug = `e2e-quiet-${uuid().slice(0, 8)}`;
    await api.patch("/academy", { name: "Quiet Courts Academy", slug, listed: false });
    const me = await api.get<MeDto>("/me");

    for (const path of [slug, `e2e-nobody-${uuid().slice(0, 8)}`, `ws-${me.workspace.id}`]) {
      const res = await request.get(`/api/public/academies/${path}`);
      expect(res.status(), path).toBe(404);
    }
    const visitor = await browser.newContext({ serviceWorkers: "block" });
    const outside = await visitor.newPage();
    await visit(outside, `/a/${slug}`);
    await expect(
      outside.getByRole("heading", { name: "This academy page isn't available" }),
    ).toBeVisible();
    await expect(outside.getByText("Quiet Courts Academy")).toHaveCount(0);
    await visitor.close();

    // Settings → Academy profile → Preview: the page as families will see it, for staff only.
    const errors = watchErrors(page);
    await visit(page, "/settings");
    const profile = page.getByRole("region", { name: "Academy profile" });
    await expect(profile.getByRole("button", { name: "Copy link" })).toHaveCount(0);
    await profile.getByRole("link", { name: "Preview public page" }).click();
    await expect(page).toHaveURL(new RegExp(`/a/${slug}\\?preview=1$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quiet Courts Academy");
    await expect(page.getByRole("note")).toContainText("Preview of your academy page");
    await expect(page.getByRole("note")).toContainText("Only your team can see this");
    expect(errors).toEqual([]);

    // Listed, the profile offers the link to share.
    await api.patch<AcademyDto>("/academy", { listed: true });
    await visit(page, "/settings");
    await expect(profile.getByRole("button", { name: "Copy link" })).toBeVisible();
    expect((await request.get(`/api/public/academies/${slug}`)).status()).toBe(200);
  });

  test("the rates sheet prints without the app around it", async ({ browser, seeded }, info) => {
    const slug = await listAcademy(seeded.api, info, PROFILE);
    const visitor = await browser.newContext({ serviceWorkers: "block" });
    const page = await visitor.newPage();
    const errors = watchErrors(page);
    await visit(page, `/a/${slug}/rates`);
    await expect(page.getByRole("heading", { name: "Rates and packages", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(`Rates and packages · ${PROFILE.name}`);
    const sheet = page.getByRole("article", { name: "Rates and packages" });
    await expect(sheet).toContainText(PROFILE.name);
    await expect(sheet).toContainText(PROFILE.tagline);
    await expect(sheet.locator(".rates-tier h3")).toHaveText([
      /^Trial$/,
      /^Monthly$/,
      /^Monthly plus/,
    ]);
    await expect(sheet).toContainText("Rates and schedule");
    await expect(sheet).toContainText(
      "Valid until the end of the month; best to enroll early in the month.",
    );
    await expect(sheet).toContainText("Inclusions");
    await expect(sheet).toContainText("₱7,000");

    // The button opens the browser's print dialog.
    await page.evaluate(() => {
      const w = window as unknown as { printed: number };
      w.printed = 0;
      window.print = () => {
        w.printed += 1;
      };
    });
    const print = page.getByRole("button", { name: "Print or save as PDF" });
    await print.click();
    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

    // Printed: no toolbar, white paper, each tier kept on one page.
    await page.emulateMedia({ media: "print" });
    await expect(print).toBeHidden();
    await expect(page.getByRole("link", { name: PROFILE.name })).toBeHidden();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      "rgb(255, 255, 255)",
    );
    const breaks = await page
      .locator(".rates-tier")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).breakInside));
    expect(breaks.length).toBe(3);
    expect(new Set(breaks)).toEqual(new Set(["avoid"]));
    await page.emulateMedia({ media: "screen" });
    await expect(print).toBeVisible();
    expect(errors).toEqual([]);
    await visitor.close();
  });

  test("shared links carry the academy's own preview tags, escaped", async ({
    coach,
    request,
  }, info) => {
    const { api } = coach;
    await onboard(api);
    const name = `Ace & "Smash" <Club>`;
    const slug = await listAcademy(api, info, { name, tagline: "Rally & roll" });
    const logo = await uploadPng(coach.request, "/academy/logo", pngImage(64, [16, 56, 105]));
    const escaped = "Ace &amp; &quot;Smash&quot; &lt;Club&gt;";
    const base = new URL(info.project.use.baseURL ?? "http://localhost:5173").origin;

    const shell = await request.get("/");
    const res = await request.get(`/a/${slug}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(`<title>${escaped}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${escaped}" />`);
    expect(html).toContain(`<meta name="description" content="Rally &amp; roll" />`);
    expect(html).toContain(`<meta property="og:url" content="${base}/a/${slug}" />`);
    expect(html).toContain(
      `<meta property="og:image" content="${base}/api/public/files/${logo.key}" />`,
    );
    expect(html).toContain(`<meta name="twitter:card" content="summary" />`);
    expect(html).not.toContain("<Club>");
    // One title (the shell's own is replaced), and the page data for the app, escaped.
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain('<script type="application/json" id="cm-public-academy">');
    expect(html).toContain("\\u003cClub\\u003e");
    // The shell's security headers are kept.
    for (const header of [
      "content-security-policy",
      "x-content-type-options",
      "referrer-policy",
      "x-frame-options",
      "permissions-policy",
      "strict-transport-security",
    ]) {
      expect(res.headers()[header], header).toBe(shell.headers()[header]);
    }

    const rates = await (await request.get(`/a/${slug}/rates`)).text();
    expect(rates).toContain(
      `<meta property="og:title" content="Rates and packages · ${escaped}" />`,
    );

    // Unknown and unlisted academies get CoachMan's own tags and the app (which says not found).
    const unknown = await request.get(`/a/e2e-nobody-${uuid().slice(0, 8)}`);
    expect(unknown.status()).toBe(200);
    const unknownHtml = await unknown.text();
    expect(unknownHtml).toContain("<title>CoachMan</title>");
    expect(unknownHtml).toContain('<meta property="og:title" content="CoachMan" />');
    expect(unknownHtml).not.toContain("cm-public-academy");
    await api.patch("/academy", { listed: false });
    const unlisted = await (await request.get(`/a/${slug}`)).text();
    expect(unlisted).toContain("<title>CoachMan</title>");
    expect(unlisted).not.toContain("Smash");
  });

  test("the public API sends only published data the page needs", async ({
    seeded,
    request,
  }, info) => {
    const { api } = seeded;
    const me = await api.get<MeDto>("/me");
    await api.patch(`/coaches/${me.user.id}`, { isPublic: true, title: "Head coach" });
    const groups = await api.get<GroupDto[]>("/groups");
    const program = groups.find((g) => g.name === "Evening program");
    if (!program) throw new Error("The sample academy has no Evening program");
    await api.patch(`/groups/${program.id}`, { description: "INTERNAL-GROUP-NOTE" });
    const tier = (await api.get<PackageTemplateDto[]>("/packages")).find(
      (t) => t.name === "Monthly",
    );
    if (!tier) throw new Error("The sample academy has no Monthly tier");
    await api.patch(`/packages/${tier.id}`, { description: "INTERNAL-PACKAGE-NOTE" });
    await api.post<ConsentDocumentDto>("/consent-documents", {
      kind: "waiver",
      title: "Activity waiver",
      body: "Training carries a risk of injury.",
    });
    await api.post<ConsentDocumentDto>("/consent-documents", {
      kind: "media",
      title: "Photo consent",
      body: "Optional.",
      required: false,
    });
    await api.post<ConsentDocumentDto>("/consent-documents", {
      kind: "other",
      title: "Draft rules",
      body: "Not yet.",
      active: false,
    });
    const slug = await listAcademy(api, info, {
      ...PROFILE,
      paymentInstructions: "INTERNAL-PAYMENT-NOTE",
    });

    const res = await request.get(`/api/public/academies/${slug}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("public, max-age=60");
    const text = await res.text();
    const data = JSON.parse(text) as PublicAcademyDto;
    expect([...keysOf(data)].filter((k) => !PUBLIC_KEYS.has(k))).toEqual([]);
    expect(text).not.toContain("INTERNAL-");
    expect(text).not.toContain(seeded.email);
    expect(text).not.toContain(me.user.id);
    const clients = await api.get<ClientListItemDto[]>("/clients");
    expect(clients.length).toBeGreaterThan(0);
    for (const c of clients) expect(text).not.toContain(`${c.firstName} ${c.lastName}`);
    // Published only: the one public program and its public tiers; the required active consent.
    expect(data.programs.map((p) => p.name)).toEqual(["Evening program"]);
    expect(data.packages.map((p) => p.name).sort()).toEqual(["Monthly", "Monthly plus", "Trial"]);
    expect(data.coaches.map((c) => c.name)).toEqual(["Robin Coach"]);
    expect(data.consents.map((c) => c.title)).toEqual(["Activity waiver"]);
    expect(data.packages.every((p) => typeof p.priceMinor === "number")).toBe(true);

    const consents = await request.get(`/api/public/academies/${slug}/consents`);
    expect(consents.status()).toBe(200);
    const docs = (await consents.json()) as PublicConsentDocumentDto[];
    expect(docs.map((d) => [d.title, d.body])).toEqual([
      ["Activity waiver", "Training carries a risk of injury."],
    ]);
  });
});
