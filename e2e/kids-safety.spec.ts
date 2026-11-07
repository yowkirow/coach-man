import type { Locator } from "@playwright/test";
import type {
  ClientDetailDto,
  LessonDetailDto,
  MeDto,
  PickupDto,
  PortalStudentDto,
  TodayDto,
} from "../src/shared/api-types";
import {
  Api,
  addMember,
  auditLog,
  bornYearsAgo,
  expect,
  linkFamily,
  pngImage,
  portalCall,
  portalGet,
  submitSheet,
  test,
  testEmail,
  uuid,
  visit,
  watchErrors,
} from "./support";

// Kids' safety (WS5a): parents keep a junior's health details and pickup people current from the
// family portal's Profile; staff read who changed them on the student's profile and, at
// check-in, a medical flag and a Pickup list with photos and tap-to-call. Pickup photos are read
// by staff and the student's own family only, checked against the pickup person they belong to.
// Service workers are blocked (see family.spec.ts).
test.use({ serviceWorkers: "block" });

/** Resolves once the image has loaded and has pixels. */
async function loaded(img: Locator) {
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
}

/** A pickup person as the app sends one: the details as JSON in `data`, the photo in `photo`. */
function pickupForm(data: Record<string, unknown>, photo?: Buffer) {
  return {
    data: JSON.stringify(data),
    ...(photo ? { photo: { name: "photo.png", mimeType: "image/png", buffer: photo } } : {}),
  };
}

test.describe("kids' safety", () => {
  test("a parent keeps a junior's health details and pickup people current; staff see them at check-in", async ({
    page,
    seeded,
    personas,
  }, info) => {
    test.slow();
    const { api, request } = seeded;
    const me = await api.get<MeDto>("/me");
    const { date: today } = await api.get<TodayDto>("/today");
    const tag = uuid().slice(0, 8);
    const MEDICAL = `Peanut allergy ${tag}: her EpiPen is in the front pocket of her bag.`;
    const CAR = `Silver Vios, plate NBC ${tag}`;

    const coachEmail = testEmail("safety-coach", info);
    const coachMember = await addMember(request, {
      email: coachEmail,
      name: "Casey Cruz",
      role: "coach",
    });
    const mia = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(10),
      isJunior: true,
    });
    // Today's clinic, led by the coach.
    const clinic = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "group",
      title: "Junior clinic",
      date: today,
      startTime: "17:00",
      durationMinutes: 60,
      clientIds: [mia.id],
      coachUserId: coachMember.userId,
    });
    const parentEmail = testEmail("safety-parent", info);
    const linked = await linkFamily(request, {
      clientId: mia.id,
      email: parentEmail,
      name: "Pat Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    const parentUserId = (linked.body as { userId: string }).userId;

    // The parent fills in Mia's medical note, emergency contact, and their own phone.
    const parent = await personas.open({ email: parentEmail, name: "Pat Santos", persona: "none" });
    const w = parent.page;
    const errors = watchErrors(w);
    await visit(w, `/my/${mia.id}/profile`);
    await expect(w.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
    await expect(w.getByText("No medical note on file.")).toBeVisible();
    await w.getByRole("button", { name: "Edit health and emergency details" }).click();
    const health = w.getByRole("dialog", { name: "Health and emergency" });
    await health.getByLabel("Medical notes").fill(MEDICAL);
    const emergency = health.getByRole("group", { name: "Emergency contact" });
    await emergency.getByLabel("Name", { exact: true }).fill("Lola Santos");
    await emergency.getByLabel("Phone", { exact: true }).fill("0917 222 3333");
    await health
      .getByRole("group", { name: "Parent or guardian contact" })
      .getByLabel("Phone", { exact: true })
      .fill("0917 444 5555");
    await submitSheet(health, health.getByRole("button", { name: "Save" }));
    await expect(w.getByText(MEDICAL)).toBeVisible();
    await expect(w.getByText(/^Updated by you on /)).toBeVisible();

    // …and adds the grandmother who collects her, with a photo for the coach.
    await w.getByRole("button", { name: "Add person" }).click();
    const add = w.getByRole("dialog", { name: "Add a pickup person" });
    await add.locator('input[type="file"]').setInputFiles({
      name: "rosa.png",
      mimeType: "image/png",
      buffer: pngImage(240, [196, 140, 112]),
    });
    await expect(add.getByRole("button", { name: "Change photo" })).toBeVisible();
    await add.getByLabel("Name", { exact: true }).fill("Rosa Dela Cruz");
    await add.getByLabel("Relationship").fill("Grandmother");
    await add.getByLabel("Phone").fill("0917 555 6666");
    await add.getByLabel("Notes for the coach").fill(CAR);
    await submitSheet(add, add.getByRole("button", { name: "Add person" }));
    const familyPickups = w.getByRole("region", { name: "Pickup" });
    await expect(familyPickups).toContainText("Rosa Dela Cruz");
    await expect(familyPickups).toContainText("Grandmother");
    await loaded(familyPickups.locator("img").first());
    await expect(
      familyPickups.getByRole("link", { name: "Call Rosa Dela Cruz, 0917 555 6666" }),
    ).toHaveAttribute("href", "tel:09175556666");
    expect(errors).toEqual([]);

    // The photo is stored privately under Mia's pickups, made small on the phone.
    const mine = await portalGet<PortalStudentDto>(parent.context.request, `/students/${mia.id}`);
    expect(mine.safety.medicalNotes).toBe(MEDICAL);
    expect(mine.safetyUpdate).toMatchObject({ byYou: true, byAcademy: false });
    const rosa = mine.pickups?.[0];
    if (!rosa?.photoKey) throw new Error("The pickup person has no photo");
    const key = rosa.photoKey;
    expect(key).toMatch(
      new RegExp(`^ws/${me.workspace.id}/clients/${mia.id}/pickups/[0-9a-f-]+\\.jpg$`),
    );
    const own = await parent.context.request.get(`/api/portal/files/${key}`);
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toBe("image/jpeg");

    // The academy sees who changed the details, and the pickup person with her photo.
    await visit(page, `/clients/${mia.id}`);
    await expect(page.getByText(/Updated by Pat Santos \(parent or guardian\) on /)).toBeVisible();
    await expect(page.getByText(MEDICAL).first()).toBeVisible();
    const staffPickups = page.getByRole("region", { name: "Pickup" });
    await expect(staffPickups).toContainText("Rosa Dela Cruz");
    await loaded(staffPickups.locator("img").first());

    // At check-in, the coach reads the medical note and who may pick Mia up.
    const coach = await personas.open({ email: coachEmail, name: "Casey Cruz", persona: "none" });
    const c = coach.page;
    const coachErrors = watchErrors(c);
    await visit(c, `/sessions/${clinic.lesson.lesson.id}`);
    await c.getByRole("button", { name: "Medical note for Mia Santos" }).click();
    const medical = c.getByRole("dialog", { name: "Mia Santos" });
    await expect(medical).toContainText(MEDICAL);
    await expect(
      medical.getByRole("link", { name: "Call Lola Santos, 0917 222 3333" }),
    ).toHaveAttribute("href", "tel:09172223333");
    await medical.getByRole("button", { name: "Close" }).click();
    await expect(medical).toBeHidden();
    await c.getByRole("button", { name: "Who may pick up Mia Santos: 1 person" }).click();
    const pickup = c.getByRole("dialog", { name: "Pickup for Mia" });
    await expect(pickup).toContainText("Rosa Dela Cruz");
    await expect(pickup).toContainText("Grandmother");
    await expect(pickup).toContainText(CAR);
    await expect(
      pickup.getByRole("link", { name: "Call Rosa Dela Cruz, 0917 555 6666" }),
    ).toHaveAttribute("href", "tel:09175556666");
    await loaded(pickup.locator("img").first());
    await pickup.getByRole("button", { name: "Close" }).click();
    expect((await coach.context.request.get(`/api/v1/files/${key}`)).status()).toBe(200);

    // Today tells the coach before the session starts.
    await visit(c, "/");
    await c
      .getByRole("region", { name: "Needs attention" })
      .getByRole("button", { name: /^1 junior with medical notes/ })
      .click();
    const notes = c.getByRole("dialog", { name: "Medical notes today" });
    await expect(notes).toContainText("Mia Santos");
    await expect(notes).toContainText(MEDICAL);
    expect(coachErrors).toEqual([]);

    // Staff (a coach too) keep pickup people current; the family sees the change.
    const edited = await coach.api.patch<PickupDto>(`/clients/${mia.id}/pickups/${rosa.id}`, {
      name: "Rosa Dela Cruz",
      relationship: "Lola (grandmother)",
      phone: "0917 555 6666",
      notes: CAR,
    });
    expect(edited.relationship).toBe("Lola (grandmother)");
    expect(edited.photoKey).toBe(key);
    const seen = await portalGet<PortalStudentDto>(parent.context.request, `/students/${mia.id}`);
    expect(seen.pickups?.[0]?.relationship).toBe("Lola (grandmother)");

    // Another family of the same academy reaches none of it.
    const zoe = await api.post<{ id: string }>("/clients", {
      firstName: "Zoe",
      lastName: "Reyes",
      birthDate: bornYearsAgo(9),
      isJunior: true,
    });
    const otherEmail = testEmail("safety-other", info);
    expect(
      (
        await linkFamily(request, {
          clientId: zoe.id,
          email: otherEmail,
          name: "Lee Reyes",
          relation: "guardian",
        })
      ).status,
    ).toBe(201);
    const other = await personas.open({ email: otherEmail, name: "Lee Reyes", persona: "none" });
    const o = other.context.request;
    expect((await o.get(`/api/portal/files/${key}`)).status()).toBe(404);
    for (const [method, path, body] of [
      ["GET", `/students/${mia.id}`, undefined],
      ["PATCH", `/students/${mia.id}/safety`, { medicalNotes: "None" }],
      ["POST", `/students/${mia.id}/pickups`, { name: "A stranger" }],
      ["PATCH", `/students/${mia.id}/pickups/${rosa.id}`, { name: "A stranger" }],
      ["DELETE", `/students/${mia.id}/pickups/${rosa.id}`, undefined],
      // Through their own student: Rosa isn't Zoe's.
      ["PATCH", `/students/${zoe.id}/pickups/${rosa.id}`, { name: "A stranger" }],
      ["DELETE", `/students/${zoe.id}/pickups/${rosa.id}`, undefined],
    ] as const) {
      const res = await portalCall(o, method, path, body);
      expect(res.status, `${method} ${path}: ${res.text}`).toBe(404);
      expect(res.text).not.toContain(tag);
    }
    // A key in the right folder that no pickup person owns: 404, even for Mia's parent.
    const guess = key.replace(/pickups\/[^/]+$/, `pickups/${uuid()}.jpg`);
    expect((await parent.context.request.get(`/api/portal/files/${guess}`)).status()).toBe(404);
    const after = await portalGet<PortalStudentDto>(parent.context.request, `/students/${mia.id}`);
    expect(after.safety.medicalNotes).toBe(MEDICAL);
    expect(after.pickups?.map((p) => p.name)).toEqual(["Rosa Dela Cruz"]);

    // The audit log says who changed which fields, and never what they say.
    const entries = (await auditLog(request)) as {
      action: string;
      entity: string;
      entityId: string | null;
      userId: string | null;
      data: unknown;
    }[];
    const safety = entries.find((e) => e.entity === "client_safety" && e.entityId === mia.id);
    expect(safety).toMatchObject({
      action: "update",
      userId: parentUserId,
      data: { by: "guardian" },
    });
    expect((safety?.data as { fields?: string[] } | undefined)?.fields).toEqual(
      expect.arrayContaining(["medicalNotes", "emergencyName", "emergencyPhone", "guardianPhone"]),
    );
    expect(
      entries.find(
        (e) => e.entity === "authorized_pickup" && e.action === "create" && e.entityId === rosa.id,
      ),
    ).toMatchObject({
      userId: parentUserId,
      data: { clientId: mia.id, photo: "added", by: "guardian" },
    });
    expect(
      entries.find(
        (e) => e.entity === "authorized_pickup" && e.action === "update" && e.entityId === rosa.id,
      ),
    ).toMatchObject({
      userId: coachMember.userId,
      data: { clientId: mia.id, fields: ["relationship"], by: "staff" },
    });
    const log = JSON.stringify(entries);
    for (const secret of [tag, "Peanut", "EpiPen", "Lola Santos", "0917 222 3333", "Rosa"]) {
      expect(log).not.toContain(secret);
    }
  });

  test("who may change what: a teen reads, an adult keeps their own, staff keep pickups", async ({
    seeded,
    personas,
  }, info) => {
    test.slow();
    const { api, request } = seeded;
    const leo = await api.post<{ id: string }>("/clients", {
      firstName: "Leo",
      lastName: "Park",
      birthDate: bornYearsAgo(15),
      isJunior: true,
      medicalNotes: "Wears glasses for distance.",
    });
    const parentEmail = testEmail("teen-parent", info);
    const teenEmail = testEmail("teen", info);
    for (const [email, name, relation] of [
      [parentEmail, "Grace Park", "guardian"],
      [teenEmail, "Leo Park", "self"],
    ] as const) {
      expect((await linkFamily(request, { clientId: leo.id, email, name, relation })).status).toBe(
        201,
      );
    }
    const parent = await personas.open({ email: parentEmail, name: "Grace Park", persona: "none" });
    const teen = await personas.open({ email: teenEmail, name: "Leo Park", persona: "none" });
    const p = parent.context.request;
    const t = teen.context.request;

    // The parent adds a pickup person with a photo, the way the app sends it.
    const added = await p.post(`/api/portal/students/${leo.id}/pickups`, {
      multipart: pickupForm(
        { name: "Min Park", relationship: "Uncle", phone: "0917 777 8888" },
        pngImage(64, [90, 120, 200]),
      ),
    });
    expect(added.status(), await added.text()).toBe(201);
    const min = ((await added.json()) as PortalStudentDto).pickups?.[0];
    if (!min?.photoKey) throw new Error("The pickup person has no photo");
    expect(min.photoKey).toMatch(new RegExp(`/clients/${leo.id}/pickups/[0-9a-f-]+\\.png$`));
    // Not an image, whatever it claims to be: refused by its bytes.
    const fake = await p.post(`/api/portal/students/${leo.id}/pickups`, {
      multipart: {
        data: JSON.stringify({ name: "Not a photo" }),
        photo: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("not a picture") },
      },
    });
    expect(fake.status()).toBe(400);

    // Leo's own login reads it all, the photo too, and changes none of it.
    const seen = await portalGet<PortalStudentDto>(t, `/students/${leo.id}`);
    expect(seen.editable).toEqual({
      medical: false,
      emergency: false,
      guardianContact: false,
      shirtSize: false,
      pickups: false,
    });
    expect(seen.safety.medicalNotes).toBe("Wears glasses for distance.");
    expect(seen.pickups?.map((x) => x.name)).toEqual(["Min Park"]);
    expect((await t.get(`/api/portal/files/${min.photoKey}`)).status()).toBe(200);
    for (const [method, path, body] of [
      ["PATCH", `/students/${leo.id}/safety`, { medicalNotes: "Nothing" }],
      ["PATCH", `/students/${leo.id}/safety`, { shirtSize: "Kids M" }],
      ["POST", `/students/${leo.id}/pickups`, { name: "A friend" }],
      ["PATCH", `/students/${leo.id}/pickups/${min.id}`, { name: "Min" }],
      ["DELETE", `/students/${leo.id}/pickups/${min.id}`, undefined],
    ] as const) {
      const res = await portalCall(t, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(Api.code(res)).toBe("read_only");
    }
    await visit(teen.page, `/my/${leo.id}/profile`);
    await expect(teen.page.getByText("Wears glasses for distance.")).toBeVisible();
    await expect(teen.page.getByRole("region", { name: "Pickup" })).toContainText("Min Park");
    await expect(
      teen.page.getByText(
        "Your parent or guardian keeps your health details and pickup people up to date.",
      ),
    ).toBeVisible();
    await expect(teen.page.getByRole("button", { name: /^Edit/ })).toHaveCount(0);
    await expect(teen.page.getByRole("button", { name: "Add person" })).toHaveCount(0);

    // The parent changes anything, their own email included, which is never sent back.
    const saved = await portalCall(p, "PATCH", `/students/${leo.id}/safety`, {
      medicalNotes: "Glasses for distance; mild asthma.",
      shirtSize: "Adult M",
      guardianEmail: "grace.park@example.com",
    });
    expect(saved.status, saved.text).toBe(200);
    const savedDto = saved.json as PortalStudentDto;
    expect(savedDto.student.shirtSize).toBe("Adult M");
    expect(savedDto.safety.guardianEmailOnFile).toBe(true);
    expect(saved.text).not.toContain("grace.park@example.com");
    const leoDetail = await api.get<ClientDetailDto>(`/clients/${leo.id}`);
    expect(leoDetail.client.guardianEmail).toBe("grace.park@example.com");
    expect(leoDetail.safetyUpdate).toMatchObject({ relation: "guardian", byName: "Grace Park" });

    // An adult student keeps their own health details, emergency contact, and shirt size.
    const ana = await api.post<{ id: string }>("/clients", {
      firstName: "Ana",
      lastName: "Reyes",
      birthDate: bornYearsAgo(30),
    });
    const anaEmail = testEmail("adult", info);
    expect(
      (
        await linkFamily(request, {
          clientId: ana.id,
          email: anaEmail,
          name: "Ana Reyes",
          relation: "self",
        })
      ).status,
    ).toBe(201);
    const adult = await personas.open({ email: anaEmail, name: "Ana Reyes", persona: "none" });
    const a = adult.context.request;
    const anaView = await portalGet<PortalStudentDto>(a, `/students/${ana.id}`);
    expect(anaView.editable).toEqual({
      medical: true,
      emergency: true,
      guardianContact: false,
      shirtSize: true,
      pickups: false,
    });
    expect(anaView.pickupsApply).toBe(false);
    const anaSaved = await portalCall(a, "PATCH", `/students/${ana.id}/safety`, {
      medicalNotes: "Knee brace on the left.",
      emergencyName: "Ben Reyes",
      emergencyPhone: "0917 123 4567",
      shirtSize: "Adult L",
    });
    expect(anaSaved.status, anaSaved.text).toBe(200);
    const refused = await portalCall(a, "PATCH", `/students/${ana.id}/safety`, {
      guardianPhone: "0917 000 0000",
    });
    expect(refused.status).toBe(403);
    expect(Api.code(refused)).toBe("read_only");
    expect((await portalCall(a, "POST", `/students/${ana.id}/pickups`, { name: "X" })).status).toBe(
      403,
    );
    const anaDetail = await api.get<ClientDetailDto>(`/clients/${ana.id}`);
    expect(anaDetail.client.shirtSize).toBe("Adult L");
    expect(anaDetail.safetyUpdate).toMatchObject({ relation: "self", byName: "Ana Reyes" });

    // Staff of any role keep pickup people too: a coach adds one with a photo, then removes it.
    const coachEmail = testEmail("teen-coach", info);
    await addMember(request, { email: coachEmail, name: "Casey Coach", role: "coach" });
    const coach = await personas.open({ email: coachEmail, name: "Casey Coach", persona: "none" });
    const byCoach = await coach.context.request.post(`/api/v1/clients/${leo.id}/pickups`, {
      multipart: pickupForm({ name: "Joy Park", relationship: "Aunt" }, pngImage(48)),
    });
    expect(byCoach.status(), await byCoach.text()).toBe(201);
    const joy = (await byCoach.json()) as PickupDto;
    const parentView = await portalGet<PortalStudentDto>(p, `/students/${leo.id}`);
    expect(parentView.pickups?.map((x) => x.name)).toEqual(["Min Park", "Joy Park"]);
    expect((await t.get(`/api/portal/files/${joy.photoKey}`)).status()).toBe(200);
    expect((await coach.api.raw("DELETE", `/clients/${leo.id}/pickups/${joy.id}`)).status).toBe(
      204,
    );
    expect((await p.get(`/api/portal/files/${joy.photoKey}`)).status()).toBe(404);
    expect((await coach.context.request.get(`/api/v1/files/${joy.photoKey}`)).status()).toBe(404);
  });
});
