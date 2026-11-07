import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type {
  AcademyDto,
  AcademyPhotoDto,
  CoachProfileDto,
  MeDto,
  PublicAcademyDto,
  TeamPersonDto,
} from "../src/shared/api-types";
import {
  addMember,
  expect,
  listAcademy,
  onboard,
  pngImage,
  test,
  testEmail,
  uploadPng,
  visit,
  watchErrors,
} from "./support";

// Photo framing: where a photo sits in the frames that show it and how far it's zoomed in, for
// the cover, the website photos, and team page photos. It's kept as a point and a zoom, never by
// cropping the file: the API checks it and keeps it with its photo, a new photo starts over, the
// public site places each photo by it, and Adjust (drag, the sliders, the zoom buttons) sets it.

/** Framings the API refuses: off the photo, zoomed out past filling the frame or in past 3×. */
const BAD_FRAMINGS: unknown[] = [
  { x: 101, y: 50, zoom: 1 },
  { x: 50, y: -1, zoom: 1 },
  { x: 50, y: 50, zoom: 3.5 },
  { x: 50, y: 50, zoom: 0.9 },
  { x: 50, y: 50 },
  "center",
];

/** A CSS `scale(z)` as the browser computes it. */
const scale = (zoom: number) => `matrix(${zoom}, 0, 0, ${zoom}, 0, 0)`;

async function seriousViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

test.describe("photo framing, at the API", () => {
  test.skip(({ isMobile }) => isMobile, "API checks: one browser is enough");

  test("framings are checked and kept with their photos, a new photo starts over, and only the academy frames its photos", async ({
    coach: owner,
    personas,
    playwright,
  }, info) => {
    test.slow();
    const { api, request } = owner;
    await onboard(api);
    const me = await api.get<MeDto>("/me");

    // A website photo: framed on its own (at two decimals), kept when the caption changes.
    const photo = await uploadPng<AcademyPhotoDto>(
      request,
      "/academy/photos",
      pngImage(64),
      "POST",
    );
    expect(photo.framing).toBeNull();
    expect(
      await api.patch<AcademyPhotoDto>(`/academy/photos/${photo.id}`, {
        framing: { x: 30, y: 70.456, zoom: 1.5 },
      }),
    ).toMatchObject({ caption: null, framing: { x: 30, y: 70.46, zoom: 1.5 } });
    expect(
      await api.patch<AcademyPhotoDto>(`/academy/photos/${photo.id}`, { caption: "Court 3" }),
    ).toMatchObject({ caption: "Court 3", framing: { x: 30, y: 70.46, zoom: 1.5 } });
    expect((await api.raw("PATCH", `/academy/photos/${photo.id}`, {})).status).toBe(400);
    for (const framing of BAD_FRAMINGS) {
      const res = await api.raw("PATCH", `/academy/photos/${photo.id}`, { framing });
      expect(res.status, JSON.stringify(framing)).toBe(400);
    }
    // Null goes back to the middle.
    expect(
      (await api.patch<AcademyPhotoDto>(`/academy/photos/${photo.id}`, { framing: null })).framing,
    ).toBeNull();
    const photoFraming = { x: 25, y: 60, zoom: 1.4 };
    await api.patch(`/academy/photos/${photo.id}`, { framing: photoFraming });

    // The cover: a new one, or none, starts over at the middle.
    await uploadPng(request, "/academy/cover", pngImage(80));
    const coverFraming = { x: 20, y: 40, zoom: 2 };
    expect((await api.patch<AcademyDto>("/academy", { coverFraming })).coverFraming).toEqual(
      coverFraming,
    );
    for (const f of BAD_FRAMINGS) {
      expect((await api.raw("PATCH", "/academy", { coverFraming: f })).status).toBe(400);
    }
    await uploadPng(request, "/academy/cover", pngImage(90));
    expect((await api.get<AcademyDto>("/academy")).coverFraming).toBeNull();
    await api.patch("/academy", { coverFraming });
    expect((await api.raw("DELETE", "/academy/cover")).status).toBe(204);
    expect((await api.get<AcademyDto>("/academy")).coverFraming).toBeNull();
    const cover = await uploadPng<{ key: string }>(request, "/academy/cover", pngImage(100));
    await api.patch("/academy", { coverFraming });

    // A coach's team page photo: a new one starts over.
    await uploadPng(request, `/coaches/${me.user.id}/portrait`, pngImage(48));
    const portraitFraming = { x: 50, y: 10, zoom: 1.25 };
    expect(
      (
        await api.patch<CoachProfileDto>(`/coaches/${me.user.id}`, {
          isPublic: true,
          portraitFraming,
        })
      ).portraitFraming,
    ).toEqual(portraitFraming);
    for (const f of BAD_FRAMINGS) {
      const res = await api.raw("PATCH", `/coaches/${me.user.id}`, { portraitFraming: f });
      expect(res.status).toBe(400);
    }
    await uploadPng(request, `/coaches/${me.user.id}/portrait`, pngImage(50));
    expect((await api.get<CoachProfileDto>(`/coaches/${me.user.id}`)).portraitFraming).toBeNull();
    await api.patch(`/coaches/${me.user.id}`, { portraitFraming });

    // Someone who doesn't sign in: the same, and taking the photo away clears it too.
    const ben = await api.post<TeamPersonDto>("/team-page/people", { name: "Ben Cruz" });
    await uploadPng(request, `/team-page/people/${ben.id}/portrait`, pngImage(40));
    const benFraming = { x: 40, y: 30, zoom: 1.1 };
    expect(
      (
        await api.patch<TeamPersonDto>(`/team-page/people/${ben.id}`, {
          portraitFraming: benFraming,
        })
      ).portraitFraming,
    ).toEqual(benFraming);
    for (const f of BAD_FRAMINGS) {
      const res = await api.raw("PATCH", `/team-page/people/${ben.id}`, { portraitFraming: f });
      expect(res.status).toBe(400);
    }
    expect((await api.raw("DELETE", `/team-page/people/${ben.id}/portrait`)).status).toBe(204);
    expect(
      (await api.get<TeamPersonDto>(`/team-page/people/${ben.id}`)).portraitFraming,
    ).toBeNull();
    await uploadPng(request, `/team-page/people/${ben.id}/portrait`, pngImage(42));
    await api.patch(`/team-page/people/${ben.id}`, { portraitFraming: benFraming });

    // A coach frames their own team page photo, and nothing else.
    const email = testEmail("framing-coach", info);
    const { userId } = await addMember(request, { email, name: "Sam Rivera", role: "coach" });
    const coach = await personas.open({ email, name: "Sam Rivera", persona: "none" });
    const theirs = { x: 10, y: 90, zoom: 3 };
    const refused = {
      cover: await coach.api.raw("PATCH", "/academy", { coverFraming: theirs }),
      photo: await coach.api.raw("PATCH", `/academy/photos/${photo.id}`, { framing: theirs }),
      person: await coach.api.raw("PATCH", `/team-page/people/${ben.id}`, {
        portraitFraming: theirs,
      }),
      owner: await coach.api.raw("PATCH", `/coaches/${me.user.id}`, { portraitFraming: theirs }),
    };
    expect(Object.fromEntries(Object.entries(refused).map(([k, r]) => [k, r.status]))).toEqual({
      cover: 403,
      photo: 403,
      person: 403,
      owner: 403,
    });
    await uploadPng(coach.context.request, `/coaches/${userId}/portrait`, pngImage(30));
    expect(
      (await coach.api.patch<CoachProfileDto>(`/coaches/${userId}`, { portraitFraming: theirs }))
        .portraitFraming,
    ).toEqual(theirs);

    // The public academy carries each framing (and nothing the coach tried).
    const slug = await listAcademy(api, info, { name: "Framing Academy" });
    const anonymous = await playwright.request.newContext({
      baseURL: info.project.use.baseURL,
      extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    });
    try {
      const res = await anonymous.get(`/api/public/academies/${slug}`);
      expect(res.status()).toBe(200);
      const academy = (await res.json()) as PublicAcademyDto;
      expect(academy.coverKey).toBe(cover.key);
      expect(academy.coverFraming).toEqual(coverFraming);
      expect(academy.photos).toEqual([
        { id: photo.id, key: photo.key, caption: "Court 3", framing: photoFraming },
      ]);
      const framingOf = (name: string) =>
        academy.coaches.find((c) => c.name === name)?.portraitFraming;
      expect(framingOf("Robin Coach")).toEqual(portraitFraming);
      expect(framingOf("Ben Cruz")).toEqual(benFraming);
    } finally {
      await anonymous.dispose();
    }
  });
});

test.describe("photo framing, on the website", () => {
  test("the home page and the team page place each photo as it was framed", async ({
    coach: owner,
    browser,
  }, info) => {
    test.slow();
    const { api, request } = owner;
    await onboard(api);
    const me = await api.get<MeDto>("/me");
    const cover = await uploadPng<{ key: string }>(request, "/academy/cover", pngImage(120));
    await api.patch("/academy", { coverFraming: { x: 20, y: 40, zoom: 2 } });
    const photo = await uploadPng<AcademyPhotoDto>(
      request,
      "/academy/photos",
      pngImage(64),
      "POST",
    );
    await api.patch(`/academy/photos/${photo.id}`, {
      caption: "Court 3 at dusk",
      framing: { x: 30, y: 70, zoom: 1.5 },
    });
    await uploadPng(request, `/coaches/${me.user.id}/portrait`, pngImage(48));
    await api.patch(`/coaches/${me.user.id}`, {
      isPublic: true,
      title: "Head coach",
      portraitFraming: { x: 50, y: 10, zoom: 1.25 },
    });
    // Never framed: the team page's default keeps faces in (the middle across, a fifth down).
    const ben = await api.post<TeamPersonDto>("/team-page/people", { name: "Ben Cruz" });
    await uploadPng(request, `/team-page/people/${ben.id}/portrait`, pngImage(40));
    const slug = await listAcademy(api, info, { name: "Framing Academy" });

    const visitor = await browser.newContext({ serviceWorkers: "block" });
    try {
      const page = await visitor.newPage();
      const errors = watchErrors(page);
      await visit(page, `/a/${slug}`);
      const hero = page.locator(`img[src="/api/public/files/${cover.key}"]`).first();
      await expect(hero).toHaveCSS("object-position", "20% 40%");
      await expect(hero).toHaveCSS("transform", scale(2));
      const court = page.getByRole("img", { name: "Court 3 at dusk" });
      await expect(court).toHaveCSS("object-position", "30% 70%");
      await expect(court).toHaveCSS("transform", scale(1.5));

      await visit(page, `/a/${slug}/team?program=all`);
      const robin = page.getByRole("article", { name: "Robin Coach" }).locator("img");
      await expect(robin).toHaveCSS("object-position", "50% 10%");
      await expect(robin).toHaveCSS("transform", scale(1.25));
      const benPhoto = page.getByRole("article", { name: "Ben Cruz" }).locator("img");
      await expect(benPhoto).toHaveCSS("object-position", "50% 20%");
      await expect(benPhoto).toHaveCSS("transform", "none");
      expect(errors).toEqual([]);
    } finally {
      await visitor.close();
    }
  });
});

test.describe("photo framing, in Settings", () => {
  test("the owner lines up a new cover photo, then a website photo, with Adjust", async ({
    coach: owner,
    page,
  }) => {
    test.slow();
    const { api, request } = owner;
    await onboard(api);
    await uploadPng<AcademyPhotoDto>(
      request,
      "/academy/photos",
      pngImage(64, [30, 90, 160]),
      "POST",
    );
    const errors = watchErrors(page);
    await visit(page, "/settings");

    // A new cover photo opens Adjust. Square, in the home page's tall frame, it only moves
    // sideways until it's zoomed in.
    const profile = page.getByRole("region", { name: "Academy profile" });
    const chooser = page.waitForEvent("filechooser");
    await profile.getByRole("button", { name: "Upload cover photo" }).click();
    await (await chooser).setFiles({
      name: "cover.png",
      mimeType: "image/png",
      buffer: pngImage(400, [30, 90, 160]),
    });
    await expect(page.getByText("Cover photo updated")).toBeVisible();
    const framer = page.getByRole("dialog", { name: "Adjust your cover photo" });
    const across = framer.getByRole("slider", { name: "Left to right" });
    const down = framer.getByRole("slider", { name: "Top to bottom" });
    await expect(across).toBeEnabled();
    await expect(down).toBeDisabled();
    await expect(framer.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    await expect(framer.getByRole("button", { name: "Reset" })).toBeDisabled();
    expect(await seriousViolations(page, '[role="dialog"]')).toEqual([]);

    await framer.getByRole("button", { name: "Zoom in" }).click();
    await framer.getByRole("button", { name: "Zoom in" }).click();
    await expect(framer.getByRole("slider", { name: "Zoom" })).toHaveValue("1.2");
    await expect(framer.getByText("1.2×")).toBeVisible();
    await expect(down).toBeEnabled();
    // The sliders work from the keyboard: more of the left side, then a little lower.
    for (let i = 0; i < 10; i++) await across.press("ArrowLeft");
    for (let i = 0; i < 5; i++) await down.press("ArrowRight");
    await expect(across).toHaveValue("40");
    await expect(down).toHaveValue("55");
    await framer.getByRole("button", { name: "Save" }).click();
    await expect(framer).toBeHidden();
    await expect(page.getByText("Cover photo adjusted")).toBeVisible();
    expect((await api.get<AcademyDto>("/academy")).coverFraming).toEqual({
      x: 40,
      y: 55,
      zoom: 1.2,
    });
    const preview = profile.getByRole("img", { name: "Your website's cover" });
    await expect(preview).toHaveCSS("object-position", "40% 55%");
    await expect(preview).toHaveCSS("transform", scale(1.2));

    // A website photo: square in its 4:3 frame, it only moves up and down. Dragging it up shows
    // more of its lower part.
    const section = page.getByRole("region", { name: "Website photos" });
    await section.getByRole("button", { name: "Adjust photo 1" }).click();
    const adjust = page.getByRole("dialog", { name: "Adjust photo 1" });
    const vertical = adjust.getByRole("slider", { name: "Top to bottom" });
    await expect(vertical).toBeEnabled();
    await expect(adjust.getByRole("slider", { name: "Left to right" })).toBeDisabled();
    const shown = adjust.locator("img").first();
    await shown.scrollIntoViewIfNeeded();
    const box = await shown.boundingBox();
    if (!box) throw new Error("The photo to drag isn't on screen");
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy - 30, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Number(await vertical.inputValue())).toBeGreaterThan(55);
    await expect(adjust.getByRole("slider", { name: "Left to right" })).toHaveValue("50");
    await adjust.getByRole("button", { name: "Save" }).click();
    await expect(adjust).toBeHidden();
    await expect(page.getByText("Photo adjusted", { exact: true })).toBeVisible();
    const [framed] = await api.get<AcademyPhotoDto[]>("/academy/photos");
    expect(framed?.framing).toMatchObject({ x: 50, zoom: 1 });
    expect(framed?.framing?.y).toBeGreaterThan(55);
    const tile = section.getByRole("img", { name: "Photo 1" });
    await expect(tile).toHaveCSS("object-position", `50% ${framed?.framing?.y}%`);

    // Reset puts it back in the middle, which is saved as no framing at all.
    await section.getByRole("button", { name: "Adjust photo 1" }).click();
    await adjust.getByRole("button", { name: "Reset" }).click();
    await expect(vertical).toHaveValue("50");
    await adjust.getByRole("button", { name: "Save" }).click();
    await expect(adjust).toBeHidden();
    expect((await api.get<AcademyPhotoDto[]>("/academy/photos"))[0]?.framing).toBeNull();
    await expect(tile).toHaveCSS("object-position", "50% 50%");
    expect(errors).toEqual([]);
  });

  test("on a phone, a finger drags the photo and two fingers zoom it; Cancel keeps what was saved", async ({
    coach: owner,
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "touch: phones");
    const { api, request } = owner;
    await onboard(api);
    await uploadPng<AcademyPhotoDto>(request, "/academy/photos", pngImage(64), "POST");
    await visit(page, "/settings");
    const section = page.getByRole("region", { name: "Website photos" });
    await section.getByRole("button", { name: "Adjust photo 1" }).click();
    const adjust = page.getByRole("dialog", { name: "Adjust photo 1" });
    const vertical = adjust.getByRole("slider", { name: "Top to bottom" });
    const zoom = adjust.getByRole("slider", { name: "Zoom" });
    await expect(vertical).toBeEnabled();
    const box = await adjust.locator("img").first().boundingBox();
    if (!box) throw new Error("The photo to drag isn't on screen");
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, touchPoints: { x: number; y: number }[]) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints } as never);

    // One finger, up: the photo follows it (and the sheet doesn't scroll instead).
    await touch("touchStart", [{ x: cx, y: cy }]);
    for (let i = 1; i <= 5; i++) await touch("touchMove", [{ x: cx, y: cy - i * 6 }]);
    await touch("touchEnd", []);
    await expect.poll(async () => Number(await vertical.inputValue())).toBeGreaterThan(55);
    await expect(zoom).toHaveValue("1");

    // Two fingers spreading apart: it zooms in.
    await touch("touchStart", [
      { x: cx - 30, y: cy },
      { x: cx + 30, y: cy },
    ]);
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", [
        { x: cx - 30 - i * 10, y: cy },
        { x: cx + 30 + i * 10, y: cy },
      ]);
    }
    await touch("touchEnd", []);
    await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(1.5);
    await cdp.detach();

    // Cancel: nothing was saved.
    await adjust.getByRole("button", { name: "Cancel" }).click();
    await expect(adjust).toBeHidden();
    expect((await api.get<AcademyPhotoDto[]>("/academy/photos"))[0]?.framing).toBeNull();
  });
});
