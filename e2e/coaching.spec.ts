import type {
  ClientCoachesSavedDto,
  ClientDetailDto,
  ClientListItemDto,
  LessonDetailDto,
  MeDto,
  NoteDto,
  ProgressDto,
  TeamDto,
  TodayDto,
} from "../src/shared/api-types";
import { addMember, expect, test, testEmail, toggle, visit, watchErrors } from "./support";

// Coaching in an academy: who coaches each student (with history and handoff notes), who leads
// each session ("Mine / Everyone"), and notes that stay with the coaches unless shared.

test.describe("coaching", () => {
  test("a student's coaches change with history, and the last coach can leave a handoff note", async ({
    page,
    seeded,
  }, info) => {
    const { userId: samId } = await addMember(seeded.request, {
      email: testEmail("assign-coach", info),
      name: "Sam Rivera",
      role: "coach",
    });
    const owner = await seeded.api.get<MeDto>("/me");
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Kai",
      lastName: "Mendoza",
    });
    // Whoever adds a student coaches them until someone changes it.
    const before = await seeded.api.get<ClientDetailDto>(`/clients/${kid.id}`);
    expect(before.coaches?.primary?.coach.userId).toBe(owner.user.id);
    const errors = watchErrors(page);

    await visit(page, `/clients/${kid.id}`);
    const card = page.getByRole("region", { name: "Coaches" });
    await expect(card.getByText("Robin Coach")).toBeVisible();
    await card.getByRole("button", { name: "Change" }).click();

    const sheet = page.getByRole("dialog", { name: "Kai's coaches" });
    await sheet.getByRole("button", { name: /Primary coach/ }).click();
    await page.getByRole("option", { name: /Sam Rivera/ }).click();
    await expect(sheet.getByRole("button", { name: /Primary coach/ })).toContainText("Sam Rivera");
    // The picker closes first: a tap during its exit animation lands on it instead.
    await expect(page.getByRole("listbox")).toHaveCount(0);
    // The owner stays on as an assistant.
    const assistant = sheet.getByRole("checkbox", { name: /Robin Coach/ });
    await toggle(assistant);
    await expect(assistant).toBeChecked();
    await sheet.getByRole("button", { name: "Save coaches" }).click();

    const handoff = page.getByRole("dialog", { name: "Write a handoff note?" });
    await expect(handoff).toBeVisible();
    await expect(handoff).toContainText("Kai moves from you to Sam Rivera");
    await handoff.getByLabel("Handoff note").fill("Working on third-shot drops. Serve is solid.");
    await handoff.getByRole("button", { name: "Save handoff note" }).click();
    await expect(handoff).toBeHidden();

    await expect(card.getByText("Sam Rivera")).toBeVisible();
    await expect(card.getByText(/Assistant coach · Since/)).toBeVisible();
    await card.getByRole("button", { name: "Earlier coaches" }).click();
    await expect(card.getByText("Robin Coach · Primary coach")).toBeVisible();

    const after = await seeded.api.get<ClientDetailDto>(`/clients/${kid.id}`);
    expect(after.coaches?.primary?.coach.userId).toBe(samId);
    expect(after.coaches?.assistants.map((a) => a.coach.userId)).toEqual([owner.user.id]);
    expect(
      after.coaches?.history.filter((h) => h.coach.userId === owner.user.id && h.endedOn),
    ).toHaveLength(1);

    // The handoff note syncs and stays with the coaches.
    await expect
      .poll(async () => {
        const p = await seeded.api.get<ProgressDto>(`/clients/${kid.id}/progress`);
        return p.notes.map((n) => [n.kind, n.visibility, n.author?.name]);
      })
      .toEqual([["handoff", "staff", "Robin Coach"]]);
    await page.getByRole("tab", { name: "Progress" }).click();
    await expect(page.getByText("Handoff · coaches only")).toBeVisible();

    // Saving the same coaches again isn't a change: no history, no prompt.
    const same = await seeded.api.put<ClientCoachesSavedDto>(`/clients/${kid.id}/coaches`, {
      primaryCoachUserId: samId,
      assistantCoachIds: [owner.user.id],
    });
    expect(same.primaryChanged).toBe(false);
    expect(same.coaches.history).toHaveLength(after.coaches?.history.length ?? 0);
    expect(errors).toEqual([]);
  });

  test("a new session is led by whoever schedules it, and coaches see their own first", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const email = testEmail("lead-coach", info);
    const { userId: samId } = await addMember(seeded.request, {
      email,
      name: "Sam Rivera",
      role: "coach",
    });
    const coach = await personas.open({ email, name: "Sam Rivera", persona: "none" });
    const errors = watchErrors(coach.page);
    const today = await coach.api.get<TodayDto>("/today");
    // A session titled after its event, not after a player whose name shows elsewhere.
    const other = today.lessons.find((l) => l.status !== "cancelled" && l.kind === "event");
    if (!other) throw new Error("The sample academy has no event session today");
    expect(other.coachUserId).not.toBe(samId);

    await visit(coach.page, "/schedule?new=1");
    const sheet = coach.page.getByRole("dialog", { name: "New session" });
    await expect(sheet.getByRole("button", { name: /Lead coach/ })).toContainText("Sam Rivera");
    await sheet.getByLabel("Title (optional)").fill("Sam's drills");
    await sheet.getByLabel("Start", { exact: true }).fill("06:00");
    await sheet.getByRole("button", { name: "Schedule session" }).click();
    await expect(coach.page).toHaveURL(/\/sessions\//);
    await expect(coach.page.getByText("Sam Rivera · lead")).toBeVisible();
    const lessonId = coach.page.url().split("/sessions/")[1]?.split(/[?#]/)[0] ?? "";
    const created = await coach.api.get<LessonDetailDto>(`/lessons/${lessonId}`);
    expect(created.lesson.coachUserId).toBe(samId);

    // Today: a coach starts on their own sessions.
    await visit(coach.page, "/");
    const scope = coach.page.getByRole("radiogroup", { name: "Whose sessions to show" });
    await expect(scope.getByRole("radio", { name: "Mine" })).toBeChecked();
    await expect(coach.page.getByText("Sam's drills").first()).toBeVisible();
    await expect(coach.page.getByText(other.title, { exact: true })).toHaveCount(0);
    await scope.getByText("Everyone").click();
    await expect(scope.getByRole("radio", { name: "Everyone" })).toBeChecked();
    await expect(coach.page.getByText(other.title, { exact: true }).first()).toBeVisible();
    // Remembered on this device.
    await coach.page.reload();
    await expect(
      coach.page
        .getByRole("radiogroup", { name: "Whose sessions to show" })
        .getByRole("radio", { name: "Everyone" }),
    ).toBeChecked();

    // The schedule follows the same choice.
    await visit(coach.page, "/schedule");
    const scheduleScope = coach.page.getByRole("radiogroup", { name: "Whose sessions to show" });
    await expect(scheduleScope.getByRole("radio", { name: "Everyone" })).toBeChecked();
    await scheduleScope.getByText("Mine").click();
    await expect(coach.page.getByText("Sam's drills").first()).toBeVisible();
    await expect(coach.page.getByText(other.title, { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);

    // Owners and admins start on everyone's.
    await visit(page, "/");
    await expect(
      page
        .getByRole("radiogroup", { name: "Whose sessions to show" })
        .getByRole("radio", { name: "Everyone" }),
    ).toBeChecked();
  });

  test("notes stay with the coaches unless shared, and only their author edits them", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const email = testEmail("note-coach", info);
    await addMember(seeded.request, { email, name: "Sam Rivera", role: "coach" });
    const coach = await personas.open({ email, name: "Sam Rivera", persona: "none" });
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Kai",
      lastName: "Mendoza",
    });
    const errors = watchErrors(coach.page);
    const notes = async () =>
      (await coach.api.get<ProgressDto>(`/clients/${kid.id}/progress`)).notes;

    await visit(coach.page, `/clients/${kid.id}`);
    await coach.page.getByRole("tab", { name: "Progress" }).click();
    const timeline = coach.page.getByRole("region", { name: "Coaching timeline" });
    const share = timeline.getByRole("switch", { name: "Share with student & parents" });
    await expect(share).not.toBeChecked();
    await expect(timeline.getByText(/Only coaches see this note/)).toBeVisible();
    await timeline.getByLabel("Note about Kai").fill("Footwork: split step on every ball.");
    await timeline.getByRole("button", { name: "Save note" }).click();
    await expect.poll(async () => (await notes()).length).toBe(1);

    await timeline.getByLabel("Note about Kai").fill("Great rally tolerance today, Kai.");
    await share.click({ force: true });
    await expect(share).toBeChecked();
    await expect(timeline.getByText(/Kai and their parents can read this note/)).toBeVisible();
    await timeline.getByRole("button", { name: "Save and share" }).click();
    await expect(timeline.getByText("Shared with family")).toHaveCount(1);
    await expect
      .poll(async () => (await notes()).map((n) => n.visibility).sort())
      .toEqual(["shared", "staff"]);
    const saved = await notes();
    for (const n of saved) expect(n.author?.name).toBe("Sam Rivera");
    const staffNote = saved.find((n) => n.visibility === "staff") as NoteDto;

    // Only the author edits: the owner can't, in the API or the menu, but may delete.
    const ownerEdit = await seeded.api.raw("PATCH", `/notes/${staffNote.id}`, {
      body: "Rewritten by the owner",
    });
    expect(ownerEdit.status).toBe(403);
    await visit(page, `/clients/${kid.id}`);
    await page.getByRole("tab", { name: "Progress" }).click();
    await page.getByRole("button", { name: "Note actions" }).first().click();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The author edits the text and takes the sharing back.
    await coach.page.getByRole("button", { name: "Note actions" }).first().click();
    await coach.page.getByRole("menuitem", { name: "Edit" }).click();
    const edit = coach.page.getByRole("dialog", { name: "Edit note" });
    await edit
      .getByRole("textbox", { name: "Note", exact: true })
      .fill("Great rally tolerance today. Next: resets.");
    await edit.getByRole("switch", { name: "Share with student & parents" }).click({ force: true });
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toBeHidden();
    await expect(timeline.getByText("Shared with family")).toHaveCount(0);
    await expect(timeline.getByText("· Edited")).toHaveCount(1);
    const edited = (await notes()).find((n) => n.body.startsWith("Great rally"));
    expect(edited).toMatchObject({ visibility: "staff" });
    expect(edited?.editedAt).toBeGreaterThan(0);

    // Handoff notes are always coaches only, whatever is asked for.
    const res = await coach.api.raw("POST", "/notes", {
      clientId: kid.id,
      body: "Handing Kai to Kim.",
      kind: "handoff",
      visibility: "shared",
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ kind: "handoff", visibility: "staff" });
    expect(errors).toEqual([]);
  });

  test("a coach's own students, team, and profile load without errors", async ({
    seeded,
    personas,
  }, info) => {
    const email = testEmail("coach-pages", info);
    const { userId: samId } = await addMember(seeded.request, {
      email,
      name: "Sam Rivera",
      role: "coach",
    });
    const clients = await seeded.api.get<ClientListItemDto[]>("/clients");
    const mine = clients[0];
    if (!mine) throw new Error("The sample academy has no clients");
    await seeded.api.put(`/clients/${mine.id}/coaches`, {
      primaryCoachUserId: samId,
      assistantCoachIds: [],
    });
    const coach = await personas.open({ email, name: "Sam Rivera", persona: "none" });
    const errors = watchErrors(coach.page);

    await visit(coach.page, "/clients?mine=1");
    await expect(coach.page.getByRole("heading", { name: "Clients" }).first()).toBeVisible();
    await expect(coach.page.getByText(`${mine.firstName} ${mine.lastName}`).first()).toBeVisible();
    const someoneElse = clients.find((c) => c.id !== mine.id);
    if (someoneElse) {
      await expect(
        coach.page.getByText(`${someoneElse.firstName} ${someoneElse.lastName}`, { exact: true }),
      ).toHaveCount(0);
    }

    await visit(coach.page, `/clients/${mine.id}`);
    const card = coach.page.getByRole("region", { name: "Coaches" });
    await expect(card.getByText("Sam Rivera")).toBeVisible();
    await expect(card.getByText("You", { exact: true })).toBeVisible();
    await coach.page.getByRole("tab", { name: "Progress" }).click();
    await expect(coach.page.getByRole("region", { name: "Coaching timeline" })).toBeVisible();

    await visit(coach.page, "/team");
    await expect(
      coach.page.getByRole("heading", { name: "Team", exact: true }).first(),
    ).toBeVisible();
    await expect(
      coach.page.getByRole("region", { name: "Members" }).getByText("Sam Rivera"),
    ).toBeVisible();
    await expect(coach.page.getByRole("button", { name: "Invite someone" })).toHaveCount(0);
    await expect(coach.page.getByRole("region", { name: "Invites" })).toHaveCount(0);
    // A coach sees who's on the team, but colleagues' email addresses stay with the managers.
    const team = await coach.api.get<TeamDto>("/team");
    expect(team.members.find((m) => m.userId === samId)?.email).toBe(email);
    expect(team.members.filter((m) => m.userId !== samId).map((m) => m.email)).toEqual([null]);
    expect(team.invites).toEqual([]);
    await coach.page.getByRole("button", { name: "My coach profile" }).click();
    await expect(coach.page.getByRole("dialog", { name: "Coach profile" })).toBeVisible();
    await coach.page.keyboard.press("Escape");

    await visit(coach.page, "/settings");
    await expect(coach.page.getByRole("region", { name: "My coach profile" })).toBeVisible();
    await expect(coach.page.getByRole("region", { name: "Academy profile" })).toHaveCount(0);

    await visit(coach.page, "/schedule");
    await expect(coach.page.getByRole("heading", { name: "Schedule" }).first()).toBeVisible();
    await visit(coach.page, "/");
    await expect(
      coach.page.getByRole("heading", { name: "Today", exact: true }).first(),
    ).toBeVisible();
    await coach.page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
});
