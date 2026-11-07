import type {
  AcademyDto,
  FamilyInviteCreatedDto,
  GroupDto,
  MeDto,
  PublicAcademyDto,
  PublicSessionDto,
  StaffInviteCreatedDto,
  TodayDto,
} from "../src/shared/api-types";
import { addDays, weekdayOf } from "../src/shared/time";
import {
  addMember,
  bornYearsAgo,
  expect,
  inviteToken,
  listAcademy,
  onboard,
  test,
  testEmail,
  uploadPng,
  uuid,
} from "./support";

// Public endpoints never return non-public data (plan: "Security and privacy"; spec §7): the public
// academy API, the page HTML the Worker writes (its data block), the trial session list, the
// public config, and invite link previews. Everything private is seeded with the run's marker, so
// one search finds a leak anywhere.

test.describe("what anyone can read", () => {
  test.skip(({ isMobile }) => isMobile, "API checks: one browser is enough");

  test("the academy page, its HTML, and its sessions carry only what's published", async ({
    coach: owner,
    personas,
    playwright,
  }, info) => {
    test.slow();
    const { api, request } = owner;
    const tag = uuid().replace(/-/g, "").slice(0, 10);
    const M = (what: string) => `INTERNAL${what}${tag}`;
    await onboard(api);
    const me = await api.get<MeDto>("/me");
    const { date: today } = await api.get<TodayDto>("/today");
    const tomorrow = addDays(today, 1);

    // The owner shows a coach profile; another coach keeps theirs private but leads the program.
    await api.patch(`/coaches/${me.user.id}`, { title: "Head coach", isPublic: true });
    const privateEmail = testEmail("private-coach", info);
    const { userId: privateId } = await addMember(request, {
      email: privateEmail,
      name: `Quiet${tag} Coach`,
      role: "coach",
    });
    await api.patch(`/coaches/${privateId}`, {
      title: M("TITLE"),
      bio: M("BIO"),
      certifications: [M("CERT")],
      isPublic: false,
    });

    // A student, with what an academy keeps to itself.
    const student = await api.post<{ id: string }>("/clients", {
      firstName: M("STUDENT"),
      lastName: "Lim",
      birthDate: bornYearsAgo(12),
      isJunior: true,
      notes: M("NOTES"),
      medicalNotes: M("MEDICAL"),
      guardianPhone: "0917 000 4444",
    });

    // Programs: a public one (led by the private coach, assisted by the owner), a private one, and
    // a public one that was archived.
    const program = await api.post<GroupDto>("/groups", {
      name: "Evening program",
      isPublic: true,
      description: M("GROUPDESC"),
      publicDescription: "Evening training for every level.",
      capacity: 12,
      coachUserId: privateId,
      assistantCoachIds: [me.user.id],
    });
    const hidden = await api.post<GroupDto>("/groups", { name: M("SECRETPROGRAM") });
    const archived = await api.post<GroupDto>("/groups", { name: M("OLDPROGRAM"), isPublic: true });
    await api.post(`/groups/${archived.id}/archive`, {});

    // Sessions: a weekly series of the public program with the student booked and a coaches' plan,
    // and a session of the private one.
    await api.post(`/groups/${program.id}/members`, { clientIds: [student.id] });
    await api.post("/lessons", {
      kind: "group",
      groupId: program.id,
      date: tomorrow,
      startTime: "19:00",
      durationMinutes: 180,
      court: "1",
      notes: M("LESSONNOTES"),
      recurrence: { weekdays: [weekdayOf(tomorrow)] },
    });
    await api.post("/lessons", {
      kind: "group",
      groupId: hidden.id,
      date: tomorrow,
      startTime: "08:00",
      durationMinutes: 60,
    });

    // Tiers: one published, and every way of not being published.
    for (const tier of [
      { name: "Monthly", programId: program.id, isPublic: true, description: M("TIERDESC") },
      { name: M("DRAFTTIER"), programId: program.id, isPublic: false },
      { name: M("RETIREDTIER"), programId: program.id, isPublic: true, active: false },
      { name: M("SECRETTIER"), programId: hidden.id, isPublic: true },
      { name: M("OLDTIER"), programId: archived.id, isPublic: true },
      { name: "Private lessons", isPublic: true, coachUserId: privateId },
    ]) {
      await api.post("/packages", { credits: 4, priceMinor: 100000, ...tier });
    }

    // Consents: the required one is named on the page; an optional one and a draft aren't.
    await api.post("/consent-documents", {
      kind: "waiver",
      title: "Waiver and release",
      body: "Pickleball has risks.",
      required: true,
    });
    await api.post("/consent-documents", {
      kind: "media",
      title: M("OPTIONAL"),
      body: M("OPTIONALBODY"),
      required: false,
    });
    await api.post("/consent-documents", {
      kind: "other",
      title: M("DRAFTDOC"),
      body: M("DRAFTBODY"),
      active: false,
    });

    // The academy's own settings: how to pay and the payment QR are for families, not the page.
    await uploadPng(request, "/academy/payment-qr");
    const slug = await listAcademy(api, info, {
      name: "Riverside Pickleball Academy",
      paymentInstructions: M("PAY"),
      enrollmentOpen: true,
    });
    const settings = await api.get<AcademyDto>("/academy");
    expect(settings.paymentQrKey).toBeTruthy();

    // Another academy's public program, asked for under this academy's address.
    const other = await personas.open({
      email: testEmail("public-other", info),
      name: "Lee Owner",
      persona: "coach",
    });
    await onboard(other.api);
    const elsewhere = await other.api.post<GroupDto>("/groups", {
      name: "Their program",
      isPublic: true,
    });

    const anonymous = await playwright.request.newContext({
      baseURL: info.project.use.baseURL,
      extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    });
    try {
      const sessionsOf = (id: string) => `/api/public/academies/${slug}/programs/${id}/sessions`;
      const reads = {
        "public academy": `/api/public/academies/${slug}`,
        "its consents": `/api/public/academies/${slug}/consents`,
        "trial sessions": sessionsOf(program.id),
        "page HTML": `/a/${slug}`,
        "rates sheet HTML": `/a/${slug}/rates`,
        "enrollment wizard HTML": `/a/${slug}/enroll`,
        "public config": "/api/public/config",
      };
      const forbidden = [
        tag,
        owner.email,
        me.user.id,
        privateId,
        privateEmail,
        student.id,
        settings.paymentQrKey ?? "",
        "0917 000 4444",
      ];
      const texts: Record<string, string> = {};
      for (const [what, path] of Object.entries(reads)) {
        const res = await anonymous.get(path);
        expect(res.status(), what).toBe(200);
        texts[what] = await res.text();
        for (const secret of forbidden) {
          expect(texts[what]?.includes(secret), `${what} contains ${secret}`).toBe(false);
        }
      }

      // What the page shows: the published program and its published tiers, public coaches only
      // (the private lead isn't named, as a coach or on a tier), the required consent's title.
      const page = JSON.parse(texts["public academy"] ?? "{}") as PublicAcademyDto;
      expect(page.programs.map((p) => p.name)).toEqual(["Evening program"]);
      expect(page.programs[0]?.coaches.map((c) => c.name)).toEqual([me.user.name]);
      expect(page.packages.map((p) => p.name).sort()).toEqual(["Monthly", "Private lessons"]);
      expect(page.packages.find((p) => p.name === "Private lessons")?.coach).toBeNull();
      expect(page.coaches.map((c) => c.name)).toEqual([me.user.name]);
      expect(page.consents.map((c) => c.title)).toEqual(["Waiver and release"]);
      // The page HTML carries the same data, for the app's first paint.
      expect(texts["page HTML"]).toContain('id="cm-public-academy"');
      expect(texts["page HTML"]).toContain("Evening training for every level.");

      // Sessions: when and where, and places left; never who.
      const sessions = JSON.parse(texts["trial sessions"] ?? "[]") as PublicSessionDto[];
      expect(sessions.length).toBeGreaterThan(0);
      for (const s of sessions) {
        expect(Object.keys(s).sort()).toEqual([
          "court",
          "date",
          "endsAt",
          "id",
          "seatsLeft",
          "startsAt",
          "venue",
        ]);
      }
      expect(sessions[0]?.seatsLeft).toBe(11);
      // Only the public, running programs of this academy have a session list.
      for (const id of [hidden.id, archived.id, elsewhere.id, uuid()]) {
        expect((await anonymous.get(sessionsOf(id))).status(), id).toBe(404);
      }

      // The public config is the contact address and nothing else.
      expect(Object.keys(JSON.parse(texts["public config"] ?? "{}"))).toEqual(["contactEmail"]);
    } finally {
      await anonymous.dispose();
    }
  });

  test("an invite link's preview says only what the person opening it needs", async ({
    coach: owner,
    playwright,
  }, info) => {
    const { api } = owner;
    const tag = uuid().replace(/-/g, "").slice(0, 10);
    await onboard(api);
    const invited = testEmail("preview-invitee", info);
    const staff = await api.post<StaffInviteCreatedDto>("/team/invites", {
      email: invited,
      role: "admin",
    });
    const kid = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: `Santos${tag}`,
      birthDate: bornYearsAgo(10),
      isJunior: true,
      notes: `INTERNALNOTES${tag}`,
    });
    const family = await api.post<FamilyInviteCreatedDto>(`/clients/${kid.id}/family/invites`, {
      relation: "guardian",
    });

    const anonymous = await playwright.request.newContext({
      baseURL: info.project.use.baseURL,
      extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    });
    try {
      const preview = async (link: string) => {
        const res = await anonymous.get(`/api/invites/${inviteToken(link)}`);
        expect(res.status()).toBe(200);
        return { text: await res.text(), json: (await res.json()) as unknown };
      };
      const s = await preview(staff.link);
      expect(s.json).toEqual({
        kind: "staff",
        academy: { name: "E2E Coaching", logoKey: null },
        role: "admin",
        status: "valid",
      });
      const f = await preview(family.link);
      expect(f.json).toEqual({
        kind: "family",
        academy: { name: "E2E Coaching", logoKey: null },
        student: { firstName: "Mia" },
        relation: "guardian",
        status: "valid",
      });
      // No address, no last name or notes, no ids, and nothing about who sent it.
      for (const text of [s.text, f.text]) {
        for (const secret of [invited, tag, kid.id, owner.email, "Robin"]) {
          expect(text).not.toContain(secret);
        }
      }
    } finally {
      await anonymous.dispose();
    }
  });
});
