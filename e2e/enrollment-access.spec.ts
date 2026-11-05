import type {
  EnrollmentContextDto,
  EnrollmentDetailDto,
  EnrollmentListDto,
  PortalHomeDto,
  PortalStudentEnrollmentsDto,
  PublicSessionDto,
  TodayDto,
} from "../src/shared/api-types";
import { newChildBody, openEnrollment, publicSessions, sendOk } from "./enroll-support";
import {
  addMember,
  bornYearsAgo,
  expect,
  linkFamily,
  portalCall,
  portalGet,
  test,
  testEmail,
  visit,
} from "./support";

// Who sees what in enrollment (WS4b): the inbox is for owners and admins; the public session list
// never says who's coming; a family sees its own requests, without anything staff-only.

test.use({ serviceWorkers: "block" });

test.describe("enrollment access", () => {
  test("only owners and admins have the Enrollments inbox", async ({ seeded, personas }, info) => {
    const setup = await openEnrollment(seeded, info);
    const parent = await personas.open({
      email: testEmail("access-parent", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, { firstName: "Mia", birthDate: bornYearsAgo(12) }),
    );
    const id = sent.request.id;

    const adminEmail = testEmail("access-admin", info);
    await addMember(seeded.request, { email: adminEmail, name: "Ari Admin", role: "admin" });
    const admin = await personas.open({ email: adminEmail, name: "Ari Admin", persona: "none" });
    const seen = await admin.api.get<EnrollmentListDto>("/enrollments");
    expect(seen.items.map((i) => i.id)).toEqual([id]);

    const coachEmail = testEmail("access-coach", info);
    await addMember(seeded.request, { email: coachEmail, name: "Casey Coach", role: "coach" });
    const coach = await personas.open({ email: coachEmail, name: "Casey Coach", persona: "none" });
    const calls: [method: "GET" | "POST", path: string, body?: unknown][] = [
      ["GET", "/enrollments"],
      ["GET", "/enrollments?status=all"],
      ["GET", "/enrollments/count"],
      ["GET", "/enrollments/renewals"],
      ["GET", `/enrollments/${id}`],
      ["POST", `/enrollments/${id}/approve`, {}],
      ["POST", `/enrollments/${id}/waitlist`, {}],
      ["POST", `/enrollments/${id}/decline`, { reason: "No room this month." }],
    ];
    for (const [method, path, body] of calls) {
      const res = await coach.api.raw(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect((await seeded.api.get<EnrollmentDetailDto>(`/enrollments/${id}`)).status).toBe(
      "requested",
    );
    // Like any parent, a coach can enroll their own child (and follow it in the portal).
    const own = await sendOk(
      coach.context.request,
      newChildBody(setup, { firstName: "Kai", lastName: "Reyes", birthDate: bornYearsAgo(9) }),
    );
    expect(own.newStudent).toBe(true);
    const coachHome = await portalGet<PortalHomeDto>(coach.context.request, "/home");
    expect(coachHome.students.map((s) => s.clientId)).toEqual([own.clientId]);
    expect(coachHome.enrollments?.map((r) => r.id)).toEqual([own.request.id]);
    // Nothing about enrollments on a coach's Today, and no way into the inbox.
    const today = await coach.api.get<TodayDto>("/today");
    expect(today.alerts.enrollments ?? null).toBeNull();
    const p = coach.page;
    // The rail (desktop) and the More page (phones) list everything else a coach can open.
    await visit(p, info.project.name === "mobile" ? "/more" : "/");
    await expect(
      p.getByRole("link", { name: info.project.name === "mobile" ? /^Groups/ : "Groups" }).first(),
    ).toBeVisible();
    await expect(p.getByRole("link", { name: /Enrollments/ })).toHaveCount(0);
    await visit(p, "/enrollments");
    await expect(
      p.getByText(/Enrollment requests are for the academy's owner and admins/),
    ).toBeVisible();
  });

  test("the public session list never says who's coming", async ({
    browser,
    seeded,
    personas,
  }, info) => {
    const setup = await openEnrollment(seeded, info);
    const before = await publicSessions(seeded.request, setup.slug, setup.program.id);
    const first = before[0];
    if (!first) throw new Error("No upcoming session");
    const parent = await personas.open({
      email: testEmail("access-sessions", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      parent.context.request,
      newChildBody(setup, {
        tier: setup.trial,
        firstName: "Mia",
        birthDate: bornYearsAgo(12),
        lessonId: first.id,
      }),
    );
    await seeded.api.post(`/enrollments/${sent.request.id}/approve`, {});

    const anon = await browser.newContext({ serviceWorkers: "block" });
    const url = `/api/public/academies/${setup.slug}/programs/${setup.program.id}/sessions`;
    const res = await anon.request.get(url);
    expect(res.ok()).toBe(true);
    const text = await res.text();
    const sessions = JSON.parse(text) as PublicSessionDto[];
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
      if (s.venue) expect(Object.keys(s.venue).sort()).toEqual(["address", "name"]);
    }
    for (const secret of [sent.clientId, "Mia", "Pat Santos", "roster", "attendance"]) {
      expect(text).not.toContain(secret);
    }
    const booked = sessions.find((s) => s.id === first.id);
    if (first.seatsLeft !== null) expect(booked?.seatsLeft).toBe(first.seatsLeft - 1);

    // Only public programs of listed academies, and only real dates.
    const hidden = await seeded.api.post<{ id: string }>("/groups", {
      name: "Private squad",
      capacity: 4,
    });
    const privateRes = await anon.request.get(
      `/api/public/academies/${setup.slug}/programs/${hidden.id}/sessions`,
    );
    expect(privateRes.status()).toBe(404);
    expect((await anon.request.get(`${url}?from=soon`)).status()).toBe(400);
    await seeded.api.patch("/academy", { listed: false });
    expect((await anon.request.get(url)).status()).toBe(404);
    await anon.close();
  });

  test("a family sees only its own requests, and nothing staff-only", async ({
    seeded,
    personas,
  }, info) => {
    const { api } = seeded;
    const setup = await openEnrollment(seeded, info);
    const a = await personas.open({
      email: testEmail("access-family-a", info),
      name: "Pat Santos",
      persona: "none",
    });
    const sent = await sendOk(
      a.context.request,
      newChildBody(setup, { firstName: "Mia", birthDate: bornYearsAgo(12) }),
    );
    await api.post(`/enrollments/${sent.request.id}/waitlist`, { note: "Full this month." });

    // Family A sees the family's fields, and no staff-only ones.
    const mine = await portalGet<PortalStudentEnrollmentsDto>(
      a.context.request,
      `/students/${sent.clientId}/enrollments`,
    );
    const request = mine.requests[0];
    expect(Object.keys(request ?? {}).sort()).toEqual([
      "canCancel",
      "clientId",
      "createdAt",
      "decidedAt",
      "id",
      "mode",
      "note",
      "payment",
      "programName",
      "renewal",
      "session",
      "startDate",
      "startMonth",
      "status",
      "student",
      "tier",
      "workspaceId",
    ]);
    expect(Object.keys(request?.tier ?? {}).sort()).toEqual([
      "credits",
      "name",
      "priceMinor",
      "sessionsLabel",
      "validityMode",
    ]);
    expect(request?.note).toBe("Full this month.");
    const home = await portalGet<PortalHomeDto>(a.context.request, "/home");
    expect(home.enrollments?.map((r) => r.id)).toEqual([sent.request.id]);
    const body = JSON.stringify([mine, home.enrollments]);
    for (const secret of [
      "decidedBy",
      "requestedBy",
      "answers",
      "Mild asthma",
      "emergency",
      "matches",
      seeded.email,
    ]) {
      expect(body).not.toContain(secret);
    }

    // Family B (linked to another student at the same academy) can't see or touch it.
    const other = await api.post<{ id: string }>("/clients", {
      firstName: "Leo",
      lastName: "Cruz",
      birthDate: bornYearsAgo(10),
      isJunior: true,
    });
    const bEmail = testEmail("access-family-b", info);
    const linked = await linkFamily(seeded.request, {
      clientId: other.id,
      email: bEmail,
      name: "Lee Cruz",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    const b = await personas.open({ email: bEmail, name: "Lee Cruz", persona: "none" });
    const theirs = await portalCall(
      b.context.request,
      "GET",
      `/students/${sent.clientId}/enrollments`,
    );
    expect(theirs.status).toBe(404);
    const cancel = await portalCall(
      b.context.request,
      "POST",
      `/enrollments/${sent.request.id}/cancel`,
    );
    expect(cancel.status).toBe(404);
    const renew = await portalCall(
      b.context.request,
      "POST",
      `/students/${sent.clientId}/renew`,
      {},
    );
    expect(renew.status).toBe(404);
    const enrollAsChild = await portalCall(b.context.request, "POST", "/enrollments", {
      ...newChildBody(setup, { firstName: "Mia", birthDate: bornYearsAgo(12) }),
      who: { kind: "child", clientId: sent.clientId },
    });
    expect(enrollAsChild.status).toBe(404);
    const bHome = await portalGet<PortalHomeDto>(b.context.request, "/home");
    expect(bHome.enrollments ?? []).toEqual([]);
    const context = await portalGet<EnrollmentContextDto>(
      b.context.request,
      `/enrollment-context?slug=${setup.slug}`,
    );
    expect(context.children.map((c) => c.clientId)).toEqual([other.id]);
    expect(context.requests).toEqual([]);
    // Still waitlisted: B's tries changed nothing.
    expect((await api.get<EnrollmentDetailDto>(`/enrollments/${sent.request.id}`)).status).toBe(
      "waitlisted",
    );
    // And no academy page means no enrollment context.
    expect(
      (await portalCall(b.context.request, "GET", "/enrollment-context?slug=no-such-academy"))
        .status,
    ).toBe(404);
  });
});
