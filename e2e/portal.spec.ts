import type {
  FamilyAccessDto,
  LessonDetailDto,
  MeDto,
  PortalHomeDto,
  PortalStudentDto,
  PortalTeenInviteCreatedDto,
  TodayDto,
} from "../src/shared/api-types";
import {
  auditLog,
  bornYearsAgo,
  expect,
  inviteToken,
  linkFamily,
  pngImage,
  portalCall,
  portalGet,
  test,
  testEmail,
  uploadPng,
  uuid,
  visit,
  watchErrors,
} from "./support";

// The family portal (/my): what parents and students see, the student and academy switcher, a
// parent managing their teen's own login, the academy ending access, and people who are staff and
// family at once. Service workers are blocked: offline use isn't tested here (see family.spec.ts).
test.use({ serviceWorkers: "block" });

/** `day` moved by `days` (YYYY-MM-DD). */
function shift(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Resolves once the image has loaded and has pixels. */
async function loaded(img: import("@playwright/test").Locator) {
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
}

test.describe("the family portal", () => {
  test("a family's pages work on a phone and a laptop, under each academy's name and logo", async ({
    seeded,
    personas,
  }, info) => {
    const { api, request } = seeded;
    const me = await api.get<MeDto>("/me");
    const { date: today } = await api.get<TodayDto>("/today");
    await api.patch("/academy", {
      name: "Riverside Pickleball Academy",
      tagline: "Steady hands, smart feet",
      contactPhone: "0917 555 0142",
      contactEmail: "hello@riverside.example",
      address: "12 Riverside Drive, Pasig City",
      paymentInstructions: "GCash 0917 555 0142 (Riverside). Send the reference to the front desk.",
      policies: "Cancel a day ahead to keep your credit.",
    });
    await uploadPng(request, "/academy/logo", pngImage(64, [16, 56, 105]));
    await uploadPng(request, "/academy/payment-qr", pngImage(96, [24, 24, 24]));
    await api.patch(`/coaches/${me.user.id}`, {
      title: "Head coach",
      bio: "Coaching juniors on the Pasig courts since 2015.",
      isPublic: true,
    });

    const mia = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(10),
      isJunior: true,
      medicalNotes: "Mild asthma: her inhaler is in the side pocket of her bag.",
      emergencyName: "Pat Santos",
      emergencyPhone: "0917 000 1111",
    });
    await uploadPng(request, `/clients/${mia.id}/photo`, pngImage(48, [240, 180, 160]));
    const pack = await api.post<{ id: string }>("/packages", {
      name: "10-session pack",
      credits: 10,
      priceMinor: 500000,
      validityDays: 90,
    });
    await api.post(`/clients/${mia.id}/packages`, {
      packageId: pack.id,
      payment: { amountMinor: 300000, method: "GCash", reference: "GC-1042" },
    });
    const skills = await api.get<{ id: string }[]>("/skills");
    await api.post(`/clients/${mia.id}/assessments`, {
      assessedOn: today,
      overallLevel: "2.5",
      notes: "Big step up at the kitchen line.",
      scores: skills.slice(0, 4).map((s, i) => ({ skillId: s.id, score: 2 + (i % 3) })),
      sharedWithFamily: true,
    });
    await api.post(`/clients/${mia.id}/goals`, {
      title: "Land 8 of 10 third-shot drops",
      targetDate: shift(today, 30),
    });
    await api.post(`/clients/${mia.id}/ratings`, {
      source: "coach",
      value: 2.75,
      recordedOn: today,
    });
    await api.post("/notes", {
      clientId: mia.id,
      body: "Mia read the wind well and kept her resets low.",
      visibility: "shared",
    });
    await api.post("/lessons", {
      kind: "private",
      date: shift(today, 1),
      startTime: "09:00",
      durationMinutes: 60,
      clientIds: [mia.id],
    });
    const earlier = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "private",
      date: shift(today, -2),
      startTime: "16:00",
      durationMinutes: 60,
      clientIds: [mia.id],
    });
    const entry = earlier.lesson.roster[0];
    const mid = uuid();
    await api.post(
      `/attendance/${entry?.attendanceId}`,
      { status: "present", mutationId: mid },
      { "Idempotency-Key": mid },
    );

    // Her brother trains at another academy.
    const other = await personas.open({
      email: testEmail("academy-b", info),
      name: "Lee Coach",
      persona: "coach",
    });
    await other.api.patch("/academy", { name: "Northside Tennis Club" });
    const leo = await other.api.post<{ id: string }>("/clients", {
      firstName: "Leo",
      lastName: "Santos",
      birthDate: bornYearsAgo(12),
      isJunior: true,
    });

    const email = testEmail("parent", info);
    for (const [req, clientId] of [
      [request, mia.id],
      [other.context.request, leo.id],
    ] as const) {
      const linked = await linkFamily(req, {
        clientId,
        email,
        name: "Pat Santos",
        relation: "guardian",
      });
      expect(linked.status).toBe(201);
    }

    const { page } = await personas.open({ email, name: "Pat Santos", persona: "none" });
    const errors = watchErrors(page);
    const header = page.locator("header").first();

    // Home: both children, where each trains, the latest shared comment, and both academies.
    await visit(page, "/my");
    await expect(page.getByRole("heading", { name: "Hi, Pat" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mia Santos" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Leo Santos" })).toBeVisible();
    await expect(
      page.getByText("You're their parent or guardian · Riverside Pickleball Academy"),
    ).toBeVisible();
    await expect(
      page.getByText("You're their parent or guardian · Northside Tennis Club"),
    ).toBeVisible();
    await expect(page.getByText("Mia read the wind well and kept her resets low.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Balance: ₱2,000\.00 due/ })).toBeVisible();
    await expect(page.getByText("News from", { exact: false })).toBeVisible();

    // Progress: shared assessment, goal, and rating, under Mia's academy's logo and name.
    await visit(page, `/my/${mia.id}/progress`);
    await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
    await expect(header).toContainText("Riverside Pickleball Academy");
    await loaded(header.locator("img").first());
    await expect(page.getByText("Big step up at the kitchen line.")).toBeVisible();
    await expect(page.getByText("Land 8 of 10 third-shot drops")).toBeVisible();
    await expect(page.getByRole("region", { name: "Rating" })).toBeVisible();

    // The switcher moves between the children, and the header follows their academy.
    const switcher = page.getByRole("navigation", { name: "Students" });
    await switcher.getByRole("link", { name: /^Leo/ }).click();
    await expect(page).toHaveURL(new RegExp(`/my/${leo.id}/progress$`));
    await expect(header).toContainText("Northside Tennis Club");
    await expect(page.getByText("Big step up at the kitchen line.")).toHaveCount(0);
    await switcher.getByRole("link", { name: /^Mia/ }).click();
    await expect(page).toHaveURL(new RegExp(`/my/${mia.id}/progress$`));
    await expect(header).toContainText("Riverside Pickleball Academy");

    // Schedule and attendance.
    await visit(page, `/my/${mia.id}/schedule`);
    await expect(page.getByRole("heading", { name: "Schedule", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Tomorrow · / })).toBeVisible();
    await expect(page.getByText("1 of 1 checked in")).toBeVisible();

    // Coaches: a public profile shows its title and bio.
    await visit(page, `/my/${mia.id}/coaches`);
    const coachCard = page.getByRole("article", { name: me.user.name });
    await expect(coachCard).toContainText("Head coach");
    await expect(coachCard).toContainText("Coaching juniors on the Pasig courts since 2015.");

    // Payments: the balance, the package and its credits, the history, and how to pay.
    await visit(page, `/my/${mia.id}/payments`);
    await expect(page.getByRole("heading", { name: "Payments", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Balance" })).toContainText("₱2,000.00");
    await expect(page.getByText("10-session pack").first()).toBeVisible();
    await expect(page.getByText("Payment received")).toBeVisible();
    await expect(page.getByText("GCash 0917 555 0142 (Riverside)", { exact: false })).toBeVisible();
    await loaded(
      page.getByRole("img", { name: "Payment QR code for Riverside Pickleball Academy" }),
    );

    // Profile: basics and the health and emergency summary, read-only.
    await visit(page, `/my/${mia.id}/profile`);
    await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
    await expect(
      page.getByText("Mild asthma: her inhaler is in the side pocket", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("0917 000 1111")).toBeVisible();

    // More and Settings.
    await visit(page, "/my/more");
    await expect(page.getByRole("heading", { name: "More", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Account" })).toContainText("Pat Santos");
    await visit(page, "/my/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Signing in" })).toContainText("Passkeys");
    await expect(page.getByRole("region", { name: "Your children's own logins" })).toContainText(
      "Children under 13 don't get their own login.",
    );

    // Nothing here asked the staff API, and nothing failed.
    expect(errors).toEqual([]);
  });

  test("a parent gives their teen a login, and ends it", async ({ seeded, personas }, info) => {
    const jun = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Jun",
      lastName: "Park",
      birthDate: bornYearsAgo(15),
      isJunior: true,
    });
    const parentEmail = testEmail("parent", info);
    expect(
      (
        await linkFamily(seeded.request, {
          clientId: jun.id,
          email: parentEmail,
          name: "Grace Park",
          relation: "guardian",
        })
      ).status,
    ).toBe(201);
    // A second parent: one parent can't end the other's access.
    expect(
      (
        await linkFamily(seeded.request, {
          clientId: jun.id,
          email: testEmail("second-parent", info),
          name: "Min Park",
          relation: "guardian",
        })
      ).status,
    ).toBe(201);

    const parent = await personas.open({ email: parentEmail, name: "Grace Park", persona: "none" });
    const errors = watchErrors(parent.page);
    await visit(parent.page, "/my/settings");
    const logins = parent.page.getByRole("region", { name: "Your children's own logins" });
    await logins.getByRole("button", { name: "Create Jun's login link" }).click();
    const sheet = parent.page.getByRole("dialog", { name: "Jun's login link" });
    await expect(sheet).toBeVisible();
    const link = await sheet.getByLabel("Invite link").inputValue();
    await expect(sheet.getByText(link, { exact: false })).toContainText(
      "invited you to see your own training",
    );
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(logins).toContainText("A login link is waiting for Jun");

    // Jun opens it on his own phone and accepts.
    const teen = await personas.open({
      email: testEmail("teen", info),
      name: "Jun Park",
      persona: "none",
    });
    await visit(teen.page, `/join/${inviteToken(link)}`);
    await expect(teen.page.getByRole("heading", { name: "See your own training" })).toBeVisible();
    await teen.page.getByRole("button", { name: "Accept invite" }).click();
    await expect(teen.page).toHaveURL(/\/my\/?$/);
    await expect(teen.page.getByRole("heading", { name: "Hi, Jun" })).toBeVisible();
    await expect(teen.page.getByText("Your own training")).toBeVisible();
    const own = await portalGet<PortalStudentDto>(teen.context.request, `/students/${jun.id}`);
    expect(own.student.relation).toBe("self");
    expect(own.teenAccess).toBeNull();

    // Logins are the parents' to manage: the teen can't make or end one.
    const teenInvite = await portalCall(
      teen.context.request,
      "POST",
      `/students/${jun.id}/teen-invite`,
    );
    expect(teenInvite.status).toBe(403);
    const access = await seeded.api.get<FamilyAccessDto>(`/clients/${jun.id}/family`);
    const other = access.links.find((l) => l.name === "Min Park");
    const self = access.links.find((l) => l.relation === "self");
    expect(self?.name).toBe("Jun Park");
    const teenRevoke = await portalCall(
      teen.context.request,
      "DELETE",
      `/students/${jun.id}/access/${self?.id}`,
    );
    expect(teenRevoke.status).toBe(403);
    // And a parent can end the teen's login, not the other parent's access.
    const notTheirs = await portalCall(
      parent.context.request,
      "DELETE",
      `/students/${jun.id}/access/${other?.id}`,
    );
    expect(notTheirs.status).toBe(404);

    // Grace ends Jun's login.
    await visit(parent.page, "/my/settings");
    await expect(logins).toContainText("Own login since");
    await logins.getByRole("button", { name: "End Jun Park's own login" }).click();
    const confirm = parent.page.getByRole("dialog", { name: "End Jun Park's own login?" });
    await confirm.getByRole("button", { name: "End login" }).click();
    await expect(confirm).toBeHidden();
    await expect(logins.getByRole("button", { name: "Create Jun's login link" })).toBeVisible();
    expect(errors).toEqual([]);

    // Jun loses access at once; both parents keep theirs.
    const gone = await portalCall(teen.context.request, "GET", `/students/${jun.id}`);
    expect(gone.status).toBe(404);
    const teenHome = await portalGet<PortalHomeDto>(teen.context.request, "/home");
    expect(teenHome.students).toEqual([]);
    const after = await seeded.api.get<FamilyAccessDto>(`/clients/${jun.id}/family`);
    expect(after.links.map((l) => l.name).sort()).toEqual(["Grace Park", "Min Park"]);
    const audited = (await auditLog(seeded.request)).filter(
      (e) => e.action === "revoke" && e.entity === "client_access",
    );
    expect(audited.map((e) => e.entityId)).toEqual([self?.id]);

    // A teen invite made through the API answers like the button: one link, single use.
    const made = await portalCall(
      parent.context.request,
      "POST",
      `/students/${jun.id}/teen-invite`,
    );
    expect(made.status).toBe(201);
    expect((made.json as PortalTeenInviteCreatedDto).link).toMatch(/\/join\/[A-Za-z0-9_-]{32,}$/);
  });

  test("when the academy ends a parent's access, the portal forgets the student", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const mia = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(10),
      isJunior: true,
    });
    const email = testEmail("parent", info);
    expect(
      (
        await linkFamily(seeded.request, {
          clientId: mia.id,
          email,
          name: "Pat Santos",
          relation: "guardian",
        })
      ).status,
    ).toBe(201);
    const parent = await personas.open({ email, name: "Pat Santos", persona: "none" });
    await visit(parent.page, `/my/${mia.id}/progress`);
    await expect(parent.page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();

    // The owner revokes it from the student's profile.
    const staffErrors = watchErrors(page);
    await visit(page, `/clients/${mia.id}`);
    const card = page.getByRole("region", { name: "Family access" });
    await card.getByRole("button", { name: "Revoke access for Pat Santos" }).click();
    const confirm = page.getByRole("dialog", { name: "Revoke Pat Santos access?" });
    await expect(confirm).toContainText("Pat Santos stops seeing Mia's training right away.");
    await confirm.getByRole("button", { name: "Revoke access" }).click();
    await expect(confirm).toBeHidden();
    await expect(card).toContainText("Nobody follows Mia's training yet.");
    expect(staffErrors).toEqual([]);

    // Every student call now answers 404, and the home has nobody on it.
    for (const path of ["", "/schedule", "/progress", "/money"]) {
      const res = await portalCall(parent.context.request, "GET", `/students/${mia.id}${path}`);
      expect(res.status, path).toBe(404);
    }
    const home = await portalGet<PortalHomeDto>(parent.context.request, "/home");
    expect(home.students).toEqual([]);
    expect(home.academies).toEqual([]);

    // The open page says so, and home shows no student.
    await visit(parent.page, `/my/${mia.id}/progress`);
    await expect(parent.page.getByText("Not linked to your account")).toBeVisible();
    await visit(parent.page, "/my");
    await expect(
      parent.page.getByText(/No students linked yet|Welcome, Pat/).first(),
    ).toBeVisible();
    await expect(parent.page.getByText("Mia Santos")).toHaveCount(0);
  });

  test("someone who coaches and is a parent switches between the two", async ({ page, seeded }) => {
    const me = await seeded.api.get<MeDto>("/me");
    const mia = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Reyes",
      birthDate: bornYearsAgo(8),
      isJunior: true,
    });
    const created = await seeded.api.post<{ link: string }>(`/clients/${mia.id}/family/invites`, {
      relation: "guardian",
    });
    const errors = watchErrors(page);

    // Staff can accept a family invite too: people can be both.
    await visit(page, `/join/${inviteToken(created.link)}`);
    await expect(page.getByRole("heading", { name: "Follow Mia's training" })).toBeVisible();
    await page.getByRole("button", { name: "Accept invite" }).click();
    await expect(page).toHaveURL(/\/my\/?$/);
    const first = me.user.name.split(" ")[0];
    await expect(page.getByRole("heading", { name: `Hi, ${first}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mia Reyes" })).toBeVisible();

    // The portal's way back to coaching.
    await page.getByRole("link", { name: "Coach view" }).click();
    await expect(page).not.toHaveURL(/\/my/);
    await expect(page.getByRole("heading", { name: "Today", exact: true }).first()).toBeVisible();

    // And the staff app's way to the family portal: More on a phone, Settings on a laptop.
    const isMobile = (page.viewportSize()?.width ?? 1440) < 1024;
    await visit(page, isMobile ? "/more" : "/settings");
    await page.getByRole("link", { name: /My family/ }).click();
    await expect(page).toHaveURL(/\/my\/?$/);
    await expect(page.getByRole("heading", { name: "Mia Reyes" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
