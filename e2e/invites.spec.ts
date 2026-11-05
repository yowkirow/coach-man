import type {
  FamilyAccessDto,
  FamilyInviteCreatedDto,
  InvitePreviewDto,
  PortalStudentDto,
  PortalTeenInviteCreatedDto,
  StaffInviteCreatedDto,
  TeamDto,
} from "../src/shared/api-types";
import {
  acceptInvite,
  bornYearsAgo,
  expect,
  inviteToken,
  linkFamily,
  onboard,
  portalCall,
  portalGet,
  test,
  testEmail,
} from "./support";

// Invite links (plan: "Security and privacy"; spec §6): random tokens stored only as a hash, valid
// for seven days, single-use even when two people open the same link at once, and replaced by a
// newer link for the same person. (Used, expired, withdrawn, and unknown links, and the pages
// that explain them, are in team.spec.ts and family.spec.ts; the rate limits are unit-tested,
// since every local test shares one address.)

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

test.describe("invite links", () => {
  test.skip(({ isMobile }) => isMobile, "API checks: one browser is enough");

  test("last seven days, and their tokens are never shown again", async ({
    coach: owner,
    personas,
  }, info) => {
    const { api, request } = owner;
    await onboard(api);
    const staff = await api.post<StaffInviteCreatedDto>("/team/invites", {
      email: testEmail("ttl-coach", info),
      role: "coach",
    });
    const teen = await api.post<{ id: string }>("/clients", {
      firstName: "Jun",
      lastName: "Park",
      birthDate: bornYearsAgo(15),
      isJunior: true,
    });
    const family = await api.post<FamilyInviteCreatedDto>(`/clients/${teen.id}/family/invites`, {
      relation: "guardian",
    });
    const parentEmail = testEmail("ttl-parent", info);
    expect(
      (
        await linkFamily(request, {
          clientId: teen.id,
          email: parentEmail,
          name: "Grace Park",
          relation: "guardian",
        })
      ).status,
    ).toBe(201);
    const parent = await personas.open({ email: parentEmail, name: "Grace Park", persona: "none" });
    const own = await portalCall(
      parent.context.request,
      "POST",
      `/students/${teen.id}/teen-invite`,
    );
    expect(own.status, own.text).toBe(201);
    const teenLink = own.json as PortalTeenInviteCreatedDto;

    // Seven days from when they're made, whoever makes them.
    for (const made of [staff.invite, family.invite, teenLink.invite]) {
      expect(made.expiresAt - made.createdAt).toBe(SEVEN_DAYS);
      expect(made.status).toBe("valid");
    }
    // 32 random bytes, base64url: 43 characters.
    const tokens = [staff.link, family.link, teenLink.link].map(inviteToken);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(tokens).size).toBe(3);

    // Lists show the links' state, never their tokens again (only a hash is kept).
    const lists = [
      JSON.stringify(await api.get<TeamDto>("/team")),
      JSON.stringify(await api.get<FamilyAccessDto>(`/clients/${teen.id}/family`)),
      JSON.stringify(
        await portalGet<PortalStudentDto>(parent.context.request, `/students/${teen.id}`),
      ),
    ];
    for (const list of lists) for (const token of tokens) expect(list).not.toContain(token);
    const listed = await api.get<FamilyAccessDto>(`/clients/${teen.id}/family`);
    expect(listed.invites.map((i) => i.id).sort()).toEqual(
      [family.invite.id, teenLink.invite.id].sort(),
    );
    // And each link still opens as valid (it's found by its token's hash).
    for (const token of tokens) {
      const preview = await request.get(`/api/invites/${token}`);
      expect(((await preview.json()) as InvitePreviewDto).status).toBe("valid");
    }
  });

  test("work once, even when two people open one at the same moment; a newer link replaces the last", async ({
    coach: owner,
    personas,
  }, info) => {
    test.slow();
    const { api } = owner;
    await onboard(api);
    const kid = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(15),
      isJunior: true,
    });

    // Two parents open the same family link at once: one follows Mia, the other is told it's used.
    const link = await api.post<FamilyInviteCreatedDto>(`/clients/${kid.id}/family/invites`, {
      relation: "guardian",
    });
    const pat = await personas.open({
      email: testEmail("race-pat", info),
      name: "Pat Santos",
      persona: "none",
    });
    const lee = await personas.open({
      email: testEmail("race-lee", info),
      name: "Lee Santos",
      persona: "none",
    });
    const token = inviteToken(link.link);
    const both = await Promise.all([
      acceptInvite(pat.context.request, token),
      acceptInvite(lee.context.request, token),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(both.find((r) => r.status === 410)?.code).toBe("invite_used");
    const linked = await api.get<FamilyAccessDto>(`/clients/${kid.id}/family`);
    expect(linked.links).toHaveLength(1);
    // Used: it's no longer among the waiting links.
    expect(linked.invites.map((i) => i.id)).not.toContain(link.invite.id);

    // One person accepting a staff link twice at once joins once.
    const coachEmail = testEmail("race-coach", info);
    const staff = await api.post<StaffInviteCreatedDto>("/team/invites", {
      email: coachEmail,
      role: "coach",
    });
    const coach = await personas.open({ email: coachEmail, name: "Sam Rivera", persona: "none" });
    const twice = await Promise.all([
      acceptInvite(coach.context.request, inviteToken(staff.link)),
      acceptInvite(coach.context.request, inviteToken(staff.link)),
    ]);
    expect(twice.map((r) => r.status).sort()).toEqual([200, 410]);
    const team = await api.get<TeamDto>("/team");
    expect(team.members.filter((m) => m.email === coachEmail.toLowerCase())).toHaveLength(1);

    // A new staff link for the same address replaces the last one.
    const nextEmail = testEmail("replaced-admin", info);
    const older = await api.post<StaffInviteCreatedDto>("/team/invites", {
      email: nextEmail,
      role: "admin",
    });
    const newer = await api.post<StaffInviteCreatedDto>("/team/invites", {
      email: nextEmail,
      role: "admin",
    });
    const admin = await personas.open({ email: nextEmail, name: "Alex Admin", persona: "none" });
    const stale = await acceptInvite(admin.context.request, inviteToken(older.link));
    expect([stale.status, stale.code]).toEqual([410, "invite_revoked"]);
    expect((await acceptInvite(admin.context.request, inviteToken(newer.link))).status).toBe(200);

    // A teen's new own-login link replaces the last; parents' links don't replace each other.
    const parent = both.find((r) => r.status === 200) === both[0] ? pat : lee;
    const first = await portalCall(
      parent.context.request,
      "POST",
      `/students/${kid.id}/teen-invite`,
    );
    const second = await portalCall(
      parent.context.request,
      "POST",
      `/students/${kid.id}/teen-invite`,
    );
    expect([first.status, second.status]).toEqual([201, 201]);
    const mia = await personas.open({
      email: testEmail("race-mia", info),
      name: "Mia Santos",
      persona: "none",
    });
    const replaced = await acceptInvite(
      mia.context.request,
      inviteToken((first.json as PortalTeenInviteCreatedDto).link),
    );
    expect([replaced.status, replaced.code]).toEqual([410, "invite_revoked"]);
    const current = await acceptInvite(
      mia.context.request,
      inviteToken((second.json as PortalTeenInviteCreatedDto).link),
    );
    expect(current.status, current.text).toBe(200);
    const guardianA = await api.post<FamilyInviteCreatedDto>(`/clients/${kid.id}/family/invites`, {
      relation: "guardian",
    });
    const guardianB = await api.post<FamilyInviteCreatedDto>(`/clients/${kid.id}/family/invites`, {
      relation: "guardian",
    });
    const waiting = await api.get<FamilyAccessDto>(`/clients/${kid.id}/family`);
    const statusOf = (id: string) => waiting.invites.find((i) => i.id === id)?.status;
    expect([statusOf(guardianA.invite.id), statusOf(guardianB.invite.id)]).toEqual([
      "valid",
      "valid",
    ]);
  });
});
