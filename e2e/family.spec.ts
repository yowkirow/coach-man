import type {
  FamilyAccessDto,
  FamilyInviteCreatedDto,
  InviteAcceptedDto,
  MeDto,
  PortalHomeDto,
} from "../src/shared/api-types";
import {
  Api,
  acceptInvite,
  auditLog,
  BYPASS_HEADER,
  bornYearsAgo,
  bypassSecret,
  expect,
  inviteToken,
  linkFamily,
  portalGet,
  test,
  testEmail,
  visit,
  watchErrors,
} from "./support";

// Family access: invite links for parents and students (/join/<token>), the age rules on both
// ends of a link, and what used, expired, and withdrawn links do. Service workers are blocked (as
// in openAs): nothing here is about offline use, and each context's precache burst can stall the
// local preview server for everyone.
test.use({ serviceWorkers: "block" });

test.describe("family invites", () => {
  test("an owner invites a parent by link, and the parent follows the student", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const owner = await seeded.api.get<MeDto>("/me");
    const academy = owner.workspace.name;
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(10),
      isJunior: true,
    });
    const staffErrors = watchErrors(page);

    await visit(page, `/clients/${kid.id}`);
    const card = page.getByRole("region", { name: "Family access" });
    await expect(card).toContainText("Nobody follows Mia's training yet.");
    // Ten years old: a parent's link, not a login of her own, and the card says why.
    await expect(card.getByRole("button", { name: "Invite student (own login)" })).toBeDisabled();
    await expect(card).toContainText(
      "Students under 13 don't get their own login. Invite a parent instead.",
    );
    await card.getByRole("button", { name: "Invite parent / guardian" }).click();
    await page
      .getByRole("dialog", { name: "Invite a parent or guardian" })
      .getByRole("button", { name: "Create invite link" })
      .click();

    const ready = page.getByRole("dialog", { name: "Invite link ready" });
    await expect(ready).toBeVisible();
    const link = await ready.getByLabel("Invite link").inputValue();
    expect(new URL(link).origin).toBe(new URL(page.url()).origin);
    const token = inviteToken(link);
    expect(token.length).toBeGreaterThanOrEqual(32);
    // A message ready for Messenger, Viber, or a text: who invites whom to what, and the link.
    const message = ready.getByText(link, { exact: false });
    await expect(message).toContainText(`${academy} invited you to follow Mia's training`);
    await expect(message).toContainText("The link works once");
    await ready.getByRole("button", { name: "Done" }).click();
    await expect(card.getByRole("list", { name: "Waiting invites" })).toContainText(
      "Parent or guardian link",
    );

    // The parent opens the link signed in (no academy of their own) and accepts.
    const email = testEmail("parent", info);
    const parent = await personas.open({ email, name: "Pat Santos", persona: "none" });
    const errors = watchErrors(parent.page);
    await visit(parent.page, `/join/${token}`);
    await expect(parent.page.getByRole("heading", { name: "Follow Mia's training" })).toBeVisible();
    await expect(parent.page.getByText(academy, { exact: true }).first()).toBeVisible();
    await expect(
      parent.page.getByText("Accept to follow Mia's training as their parent or guardian."),
    ).toBeVisible();
    await parent.page.getByRole("button", { name: "Accept invite" }).click();

    await expect(parent.page).toHaveURL(/\/my\/?$/);
    await expect(parent.page.getByRole("heading", { name: "Hi, Pat" })).toBeVisible();
    await expect(parent.page.getByRole("heading", { name: "Mia Santos" })).toBeVisible();
    const home = await portalGet<PortalHomeDto>(parent.context.request, "/home");
    expect(home.students.map((s) => [s.clientId, s.relation])).toEqual([[kid.id, "guardian"]]);

    // Used once: the link says so, points to the portal, and can't be used again.
    await visit(parent.page, `/join/${token}`);
    await expect(
      parent.page.getByRole("heading", { name: "This invite has already been used" }),
    ).toBeVisible();
    await expect(parent.page.getByText("You already follow Mia's training")).toBeVisible();
    await expect(parent.page.getByRole("link", { name: "Open My family" })).toBeVisible();
    const again = await acceptInvite(parent.context.request, token);
    expect([again.status, again.code]).toEqual([410, "invite_used"]);
    expect(errors).toEqual([]);

    // The academy sees who follows Mia now, and the grant is on the record.
    await visit(page, `/clients/${kid.id}`);
    await expect(card.getByRole("list", { name: "Linked accounts" })).toContainText("Pat Santos");
    await expect(card.getByRole("list", { name: "Waiting invites" })).toHaveCount(0);
    expect(staffErrors).toEqual([]);
    const access = await seeded.api.get<FamilyAccessDto>(`/clients/${kid.id}/family`);
    expect(access.links.map((l) => [l.name, l.relation, l.email])).toEqual([
      ["Pat Santos", "guardian", email.toLowerCase()],
    ]);
    const audited = (await auditLog(seeded.request)).map((e) => `${e.action} ${e.entity}`);
    expect(audited).toEqual(
      expect.arrayContaining([
        "invite family_invite",
        "accept family_invite",
        "grant client_access",
      ]),
    );
  });

  test("the age rules decide who gets a link, and are checked again when it's used", async ({
    page,
    seeded,
    personas,
  }, info) => {
    const { api } = seeded;
    const student = (body: Record<string, unknown>) => api.post<{ id: string }>("/clients", body);
    const invite = (clientId: string, relation: "guardian" | "self") =>
      api.raw("POST", `/clients/${clientId}/family/invites`, { relation });
    const outcome = async (clientId: string, relation: "guardian" | "self") => {
      const res = await invite(clientId, relation);
      return res.status === 201 ? 201 : `${res.status} ${Api.code(res)}`;
    };

    // An adult signs in themself: their own login, never a parent's link.
    const adult = await student({
      firstName: "Ana",
      lastName: "Cruz",
      birthDate: bornYearsAgo(30),
    });
    expect(await outcome(adult.id, "guardian")).toBe("409 not_a_minor");
    const adultLink = await api.post<FamilyInviteCreatedDto>(
      `/clients/${adult.id}/family/invites`,
      { relation: "self" },
    );
    // So is someone without a birth date who isn't marked junior.
    const grownUp = await student({ firstName: "Bea", lastName: "Lim" });
    expect(await outcome(grownUp.id, "guardian")).toBe("409 not_a_minor");
    expect(await outcome(grownUp.id, "self")).toBe(201);

    // Under 13: a parent's link only.
    const child = await student({
      firstName: "Leo",
      lastName: "Cruz",
      birthDate: bornYearsAgo(12),
      isJunior: true,
    });
    expect(await outcome(child.id, "self")).toBe("409 too_young");
    expect(await outcome(child.id, "guardian")).toBe(201);

    // A junior without a birth date: a parent's link, and no own login until the age is known.
    const junior = await student({ firstName: "Kai", lastName: "Reyes", isJunior: true });
    expect(await outcome(junior.id, "self")).toBe("409 needs_birth_date");
    expect(await outcome(junior.id, "guardian")).toBe(201);

    // 13 to 17: their own login once a parent is linked, and the staff card says why not yet.
    const teen = await student({
      firstName: "Jun",
      lastName: "Park",
      birthDate: bornYearsAgo(15),
      isJunior: true,
    });
    expect(await outcome(teen.id, "self")).toBe("409 needs_guardian");
    await visit(page, `/clients/${teen.id}`);
    const card = page.getByRole("region", { name: "Family access" });
    await expect(card.getByRole("button", { name: "Invite student (own login)" })).toBeDisabled();
    await expect(card).toContainText("A teen's own login needs a parent linked first.");

    const parentEmail = testEmail("teen-parent", info);
    const linked = await linkFamily(seeded.request, {
      clientId: teen.id,
      email: parentEmail,
      name: "Grace Park",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    await visit(page, `/clients/${teen.id}`);
    await expect(card.getByRole("button", { name: "Invite student (own login)" })).toBeEnabled();
    await expect(card).not.toContainText("needs a parent linked first");
    const teenLink = await api.post<FamilyInviteCreatedDto>(`/clients/${teen.id}/family/invites`, {
      relation: "self",
    });
    const token = inviteToken(teenLink.link);

    // Checked again when the link is used: with the parent's access ended, it's refused, and the
    // link stays unused.
    const access = await api.get<FamilyAccessDto>(`/clients/${teen.id}/family`);
    const parentAccess = access.links.find((l) => l.relation === "guardian");
    expect(parentAccess?.name).toBe("Grace Park");
    await api.del(`/clients/${teen.id}/family/access/${parentAccess?.id}`);

    const teenUser = await personas.open({
      email: testEmail("teen", info),
      name: "Jun Park",
      persona: "none",
    });
    const early = await acceptInvite(teenUser.context.request, token);
    expect([early.status, early.code]).toEqual([409, "needs_guardian"]);
    await visit(teenUser.page, `/join/${token}`);
    await expect(
      teenUser.page.getByRole("heading", { name: "See your own training" }),
    ).toBeVisible();
    await teenUser.page.getByRole("button", { name: "Accept invite" }).click();
    await expect(
      teenUser.page.getByText("A teen's own login needs a parent linked first.", { exact: false }),
    ).toBeVisible();
    await expect(teenUser.page).toHaveURL(new RegExp(`/join/${token}$`));

    // A parent again: the same link now works.
    const relinked = await linkFamily(seeded.request, {
      clientId: teen.id,
      email: parentEmail,
      name: "Grace Park",
      relation: "guardian",
    });
    expect(relinked.status).toBe(201);
    const accepted = await acceptInvite(teenUser.context.request, token);
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.json as InviteAcceptedDto).toEqual({
      kind: "family",
      clientId: teen.id,
      workspaceId: (await api.get<MeDto>("/me")).workspace.id,
    });

    // And an adult's own login works end to end.
    const ana = await personas.open({
      email: testEmail("adult", info),
      name: "Ana Cruz",
      persona: "none",
    });
    const own = await acceptInvite(ana.context.request, inviteToken(adultLink.link));
    expect(own.status, own.text).toBe(200);
    const anaHome = await portalGet<PortalHomeDto>(ana.context.request, "/home");
    expect(anaHome.students.map((s) => [s.firstName, s.relation])).toEqual([["Ana", "self"]]);
  });

  test("used, expired, and withdrawn links are refused, and a second link isn't needed", async ({
    seeded,
    personas,
  }, info) => {
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(9),
      isJunior: true,
    });
    const make = () =>
      seeded.api.post<FamilyInviteCreatedDto>(`/clients/${kid.id}/family/invites`, {
        relation: "guardian",
      });
    const pat = await personas.open({
      email: testEmail("parent", info),
      name: "Pat Santos",
      persona: "none",
    });
    const lee = await personas.open({
      email: testEmail("other-parent", info),
      name: "Lee Santos",
      persona: "none",
    });
    const errors = watchErrors(lee.page);

    // Used: whoever opens it first gets it; nobody else can use it after.
    const first = await make();
    expect((await acceptInvite(pat.context.request, inviteToken(first.link))).status).toBe(200);
    const used = await acceptInvite(lee.context.request, inviteToken(first.link));
    expect([used.status, used.code]).toEqual([410, "invite_used"]);
    await visit(lee.page, `/join/${inviteToken(first.link)}`);
    await expect(
      lee.page.getByRole("heading", { name: "This invite has already been used" }),
    ).toBeVisible();

    // Withdrawn.
    const withdrawn = await make();
    await seeded.api.del(`/clients/${kid.id}/family/invites/${withdrawn.invite.id}`);
    const revoked = await acceptInvite(lee.context.request, inviteToken(withdrawn.link));
    expect([revoked.status, revoked.code]).toEqual([410, "invite_revoked"]);
    await visit(lee.page, `/join/${inviteToken(withdrawn.link)}`);
    await expect(
      lee.page.getByRole("heading", { name: "This invite was withdrawn" }),
    ).toBeVisible();

    // Expired.
    const stale = await make();
    const expire = await seeded.request.post("/api/test/expire-invite", {
      headers: { [BYPASS_HEADER]: bypassSecret() },
      data: { inviteId: stale.invite.id },
    });
    expect(expire.status()).toBe(204);
    const expired = await acceptInvite(lee.context.request, inviteToken(stale.link));
    expect([expired.status, expired.code]).toEqual([410, "invite_expired"]);
    await visit(lee.page, `/join/${inviteToken(stale.link)}`);
    await expect(lee.page.getByRole("heading", { name: "This invite has expired" })).toBeVisible();

    // A made-up token.
    const unknown = await acceptInvite(lee.context.request, "x".repeat(43));
    expect([unknown.status, unknown.code]).toEqual([404, "invite_not_found"]);

    // Someone who already follows Mia is told so, and the link stays unused for the next person.
    const spare = await make();
    const twice = await acceptInvite(pat.context.request, inviteToken(spare.link));
    expect([twice.status, twice.code]).toEqual([409, "already_linked"]);
    await visit(pat.page, `/join/${inviteToken(spare.link)}`);
    await expect(
      pat.page.getByRole("heading", { name: "You already follow Mia's training" }),
    ).toBeVisible();
    expect((await acceptInvite(lee.context.request, inviteToken(spare.link))).status).toBe(200);

    const access = await seeded.api.get<FamilyAccessDto>(`/clients/${kid.id}/family`);
    expect(access.links.map((l) => l.name).sort()).toEqual(["Lee Santos", "Pat Santos"]);
    expect(access.invites.map((i) => i.status)).toEqual(["expired"]);
    expect(errors).toEqual([]);
  });
});
