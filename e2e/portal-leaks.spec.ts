import type { APIRequestContext } from "@playwright/test";
import type {
  AcademyDto,
  ClientListItemDto,
  LessonDetailDto,
  MeDto,
  PortalHomeDto,
  TodayDto,
} from "../src/shared/api-types";
import {
  bornYearsAgo,
  expect,
  linkFamily,
  onboard,
  type Personas,
  portalCall,
  portalGet,
  type RawResponse,
  test,
  testEmail,
  uploadPng,
  uuid,
  visit,
  watchErrors,
} from "./support";

// The family portal must never show what an academy keeps to itself. Every kind of private
// detail is seeded with a unique marker; no portal answer (and no portal page) may contain any of
// them, and ids that aren't the family's answer 404. Service workers are blocked (see
// family.spec.ts).
test.use({ serviceWorkers: "block" });

/** `day` moved by `days` (YYYY-MM-DD). */
function shift(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Checks a player in (or another status) the way the app does, with an idempotency key. */
async function mark(
  api: import("./support").Api,
  attendanceId: string,
  status: string,
  note?: string,
) {
  const mid = uuid();
  await api.post(
    `/attendance/${attendanceId}`,
    { status, mutationId: mid, note },
    { "Idempotency-Key": mid },
  );
}

/** A second academy (its own owner) with a student and a shared note nobody else may see. */
async function otherAcademy(
  personas: Personas,
  info: import("@playwright/test").TestInfo,
  M: (s: string) => string,
) {
  const owner = await personas.open({
    email: testEmail("other-academy", info),
    name: "Lee Owner",
    persona: "coach",
  });
  await onboard(owner.api);
  const student = await owner.api.post<{ id: string }>("/clients", {
    firstName: M("OTHERACADEMY"),
    lastName: "Lim",
    birthDate: bornYearsAgo(11),
    isJunior: true,
  });
  await owner.api.post("/notes", {
    clientId: student.id,
    body: M("OTHERACADEMYNOTE"),
    visibility: "shared",
  });
  const photo = await uploadPng(owner.context.request, `/clients/${student.id}/photo`);
  await uploadPng(owner.context.request, "/academy/logo");
  const academy = await owner.api.get<AcademyDto>("/academy");
  const me = await owner.api.get<MeDto>("/me");
  return {
    workspaceId: me.workspace.id,
    studentId: student.id,
    photoKey: photo.photoKey ?? "",
    logoKey: academy.logoKey ?? "",
  };
}

test.describe("family portal privacy", () => {
  test("no portal answer carries private notes, internal fields, other students, or another academy @smoke", async ({
    request,
    seeded,
    personas,
  }, info) => {
    test.slow();
    const { api } = seeded;
    const staff = seeded.request;
    const tag = uuid().replace(/-/g, "").slice(0, 10);
    const M = (name: string) => `LEAK${name}${tag}`;
    const me = await api.get<MeDto>("/me");
    const { date: today } = await api.get<TodayDto>("/today");
    const sampleClients = await api.get<ClientListItemDto[]>("/clients");

    // The coach keeps their profile private: no bio for families.
    await api.patch(`/coaches/${me.user.id}`, {
      title: "Head coach",
      bio: M("PRIVATEBIO"),
      certifications: [M("PRIVATECERT")],
      isPublic: false,
    });
    await uploadPng(staff, "/academy/logo");

    // The family's student, with every internal field filled in.
    const mia = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(10),
      isJunior: true,
      notes: M("CLIENTNOTES"),
      tags: [M("TAG")],
      source: M("SOURCE"),
      goals: M("CLIENTGOALS"),
      guardianEmail: M("GUARDIANEMAIL"),
      duprId: M("DUPRID"),
      paddle: M("PADDLE"),
      medicalNotes: "Mild asthma.",
    });
    const miaPhoto = await uploadPng(staff, `/clients/${mia.id}/photo`);
    // Another student in the same academy, with a shared note and a photo of their own.
    const sibling = await api.post<{ id: string }>("/clients", {
      firstName: M("SIBLING"),
      lastName: M("SIBLINGLAST"),
      birthDate: bornYearsAgo(11),
      isJunior: true,
      medicalNotes: M("SIBLINGMEDICAL"),
    });
    const siblingPhoto = await uploadPng(staff, `/clients/${sibling.id}/photo`);
    await api.post("/notes", {
      clientId: sibling.id,
      body: M("SIBLINGNOTE"),
      visibility: "shared",
    });

    // Notes: one for coaches only, a handoff note (always coaches only, even if asked to share),
    // and one shared with the family.
    await api.post("/notes", { clientId: mia.id, body: M("STAFFNOTE") });
    await api.post("/notes", {
      clientId: mia.id,
      body: M("HANDOFF"),
      kind: "handoff",
      visibility: "shared",
    });
    await api.post("/notes", {
      clientId: mia.id,
      body: "Great footwork in the drills today.",
      visibility: "shared",
    });

    // Assessments: one shared, one not.
    const skills = await api.get<{ id: string }[]>("/skills");
    const [skill] = skills;
    expect(skill).toBeTruthy();
    await api.post(`/clients/${mia.id}/assessments`, {
      assessedOn: today,
      overallLevel: "3.0",
      notes: "Steady progress at the net.",
      scores: [{ skillId: skill?.id, score: 3 }],
      sharedWithFamily: true,
    });
    await api.post(`/clients/${mia.id}/assessments`, {
      assessedOn: shift(today, -1),
      overallLevel: M("LVL").slice(0, 20),
      notes: M("UNSHARED"),
      scores: [{ skillId: skill?.id, score: 4, note: M("SCORENOTE") }],
      sharedWithFamily: false,
    });

    // Sessions with both students: internal lesson notes, an attendance note, a cancelled one.
    const together = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "group",
      date: shift(today, -1),
      startTime: "16:00",
      durationMinutes: 60,
      clientIds: [mia.id, sibling.id],
      notes: M("LESSONNOTES"),
    });
    for (const entry of together.lesson.roster) {
      await mark(api, entry.attendanceId, "present", M("ATTENDNOTE"));
    }
    await api.post("/lessons", {
      kind: "group",
      date: shift(today, 2),
      startTime: "16:00",
      durationMinutes: 60,
      clientIds: [mia.id, sibling.id],
      notes: M("UPCOMINGNOTES"),
    });
    const cancelled = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "private",
      date: shift(today, 3),
      startTime: "10:00",
      durationMinutes: 60,
      clientIds: [mia.id],
    });
    await api.post(`/lessons/${cancelled.lesson.lesson.id}/cancel`, { reason: M("CANCELREASON") });

    // Money: package notes, a credit adjustment's note, a payment note, a voided charge, and an
    // event registration's note.
    const pack = await api.post<{ id: string }>("/packages", {
      name: "5-session pack",
      credits: 5,
      priceMinor: 250000,
      validityDays: 60,
    });
    const sold = await api.post<{ id: string }>(`/clients/${mia.id}/packages`, {
      packageId: pack.id,
      notes: M("PACKAGENOTES"),
    });
    await api.post(`/client-packages/${sold.id}/adjust`, { delta: 1, note: M("ADJUSTNOTE") });
    await api.post("/payments", {
      clientId: mia.id,
      amountMinor: 100000,
      method: "Cash",
      paidOn: today,
      note: M("PAYMENTNOTE"),
    });
    const voidedId = uuid();
    await api.post("/charges", {
      id: voidedId,
      clientId: mia.id,
      kind: "other",
      description: M("VOIDEDCHARGE"),
      amountMinor: 30000,
      occurredOn: today,
    });
    await api.post(`/charges/${voidedId}/void`, { reason: M("VOIDREASON") });
    await api.post("/charges", {
      clientId: mia.id,
      kind: "other",
      description: "Court fee",
      amountMinor: 20000,
      occurredOn: today,
    });
    const camp = await api.post<{ id: string }>("/events", {
      kind: "camp",
      name: "Holiday camp",
      startsOn: shift(today, 10),
      endsOn: shift(today, 12),
      priceMinor: 150000,
    });
    await api.post(`/events/${camp.id}/registrations`, { clientId: mia.id, note: M("REGNOTE") });
    await api.post(`/events/${camp.id}/registrations`, { clientId: sibling.id });

    // Another academy, with its own student.
    const elsewhere = await otherAcademy(personas, info, M);

    // The parent: linked to Mia only.
    const email = testEmail("parent", info);
    const linked = await linkFamily(staff, {
      clientId: mia.id,
      email,
      name: "Pat Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    const parent = await personas.open({ email, name: "Pat Santos", persona: "none" });
    const fam = parent.context.request;

    // Everything the portal answers for the family's own student.
    const answers: Record<string, RawResponse> = {};
    const collect = async (
      method: "GET" | "POST" | "DELETE",
      path: string,
      expected: number,
      req: APIRequestContext = fam,
    ) => {
      const res = await portalCall(req, method, path);
      expect(res.status, `${method} ${path}: ${res.text}`).toBe(expected);
      answers[`${method} ${path}`] = res;
      return res;
    };
    const account = await fam.get("/api/account");
    answers["GET /api/account"] = {
      status: account.status(),
      text: await account.text(),
      json: undefined,
    };
    await collect("GET", "/home", 200);
    await collect("GET", `/academies/${me.workspace.id}`, 200);
    await collect("GET", `/students/${mia.id}`, 200);
    await collect("GET", `/students/${mia.id}/schedule`, 200);
    await collect(
      "GET",
      `/students/${mia.id}/schedule?from=${shift(today, -30)}&to=${shift(today, 30)}`,
      200,
    );
    await collect("GET", `/students/${mia.id}/progress`, 200);
    await collect("GET", `/students/${mia.id}/money`, 200);
    // Ten years old: no own login, and the refusal is all it says.
    await collect("POST", `/students/${mia.id}/teen-invite`, 409);

    // What families should see is there.
    const all = Object.values(answers)
      .map((a) => a.text)
      .join("\n");
    for (const visible of [
      "Great footwork in the drills today.",
      "Steady progress at the net.",
      "Court fee",
      "5-session pack",
      "Holiday camp",
      "Mild asthma.",
      "Head coach",
    ]) {
      expect(all, visible).toContain(visible);
    }

    // And nothing private is.
    const forbidden = [
      ...[
        "PRIVATEBIO",
        "PRIVATECERT",
        "CLIENTNOTES",
        "TAG",
        "SOURCE",
        "CLIENTGOALS",
        "GUARDIANEMAIL",
        "DUPRID",
        "PADDLE",
        "SIBLING",
        "SIBLINGLAST",
        "SIBLINGMEDICAL",
        "SIBLINGNOTE",
        "STAFFNOTE",
        "HANDOFF",
        "UNSHARED",
        "SCORENOTE",
        "LESSONNOTES",
        "ATTENDNOTE",
        "UPCOMINGNOTES",
        "CANCELREASON",
        "PACKAGENOTES",
        "ADJUSTNOTE",
        "PAYMENTNOTE",
        "VOIDEDCHARGE",
        "VOIDREASON",
        "REGNOTE",
        "OTHERACADEMY",
        "OTHERACADEMYNOTE",
      ].map(M),
      M("LVL").slice(0, 20),
      // No coach contact details or staff ids, no other student's id or photo, no other academy.
      seeded.email.toLowerCase(),
      me.user.id,
      sibling.id,
      siblingPhoto.photoKey ?? "",
      elsewhere.workspaceId,
      elsewhere.studentId,
      ...sampleClients.map((c) => c.id),
    ].filter(Boolean);
    for (const [where, res] of Object.entries(answers)) {
      for (const secret of forbidden) {
        expect(res.text.includes(secret), `${where} contains ${secret}`).toBe(false);
      }
    }
    // Every marker carries the run's tag: a backstop for anything not listed above.
    expect(all).not.toContain(tag);

    // Ids that aren't the family's answer 404, whoever they belong to.
    for (const id of [sibling.id, elsewhere.studentId, uuid(), "..", "%2e%2e"]) {
      for (const path of ["", "/schedule", "/progress", "/money"]) {
        const res = await portalCall(fam, "GET", `/students/${id}${path}`);
        expect(res.status, `GET /students/${id}${path}`).toBe(404);
        expect(res.text).not.toContain(M("SIBLING"));
      }
      expect((await portalCall(fam, "POST", `/students/${id}/teen-invite`)).status).toBe(404);
      expect((await portalCall(fam, "DELETE", `/students/${id}/access/${uuid()}`)).status).toBe(
        404,
      );
      expect(
        (await portalCall(fam, "DELETE", `/students/${id}/teen-invites/${uuid()}`)).status,
      ).toBe(404);
    }
    for (const id of [elsewhere.workspaceId, uuid()]) {
      expect((await portalCall(fam, "GET", `/academies/${id}`)).status).toBe(404);
    }

    // Files: Mia's photo and her academy's logo; nobody else's photo, nothing outside her
    // folder, no payment proofs (those come with WS4), and no way around it.
    const ws = me.workspace.id;
    const academy = await api.get<AcademyDto>("/academy");
    const file = async (key: string) => (await fam.get(`/api/portal/files/${key}`)).status();
    expect(await file(miaPhoto.photoKey ?? "")).toBe(200);
    expect(await file(academy.logoKey ?? "")).toBe(200);
    expect(await file(siblingPhoto.photoKey ?? "")).toBe(404);
    expect(await file(elsewhere.photoKey)).toBe(404);
    expect(await file(elsewhere.logoKey)).toBe(404);
    expect(await file(`ws/${ws}/clients/${mia.id}/payments/${uuid()}.png`)).toBe(404);
    const siblingFile = (siblingPhoto.photoKey ?? "").split("/").at(-1);
    expect(await file(`ws/${ws}/clients/${mia.id}/%2E%2E/${sibling.id}/${siblingFile}`)).toBe(404);
    expect(await file(`ws/${ws}/clients/${mia.id}/..%2F${sibling.id}%2F${siblingFile}`)).toBe(404);

    // Signed out: 401. Signed in with no links: an empty home, not an error.
    const signedOut = await request.get("/api/portal/home");
    expect(signedOut.status()).toBe(401);
    const nobody = await personas.open({
      email: testEmail("nobody", info),
      name: "Jordan Lake",
      persona: "none",
    });
    const empty = await portalGet<PortalHomeDto>(nobody.context.request, "/home");
    expect(empty).toEqual({
      user: { name: "Jordan Lake", firstName: "Jordan" },
      academies: [],
      students: [],
      comments: [],
      announcements: [],
    });
    expect((await portalCall(nobody.context.request, "GET", `/students/${mia.id}`)).status).toBe(
      404,
    );

    // The portal's pages show none of it either, and load without errors.
    const errors = watchErrors(parent.page);
    for (const path of [
      "/my",
      `/my/${mia.id}/progress`,
      `/my/${mia.id}/schedule`,
      `/my/${mia.id}/coaches`,
      `/my/${mia.id}/payments`,
      `/my/${mia.id}/profile`,
      "/my/settings",
    ]) {
      await visit(parent.page, path);
      await expect(parent.page.locator("h1").first()).toBeVisible();
      await parent.page.waitForLoadState("networkidle");
      const html = await parent.page.content();
      expect(html, path).not.toContain(tag);
      for (const id of [sibling.id, elsewhere.studentId, me.user.id]) {
        expect(html, `${path} has ${id}`).not.toContain(id);
      }
    }
    // Someone else's student in the address: the page says it isn't theirs.
    await visit(parent.page, `/my/${sibling.id}/progress`);
    await expect(parent.page.getByText("Not linked to your account")).toBeVisible();
    expect(errors.filter((e) => !e.startsWith("404 GET /api/portal/students/"))).toEqual([]);
  });
});
