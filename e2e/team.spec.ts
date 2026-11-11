import type { APIRequestContext } from "@playwright/test";
import type {
  AcademyDto,
  CoachProfileDto,
  MeDto,
  StaffInviteCreatedDto,
  TeamDto,
} from "../src/shared/api-types";
import {
  Api,
  addMember,
  BYPASS_HEADER,
  bypassSecret,
  expect,
  test,
  testEmail,
  uuid,
  visit,
  watchErrors,
} from "./support";

// The team: invite links (/join/<token>), roles and removal with an owner always kept, the
// academy profile, and coach profiles.

/** The token at the end of an invite link. */
function tokenOf(link: string): string {
  const match = link.match(/\/join\/([A-Za-z0-9_-]+)$/);
  if (!match?.[1]) throw new Error(`Not an invite link: ${link}`);
  return match[1];
}

/** POST /api/invites/<token>/accept as whoever `request` is signed in as. */
async function accept(request: APIRequestContext, token: string) {
  const res = await request.post(`/api/invites/${token}/accept`);
  const json = (await res.json().catch(() => undefined)) as unknown;
  return { status: res.status(), code: Api.code({ json }) };
}

test.describe("staff invites", () => {
  test("an owner invites a coach by link, and the coach joins with it", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const email = testEmail("invitee", info);
    const owner = await seeded.api.get<MeDto>("/me");
    const academy = owner.workspace.name;
    const ownerErrors = watchErrors(page);

    await visit(page, "/team");
    await expect(page.getByRole("heading", { name: "Team", exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Invite someone" }).first().click();
    const form = page.getByRole("dialog", { name: "Invite someone" });
    await form.getByLabel("Their email").fill(email.toUpperCase());
    await expect(form.getByRole("radio", { name: /^Coach/ })).toBeChecked();
    await form.getByRole("button", { name: "Create invite link" }).click();

    const ready = page.getByRole("dialog", { name: "Invite link ready" });
    await expect(ready).toBeVisible();
    // CoachMan emailed it too (to the test sink); the link is still here to share.
    await expect(ready.getByText(`We emailed the link to ${email.toLowerCase()}.`)).toBeVisible();
    const link = await ready.getByLabel("Invite link").inputValue();
    // Built from APP_URL, which is the served origin locally and on staging.
    expect(new URL(link).origin).toBe(new URL(page.url()).origin);
    const token = tokenOf(link);
    expect(token.length).toBeGreaterThanOrEqual(32);
    // The ready-to-paste message names the academy, the account to use, and the link.
    const message = ready.getByText(link, { exact: false });
    await expect(message).toContainText(academy);
    await expect(message).toContainText(email.toLowerCase());
    await ready.getByRole("button", { name: "Done" }).click();

    const invites = page.getByRole("region", { name: "Invites" });
    await expect(invites.getByText(email.toLowerCase())).toBeVisible();
    const team = await seeded.api.get<TeamDto>("/team");
    expect(team.invites.map((i) => [i.email, i.role, i.status])).toEqual([
      [email.toLowerCase(), "coach", "valid"],
    ]);

    // The invitee signs in with the invited address (no academy yet) and opens the link.
    const invitee = await personas.open({ email, name: "Sam Rivera", persona: "none" });
    const errors = watchErrors(invitee.page);
    await visit(invitee.page, `/join/${token}`);
    await expect(invitee.page.getByRole("heading", { name: `Join ${academy}` })).toBeVisible();
    await expect(invitee.page.getByText("You'll join as a coach.")).toBeVisible();
    await invitee.page.getByRole("button", { name: `Join ${academy}` }).click();

    await expect(invitee.page).toHaveURL(/\/$/);
    await expect(
      invitee.page.getByRole("heading", { name: "Today", exact: true }).first(),
    ).toBeVisible();
    const me = await invitee.api.get<MeDto>("/me");
    expect(me.role).toBe("coach");
    expect(me.workspace.id).toBe(owner.workspace.id);
    expect(me.can.money).toBe(false);

    // Used once: the link now says so (and that they're already on the team), and the owner sees
    // a new coach and no waiting invite.
    await visit(invitee.page, `/join/${token}`);
    await expect(
      invitee.page.getByRole("heading", { name: "This invite has already been used" }),
    ).toBeVisible();
    await expect(
      invitee.page.getByText(`You're already on the team at ${academy}`, { exact: false }),
    ).toBeVisible();
    await expect(invitee.page.getByRole("button", { name: `Open ${academy}` })).toBeVisible();
    expect(await accept(invitee.context.request, token)).toEqual({
      status: 410,
      code: "invite_used",
    });
    expect(errors).toEqual([]);

    await visit(page, "/team");
    const members = page.getByRole("region", { name: "Members" });
    await expect(members.getByText("Sam Rivera")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No invites waiting" })).toBeVisible();
    expect(ownerErrors).toEqual([]);
  });

  test("a different account, a withdrawn link, and an expired link are all refused", async ({
    seeded,
    personas,
  }, info) => {
    const invited = testEmail("invited", info);
    const first = await seeded.api.post<StaffInviteCreatedDto>("/team/invites", {
      email: invited,
      role: "coach",
    });
    const token = tokenOf(first.link);

    // Signed in as someone else: the page says so and offers to switch; the API refuses.
    const stranger = await personas.open({
      email: testEmail("stranger", info),
      name: "Lee Stranger",
      persona: "none",
    });
    await visit(stranger.page, `/join/${token}`);
    await expect(
      stranger.page.getByRole("heading", { name: "This invite is for a different account" }),
    ).toBeVisible();
    await expect(stranger.page.getByRole("button", { name: "Use another account" })).toBeVisible();
    expect(await accept(stranger.context.request, token)).toEqual({
      status: 403,
      code: "wrong_email",
    });
    expect((await stranger.api.raw("GET", "/me")).status).toBe(403);

    // Withdrawn: the right person can't use it either.
    await seeded.api.del(`/team/invites/${first.invite.id}`);
    const invitee = await personas.open({ email: invited, name: "Sam Rivera", persona: "none" });
    await visit(invitee.page, `/join/${token}`);
    await expect(
      invitee.page.getByRole("heading", { name: "This invite was withdrawn" }),
    ).toBeVisible();
    expect(await accept(invitee.context.request, token)).toEqual({
      status: 410,
      code: "invite_revoked",
    });

    // Expired.
    const second = await seeded.api.post<StaffInviteCreatedDto>("/team/invites", {
      email: invited,
      role: "admin",
    });
    const expire = await seeded.request.post("/api/test/expire-invite", {
      headers: { [BYPASS_HEADER]: bypassSecret() },
      data: { inviteId: second.invite.id },
    });
    expect(expire.status()).toBe(204);
    await visit(invitee.page, `/join/${tokenOf(second.link)}`);
    await expect(
      invitee.page.getByRole("heading", { name: "This invite has expired" }),
    ).toBeVisible();
    expect(await accept(invitee.context.request, tokenOf(second.link))).toEqual({
      status: 410,
      code: "invite_expired",
    });
    const team = await seeded.api.get<TeamDto>("/team");
    expect(team.invites.map((i) => i.status)).toEqual(["expired"]);

    // A made-up token, and nobody joined anything.
    const unknown = await invitee.context.request.get(`/api/invites/${"x".repeat(43)}`);
    expect(unknown.status()).toBe(404);
    expect((await invitee.api.raw("GET", "/me")).status).toBe(403);
    expect(team.members).toHaveLength(1);

    // Staff only: a coach can't invite anyone.
    const coachEmail = testEmail("no-invites", info);
    await addMember(seeded.request, { email: coachEmail, name: "Kim Lee", role: "coach" });
    const coach = await personas.open({ email: coachEmail, name: "Kim Lee", persona: "none" });
    const denied = await coach.api.raw("POST", "/team/invites", { email: invited, role: "coach" });
    expect(denied.status).toBe(403);
  });
});

test.describe("the team", () => {
  test("roles change, people leave, and the academy always keeps an owner", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const samEmail = testEmail("role-sam", info);
    const { userId: samId } = await addMember(seeded.request, {
      email: samEmail,
      name: "Sam Rivera",
      role: "coach",
    });
    const alexEmail = testEmail("role-alex", info);
    const { userId: alexId } = await addMember(seeded.request, {
      email: alexEmail,
      name: "Alex Admin",
      role: "admin",
    });
    const owner = await seeded.api.get<MeDto>("/me");
    const errors = watchErrors(page);

    await visit(page, "/team");
    const members = page.getByRole("region", { name: "Members" });
    await expect(members.getByText("Sam Rivera")).toBeVisible();

    // Sam: coach → admin.
    await page.getByRole("button", { name: "Options for Sam Rivera" }).click();
    await page.getByRole("menuitem", { name: "Change role" }).click();
    const roleSheet = page.getByRole("dialog", { name: "Change role" });
    await roleSheet.getByRole("radio", { name: /^Admin/ }).check({ force: true });
    await roleSheet.getByRole("button", { name: "Save role" }).click();
    await expect(roleSheet).toBeHidden();
    await expect(page.getByText("Sam Rivera is now an admin")).toBeVisible();

    // Alex leaves the team.
    await page.getByRole("button", { name: "Options for Alex Admin" }).click();
    await page.getByRole("menuitem", { name: "Remove from team" }).click();
    const confirm = page.getByRole("dialog", { name: "Remove Alex Admin?" });
    await confirm.getByRole("button", { name: "Remove from team" }).click();
    await expect(confirm).toBeHidden();
    await expect(members.getByText("Alex Admin")).toHaveCount(0);

    // The only owner can't demote or remove themselves, so the menu doesn't offer it.
    await page.getByRole("button", { name: "Options for Robin Coach" }).click();
    await expect(page.getByRole("menuitem", { name: "Edit coach profile" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Change role" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Leave this academy" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);

    const team = await seeded.api.get<TeamDto>("/team");
    expect(team.members.map((m) => [m.userId, m.role]).sort()).toEqual(
      [
        [owner.user.id, "owner"],
        [samId, "admin"],
      ].sort(),
    );
    expect(team.members.some((m) => m.userId === alexId)).toBe(false);

    // The API holds the same lines.
    const lastOwner = await seeded.api.raw("PATCH", `/team/members/${owner.user.id}`, {
      role: "admin",
    });
    expect([lastOwner.status, Api.code(lastOwner)]).toEqual([409, "last_owner"]);
    const leave = await seeded.api.raw("DELETE", `/team/members/${owner.user.id}`);
    expect([leave.status, Api.code(leave)]).toEqual([409, "last_owner"]);

    const sam = await personas.open({ email: samEmail, name: "Sam Rivera", persona: "none" });
    expect(
      (await sam.api.raw("PATCH", `/team/members/${owner.user.id}`, { role: "coach" })).status,
    ).toBe(403);
    expect((await sam.api.raw("PATCH", `/team/members/${samId}`, { role: "owner" })).status).toBe(
      403,
    );
    expect((await sam.api.raw("POST", "/team/transfer-ownership", { userId: samId })).status).toBe(
      403,
    );

    // Only the owner hands the academy on; they stay on as an admin.
    const handed = await seeded.api.post<TeamDto>("/team/transfer-ownership", { userId: samId });
    expect(handed.members.find((m) => m.userId === samId)?.role).toBe("owner");
    expect(handed.members.find((m) => m.userId === owner.user.id)?.role).toBe("admin");
    expect((await seeded.api.get<MeDto>("/me")).can.ownership).toBe(false);
  });

  test("the academy profile saves, and its public address is checked and must be free", async ({
    page,
    seeded,
    personas,
  }, info) => {
    // Another academy holds an address first.
    const other = await personas.open({
      email: testEmail("other-academy", info),
      name: "Other Owner",
      persona: "coach",
    });
    const taken = `taken-${uuid().slice(0, 8)}`;
    await other.api.patch<AcademyDto>("/academy", { slug: taken });
    const errors = watchErrors(page);

    await visit(page, "/settings");
    const section = page.getByRole("region", { name: "Academy profile" });
    await expect(section.getByLabel("Academy name")).toBeVisible();
    await section.getByLabel("Academy name").fill("Riverside Pickleball Academy");
    await section.getByLabel("Tagline").fill("Pickleball for every level");
    // The preview follows the form.
    await expect(section.getByText("Pickleball for every level", { exact: true })).toBeVisible();
    await expect(section.getByText("Riverside Pickleball Academy", { exact: true })).toBeVisible();

    await section.getByLabel("Public address").fill("Not a slug!");
    await section.getByRole("button", { name: "Save changes" }).click();
    await expect(section.getByText(/Use 3 to 40 lowercase letters/)).toBeVisible();

    await section.getByLabel("Public address").fill(taken);
    await section.getByRole("button", { name: "Save changes" }).click();
    await expect(section.getByText("That address is taken. Try another.")).toBeVisible();

    const mine = `e2e-${uuid().slice(0, 8)}`;
    await section.getByLabel("Public address").fill(mine);
    await section.getByLabel("How to pay").fill("GCash 0917 000 0000 (Riverside PA)");
    const enrollment = section.getByRole("switch", { name: "Take enrollment requests" });
    await enrollment.click({ force: true });
    await expect(enrollment).toBeChecked();
    await section.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Academy profile saved")).toBeVisible();

    const saved = await seeded.api.get<AcademyDto>("/academy");
    expect(saved).toMatchObject({
      name: "Riverside Pickleball Academy",
      slug: mine,
      tagline: "Pickleball for every level",
      paymentInstructions: "GCash 0917 000 0000 (Riverside PA)",
      enrollmentOpen: true,
    });
    expect((await seeded.api.get<MeDto>("/me")).workspace.name).toBe(
      "Riverside Pickleball Academy",
    );
    // The clash was the server's answer (409); nothing else failed.
    expect(errors.filter((e) => e !== "409 PATCH /api/v1/academy")).toEqual([]);

    // API: the same address rules, and coaches read but don't edit.
    const clash = await seeded.api.raw("PATCH", "/academy", { slug: taken });
    expect([clash.status, Api.code(clash)]).toEqual([409, "conflict"]);
    expect((await seeded.api.raw("PATCH", "/academy", { slug: "ab" })).status).toBe(400);
    const coachEmail = testEmail("academy-coach", info);
    await addMember(seeded.request, { email: coachEmail, name: "Kim Lee", role: "coach" });
    const coach = await personas.open({ email: coachEmail, name: "Kim Lee", persona: "none" });
    expect((await coach.api.get<AcademyDto>("/academy")).slug).toBe(mine);
    expect((await coach.api.raw("PATCH", "/academy", { tagline: "Mine now" })).status).toBe(403);
  });

  test("everyone keeps a coach profile, and admins edit anyone's from Team", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const email = testEmail("profile-coach", info);
    const { userId } = await addMember(seeded.request, {
      email,
      name: "Sam Rivera",
      role: "coach",
    });
    const owner = await seeded.api.get<MeDto>("/me");
    const coach = await personas.open({ email, name: "Sam Rivera", persona: "none" });
    const errors = watchErrors(coach.page);

    await visit(coach.page, "/settings");
    const section = coach.page.getByRole("region", { name: "My coach profile" });
    // By role: "Title" and "About" also appear in the descriptions of other controls.
    await section
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Junior programs coach");
    await section
      .getByRole("textbox", { name: "About", exact: true })
      .fill("Ten years of coaching juniors.");
    await section.getByRole("button", { name: "Save profile" }).click();
    await expect(coach.page.getByText("Coach profile saved")).toBeVisible();
    // Coaches see their own profile, not the academy's settings.
    await expect(coach.page.getByRole("region", { name: "Academy profile" })).toHaveCount(0);
    expect(errors).toEqual([]);

    const own = await coach.api.get<CoachProfileDto>(`/coaches/${userId}`);
    expect(own).toMatchObject({
      title: "Junior programs coach",
      bio: "Ten years of coaching juniors.",
    });
    expect(
      (await coach.api.raw("PATCH", `/coaches/${owner.user.id}`, { title: "Not mine" })).status,
    ).toBe(403);

    // The owner sees it on Team and edits it there.
    await visit(page, "/team");
    const members = page.getByRole("region", { name: "Members" });
    await expect(members.getByText(/Junior programs coach/)).toBeVisible();
    await page.getByRole("button", { name: "Options for Sam Rivera" }).click();
    await page.getByRole("menuitem", { name: "Edit coach profile" }).click();
    const sheet = page.getByRole("dialog", { name: "Coach profile" });
    const title = sheet.getByRole("textbox", { name: "Title", exact: true });
    await expect(title).toHaveValue("Junior programs coach");
    await title.fill("Head of juniors");
    await sheet.getByRole("button", { name: "Save profile" }).click();
    await expect(sheet).toBeHidden();
    await expect(members.getByText(/Head of juniors/)).toBeVisible();
    expect((await seeded.api.get<CoachProfileDto>(`/coaches/${userId}`)).title).toBe(
      "Head of juniors",
    );

    // The picker list every staff screen uses.
    const coaches =
      await coach.api.get<{ userId: string; name: string; title: string | null }[]>("/coaches");
    expect(coaches.find((c) => c.userId === userId)).toMatchObject({
      name: "Sam Rivera",
      title: "Head of juniors",
    });
  });
});
