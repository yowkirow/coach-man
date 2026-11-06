import type { GroupDto, MeDto } from "../src/shared/api-types";
import {
  addMember,
  expect,
  listAcademy,
  pngImage,
  test,
  testEmail,
  uploadPng,
  uuid,
  visit,
  watchErrors,
} from "./support";

// The public team page, "Meet the team" (/a/<slug>/team): each program's coaches with their
// half-body photos, credentials, and highlights; the rest of the team; Everyone; the way back to
// the academy page; the link preview the Worker writes; and the staff preview.

test.describe("the team page", () => {
  test("meets a program's coaches, then the whole team", async ({ browser, seeded }, info) => {
    const { api } = seeded;
    const me = await api.get<MeDto>("/me");
    await api.patch(`/coaches/${me.user.id}`, {
      isPublic: true,
      title: "Head coach",
      bio: "Drills first, then live play.",
      certifications: ["RPO licensed coach"],
      highlights: ["Gold, Mixed Doubles 4.0, Manila Open 2025"],
      yearsCoaching: 8,
      duprRating: 4.25,
      languages: ["English", "Filipino"],
    });
    await uploadPng(seeded.request, `/coaches/${me.user.id}/portrait`, pngImage(40));
    const sam = await addMember(seeded.request, {
      email: testEmail("team-sam", info),
      name: "Sam Rivera",
      role: "coach",
    });
    await api.patch(`/coaches/${sam.userId}`, { isPublic: true, title: "Assistant coach" });
    const quinn = await addMember(seeded.request, {
      email: testEmail("team-quinn", info),
      name: "Quinn Hidden",
      role: "coach",
    });
    await api.patch(`/coaches/${quinn.userId}`, { isPublic: false });
    const program = (await api.get<GroupDto[]>("/groups")).find(
      (g) => g.name === "Evening program",
    );
    if (!program) throw new Error("The sample academy has no Evening program");
    await api.patch(`/groups/${program.id}`, {
      isPublic: true,
      coachUserId: me.user.id,
      assistantCoachIds: [quinn.userId, sam.userId],
    });
    // Someone who doesn't sign in to CoachMan, shown on the team page by the academy.
    const lia = await api.post<{ id: string }>("/team-page/people", {
      name: "Lia Santos",
      title: "Junior program coordinator",
      highlights: ["Ran 12 summer camps"],
    });
    await uploadPng(
      seeded.request,
      `/team-page/people/${lia.id}/portrait`,
      pngImage(36, [179, 168, 245]),
    );
    const slug = await listAcademy(api, info, {
      name: "Riverside Team Academy",
      contactPhone: "+63 917 555 0100",
    });
    const desktop = info.project.name === "desktop";

    const visitor = await browser.newContext({ serviceWorkers: "block" });
    const page = await visitor.newPage();
    const errors = watchErrors(page);
    await visit(page, `/a/${slug}/team`);
    await expect(page).toHaveTitle("Meet the team · Riverside Team Academy");
    await expect(page.getByRole("heading", { name: "Meet the team", level: 1 })).toBeVisible();

    // It opens on the program: the lead coach first, the assistant next, the hidden profile never.
    const programs = page.getByRole("navigation", { name: "Programs" });
    await expect(programs.getByRole("link", { name: "Evening program" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(
      page.getByRole("heading", { name: "Evening program coaches", level: 2 }),
    ).toBeVisible();
    await expect(page.getByText("2 coaches", { exact: true })).toBeVisible();
    // On a laptop the panel also says where the program meets (with directions) and when it next
    // meets, and the chosen tile doesn't repeat its times; phones keep the block short.
    const panel = page.getByRole("complementary");
    if (desktop) {
      await expect(panel).toContainText("Riverside Park Courts");
      await expect(panel.getByRole("link", { name: /Directions/ })).toBeVisible();
      await expect(panel).toContainText("Next session");
      await expect(
        programs.getByRole("link", { name: "Evening program", exact: true }),
      ).toHaveAttribute("aria-current", "true");
    } else {
      await expect(panel.getByRole("link", { name: /Directions/ })).toBeHidden();
    }
    const spaces = page.getByRole("main").getByRole("article");
    await expect(spaces).toHaveCount(2);
    await expect(spaces.first()).toHaveAccessibleName("Robin Coach");
    const robin = page.getByRole("article", { name: "Robin Coach" });
    for (const text of [
      "Program lead",
      "Head coach",
      "RPO licensed coach",
      "Gold, Mixed Doubles 4.0, Manila Open 2025",
      "8 years",
      "4.25",
      "English, Filipino",
      "Drills first, then live play.",
    ]) {
      await expect(robin).toContainText(text);
    }
    await expect(robin.locator("img")).toHaveAttribute(
      "src",
      /\/api\/public\/files\/ws\/.+-portrait-/,
    );
    const samSpace = page.getByRole("article", { name: "Sam Rivera" });
    await expect(samSpace).toContainText("Assistant coach");
    await expect(samSpace).not.toContainText("Program lead");
    await expect(page.getByText("Quinn Hidden")).toHaveCount(0);
    const also = page.getByRole("region", { name: "Also on the team" });
    await expect(also).toContainText("Lia Santos");
    await expect(also).toContainText("Junior program coordinator");

    // Everyone: the whole team, each with the programs they coach.
    await programs.getByRole("link", { name: "Everyone" }).click();
    await expect(page).toHaveURL(/[?&]program=all/);
    await expect(page.getByRole("heading", { name: "The whole team", level: 2 })).toBeVisible();
    await expect(spaces).toHaveCount(3);
    const liaSpace = page.getByRole("article", { name: "Lia Santos" });
    await expect(liaSpace).toContainText("Ran 12 summer camps");
    await expect(liaSpace.locator("img")).toHaveAttribute("src", /\/coaches\/person-/);
    if (desktop) {
      // Everyone, on a laptop: the academy's number under its actions, for screens that can't dial.
      await expect(panel.getByRole("link", { name: "+63 917 555 0100" })).toHaveAttribute(
        "href",
        "tel:+639175550100",
      );
    }

    // A coach's program leads back to that program's team.
    await page
      .getByRole("article", { name: "Sam Rivera" })
      .getByRole("link", { name: "Evening program" })
      .click();
    await expect(page).toHaveURL(new RegExp(`[?&]program=${program.id}`));
    await expect(
      page.getByRole("heading", { name: "Evening program coaches", level: 2 }),
    ).toBeVisible();

    // And home through the website's nav, where the coaches have their own section.
    await page
      .getByRole("navigation", { name: "Riverside Team Academy" })
      .getByRole("link", { name: "Riverside Team Academy" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/a/${slug}$`));
    const team = page.getByRole("region", { name: "The coaches" });
    await expect(team).toContainText("Lia Santos");
    await expect(team).not.toContainText("Quinn Hidden");
    expect(errors).toEqual([]);
    await visitor.close();
  });

  test("its link preview names the team and shows a face", async ({ request, seeded }, info) => {
    const { api } = seeded;
    const me = await api.get<MeDto>("/me");
    await api.patch(`/coaches/${me.user.id}`, { isPublic: true, title: "Head coach" });
    await uploadPng(seeded.request, `/coaches/${me.user.id}/portrait`, pngImage(40));
    const slug = await listAcademy(api, info, { name: "Preview Team Academy" });

    const res = await request.get(`/a/${slug}/team`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Meet the team · Preview Team Academy</title>");
    expect(html).toContain("Meet the team at Preview Team Academy: Robin Coach.");
    expect(html).toMatch(
      /<meta property="og:image" content="[^"]+\/api\/public\/files\/ws\/[^"]+-portrait-[^"]+"/,
    );
    expect(html).toMatch(new RegExp(`<meta property="og:url" content="[^"]+/a/${slug}/team"`));
  });

  test("staff preview it before the academy page is shared", async ({ page, seeded }) => {
    const { api } = seeded;
    const me = await api.get<MeDto>("/me");
    await api.patch(`/coaches/${me.user.id}`, { isPublic: true, title: "Head coach" });
    const slug = `e2e-team-${uuid().slice(0, 8)}`;
    await api.patch("/academy", { name: "Quiet Team Academy", slug, listed: false });

    const errors = watchErrors(page);
    await visit(page, `/a/${slug}/team?preview=1`);
    await expect(page.getByRole("note")).toContainText("Preview of your team page");
    await expect(page.getByRole("note")).toContainText("Only your team can see this");
    await expect(page.getByRole("article", { name: "Robin Coach" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
