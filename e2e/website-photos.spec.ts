import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import type {
  AcademyDto,
  AcademyPhotoDto,
  ApiErrorBody,
  MeDto,
  PublicAcademyDto,
  PublicAcademyPreviewDto,
} from "../src/shared/api-types";
import {
  auditLog,
  expect,
  listAcademy,
  onboard,
  pngImage,
  submitSheet,
  test,
  testEmail,
  uploadPng,
  uuid,
  visit,
  watchErrors,
} from "./support";

// The academy's website photos, staff side: the cover photo (Academy profile) and the gallery
// (Settings → Website photos): uploads, captions, the order, the 24-photo limit, who may change
// them, what the public academy API then carries (in order, without anything private), the files'
// cleanup, the audit, and the backup.

/** Every key a public website photo carries (PublicAcademyPhotoDto), nothing else. */
const PUBLIC_PHOTO_KEYS = ["caption", "id", "key"];

const LIMIT_MESSAGE = "You can show up to 24 photos. Remove one to add another.";

/** POSTs a PNG as a new website photo and returns the raw answer (refusals included). */
async function postPhoto(request: APIRequestContext, image = pngImage()) {
  const res = await request.fetch("/api/v1/academy/photos", {
    method: "POST",
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
  return { status: res.status(), text, photo: json as AcademyPhotoDto, json };
}

const messageOf = (res: { json: unknown }) => (res.json as ApiErrorBody | undefined)?.error.message;

async function seriousViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

test.describe("website photos, at the API", () => {
  test.skip(({ isMobile }) => isMobile, "API checks: one browser is enough");

  test("the owner adds a cover and photos, captions and orders them; the public page shows them, and nothing private", async ({
    coach: owner,
    playwright,
  }, info) => {
    test.slow();
    const { api, request } = owner;
    await onboard(api);
    const me = await api.get<MeDto>("/me");
    const ws = me.workspace.id;

    // The cover photo: a public file; a new one replaces it (and the old file goes).
    const firstCover = await uploadPng(request, "/academy/cover");
    expect(firstCover.key).toMatch(new RegExp(`^ws/${ws}/public/cover-[\\w-]+\\.png$`));
    const cover = await uploadPng(request, "/academy/cover", pngImage(64, [30, 90, 160]));
    expect(cover.key).not.toBe(firstCover.key);
    expect((await api.get<AcademyDto>("/academy")).coverKey).toBe(cover.key);

    // Two website photos, each added at the end.
    expect(await api.get<AcademyPhotoDto[]>("/academy/photos")).toEqual([]);
    const courts = await postPhoto(request);
    expect(courts.status, courts.text).toBe(201);
    expect(courts.photo).toMatchObject({ caption: null, sortOrder: 0 });
    expect(courts.photo.key).toMatch(new RegExp(`^ws/${ws}/public/photos/[\\w-]+\\.png$`));
    const clinic = await postPhoto(request, pngImage(48, [120, 160, 200]));
    expect(clinic.status, clinic.text).toBe(201);
    expect(clinic.photo.sortOrder).toBe(1);
    // Only JPEG, PNG, or WebP.
    const notImage = await request.fetch("/api/v1/academy/photos", {
      method: "POST",
      data: "<svg/>",
      headers: { "Content-Type": "image/svg+xml" },
    });
    expect(notImage.status()).toBe(400);

    // A caption is trimmed, an empty one clears it, and 140 characters is the most.
    const captioned = await api.patch<AcademyPhotoDto>(`/academy/photos/${clinic.photo.id}`, {
      caption: "  Saturday clinic on court 2 ",
    });
    expect(captioned.caption).toBe("Saturday clinic on court 2");
    await api.patch(`/academy/photos/${courts.photo.id}`, { caption: "Our courts" });
    const cleared = await api.patch<AcademyPhotoDto>(`/academy/photos/${courts.photo.id}`, {
      caption: "   ",
    });
    expect(cleared.caption).toBeNull();
    const tooLong = await api.raw("PATCH", `/academy/photos/${courts.photo.id}`, {
      caption: "x".repeat(141),
    });
    expect(tooLong.status).toBe(400);
    expect((await api.raw("PATCH", `/academy/photos/${uuid()}`, { caption: "x" })).status).toBe(
      404,
    );

    // The order names every photo once: the clinic first.
    const ordered = await api.put<AcademyPhotoDto[]>("/academy/photos/order", {
      ids: [clinic.photo.id, courts.photo.id],
    });
    expect(ordered.map((p) => [p.id, p.sortOrder])).toEqual([
      [clinic.photo.id, 0],
      [courts.photo.id, 1],
    ]);
    for (const ids of [
      [clinic.photo.id],
      [clinic.photo.id, clinic.photo.id],
      [clinic.photo.id, courts.photo.id, uuid()],
      [],
    ]) {
      const res = await api.raw("PUT", "/academy/photos/order", { ids });
      expect(res.status, JSON.stringify(ids)).toBe(400);
    }
    // A new photo lands after the arranged ones.
    const camp = await postPhoto(request, pngImage(40, [200, 80, 60]));
    expect(camp.status, camp.text).toBe(201);
    expect(camp.photo.sortOrder).toBe(2);
    expect((await api.get<AcademyPhotoDto[]>("/academy/photos")).map((p) => p.id)).toEqual([
      clinic.photo.id,
      courts.photo.id,
      camp.photo.id,
    ]);

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
      // The cover, and the photos in the academy's order with their captions: nothing else.
      expect(academy.coverKey).toBe(cover.key);
      expect(academy.photos).toEqual([
        { id: clinic.photo.id, key: clinic.photo.key, caption: "Saturday clinic on court 2" },
        { id: courts.photo.id, key: courts.photo.key, caption: null },
        { id: camp.photo.id, key: camp.photo.key, caption: null },
      ]);
      for (const p of academy.photos) expect(Object.keys(p).sort()).toEqual(PUBLIC_PHOTO_KEYS);
      for (const secret of [owner.email, me.user.id, "sortOrder", "createdAt", "workspaceId"]) {
        expect(text, secret).not.toContain(secret);
      }
      // The staff preview shows the same.
      const preview = await api.get<PublicAcademyPreviewDto>("/academy/public-preview");
      expect(preview.photos).toEqual(academy.photos);
      expect(preview.coverKey).toBe(cover.key);

      // The files are public; the replaced cover is gone.
      for (const key of [cover.key, clinic.photo.key, courts.photo.key]) {
        expect((await anonymous.get(`/api/public/files/${key}`)).status(), key).toBe(200);
      }
      expect((await anonymous.get(`/api/public/files/${firstCover.key}`)).status()).toBe(404);
      // Nothing deeper than the photos folder, and no climbing out of it.
      for (const path of [
        `ws/${ws}/public/photos/x/${clinic.photo.key.split("/").pop()}`,
        `ws/${ws}/public/photos/..%2Fcover.png`,
      ]) {
        expect((await anonymous.get(`/api/public/files/${path}`)).status(), path).toBe(404);
      }

      // Removing a photo takes it off the page, with its file.
      expect((await api.raw("DELETE", `/academy/photos/${courts.photo.id}`)).status).toBe(204);
      expect((await api.raw("DELETE", `/academy/photos/${courts.photo.id}`)).status).toBe(404);
      expect((await anonymous.get(`/api/public/files/${courts.photo.key}`)).status()).toBe(404);
      const after = (await (
        await anonymous.get(`/api/public/academies/${slug}`)
      ).json()) as PublicAcademyDto;
      expect(after.photos.map((p) => p.id)).toEqual([clinic.photo.id, camp.photo.id]);

      // Removing the cover does the same.
      expect((await api.raw("DELETE", "/academy/cover")).status).toBe(204);
      expect((await api.get<AcademyDto>("/academy")).coverKey).toBeNull();
      expect((await anonymous.get(`/api/public/files/${cover.key}`)).status()).toBe(404);
    } finally {
      await anonymous.dispose();
    }

    // Every change was audited.
    const audit = (await auditLog(request)).map((e) => `${e.action} ${e.entity}`);
    for (const line of [
      "upload academy_cover",
      "upload academy_photo",
      "update academy_photo",
      "reorder academy_photos",
      "delete academy_photo",
    ]) {
      expect(audit, line).toContain(line);
    }

    // The full backup has the photos' rows (the files stay in storage).
    const backup = await api.get<{
      academyPhotos: { id: string; key: string; caption: string | null; sortOrder: number }[];
    }>("/export/workspace.json");
    const rows = [...backup.academyPhotos].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(rows.map((p) => [p.id, p.key, p.caption])).toEqual([
      [clinic.photo.id, clinic.photo.key, "Saturday clinic on court 2"],
      [camp.photo.id, camp.photo.key, null],
    ]);
  });

  test("an academy shows at most 24 photos, and another academy can't touch them", async ({
    coach: owner,
    personas,
  }, info) => {
    test.slow();
    const { api, request } = owner;
    await onboard(api);
    const added: AcademyPhotoDto[] = [];
    for (let i = 0; i < 24; i++) {
      const res = await postPhoto(request, pngImage(8));
      expect(res.status, `photo ${i + 1}: ${res.text}`).toBe(201);
      added.push(res.photo);
    }
    expect(added.map((p) => p.sortOrder)).toEqual(Array.from({ length: 24 }, (_, i) => i));

    // The 25th is refused, and nothing is kept of it.
    const refused = await postPhoto(request);
    expect(refused.status).toBe(400);
    expect(messageOf(refused)).toBe(LIMIT_MESSAGE);
    expect(await api.get<AcademyPhotoDto[]>("/academy/photos")).toHaveLength(24);
    const audit = await auditLog(request);
    expect(audit.filter((e) => e.action === "upload" && e.entity === "academy_photo")).toHaveLength(
      24,
    );

    // Removing one makes room for one.
    const [gone, kept] = added;
    if (!gone || !kept) throw new Error("No photos were added");
    expect((await api.raw("DELETE", `/academy/photos/${gone.id}`)).status).toBe(204);
    expect((await postPhoto(request)).status).toBe(201);
    expect((await postPhoto(request)).status).toBe(400);

    // Another academy: the photos aren't theirs to see or change (its own list is empty).
    const other = await personas.open({
      email: testEmail("photos-other", info),
      name: "Olive Other",
    });
    await onboard(other.api);
    expect(await other.api.get<AcademyPhotoDto[]>("/academy/photos")).toEqual([]);
    const patch = await other.api.raw("PATCH", `/academy/photos/${kept.id}`, {
      caption: "Mine now",
    });
    expect(patch.status).toBe(404);
    expect((await other.api.raw("DELETE", `/academy/photos/${kept.id}`)).status).toBe(404);
    expect((await other.api.raw("PUT", "/academy/photos/order", { ids: [kept.id] })).status).toBe(
      400,
    );
    const mine = await api.get<AcademyPhotoDto[]>("/academy/photos");
    expect(mine.find((p) => p.id === kept.id)).toMatchObject({ caption: null, sortOrder: 1 });
  });
});

test.describe("website photos, in Settings", () => {
  test("the owner sets a cover photo, then adds a photo, captions it, moves it, and removes it", async ({
    coach: owner,
    page,
  }) => {
    test.slow();
    const { api, request } = owner;
    await onboard(api);
    // One photo is there already.
    const existing = await uploadPng<AcademyPhotoDto>(
      request,
      "/academy/photos",
      pngImage(64, [30, 90, 160]),
      "POST",
    );
    const errors = watchErrors(page);
    await visit(page, "/settings");

    // The cover photo, in the Academy profile: resized in the browser (a JPEG), then uploaded.
    const profile = page.getByRole("region", { name: "Academy profile" });
    const chooser = page.waitForEvent("filechooser");
    await profile.getByRole("button", { name: "Upload cover photo" }).click();
    await (await chooser).setFiles({
      name: "cover.png",
      mimeType: "image/png",
      buffer: pngImage(400, [30, 90, 160]),
    });
    await expect(page.getByText("Cover photo updated")).toBeVisible();
    await expect(profile.getByRole("button", { name: "Change cover photo" })).toBeVisible();
    const academy = await api.get<AcademyDto>("/academy");
    expect(academy.coverKey).toMatch(/\/public\/cover-[\w-]+\.jpg$/);
    await expect(profile.getByRole("img", { name: "Your website's cover" })).toHaveAttribute(
      "src",
      `/api/v1/files/${academy.coverKey}`,
    );

    // Website photos: the one already there, how many there may be, and whose photos to upload.
    const section = page.getByRole("region", { name: "Website photos" });
    const tiles = section.getByRole("list", { name: "Website photos" }).getByRole("listitem");
    await expect(tiles).toHaveCount(1);
    await expect(section.getByText("1 of 24 photos")).toBeVisible();
    await expect(
      section.getByText(
        "Only upload photos you have permission to share. For children, ask a parent first.",
      ),
    ).toBeVisible();

    // Add one: resized in the browser (a JPEG), uploaded, and shown last.
    const uploaded = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/v1/academy/photos"),
    );
    await section.locator('input[type="file"]').setInputFiles({
      name: "courts.png",
      mimeType: "image/png",
      buffer: pngImage(320, [120, 160, 200]),
    });
    expect((await uploaded).status()).toBe(201);
    await expect(page.getByText("Photo added")).toBeVisible();
    await expect(tiles).toHaveCount(2);
    const added = (await api.get<AcademyPhotoDto[]>("/academy/photos"))[1];
    if (!added) throw new Error("The photo wasn't added");
    expect(added.key).toMatch(/\/public\/photos\/[\w-]+\.jpg$/);
    await expect(tiles.nth(1).getByRole("img", { name: "Photo 2" })).toHaveAttribute(
      "src",
      `/api/v1/files/${added.key}`,
    );
    await expect(section.getByText("2 of 24 photos")).toBeVisible();
    expect(await seriousViolations(page, "#website-photos")).toEqual([]);

    // Caption it.
    await tiles.nth(1).getByRole("button", { name: "Add a caption to photo 2" }).click();
    const sheet = page.getByRole("dialog", { name: "Caption for photo 2" });
    await sheet.getByRole("textbox", { name: "Caption" }).fill("  Evening drills on court 3 ");
    await submitSheet(sheet, sheet.getByRole("button", { name: "Save caption" }));
    await expect(tiles.nth(1)).toContainText("Evening drills on court 3");
    await expect(
      tiles.nth(0).getByRole("button", { name: "Add a caption to photo 1" }),
    ).toBeVisible();
    expect((await api.get<AcademyPhotoDto[]>("/academy/photos"))[1]?.caption).toBe(
      "Evening drills on court 3",
    );

    // Move it earlier: it leads the website's photos.
    const saved = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes("/api/v1/academy/photos/order"),
    );
    await section.getByRole("button", { name: "Move photo 2 earlier" }).click();
    expect((await saved).status()).toBe(200);
    await expect(tiles.first()).toContainText("Evening drills on court 3");
    await expect(section.getByRole("button", { name: "Move photo 1 earlier" })).toBeDisabled();
    await expect(section.getByRole("button", { name: "Move photo 2 later" })).toBeDisabled();
    expect((await api.get<AcademyPhotoDto[]>("/academy/photos")).map((p) => p.id)).toEqual([
      added.id,
      existing.id,
    ]);

    // Remove it, after saying yes.
    await section.getByRole("button", { name: "Remove photo 1" }).click();
    const confirm = page.getByRole("dialog", { name: "Remove photo 1?" });
    await submitSheet(confirm, confirm.getByRole("button", { name: "Remove photo" }));
    await expect(page.getByText("Photo removed")).toBeVisible();
    await expect(tiles).toHaveCount(1);
    await expect(tiles.first()).not.toContainText("Evening drills on court 3");
    expect((await api.get<AcademyPhotoDto[]>("/academy/photos")).map((p) => p.id)).toEqual([
      existing.id,
    ]);
    expect(errors).toEqual([]);
  });

  test("with no photos yet, the section says what they're for", async ({ coach: owner, page }) => {
    const { api } = owner;
    await onboard(api);
    await visit(page, "/settings");
    const section = page.getByRole("region", { name: "Website photos" });
    await expect(
      section.getByText(
        "Add photos of your courts, sessions, and camps. They appear on your website.",
      ),
    ).toBeVisible();
    await expect(section.getByRole("button", { name: "Add photos" })).toBeEnabled();
    await expect(section.getByText("0 of 24 photos")).toBeVisible();
  });
});
