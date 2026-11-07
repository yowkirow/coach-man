import type {
  PortalHomeDto,
  PortalProgressDto,
  PortalStudentDto,
  ProgressDto,
} from "../src/shared/api-types";
import { pushes, sinkOf, subscribeFamily } from "./push-support";
import {
  addMember,
  bornYearsAgo,
  expect,
  linkFamily,
  onboard,
  portalGet,
  test,
  testEmail,
  uuid,
  visit,
  watchErrors,
} from "./support";

// Coach handoff (plan: key flow 7): when a student moves to another coach, the handoff note
// stays with the coaches. The family sees the new coach and every coach's shared comments, with
// their names, and never the handoff note or a coaches-only note, in the portal's answers, its
// pages, or a push.

test.use({ serviceWorkers: "block" });

test.describe("coach handoff", () => {
  test("after a handoff the family sees the new coach and shared comments, never the handoff note", async ({
    coach: owner,
    personas,
  }, info) => {
    test.slow();
    const { api, request } = owner;
    const tag = uuid().replace(/-/g, "").slice(0, 10);
    const HANDOFF = `Handoff ${tag}: working on resets; mum asked us to go easy on her knee.`;
    const STAFF_ONLY = `Coaches only ${tag}: tired today, keep an eye on her.`;
    await onboard(api);
    const samEmail = testEmail("handoff-sam", info);
    const sam = await addMember(request, { email: samEmail, name: "Sam Rivera", role: "coach" });
    const kimEmail = testEmail("handoff-kim", info);
    await addMember(request, { email: kimEmail, name: "Kim Lee", role: "coach" });
    const mia = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(15),
      isJunior: true,
      primaryCoachUserId: sam.userId,
    });
    const parentEmail = testEmail("handoff-parent", info);
    const linked = await linkFamily(request, {
      clientId: mia.id,
      email: parentEmail,
      name: "Pat Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    const parentId = (linked.body as { userId: string }).userId;
    const parent = await personas.open({ email: parentEmail, name: "Pat Santos", persona: "none" });
    await subscribeFamily(parent.context.request);
    // Mia, 15, has her own login too (her parent is linked).
    const ownEmail = testEmail("handoff-teen", info);
    expect(
      (
        await linkFamily(request, {
          clientId: mia.id,
          email: ownEmail,
          name: "Mia Santos",
          relation: "self",
        })
      ).status,
    ).toBe(201);
    const teen = await personas.open({ email: ownEmail, name: "Mia Santos", persona: "none" });

    // Sam shares one comment and keeps one for the coaches.
    const coach = await personas.open({ email: samEmail, name: "Sam Rivera", persona: "none" });
    const fromSam = await coach.api.post<{ id: string }>("/notes", {
      clientId: mia.id,
      body: "Mia kept her resets low all session.",
      visibility: "shared",
    });
    const staffOnly = await coach.api.post<{ id: string }>("/notes", {
      clientId: mia.id,
      body: STAFF_ONLY,
    });

    // Sam hands Mia to Kim from her profile and writes the handoff note the app asks for.
    const errors = watchErrors(coach.page);
    await visit(coach.page, `/clients/${mia.id}`);
    const card = coach.page.getByRole("region", { name: "Coaches" });
    await card.getByRole("button", { name: "Change" }).click();
    const sheet = coach.page.getByRole("dialog", { name: "Mia's coaches" });
    await sheet.getByRole("button", { name: /Primary coach/ }).click();
    await coach.page.getByRole("option", { name: /Kim Lee/ }).click();
    await sheet.getByRole("button", { name: "Save coaches" }).click();
    const prompt = coach.page.getByRole("dialog", { name: "Write a handoff note?" });
    await expect(prompt).toContainText("Mia moves from you to Kim Lee");
    await expect(prompt).toContainText("never see them");
    await prompt.getByLabel("Handoff note").fill(HANDOFF);
    await prompt.getByRole("button", { name: "Save handoff note" }).click();
    await expect(prompt).toBeHidden();
    await expect(card.getByText("Kim Lee")).toBeVisible();
    let handoffId = "";
    await expect
      .poll(async () => {
        const notes = (await api.get<ProgressDto>(`/clients/${mia.id}/progress`)).notes;
        const note = notes.find((n) => n.kind === "handoff");
        handoffId = note?.id ?? "";
        return note ? [note.visibility, note.author?.name, note.body] : null;
      })
      .toEqual(["staff", "Sam Rivera", HANDOFF]);
    // Asking to share it changes nothing: handoff notes stay with the coaches.
    const shared = await coach.api.raw("PATCH", `/notes/${handoffId}`, { visibility: "shared" });
    expect(shared.status).toBe(200);
    expect(shared.json).toMatchObject({ kind: "handoff", visibility: "staff" });
    expect(errors).toEqual([]);

    // Kim picks up and shares a comment of her own.
    const kimSession = await personas.open({ email: kimEmail, name: "Kim Lee", persona: "none" });
    const fromKim = await kimSession.api.post<{ id: string }>("/notes", {
      clientId: mia.id,
      body: "Great first session together, Mia.",
      visibility: "shared",
    });

    // The family: both shared comments with their coaches' names, Kim as Mia's coach now, and no
    // handoff or coaches-only note anywhere, for her parent or for Mia herself.
    const fam = parent.context.request;
    const progress = await portalGet<PortalProgressDto>(fam, `/students/${mia.id}/progress`);
    expect(progress.comments.map((c) => [c.body, c.author?.name]).sort()).toEqual(
      [
        ["Great first session together, Mia.", "Kim Lee"],
        ["Mia kept her resets low all session.", "Sam Rivera"],
      ].sort(),
    );
    const student = await portalGet<PortalStudentDto>(fam, `/students/${mia.id}`);
    expect(student.coaches.map((c) => [c.name, c.role])).toEqual([["Kim Lee", "primary"]]);
    const home = await portalGet<PortalHomeDto>(fam, "/home");
    expect(home.comments.map((c) => c.id).sort()).toEqual([fromKim.id, fromSam.id].sort());
    const own = await portalGet<PortalProgressDto>(
      teen.context.request,
      `/students/${mia.id}/progress`,
    );
    expect(own.comments.map((c) => c.id).sort()).toEqual([fromKim.id, fromSam.id].sort());
    for (const reader of [fam, teen.context.request]) {
      for (const path of ["/home", `/students/${mia.id}`, `/students/${mia.id}/progress`]) {
        const text = JSON.stringify(await portalGet(reader, path));
        expect(text, path).not.toContain(tag);
        expect(text, path).not.toContain(handoffId);
        expect(text, path).not.toContain(staffOnly.id);
      }
    }

    // Their pages say the same.
    const familyErrors = watchErrors(parent.page);
    await visit(parent.page, `/my/${mia.id}/progress`);
    await expect(parent.page.getByText("Great first session together, Mia.")).toBeVisible();
    await expect(parent.page.getByText("Mia kept her resets low all session.")).toBeVisible();
    await visit(parent.page, `/my/${mia.id}/coaches`);
    await expect(parent.page.getByRole("article", { name: "Kim Lee" })).toBeVisible();
    await expect(parent.page.getByRole("article", { name: "Sam Rivera" })).toHaveCount(0);
    for (const path of ["/my", `/my/${mia.id}/progress`, `/my/${mia.id}/coaches`]) {
      await visit(parent.page, path);
      await expect(parent.page.locator("h1").first()).toBeVisible();
      await parent.page.waitForLoadState("networkidle");
      expect(await parent.page.content(), path).not.toContain(tag);
    }
    expect(familyErrors).toEqual([]);

    // Pushes: each shared comment, never the handoff or the coaches-only note.
    await pushes(owner.request, parentId, (p) => p.payload.tag === `note:${fromSam.id}`);
    await pushes(owner.request, parentId, (p) => p.payload.tag === `note:${fromKim.id}`);
    const sent = (await sinkOf(owner.request, parentId)).items;
    expect(sent.map((p) => p.payload.tag)).not.toContain(`note:${handoffId}`);
    expect(sent.map((p) => p.payload.tag)).not.toContain(`note:${staffOnly.id}`);
    expect(JSON.stringify(sent)).not.toContain(tag);
  });
});
