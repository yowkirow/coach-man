import type {
  ClientDetailDto,
  CoachProfileDto,
  CoachSummaryDto,
  LessonDetailDto,
  MeDto,
  NoteDto,
  OfflinePackDto,
  ProgressDto,
  PublicAcademyDto,
  PublicAcademyPreviewDto,
  TeamDto,
  TeamPageDto,
  TodayDto,
} from "../src/shared/api-types";
import { addDays, weekdayOf } from "../src/shared/time";
import {
  Api,
  addMember,
  auditLog,
  expect,
  inviteToken,
  listAcademy,
  onboard,
  submitSheet,
  test,
  testEmail,
  toggle,
  uuid,
  visit,
  watchErrors,
} from "./support";

// The front desk: staff who handle payments, check-in, the schedule, enrollments, and family
// invites, and don't coach. The team list names them, but they're never offered as a coach, on the
// team page, or on the public site; they can't be named anyone's coach; moving a coach to the
// front desk ends their coaching, as leaving the team does; and of a student's progress they see
// what the family sees and write none of it. The roles matrix (roles.spec.ts) covers their
// capabilities.

const DOESNT_COACH = "Front desk staff don't coach.";
const NO_NOTES = "Front desk staff don't write coaching notes.";
const NO_ASSESSMENTS = "Front desk staff don't write assessments.";
const NO_GOALS = "Front desk staff don't set goals.";
const DESCRIPTION =
  "Payments, enrollments, check-in, the schedule, and family invites. Doesn't coach; no prices, settings, or team.";

/** A refusal as the API words it: status, message, and the field errors. */
function refusal(res: { status: number; json: unknown }) {
  const error = (
    res.json as
      | { error?: { message?: string; details?: { fields?: Record<string, string> } } }
      | undefined
  )?.error;
  return { status: res.status, message: error?.message, fields: error?.details?.fields };
}

test.describe("the front desk, at the API", () => {
  test.skip(({ isMobile }) => isMobile, "API checks: one browser is enough");

  test("is named in the team list but never as a coach: not on the team page or the public site", async ({
    coach: owner,
    personas,
    playwright,
  }, info) => {
    const { api, request } = owner;
    await onboard(api);
    const me = await api.get<MeDto>("/me");
    const deskEmail = testEmail("desk-listed", info);
    const { userId: deskId } = await addMember(request, {
      email: deskEmail,
      name: "Dana Desk",
      role: "front_desk",
    });
    const { userId: kimId } = await addMember(request, {
      email: testEmail("desk-kim", info),
      name: "Kim Lee",
      role: "coach",
    });
    // Their profile says it may be public, with a title: they're still never shown.
    expect(
      await api.patch<CoachProfileDto>(`/coaches/${deskId}`, {
        title: "Front desk lead",
        isPublic: true,
      }),
    ).toMatchObject({ role: "front_desk", title: "Front desk lead", isPublic: true });

    // Everyone is listed with their role, for names and avatars; pickers offer only people who
    // coach (the role says who), and naming the front desk a coach is refused (below).
    const desk = await personas.open({ email: deskEmail, name: "Dana Desk", persona: "none" });
    for (const who of [api, desk.api]) {
      const coaches = await who.get<CoachSummaryDto[]>("/coaches");
      expect(Object.fromEntries(coaches.map((c) => [c.userId, c.role]))).toEqual({
        [me.user.id]: "owner",
        [kimId]: "coach",
        [deskId]: "front_desk",
      });
    }
    const team = await desk.api.get<TeamDto>("/team");
    expect(team.members.find((m) => m.userId === deskId)?.role).toBe("front_desk");
    // They keep their own name, title, and photo.
    await desk.api.patch(`/coaches/${deskId}`, { displayName: "Dana D." });
    expect(await desk.api.get<CoachProfileDto>(`/coaches/${deskId}`)).toMatchObject({
      name: "Dana D.",
      title: "Front desk lead",
    });

    // The team page leaves them out, and an order that names them doesn't put them on it.
    expect((await api.get<TeamPageDto>("/team-page")).entries.map((e) => e.name)).toEqual([
      "Robin Coach",
      "Kim Lee",
    ]);
    const ordered = await api.put<TeamPageDto>("/team-page/order", {
      entries: [
        { kind: "staff", id: deskId },
        { kind: "staff", id: kimId },
        { kind: "staff", id: me.user.id },
      ],
    });
    expect(ordered.entries.map((e) => e.name)).toEqual(["Kim Lee", "Robin Coach"]);

    // The public academy, and the staff preview of it: the people who coach, in the page's order.
    const slug = await listAcademy(api, info);
    const anonymous = await playwright.request.newContext({
      baseURL: info.project.use.baseURL,
      extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    });
    try {
      const res = await anonymous.get(`/api/public/academies/${slug}`);
      expect(res.status()).toBe(200);
      const text = await res.text();
      expect((JSON.parse(text) as PublicAcademyDto).coaches.map((c) => c.name)).toEqual([
        "Kim Lee",
        "Robin Coach",
      ]);
      for (const secret of ["Dana", "Front desk lead"]) expect(text, secret).not.toContain(secret);
    } finally {
      await anonymous.dispose();
    }
    const preview = await api.get<PublicAcademyPreviewDto>("/academy/public-preview");
    expect(preview.coaches.map((c) => c.name)).toEqual(["Kim Lee", "Robin Coach"]);
  });

  test("schedules sessions with no lead and adds students with no coach", async ({
    coach: owner,
    personas,
  }, info) => {
    const { api, request } = owner;
    await onboard(api);
    const { date: today } = await api.get<TodayDto>("/today");
    const tomorrow = addDays(today, 1);
    const deskEmail = testEmail("desk-schedules", info);
    await addMember(request, { email: deskEmail, name: "Dana Desk", role: "front_desk" });
    const { userId: kimId } = await addMember(request, {
      email: testEmail("desk-lead", info),
      name: "Kim Lee",
      role: "coach",
    });
    const program = await api.post<{ id: string }>("/groups", {
      name: "Evening program",
      coachUserId: kimId,
    });
    const desk = await personas.open({ email: deskEmail, name: "Dana Desk", persona: "none" });
    const session = { kind: "private", date: tomorrow, durationMinutes: 60 };

    // Whoever schedules a session leads it only if they coach.
    const own = await desk.api.post<{ lesson: LessonDetailDto }>("/lessons", {
      ...session,
      startTime: "07:00",
    });
    expect(own.lesson.lesson.coachUserId).toBeNull();
    const weekly = await desk.api.post<{ lessonIds: string[]; seriesId: string }>("/lessons", {
      ...session,
      startTime: "08:00",
      recurrence: { weekdays: [weekdayOf(tomorrow)], endsOn: null },
    });
    expect(weekly.lessonIds.length).toBeGreaterThan(1);
    for (const id of weekly.lessonIds.slice(0, 2)) {
      expect((await desk.api.get<LessonDetailDto>(`/lessons/${id}`)).lesson.coachUserId).toBeNull();
    }
    // A program's session is led by the program's lead; naming a coach works too.
    const programSession = await desk.api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "group",
      groupId: program.id,
      date: tomorrow,
      startTime: "17:00",
      durationMinutes: 90,
    });
    expect(programSession.lesson.lesson.coachUserId).toBe(kimId);
    const named = await desk.api.post<{ lesson: LessonDetailDto }>("/lessons", {
      ...session,
      startTime: "09:00",
      coachUserId: kimId,
    });
    expect(named.lesson.lesson.coachUserId).toBe(kimId);

    // A student they add starts with no coach, unless they name one.
    const kai = await desk.api.post<{ id: string }>("/clients", {
      firstName: "Kai",
      lastName: "Mendoza",
    });
    expect((await desk.api.get<ClientDetailDto>(`/clients/${kai.id}`)).coaches?.primary).toBeNull();
    const mia = await desk.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      primaryCoachUserId: kimId,
    });
    expect(
      (await desk.api.get<ClientDetailDto>(`/clients/${mia.id}`)).coaches?.primary?.coach.userId,
    ).toBe(kimId);
  });

  test("can't be named a coach of a session, a student, a program, or an event", async ({
    coach: owner,
  }, info) => {
    const { api, request } = owner;
    await onboard(api);
    const me = await api.get<MeDto>("/me");
    const { date: today } = await api.get<TodayDto>("/today");
    const { userId: deskId } = await addMember(request, {
      email: testEmail("desk-named", info),
      name: "Dana Desk",
      role: "front_desk",
    });
    const kai = await api.post<{ id: string }>("/clients", {
      firstName: "Kai",
      lastName: "Mendoza",
    });
    const lessonBody = { kind: "private", date: addDays(today, 1), durationMinutes: 60 };
    const existing = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      ...lessonBody,
      startTime: "07:00",
    });
    const program = await api.post<{ id: string }>("/groups", { name: "Evening program" });

    const attempts: [string, string, { status: number; json: unknown }][] = [
      [
        "POST /lessons (lead)",
        "coachUserId",
        await api.raw("POST", "/lessons", {
          ...lessonBody,
          startTime: "08:00",
          coachUserId: deskId,
        }),
      ],
      [
        "POST /lessons (assistant)",
        "coachUserId",
        await api.raw("POST", "/lessons", {
          ...lessonBody,
          startTime: "09:00",
          assistantCoachIds: [deskId],
        }),
      ],
      [
        "PATCH /lessons/:id",
        "coachUserId",
        await api.raw("PATCH", `/lessons/${existing.lesson.lesson.id}`, { coachUserId: deskId }),
      ],
      [
        "POST /clients",
        "primaryCoachUserId",
        await api.raw("POST", "/clients", { firstName: "Mia", primaryCoachUserId: deskId }),
      ],
      [
        "PUT /clients/:id/coaches (primary)",
        "primaryCoachUserId",
        await api.raw("PUT", `/clients/${kai.id}/coaches`, {
          primaryCoachUserId: deskId,
          assistantCoachIds: [],
        }),
      ],
      [
        "PUT /clients/:id/coaches (assistant)",
        "assistantCoachIds",
        await api.raw("PUT", `/clients/${kai.id}/coaches`, {
          primaryCoachUserId: me.user.id,
          assistantCoachIds: [deskId],
        }),
      ],
      [
        "POST /groups",
        "coachUserId",
        await api.raw("POST", "/groups", { name: "Desk program", coachUserId: deskId }),
      ],
      [
        "PATCH /groups/:id",
        "coachUserId",
        await api.raw("PATCH", `/groups/${program.id}`, { assistantCoachIds: [deskId] }),
      ],
      [
        "POST /events",
        "coachUserId",
        await api.raw("POST", "/events", {
          kind: "clinic",
          name: "Desk clinic",
          startsOn: today,
          endsOn: today,
          priceMinor: 0,
          coachUserId: deskId,
        }),
      ],
    ];
    expect(Object.fromEntries(attempts.map(([name, , res]) => [name, refusal(res)]))).toEqual(
      Object.fromEntries(
        attempts.map(([name, field]) => [
          name,
          {
            status: 400,
            message: "Pick coaches from your team.",
            fields: { [field]: DOESNT_COACH },
          },
        ]),
      ),
    );
    // Someone who isn't on the team is still refused as before.
    expect(
      refusal(
        await api.raw("POST", "/lessons", {
          ...lessonBody,
          startTime: "10:00",
          coachUserId: uuid(),
        }),
      ),
    ).toEqual({
      status: 400,
      message: "Pick coaches from your team.",
      fields: { coachUserId: "That person isn't on your team." },
    });

    // Nothing changed: Kai keeps the owner, the session keeps its lead, and no Mia was added.
    const detail = await api.get<ClientDetailDto>(`/clients/${kai.id}`);
    expect(detail.coaches?.primary?.coach.userId).toBe(me.user.id);
    expect(detail.coaches?.assistants).toEqual([]);
    const session = await api.get<LessonDetailDto>(`/lessons/${existing.lesson.lesson.id}`);
    expect(session.lesson.coachUserId).toBe(me.user.id);
    const clients = await api.get<{ firstName: string }[]>("/clients");
    expect(clients.map((c) => c.firstName)).toEqual(["Kai"]);
  });

  test("moving a coach to the front desk ends their coaching, as leaving the team does", async ({
    coach: owner,
  }, info) => {
    const { api, request } = owner;
    await onboard(api);
    const me = await api.get<MeDto>("/me");
    const { date: today } = await api.get<TodayDto>("/today");
    const { userId: samId } = await addMember(request, {
      email: testEmail("desk-sam", info),
      name: "Sam Rivera",
      role: "coach",
    });
    const kai = await api.post<{ id: string }>("/clients", {
      firstName: "Kai",
      lastName: "Mendoza",
      primaryCoachUserId: samId,
    });
    const led = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "private",
      date: addDays(today, 1),
      startTime: "07:00",
      durationMinutes: 60,
      clientIds: [kai.id],
      coachUserId: samId,
    });
    const assisted = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "private",
      date: addDays(today, 2),
      startTime: "07:00",
      durationMinutes: 60,
      coachUserId: me.user.id,
      assistantCoachIds: [samId],
    });

    const team = await api.patch<TeamDto>(`/team/members/${samId}`, { role: "front_desk" });
    expect(team.members.find((m) => m.userId === samId)?.role).toBe("front_desk");

    // Kai's assignment ends today and stays in the history; the sessions ahead lose Sam.
    const coaches = (await api.get<ClientDetailDto>(`/clients/${kai.id}`)).coaches;
    expect(coaches?.primary).toBeNull();
    expect(coaches?.history.map((h) => [h.coach.userId, h.role, h.endedOn])).toEqual([
      [samId, "primary", today],
    ]);
    expect(
      (await api.get<LessonDetailDto>(`/lessons/${led.lesson.lesson.id}`)).lesson,
    ).toMatchObject({ coachUserId: null, assistantCoachIds: [] });
    expect(
      (await api.get<LessonDetailDto>(`/lessons/${assisted.lesson.lesson.id}`)).lesson,
    ).toMatchObject({ coachUserId: me.user.id, assistantCoachIds: [] });
    // Still named (past sessions keep showing who led them), now as front desk.
    expect(
      (await api.get<CoachSummaryDto[]>("/coaches")).find((c) => c.userId === samId),
    ).toMatchObject({ name: "Sam Rivera", role: "front_desk" });

    // The audit log names the release; moving back to coach has nothing to release.
    const roleChange = async () =>
      (await auditLog(request)).find(
        (e) => e.action === "role" && e.entity === "member" && e.entityId === samId,
      )?.data;
    expect(await roleChange()).toEqual({ from: "coach", to: "front_desk", releasedCoaching: true });
    await api.patch<TeamDto>(`/team/members/${samId}`, { role: "coach" });
    expect(await roleChange()).toEqual({ from: "front_desk", to: "coach" });
    expect((await api.get<ClientDetailDto>(`/clients/${kai.id}`)).coaches?.primary).toBeNull();
  });

  test("sees what the family sees of a student's progress, and writes none of it", async ({
    coach: owner,
    personas,
  }, info) => {
    const { api, request } = owner;
    await onboard(api);
    const { date: today } = await api.get<TodayDto>("/today");
    const deskEmail = testEmail("desk-progress", info);
    await addMember(request, { email: deskEmail, name: "Dana Desk", role: "front_desk" });
    const kai = await api.post<{ id: string }>("/clients", {
      firstName: "Kai",
      lastName: "Mendoza",
    });
    const session = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "private",
      date: today,
      startTime: "07:00",
      durationMinutes: 60,
      clientIds: [kai.id],
    });
    const lessonId = session.lesson.lesson.id;
    // The owner coaches: a shared comment, a coaches-only one, a handoff, and two session notes.
    const shared = await api.post<NoteDto>("/notes", {
      clientId: kai.id,
      body: "Great footwork today.",
      visibility: "shared",
    });
    await api.post("/notes", { clientId: kai.id, body: "Watch the left knee." });
    await api.post("/notes", { clientId: kai.id, body: "Ready for Kim's group.", kind: "handoff" });
    await api.post("/notes", {
      lessonId,
      clientId: kai.id,
      body: "Shared from the session.",
      visibility: "shared",
    });
    await api.post("/notes", { lessonId, body: "The plan worked; more drops next time." });
    const assessed = await api.post<ProgressDto>(`/clients/${kai.id}/assessments`, {
      assessedOn: today,
      scores: [],
      notes: "Shared with the family.",
    });
    await api.post(`/clients/${kai.id}/assessments`, {
      assessedOn: today,
      scores: [],
      notes: "Held back.",
      sharedWithFamily: false,
    });
    const withGoal = await api.post<ProgressDto>(`/clients/${kai.id}/goals`, {
      title: "Land the third-shot drop",
    });
    const assessment = assessed.assessments[0];
    const goal = withGoal.goals[0];
    if (!assessment || !goal) throw new Error("The assessment and goal weren't saved");

    // The front desk reads the shared comments and assessments, and every goal, as families do.
    const desk = await personas.open({ email: deskEmail, name: "Dana Desk", persona: "none" });
    const progress = await desk.api.get<ProgressDto>(`/clients/${kai.id}/progress`);
    expect(progress.notes.map((n) => n.body).sort()).toEqual([
      "Great footwork today.",
      "Shared from the session.",
    ]);
    expect(progress.assessments.map((a) => a.notes)).toEqual(["Shared with the family."]);
    expect(progress.goals.map((g) => g.title)).toEqual(["Land the third-shot drop"]);
    // The owner, who coaches, reads everything.
    const full = await api.get<ProgressDto>(`/clients/${kai.id}/progress`);
    expect(full.notes.map((n) => n.body).sort()).toEqual([
      "Great footwork today.",
      "Ready for Kim's group.",
      "Shared from the session.",
      "Watch the left knee.",
    ]);
    const assessments = [
      ["Held back.", false],
      ["Shared with the family.", true],
    ];
    expect(full.assessments.map((a) => [a.notes, a.sharedWithFamily]).sort()).toEqual(assessments);
    // The same on the session and in the offline pack.
    const sessionNotes = async (who: typeof api) =>
      (await who.get<LessonDetailDto>(`/lessons/${lessonId}`)).notes.map((n) => n.body).sort();
    expect(await sessionNotes(desk.api)).toEqual(["Shared from the session."]);
    expect(await sessionNotes(api)).toEqual([
      "Shared from the session.",
      "The plan worked; more drops next time.",
    ]);
    const pack = await desk.api.get<OfflinePackDto>("/offline-pack");
    expect(pack.lessons.find((l) => l.lesson.id === lessonId)?.notes.map((n) => n.body)).toEqual([
      "Shared from the session.",
    ]);

    // Writing, sharing, pinning, or deleting any of it is refused.
    const writes: [string, string, { status: number; json: unknown }][] = [
      [
        "POST /notes",
        NO_NOTES,
        await desk.api.raw("POST", "/notes", { clientId: kai.id, body: "From the desk." }),
      ],
      [
        "PATCH /notes/:id (pin)",
        NO_NOTES,
        await desk.api.raw("PATCH", `/notes/${shared.id}`, { pinned: true }),
      ],
      ["DELETE /notes/:id", NO_NOTES, await desk.api.raw("DELETE", `/notes/${shared.id}`)],
      [
        "POST /clients/:id/assessments",
        NO_ASSESSMENTS,
        await desk.api.raw("POST", `/clients/${kai.id}/assessments`, {
          assessedOn: today,
          scores: [],
        }),
      ],
      [
        "PATCH /assessments/:id (hold back)",
        NO_ASSESSMENTS,
        await desk.api.raw("PATCH", `/assessments/${assessment.id}`, { sharedWithFamily: false }),
      ],
      [
        "DELETE /assessments/:id",
        NO_ASSESSMENTS,
        await desk.api.raw("DELETE", `/assessments/${assessment.id}`),
      ],
      [
        "POST /clients/:id/goals",
        NO_GOALS,
        await desk.api.raw("POST", `/clients/${kai.id}/goals`, { title: "From the desk" }),
      ],
      [
        "PATCH /goals/:id (reached)",
        NO_GOALS,
        await desk.api.raw("PATCH", `/goals/${goal.id}`, { status: "achieved" }),
      ],
      ["DELETE /goals/:id", NO_GOALS, await desk.api.raw("DELETE", `/goals/${goal.id}`)],
    ];
    expect(
      Object.fromEntries(writes.map(([name, , res]) => [name, [Api.code(res), refusal(res)]])),
    ).toEqual(
      Object.fromEntries(
        writes.map(([name, message]) => [name, ["forbidden", { status: 403, message }]]),
      ),
    );

    // Nothing changed.
    const after = await api.get<ProgressDto>(`/clients/${kai.id}/progress`);
    expect(after.notes.map((n) => [n.body, n.pinned]).sort()).toEqual(
      full.notes.map((n) => [n.body, n.pinned]).sort(),
    );
    expect(after.assessments.map((a) => [a.notes, a.sharedWithFamily]).sort()).toEqual(assessments);
    expect(after.goals.map((g) => [g.title, g.status])).toEqual([
      ["Land the third-shot drop", "active"],
    ]);
  });
});

test.describe("the front desk, in the app", () => {
  test("the owner invites the front desk from Team, and they land in a staff app made for them", async ({
    page,
    seeded,
    personas,
    isMobile,
  }, info) => {
    const email = testEmail("desk-invitee", info);
    const owner = await seeded.api.get<MeDto>("/me");
    const academy = owner.workspace.name;
    // A colleague who coaches: a coach here would get "Mine / Everyone".
    await addMember(seeded.request, {
      email: testEmail("desk-colleague", info),
      name: "Kim Lee",
      role: "coach",
    });
    const ownerErrors = watchErrors(page);

    await visit(page, "/team");
    await page.getByRole("button", { name: "Invite someone" }).first().click();
    const form = page.getByRole("dialog", { name: "Invite someone" });
    await form.getByLabel("Their Google email").fill(email);
    await expect(form.getByText(DESCRIPTION)).toBeVisible();
    const option = form.getByRole("radio", { name: /^Front desk/ });
    await toggle(option);
    await expect(option).toBeChecked();
    await form.getByRole("button", { name: "Create invite link" }).click();

    const ready = page.getByRole("dialog", { name: "Invite link ready" });
    await expect(ready).toBeVisible();
    const link = await ready.getByLabel("Invite link").inputValue();
    await expect(ready.getByText(link, { exact: false })).toContainText(
      `join ${academy} on CoachMan as front desk staff.`,
    );
    await ready.getByRole("button", { name: "Done" }).click();
    const invites = page.getByRole("region", { name: "Invites" });
    await expect(invites.getByText(email)).toBeVisible();
    await expect(invites.getByText("Front desk", { exact: true })).toBeVisible();
    const sent = await seeded.api.get<TeamDto>("/team");
    expect(sent.invites.map((i) => [i.email, i.role])).toEqual([[email, "front_desk"]]);
    expect(ownerErrors).toEqual([]);

    // The invitee joins as front desk staff.
    const desk = await personas.open({ email, name: "Dana Desk", persona: "none" });
    const errors = watchErrors(desk.page);
    await visit(desk.page, `/join/${inviteToken(link)}`);
    await expect(desk.page.getByRole("heading", { name: `Join ${academy}` })).toBeVisible();
    await expect(desk.page.getByText("You'll join as front desk staff.")).toBeVisible();
    await expect(desk.page.getByText(DESCRIPTION)).toBeVisible();
    await desk.page.getByRole("button", { name: `Join ${academy}` }).click();
    await expect(desk.page).toHaveURL(/\/$/);
    await expect(
      desk.page.getByRole("heading", { name: "Today", exact: true }).first(),
    ).toBeVisible();
    const me = await desk.api.get<MeDto>("/me");
    expect([
      me.role,
      me.can.money,
      me.can.enrollment,
      me.can.familyAccess,
      me.can.settings,
    ]).toEqual(["front_desk", true, true, true, false]);

    // Today shows every session, with no "Mine / Everyone" to choose.
    await desk.page.waitForLoadState("networkidle");
    await expect(desk.page.getByRole("radiogroup", { name: "Whose sessions to show" })).toHaveCount(
      0,
    );

    // Money and Enrollments are theirs.
    await visit(desk.page, "/money");
    await expect(desk.page.getByRole("button", { name: "Record payment" }).first()).toBeVisible();
    await visit(desk.page, "/enrollments");
    await expect(
      desk.page.getByText("Requests from your academy page, newest first"),
    ).toBeVisible();

    // Settings: "My profile" (a name, a title, and a photo), and no academy settings.
    await visit(desk.page, "/settings");
    const profile = desk.page.getByRole("region", { name: "My profile" });
    await expect(profile.getByRole("textbox", { name: "Name shown" })).toBeVisible();
    await expect(profile.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
    await expect(profile.getByRole("textbox", { name: "About", exact: true })).toHaveCount(0);
    await expect(profile.getByRole("switch", { name: /Show on the academy page/ })).toHaveCount(0);
    for (const section of ["My coach profile", "Academy profile", "Regional settings"]) {
      await expect(desk.page.getByRole("region", { name: section })).toHaveCount(0);
    }

    // Team: "My profile", and no count of their students.
    await visit(desk.page, "/team");
    await expect(desk.page.getByRole("button", { name: "My profile" })).toBeVisible();
    if (!isMobile) {
      await expect(desk.page.getByText("Other staff", { exact: true })).toBeVisible();
      await expect(desk.page.getByText("Your students", { exact: true })).toHaveCount(0);
    }
    await desk.page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("the role sheet says a coach stops coaching before they move to the front desk", async ({
    page,
    seeded,
  }, info) => {
    const { userId: samId } = await addMember(seeded.request, {
      email: testEmail("desk-move", info),
      name: "Sam Rivera",
      role: "coach",
    });
    const errors = watchErrors(page);

    await visit(page, "/team");
    const pageOrder = page.getByRole("list", { name: "Team page order" });
    await expect(pageOrder.getByText("Sam Rivera")).toBeVisible();
    await page.getByRole("button", { name: "Options for Sam Rivera" }).click();
    await page.getByRole("menuitem", { name: "Change role" }).click();
    const sheet = page.getByRole("dialog", { name: "Change role" });
    await expect(sheet.getByText("Sam Rivera is a coach.")).toBeVisible();
    const stops = sheet.getByText(
      "Sam Rivera stops coaching: their students and upcoming sessions lose them as coach.",
    );
    await expect(stops).toHaveCount(0);
    const deskOption = sheet.getByRole("radio", { name: /^Front desk/ });
    await toggle(deskOption);
    await expect(deskOption).toBeChecked();
    await expect(stops).toBeVisible();
    await toggle(sheet.getByRole("radio", { name: /^Admin/ }));
    await expect(stops).toHaveCount(0);
    await toggle(deskOption);
    await expect(stops).toBeVisible();
    await sheet.getByRole("button", { name: "Save role" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Sam Rivera is now front desk staff")).toBeVisible();
    const team = await seeded.api.get<TeamDto>("/team");
    expect(team.members.find((m) => m.userId === samId)?.role).toBe("front_desk");
    // Off the team page with it.
    await expect(pageOrder.getByText("Sam Rivera")).toHaveCount(0);

    // Their profile, from Team: a name, a title, and a photo, and nothing families see.
    await page.getByRole("button", { name: "Options for Sam Rivera" }).click();
    await page.getByRole("menuitem", { name: "Edit profile" }).click();
    const profile = page.getByRole("dialog", { name: "Profile" });
    const title = profile.getByRole("textbox", { name: "Title", exact: true });
    await expect(title).toBeVisible();
    await expect(profile.getByRole("textbox", { name: "About", exact: true })).toHaveCount(0);
    await expect(profile.getByRole("group", { name: "Team page photo" })).toHaveCount(0);
    await expect(profile.getByRole("switch", { name: /Show on the academy page/ })).toHaveCount(0);
    await title.fill("Front desk lead");
    await submitSheet(profile, profile.getByRole("button", { name: "Save profile" }));
    await expect(page.getByText("Profile saved", { exact: true })).toBeVisible();
    expect((await seeded.api.get<CoachProfileDto>(`/coaches/${samId}`)).title).toBe(
      "Front desk lead",
    );
    expect(errors).toEqual([]);
  });

  test("the front desk reads what's shared with the family, with nothing to write", async ({
    coach: owner,
    personas,
  }, info) => {
    const { api, request } = owner;
    await onboard(api);
    const deskEmail = testEmail("desk-reads", info);
    await addMember(request, { email: deskEmail, name: "Dana Desk", role: "front_desk" });
    const kai = await api.post<{ id: string }>("/clients", {
      firstName: "Kai",
      lastName: "Mendoza",
    });
    for (const note of [
      { body: "Great footwork today.", visibility: "shared" },
      { body: "Watch the left knee." },
      { body: "Ready for Kim's group.", kind: "handoff" },
    ]) {
      await api.post("/notes", { clientId: kai.id, ...note });
    }
    await api.post(`/clients/${kai.id}/goals`, { title: "Land the third-shot drop" });
    const desk = await personas.open({ email: deskEmail, name: "Dana Desk", persona: "none" });
    const errors = watchErrors(desk.page);

    await visit(desk.page, `/clients/${kai.id}`);
    const notes = desk.page.getByRole("region", { name: "Coach notes" });
    await expect(notes.getByText("Great footwork today.")).toBeVisible();
    await expect(notes.getByRole("button", { name: "Add note" })).toHaveCount(0);
    for (const action of ["Add a note", "New assessment"]) {
      await expect(desk.page.getByRole("button", { name: action })).toHaveCount(0);
    }

    // Progress: the shared comment and the goal, never the coaches-only note or the handoff, and
    // no composer, note actions, assessment, or goal to add or tick.
    await desk.page.getByRole("tab", { name: "Progress" }).click();
    const timeline = desk.page.getByRole("region", { name: "Coaching timeline" });
    await expect(timeline.getByText("Great footwork today.")).toBeVisible();
    await expect(timeline.getByText("Shared with family")).toBeVisible();
    for (const hidden of ["Watch the left knee.", "Ready for Kim's group."]) {
      await expect(desk.page.getByText(hidden)).toHaveCount(0);
    }
    await expect(timeline.getByText("Handoff · coaches only")).toHaveCount(0);
    await expect(timeline.getByLabel("Note about Kai")).toHaveCount(0);
    await expect(timeline.getByRole("button", { name: "Note actions" })).toHaveCount(0);
    const skills = desk.page.getByRole("region", { name: "Skills" });
    await expect(skills.getByText("No assessments yet")).toBeVisible();
    await expect(skills.getByRole("button")).toHaveCount(0);
    const goals = desk.page.getByRole("region", { name: "Goals" });
    await expect(
      goals.getByRole("checkbox", { name: "Land the third-shot drop: not reached yet" }),
    ).toBeVisible();
    await expect(goals.getByRole("button")).toHaveCount(0);
    await desk.page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("coach pickers offer only people who coach, and a past session keeps its lead's name", async ({
    page,
    coach: owner,
  }, info) => {
    const { api, request } = owner;
    await onboard(api);
    const { date: today } = await api.get<TodayDto>("/today");
    const { userId: samId } = await addMember(request, {
      email: testEmail("desk-past-lead", info),
      name: "Sam Rivera",
      role: "coach",
    });
    await addMember(request, {
      email: testEmail("desk-picker-kim", info),
      name: "Kim Lee",
      role: "coach",
    });
    await addMember(request, {
      email: testEmail("desk-picker-dana", info),
      name: "Dana Desk",
      role: "front_desk",
    });
    const past = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "private",
      date: addDays(today, -1),
      startTime: "07:00",
      durationMinutes: 60,
      coachUserId: samId,
    });
    await api.patch<TeamDto>(`/team/members/${samId}`, { role: "front_desk" });
    const kai = await api.post<{ id: string }>("/clients", {
      firstName: "Kai",
      lastName: "Mendoza",
    });
    const errors = watchErrors(page);

    // The session Sam led before moving to the front desk still names him.
    await visit(page, `/sessions/${past.lesson.lesson.id}`);
    await expect(page.getByText("Sam Rivera · lead")).toBeVisible();
    await expect(page.getByText("Former coach")).toHaveCount(0);

    // A student's coaches: the people who coach, never the front desk.
    await visit(page, `/clients/${kai.id}`);
    await page
      .getByRole("region", { name: "Coaches" })
      .getByRole("button", { name: "Change" })
      .click();
    const sheet = page.getByRole("dialog", { name: "Kai's coaches" });
    await expect(sheet.getByRole("checkbox", { name: /Kim Lee/ })).toBeVisible();
    await sheet.getByRole("button", { name: /Primary coach/ }).click();
    await expect(page.getByRole("option", { name: /Kim Lee/ })).toBeVisible();
    for (const name of [/Dana Desk/, /Sam Rivera/]) {
      await expect(page.getByRole("option", { name })).toHaveCount(0);
      await expect(sheet.getByRole("checkbox", { name })).toHaveCount(0);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
