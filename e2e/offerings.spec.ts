import type {
  ClientDetailDto,
  GroupDto,
  LessonDetailDto,
  PackageBalanceDto,
  PackageTemplateDto,
  RateDto,
  TodayDto,
} from "../src/shared/api-types";
import {
  addMember,
  expect,
  lastDayOfMonth,
  onboard,
  shiftMonth,
  submitSheet,
  test,
  testEmail,
  toggle,
  uuid,
  visit,
  watchErrors,
} from "./support";

// Programs and package tiers (WS4a): publishing a program and its tiers, month-end validity with a
// start month (no paying for sessions before it starts), and the training uniform.

/** Any money field in a JSON payload: an amount in minor units, `"…Minor": <number|null>`. */
const MONEY_FIELD = /"[A-Za-z]+Minor":\s*(-?\d|null)/;

test.describe("programs and package tiers", () => {
  test("an owner publishes a program and three tiers; coaches see them without prices", async ({
    page,
    coach,
    personas,
  }, info) => {
    const { api } = coach;
    await onboard(api);
    const errors = watchErrors(page);
    const program = await api.post<GroupDto>("/groups", {
      name: "Evening program",
      level: "All levels",
    });
    // Two tiers from the API; the featured one through the editor below.
    const trial = await api.post<PackageTemplateDto>("/packages", {
      name: "Trial",
      credits: 1,
      priceMinor: 150000,
      validityDays: 30,
      programId: program.id,
      sessionsLabel: "1 session",
      inclusions: ["One coached session", "Court fee included"],
      isPublic: true,
    });
    const monthly = await api.post<PackageTemplateDto>("/packages", {
      name: "Monthly",
      credits: 6,
      priceMinor: 600000,
      validityMode: "month_end",
      validityDays: 30,
      programId: program.id,
      sessionsLabel: "4–6 sessions",
      inclusions: ["Coached sessions", "Court fees included"],
      includesUniform: true,
      isPublic: true,
    });
    // Month-end tiers have no day count.
    expect(monthly).toMatchObject({ validityMode: "month_end", validityDays: null });

    // Packages → Academy page: put the program on the page.
    await visit(page, "/packages?tab=public");
    const programCard = page.getByRole("region", { name: "Evening program", exact: true });
    const programSwitch = programCard.getByRole("switch", {
      name: "Public: Evening program on the academy page",
    });
    await expect(programSwitch).not.toBeChecked();
    await toggle(programSwitch);
    await expect(programSwitch).toBeChecked();
    await expect(page.getByText("Evening program is on your academy page")).toBeVisible();

    // The third tier through the editor: month-end, inclusions, uniform, self-rating, featured.
    await page.getByRole("button", { name: "New package" }).first().click();
    const sheet = page.getByRole("dialog", { name: "New package" });
    await sheet.getByLabel("Name", { exact: true }).fill("Monthly plus");
    await sheet.getByLabel("Credits").fill("9");
    await sheet.getByLabel("Price").fill("7000");
    await toggle(sheet.getByRole("radio", { name: "To month end" }));
    await expect(sheet.getByLabel("Valid for (days)")).toHaveCount(0);
    await sheet.getByRole("button", { name: /Program/ }).click();
    await page.getByRole("option", { name: /Evening program/ }).click();
    await sheet.getByLabel("Sessions label (optional)").fill("7–9 sessions");
    const addInclusion = sheet.getByLabel("Add an inclusion");
    for (const item of ["Court fees included", "Three-hour coached sessions", "Game analysis"]) {
      await addInclusion.fill(item);
      await addInclusion.press("Enter");
    }
    // The checklist is ordered: the last line goes first.
    await sheet.getByRole("button", { name: "Move “Game analysis” up" }).click();
    await sheet.getByRole("button", { name: "Move “Game analysis” up" }).click();
    await sheet.getByRole("button", { name: "Remove “Court fees included”" }).click();
    await sheet.getByLabel("Who it's for (optional)").fill("Players working on the long game");
    await sheet.getByLabel("Commitment note (optional)").fill("Best over at least 2 months");
    for (const name of [
      "Includes the training uniform",
      "Asks for a self-rating",
      "Show on the academy page",
      "Featured",
    ]) {
      const control = sheet.getByRole("switch", { name });
      await toggle(control);
      await expect(control).toBeChecked();
    }
    // The preview is the card families see.
    const preview = sheet.getByRole("article", { name: "Monthly plus" });
    await expect(preview).toContainText("₱7,000");
    await expect(preview).toContainText("7–9 sessions");
    await expect(preview).toContainText("Valid until the end of the month");
    await expect(preview).toContainText("Training uniform included");
    await expect(preview).toContainText("Featured");
    await submitSheet(sheet, sheet.getByRole("button", { name: "Create package" }));

    const saved = (await api.get<PackageTemplateDto[]>("/packages")).find(
      (t) => t.name === "Monthly plus",
    );
    expect(saved).toMatchObject({
      credits: 9,
      priceMinor: 700000,
      programId: program.id,
      sessionsLabel: "7–9 sessions",
      validityMode: "month_end",
      validityDays: null,
      inclusions: ["Game analysis", "Three-hour coached sessions"],
      audience: "Players working on the long game",
      commitmentNote: "Best over at least 2 months",
      includesUniform: true,
      asksSelfRating: true,
      isPublic: true,
      highlight: true,
    });
    if (!saved) throw new Error("Monthly plus wasn't saved");

    // Order on the page: move the featured tier to the top of its program.
    const tiers = page.getByRole("list", { name: "Evening program tiers" });
    await expect(tiers.getByRole("listitem")).toHaveCount(3);
    await tiers.getByRole("button", { name: "Move Monthly plus up" }).click();
    await tiers.getByRole("button", { name: "Move Monthly plus up" }).click();
    await expect
      .poll(async () =>
        (await api.get<PackageTemplateDto[]>("/packages"))
          .filter((t) => t.programId === program.id)
          .map((t) => t.name),
      )
      .toEqual(["Monthly plus", "Trial", "Monthly"]);
    await expect(tiers.getByRole("listitem").first()).toContainText("Monthly plus");
    // Pills on the catalog cards.
    await page.getByRole("tab", { name: /^Packages/ }).click();
    const card = page.getByRole("article", { name: "Monthly plus" });
    await expect(card).toContainText("Public");
    await expect(card).toContainText("Featured");
    await expect(card).toContainText("Valid to month end");
    expect(errors).toEqual([]);

    // A coach reads the tiers (names, inclusions, schedule) without prices, and can't change them.
    const email = testEmail("tier-coach", info);
    await addMember(coach.request, { email, name: "Sam Rivera", role: "coach" });
    const sam = await personas.open({ email, name: "Sam Rivera", persona: "none" });
    const read = await sam.api.raw("GET", "/packages");
    expect(read.status).toBe(200);
    expect(read.text).not.toMatch(MONEY_FIELD);
    const seen = read.json as PackageTemplateDto[];
    expect(seen.find((t) => t.id === saved.id)).toMatchObject({
      name: "Monthly plus",
      inclusions: ["Game analysis", "Three-hour coached sessions"],
      sessionsLabel: "7–9 sessions",
    });
    const refused: ["POST" | "PATCH", string, unknown][] = [
      ["PATCH", `/packages/${trial.id}`, { isPublic: false }],
      ["PATCH", `/packages/${monthly.id}`, { highlight: true }],
      ["POST", "/packages/reorder", { ids: [trial.id, monthly.id, saved.id] }],
      ["PATCH", `/groups/${program.id}`, { isPublic: false }],
      ["POST", "/groups/reorder", { ids: [program.id] }],
    ];
    for (const [method, path, body] of refused) {
      expect((await sam.api.raw(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    const coachErrors = watchErrors(sam.page);
    await visit(sam.page, `/groups/${program.id}?tab=details`);
    const tierCard = sam.page.getByRole("region", { name: "Evening program tiers" });
    await expect(tierCard.getByRole("article", { name: "Monthly plus" })).toContainText(
      "Game analysis",
    );
    await expect(tierCard.getByRole("article")).toHaveCount(3);
    await expect(tierCard).not.toContainText("₱");
    expect(coachErrors).toEqual([]);
  });

  test("a tier sold for next month doesn't pay for this month's sessions and expires at its end", async ({
    page,
    coach,
  }) => {
    const { api } = coach;
    await onboard(api);
    const errors = watchErrors(page);
    const rate = await api.post<RateDto>("/rates", {
      name: "Group session",
      kind: "group",
      durationMinutes: 180,
      priceMinor: 50000,
      unit: "session",
    });
    await api.post<PackageTemplateDto>("/packages", {
      name: "Monthly",
      credits: 6,
      priceMinor: 600000,
      validityMode: "month_end",
      sessionsLabel: "4–6 sessions",
    });
    const kai = await api.post<{ id: string }>("/clients", { firstName: "Kai", lastName: "Reyes" });
    const { date: today } = await api.get<TodayDto>("/today");
    const next = shiftMonth(today.slice(0, 7), 1);

    // Sell it from the client's page for next month.
    await visit(page, `/clients/${kai.id}`);
    await page.getByRole("button", { name: "Sell package" }).click();
    const sheet = page.getByRole("dialog", { name: "Sell a package" });
    await toggle(sheet.getByRole("radio", { name: /^Monthly/ }));
    const nextMonth = sheet.getByRole("radio", { name: /\(next\)/ });
    await toggle(nextMonth);
    await expect(nextMonth).toBeChecked();
    await expect(sheet.getByText(/^Pays for sessions from .+\. Valid until .+\.$/)).toBeVisible();
    await submitSheet(sheet, sheet.getByRole("button", { name: "Sell to Kai" }));

    const detail = await api.get<ClientDetailDto>(`/clients/${kai.id}`);
    const pkg = detail.packages[0] as PackageBalanceDto;
    expect(pkg).toMatchObject({
      name: "Monthly",
      remaining: 6,
      startMonth: next,
      startsOn: `${next}-01`,
      expiresOn: lastDayOfMonth(next),
    });
    const bento = page.locator("section", {
      has: page.getByRole("heading", { name: "Packages", exact: true }),
    });
    await expect(bento).toContainText("Starts");

    // A session today: the package can't pay for it, so the per-session rate is charged.
    const created = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "group",
      date: today,
      startTime: "19:00",
      durationMinutes: 180,
      rateId: rate.id,
      clientIds: [kai.id],
    });
    const entry = created.lesson.roster[0];
    if (!entry) throw new Error("No roster entry");
    expect(entry.usablePackages.map((p) => p.id)).not.toContain(pkg.id);
    const forced = await api.raw("POST", `/attendance/${entry.attendanceId}`, {
      status: "present",
      packageId: pkg.id,
      mutationId: uuid(),
    });
    expect(forced.status).toBe(409);
    expect(forced.text).toContain("it starts on");
    const checked = await api.post<{ lesson: LessonDetailDto }>(
      `/attendance/${entry.attendanceId}`,
      { status: "present", mutationId: uuid() },
    );
    expect(checked.lesson.roster[0]).toMatchObject({ consumedPackageId: null, chargeMinor: 50000 });
    const after = await api.get<ClientDetailDto>(`/clients/${kai.id}`);
    expect(after.packages.find((p) => p.id === pkg.id)?.remaining).toBe(6);

    // A session on the first of next month is the first one it pays for.
    const later = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "group",
      date: `${next}-01`,
      startTime: "19:00",
      durationMinutes: 180,
      rateId: rate.id,
      clientIds: [kai.id],
    });
    expect(later.lesson.roster[0]?.usablePackages.map((p) => p.id)).toContain(pkg.id);

    // Month-end packages only start this month or next.
    const tooLate = await api.raw("POST", `/clients/${kai.id}/packages`, {
      packageId: (await api.get<PackageTemplateDto[]>("/packages"))[0]?.id,
      startMonth: shiftMonth(today.slice(0, 7), 2),
    });
    expect(tooLate.status).toBe(400);
    expect(errors).toEqual([]);
  });

  test("staff record the uniform's size and when it was handed out", async ({
    page,
    coach,
    personas,
  }, info) => {
    const { api } = coach;
    await onboard(api);
    const errors = watchErrors(page);
    const tpl = await api.post<PackageTemplateDto>("/packages", {
      name: "Monthly",
      credits: 6,
      priceMinor: 600000,
      validityMode: "month_end",
      includesUniform: true,
    });
    const kai = await api.post<{ id: string }>("/clients", { firstName: "Kai", lastName: "Reyes" });
    const sold = await api.post<PackageBalanceDto>(`/clients/${kai.id}/packages`, {
      packageId: tpl.id,
    });
    expect(sold).toMatchObject({ includesUniform: true, uniformSize: null, uniformIssuedAt: null });

    // Whoever sells packages (owners, admins, and the front desk) sees it on Today until it's
    // handed out.
    await visit(page, "/");
    const attention = page.getByRole("region", { name: "Needs attention" });
    await expect(attention).toContainText("Uniform to hand out · Monthly");

    await visit(page, `/clients/${kai.id}`);
    const bento = page.locator("section", {
      has: page.getByRole("heading", { name: "Packages", exact: true }),
    });
    await expect(bento).toContainText("size not recorded");
    await expect(bento).toContainText("To hand out");
    await bento.getByRole("button", { name: "Update uniform for Monthly" }).click();
    const sheet = page.getByRole("dialog", { name: "Training uniform" });
    await sheet.getByLabel("Size").fill("L");
    const handed = sheet.getByRole("switch", { name: /Uniform handed out/ });
    await toggle(handed);
    await expect(handed).toBeChecked();
    await submitSheet(sheet, sheet.getByRole("button", { name: "Save" }));
    await expect(page.getByText("Uniform handed out").first()).toBeVisible();
    await expect(bento).toContainText("size L");
    await expect(bento).toContainText("Handed out");

    const detail = await api.get<ClientDetailDto>(`/clients/${kai.id}`);
    const pkg = detail.packages.find((p) => p.id === sold.id);
    expect(pkg?.uniformSize).toBe("L");
    expect(typeof pkg?.uniformIssuedAt).toBe("number");
    const today = await api.get<TodayDto>("/today");
    expect(today.alerts.uniforms ?? []).toEqual([]);

    // Any staff member can update it at the court; Today's list isn't for coaches.
    const email = testEmail("uniform-coach", info);
    await addMember(coach.request, { email, name: "Sam Rivera", role: "coach" });
    const sam = await personas.open({ email, name: "Sam Rivera", persona: "none" });
    const changed = await sam.api.raw("PATCH", `/client-packages/${sold.id}/uniform`, {
      uniformSize: "XL",
      issued: false,
    });
    expect(changed.status).toBe(200);
    expect(changed.json).toMatchObject({ uniformSize: "XL", uniformIssuedAt: null });
    expect((await sam.api.get<TodayDto>("/today")).alerts.uniforms ?? []).toEqual([]);
    const deskEmail = testEmail("uniform-desk", info);
    await addMember(coach.request, { email: deskEmail, name: "Dana Desk", role: "front_desk" });
    const desk = await personas.open({ email: deskEmail, name: "Dana Desk", persona: "none" });
    for (const who of [api, desk.api]) {
      expect(
        (await who.get<TodayDto>("/today")).alerts.uniforms?.map((u) => u.uniformSize),
      ).toEqual(["XL"]);
    }
    await visit(desk.page, "/");
    await expect(desk.page.getByRole("region", { name: "Needs attention" })).toContainText(
      "Uniform to hand out · size XL · Monthly",
    );
    expect(errors).toEqual([]);
  });
});
