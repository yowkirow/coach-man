import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import type {
  AcademyDto,
  CoachProfileDto,
  GroupDto,
  MeDto,
  PublicAcademyDto,
  PublicAcademyPreviewDto,
  TeamPageDto,
  TeamPersonDto,
} from "../src/shared/api-types";
import {
  addMember,
  auditLog,
  expect,
  listAcademy,
  onboard,
  pngImage,
  submitSheet,
  test,
  testEmail,
  uuid,
  visit,
  watchErrors,
} from "./support";

// The team page, staff side: display-only people (people the academy shows who don't sign in),
// team page photos and highlights on coach profiles, the page's one order, who may change it, and
// what the public academy API then carries (in order, without anything private).

/** Every key a public team page person carries (PublicCoachDto), nothing else. */
const PUBLIC_PERSON_KEYS = [
  "bio",
  "certifications",
  "duprRating",
  "highlights",
  "id",
  "languages",
  "name",
  "photoKey",
  "portraitFraming",
  "portraitKey",
  "specialties",
  "title",
  "yearsCoaching",
];

const GOLD = "Gold, Men's Doubles 4.0, Manila Open 2025";

/** PUTs a PNG to a staff upload route and returns the raw answer (refusals included). */
async function putPng(request: APIRequestContext, path: string, image = pngImage()) {
  const res = await request.fetch(`/api/v1${path}`, {
    method: "PUT",
    data: image,
    headers: { "Content-Type": "image/png" },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status(), text, json };
}

const portraitOf = (res: { json: unknown }) =>
  (res.json as { portraitKey?: string } | undefined)?.portraitKey ?? "";

/** Who the page lists, top to bottom. */
const namesOf = (page: TeamPageDto) => page.entries.map((e) => e.name);

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

test.describe("the team page, at the API", () => {
  test.skip(({ isMobile }) => isMobile, "API checks: one browser is enough");

  test("the owner arranges staff and display-only people; the public page shows them in order, and nothing private", async ({
    coach: owner,
    playwright,
  }, info) => {
    test.slow();
    const { api, request } = owner;
    await onboard(api);
    const me = await api.get<MeDto>("/me");
    const ws = me.workspace.id;
    const kim = await addMember(request, {
      email: testEmail("team-kim", info),
      name: "Kim Lee",
      role: "coach",
    });

    // The owner's own coach profile: a title, highlights, and a team page photo.
    const profile = await api.patch<CoachProfileDto>(`/coaches/${me.user.id}`, {
      title: "Head coach",
      highlights: [GOLD, "  PPR certified, 2024  "],
      isPublic: true,
    });
    expect(profile.highlights).toEqual([GOLD, "PPR certified, 2024"]);
    const mine = await putPng(request, `/coaches/${me.user.id}/portrait`);
    expect(mine.status, mine.text).toBe(200);
    const myPortrait = portraitOf(mine);
    // Named by the coach profile's id (public), never the account's user id.
    expect(myPortrait).toMatch(
      new RegExp(`^ws/${ws}/public/coaches/[\\w-]+-portrait-[\\w-]+\\.png$`),
    );
    expect(myPortrait).not.toContain(me.user.id);
    expect((await api.get<CoachProfileDto>(`/coaches/${me.user.id}`)).portraitKey).toBe(myPortrait);
    // The square photo is named the same way.
    const square = await putPng(request, `/coaches/${me.user.id}/photo`);
    expect(square.status, square.text).toBe(200);
    const myPhoto = (square.json as { photoKey?: string } | undefined)?.photoKey ?? "";
    expect(myPhoto).toMatch(new RegExp(`^ws/${ws}/public/coaches/[\\w-]+\\.png$`));
    expect(myPhoto).not.toContain(me.user.id);

    // Two people who don't sign in, added at the end of the page (after the owner, 0, and Kim, 1).
    const ben = (await api.raw("POST", "/team-page/people", {
      name: "  Ben Cruz ",
      title: "Visiting coach",
      bio: "Plays the pro tour.",
      certifications: ["PPR"],
      highlights: ["Silver, Mixed Doubles Open, PNG 2024"],
      duprRating: 5.1,
      specialties: ["Dinking"],
      languages: ["English"],
      yearsCoaching: 6,
    })) as { status: number; json: TeamPersonDto };
    expect(ben.status).toBe(201);
    expect(ben.json).toMatchObject({
      name: "Ben Cruz",
      title: "Visiting coach",
      highlights: ["Silver, Mixed Doubles Open, PNG 2024"],
      portraitKey: null,
      isPublic: true,
      sortOrder: 2,
    });
    const carla = await api.post<TeamPersonDto>("/team-page/people", { name: "Carla Reyes" });
    expect(carla.sortOrder).toBe(3);
    expect(
      (await api.raw("POST", "/team-page/people", { name: " ", highlights: ["x".repeat(121)] }))
        .status,
    ).toBe(400);

    // Ben's photo; a new one replaces it and the old file goes.
    const first = portraitOf(await putPng(request, `/team-page/people/${ben.json.id}/portrait`));
    const second = await putPng(
      request,
      `/team-page/people/${ben.json.id}/portrait`,
      pngImage(48, [120, 160, 200]),
    );
    expect(second.status, second.text).toBe(200);
    const benPortrait = portraitOf(second);
    expect(benPortrait).toMatch(
      new RegExp(`^ws/${ws}/public/coaches/person-${ben.json.id}-[\\w-]+\\.png$`),
    );
    expect(benPortrait).not.toBe(first);

    // Everyone in the order they came: the owner, Kim (who joined after), then Ben and Carla.
    const page = await api.get<TeamPageDto>("/team-page");
    expect(namesOf(page)).toEqual(["Robin Coach", "Kim Lee", "Ben Cruz", "Carla Reyes"]);
    expect(page.entries[0]).toMatchObject({
      kind: "staff",
      userId: me.user.id,
      role: "owner",
      title: "Head coach",
      photoKey: myPhoto,
      portraitKey: myPortrait,
      isPublic: true,
    });
    expect(page.entries[2]).toMatchObject({
      kind: "listed",
      id: ben.json.id,
      photoKey: null,
      portraitKey: benPortrait,
    });

    // The academy's order: Carla, the owner, Ben, Kim.
    const ordered = await api.put<TeamPageDto>("/team-page/order", {
      entries: [
        { kind: "listed", id: carla.id },
        { kind: "staff", id: me.user.id },
        { kind: "listed", id: ben.json.id },
        { kind: "staff", id: kim.userId },
      ],
    });
    expect(namesOf(ordered)).toEqual(["Carla Reyes", "Robin Coach", "Ben Cruz", "Kim Lee"]);
    expect(ordered.entries.map((e) => e.sortOrder)).toEqual([0, 1, 2, 3]);
    // Ids it doesn't know are skipped; anyone it leaves out keeps their place after the rest.
    const partial = await api.put<TeamPageDto>("/team-page/order", {
      entries: [
        { kind: "staff", id: me.user.id },
        { kind: "listed", id: uuid() },
      ],
    });
    expect(namesOf(partial)).toEqual(["Robin Coach", "Carla Reyes", "Ben Cruz", "Kim Lee"]);
    // Carla is hidden; Kim leads a public program the owner assists.
    await api.patch(`/team-page/people/${carla.id}`, { isPublic: false });
    expect((await api.get<TeamPersonDto>(`/team-page/people/${carla.id}`)).isPublic).toBe(false);
    await api.post<GroupDto>("/groups", {
      name: "Evening program",
      isPublic: true,
      coachUserId: kim.userId,
      assistantCoachIds: [me.user.id],
    });
    const slug = await listAcademy(api, info, { name: "Riverside Pickleball Academy" });

    const anonymous = await playwright.request.newContext({
      baseURL: info.project.use.baseURL,
      extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    });
    try {
      const res = await anonymous.get(`/api/public/academies/${slug}`);
      expect(res.status()).toBe(200);
      const text = await res.text();
      const academy = JSON.parse(text) as PublicAcademyDto;
      // The page's people in the academy's order; the hidden one isn't there.
      expect(academy.coaches.map((c) => c.name)).toEqual(["Robin Coach", "Ben Cruz", "Kim Lee"]);
      for (const c of academy.coaches) expect(Object.keys(c).sort()).toEqual(PUBLIC_PERSON_KEYS);
      // Staff are named by their coach profile's id, never their account's.
      const backup = await api.get<{ coachProfiles: { id: string; userId: string }[] }>(
        "/export/workspace.json",
      );
      const ownProfileId = backup.coachProfiles.find((p) => p.userId === me.user.id)?.id ?? "";
      expect(academy.coaches[0]).toMatchObject({
        id: ownProfileId,
        title: "Head coach",
        photoKey: myPhoto,
        portraitKey: myPortrait,
        highlights: [GOLD, "PPR certified, 2024"],
      });
      expect(myPortrait.startsWith(`ws/${ws}/public/coaches/${ownProfileId}-portrait-`)).toBe(true);
      expect(myPhoto.startsWith(`ws/${ws}/public/coaches/${ownProfileId}-`)).toBe(true);
      expect(academy.coaches[1]).toEqual({
        id: ben.json.id,
        name: "Ben Cruz",
        title: "Visiting coach",
        bio: "Plays the pro tour.",
        photoKey: null,
        portraitKey: benPortrait,
        portraitFraming: null,
        certifications: ["PPR"],
        highlights: ["Silver, Mixed Doubles Open, PNG 2024"],
        specialties: ["Dinking"],
        languages: ["English"],
        yearsCoaching: 6,
        duprRating: 5.1,
      });
      // Programs name staff only: Kim leads, the owner assists.
      expect(academy.programs[0]?.coaches.map((c) => [c.name, c.lead])).toEqual([
        ["Kim Lee", true],
        ["Robin Coach", false],
      ]);
      for (const secret of [
        owner.email,
        me.user.id,
        kim.userId,
        "Carla Reyes",
        "sortOrder",
        "isPublic",
        "createdBy",
      ]) {
        expect(text, secret).not.toContain(secret);
      }
      // The staff preview shows the same people.
      const preview = await api.get<PublicAcademyPreviewDto>("/academy/public-preview");
      expect(preview.coaches).toEqual(academy.coaches);

      // Every change was audited.
      const audit = (await auditLog(request)).map((e) => `${e.action} ${e.entity}`);
      for (const line of [
        "upload coach_portrait",
        "create team_person",
        "upload team_person_portrait",
        "reorder team_page",
        "update team_person",
      ]) {
        expect(audit, line).toContain(line);
      }

      // Ben's first photo went when the second came; deleting Ben takes him and his photo away.
      expect((await anonymous.get(`/api/public/files/${first}`)).status()).toBe(404);
      expect((await anonymous.get(`/api/public/files/${benPortrait}`)).status()).toBe(200);
      expect((await api.raw("DELETE", `/team-page/people/${ben.json.id}`)).status).toBe(204);
      expect((await api.raw("GET", `/team-page/people/${ben.json.id}`)).status).toBe(404);
      expect((await anonymous.get(`/api/public/files/${benPortrait}`)).status()).toBe(404);
      const after = (await (
        await anonymous.get(`/api/public/academies/${slug}`)
      ).json()) as PublicAcademyDto;
      expect(after.coaches.map((c) => c.name)).toEqual(["Robin Coach", "Kim Lee"]);
      expect((await auditLog(request)).map((e) => `${e.action} ${e.entity}`)).toContain(
        "delete team_person",
      );

      // The full backup carries the page's people.
      const full = await api.get<{ teamPeople: { id: string; name: string }[] }>(
        "/export/workspace.json",
      );
      expect(full.teamPeople.map((p) => p.name)).toEqual(["Carla Reyes"]);
    } finally {
      await anonymous.dispose();
    }
  });

  test("a coach can't change the team page, and keeps their own team page photo and highlights", async ({
    coach: owner,
    personas,
    playwright,
  }, info) => {
    const { api, request } = owner;
    await onboard(api);
    const me = await api.get<MeDto>("/me");
    const email = testEmail("team-coach", info);
    const { userId } = await addMember(request, { email, name: "Sam Rivera", role: "coach" });
    const person = await api.post<TeamPersonDto>("/team-page/people", { name: "Ben Cruz" });
    const coach = await personas.open({ email, name: "Sam Rivera", persona: "none" });

    // Every team page route is the academy's call.
    const refusals: Record<string, string> = {};
    const refusal = (res: { status: number; json: unknown }) => {
      const error = (res.json as { error?: { code?: string; details?: { cap?: string } } })?.error;
      return `${res.status} ${error?.code} (${error?.details?.cap})`;
    };
    const probes: {
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
      path: string;
      body?: unknown;
    }[] = [
      { method: "GET", path: "/team-page" },
      { method: "POST", path: "/team-page/people", body: { name: "Not mine" } },
      { method: "GET", path: `/team-page/people/${person.id}` },
      { method: "PATCH", path: `/team-page/people/${person.id}`, body: { title: "Not mine" } },
      { method: "DELETE", path: `/team-page/people/${person.id}/portrait` },
      {
        method: "PUT",
        path: "/team-page/order",
        body: { entries: [{ kind: "listed", id: person.id }] },
      },
      { method: "DELETE", path: `/team-page/people/${person.id}` },
    ];
    for (const p of probes) {
      refusals[`${p.method} ${p.path}`] = refusal(await coach.api.raw(p.method, p.path, p.body));
    }
    refusals["PUT portrait"] = refusal(
      await putPng(coach.context.request, `/team-page/people/${person.id}/portrait`),
    );
    refusals["PUT someone else's portrait"] = refusal(
      await putPng(coach.context.request, `/coaches/${me.user.id}/portrait`),
    );
    refusals["DELETE someone else's portrait"] = refusal(
      await coach.api.raw("DELETE", `/coaches/${me.user.id}/portrait`),
    );
    expect(refusals).toEqual(
      Object.fromEntries(Object.keys(refusals).map((k) => [k, "403 forbidden (team)"])),
    );
    // Nothing changed.
    expect(await api.get<TeamPersonDto>(`/team-page/people/${person.id}`)).toMatchObject({
      name: "Ben Cruz",
      title: null,
    });

    // Their own profile: highlights (checked like any field) and a team page photo.
    const saved = await coach.api.patch<CoachProfileDto>(`/coaches/${userId}`, {
      highlights: ["Bronze, Juniors 14U, Cebu Open 2023"],
    });
    expect(saved.highlights).toEqual(["Bronze, Juniors 14U, Cebu Open 2023"]);
    for (const highlights of [
      Array.from({ length: 13 }, (_, i) => `Win ${i}`),
      ["x".repeat(121)],
    ]) {
      expect((await coach.api.raw("PATCH", `/coaches/${userId}`, { highlights })).status).toBe(400);
    }
    const one = await putPng(coach.context.request, `/coaches/${userId}/portrait`);
    expect(one.status, one.text).toBe(200);
    const two = await putPng(coach.context.request, `/coaches/${userId}/portrait`);
    expect(two.status, two.text).toBe(200);
    const anonymous = await playwright.request.newContext({
      baseURL: info.project.use.baseURL,
      extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    });
    try {
      expect((await anonymous.get(`/api/public/files/${portraitOf(one)}`)).status()).toBe(404);
      expect((await anonymous.get(`/api/public/files/${portraitOf(two)}`)).status()).toBe(200);
      expect((await coach.api.raw("DELETE", `/coaches/${userId}/portrait`)).status).toBe(204);
      expect((await anonymous.get(`/api/public/files/${portraitOf(two)}`)).status()).toBe(404);
    } finally {
      await anonymous.dispose();
    }
    expect(await coach.api.get<CoachProfileDto>(`/coaches/${userId}`)).toMatchObject({
      portraitKey: null,
      highlights: ["Bronze, Juniors 14U, Cebu Open 2023"],
    });

    // Someone who joins an arranged page lands at its end, even with a name that sorts first.
    await api.put<TeamPageDto>("/team-page/order", {
      entries: [
        { kind: "listed", id: person.id },
        { kind: "staff", id: userId },
        { kind: "staff", id: me.user.id },
      ],
    });
    await addMember(request, {
      email: testEmail("team-aaron", info),
      name: "Aaron Ames",
      role: "coach",
    });
    expect(namesOf(await api.get<TeamPageDto>("/team-page"))).toEqual([
      "Ben Cruz",
      "Sam Rivera",
      "Robin Coach",
      "Aaron Ames",
    ]);

    // Team shows a coach no Team page card.
    await visit(coach.page, "/team");
    await expect(coach.page.getByRole("region", { name: "Members" })).toBeVisible();
    await expect(coach.page.getByRole("region", { name: "Team page" })).toHaveCount(0);
  });
});

test.describe("the team page, on Team", () => {
  test("the owner adds a person with a photo and a highlight, moves them up, and gives themself a team page photo", async ({
    coach: owner,
    page,
  }) => {
    test.slow();
    const { api } = owner;
    await onboard(api);
    const me = await api.get<MeDto>("/me");
    const academy = await api.get<AcademyDto>("/academy");
    const errors = watchErrors(page);

    await visit(page, "/team");
    const card = page.getByRole("region", { name: "Team page" });
    const rows = card.getByRole("list", { name: "Team page order" }).getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Robin Coach");
    await expect(card.getByRole("link", { name: "Preview team page" })).toHaveAttribute(
      "href",
      `/a/${academy.slug}/team?preview=1`,
    );

    // Someone who doesn't sign in, with a photo (chosen first) and a highlight with commas in it.
    await card.getByRole("button", { name: "Add a person" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a person" });
    await sheet.locator('input[type="file"]').setInputFiles({
      name: "ben.png",
      mimeType: "image/png",
      buffer: pngImage(240, [120, 160, 200]),
    });
    // A new photo opens Adjust: zoomed in a step, the framing is kept until the person is saved.
    const framer = page.getByRole("dialog", { name: "Adjust the photo" });
    await framer.getByRole("button", { name: "Zoom in" }).click();
    await framer.getByRole("button", { name: "Done" }).click();
    await expect(framer).toBeHidden();
    await expect(sheet.getByRole("button", { name: "Change team page photo" })).toBeVisible();
    await sheet.getByRole("textbox", { name: "Name", exact: true }).fill("Ben Cruz");
    await sheet.getByRole("textbox", { name: "Title", exact: true }).fill("Visiting coach");
    const addHighlight = sheet.getByRole("textbox", { name: "Add a highlight" });
    await addHighlight.fill(GOLD);
    await addHighlight.press("Enter");
    await expect(sheet.getByRole("textbox", { name: "Highlight 1" })).toHaveValue(GOLD);
    expect(await seriousViolations(page)).toEqual([]);
    await submitSheet(sheet, sheet.getByRole("button", { name: "Add person" }));
    // Saved, then the photo uploaded: the toast says so once both are done.
    await expect(page.getByText("Ben Cruz added")).toBeVisible();

    await expect(rows).toHaveCount(2);
    const benRow = rows.filter({ hasText: "Ben Cruz" });
    await expect(benRow).toContainText("Not on CoachMan");
    await expect(benRow).toContainText("Visiting coach");
    await expect(rows.nth(1)).toContainText("Ben Cruz");
    const added = (await api.get<TeamPageDto>("/team-page")).entries.find(
      (e) => e.name === "Ben Cruz",
    );
    if (added?.kind !== "listed") throw new Error("Ben Cruz isn't on the team page");
    expect(added.portraitKey).toMatch(/\/public\/coaches\/person-[\w-]+\.jpg$/);
    expect(added.portraitFraming).toEqual({ x: 50, y: 20, zoom: 1.1 });
    expect((await api.get<TeamPersonDto>(`/team-page/people/${added.id}`)).highlights).toEqual([
      GOLD,
    ]);
    await expect(benRow.locator("img")).toHaveAttribute("src", /person-/);

    // Move up: Ben leads the page.
    const saved = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes("/api/v1/team-page/order"),
    );
    await card.getByRole("button", { name: "Move Ben Cruz up" }).click();
    expect((await saved).status()).toBe(200);
    await expect(rows.first()).toContainText("Ben Cruz");
    await expect(card.getByRole("button", { name: "Move Ben Cruz up" })).toBeDisabled();
    expect((await api.get<TeamPageDto>("/team-page")).entries.map((e) => e.name)).toEqual([
      "Ben Cruz",
      "Robin Coach",
    ]);

    // Ben's sheet opens with what was saved.
    await card.getByRole("button", { name: "Edit Ben Cruz" }).click();
    const edit = page.getByRole("dialog", { name: "Edit Ben Cruz" });
    await expect(edit.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
      "Visiting coach",
    );
    await expect(edit.getByRole("switch", { name: /Show on the team page/ })).toBeChecked();
    await edit.getByRole("button", { name: "Cancel" }).click();
    await expect(edit).toBeHidden();

    // Staff open their coach profile: the owner adds a team page photo and a highlight.
    await card.getByRole("button", { name: "Edit Robin Coach" }).click();
    const profile = page.getByRole("dialog", { name: "Coach profile" });
    await profile
      .getByRole("group", { name: "Team page photo" })
      .locator('input[type="file"]')
      .setInputFiles({ name: "me.png", mimeType: "image/png", buffer: pngImage(200) });
    // Uploaded at once, it opens Adjust; it sits well as it is, so Save closes it.
    const adjust = page.getByRole("dialog", { name: "Adjust your team page photo" });
    await adjust.getByRole("button", { name: "Save" }).click();
    await expect(adjust).toBeHidden();
    await expect(profile.getByRole("button", { name: "Change team page photo" })).toBeVisible();
    const mine = profile.getByRole("textbox", { name: "Add a highlight" });
    await mine.fill("PPR certified, 2024");
    await mine.press("Enter");
    await submitSheet(profile, profile.getByRole("button", { name: "Save profile" }));
    const own = await api.get<CoachProfileDto>(`/coaches/${me.user.id}`);
    expect(own.highlights).toEqual(["PPR certified, 2024"]);
    expect(own.portraitKey).toMatch(/\/public\/coaches\/[\w-]+-portrait-[\w-]+\.jpg$/);
    expect(own.portraitKey).not.toContain(me.user.id);
    await expect(rows.filter({ hasText: "Robin Coach" }).locator("img")).toHaveAttribute(
      "src",
      /-portrait-/,
    );
    expect(errors).toEqual([]);
  });
});
