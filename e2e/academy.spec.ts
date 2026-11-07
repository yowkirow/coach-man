import type { TestInfo } from "@playwright/test";
import type {
  AccountDto,
  ClientDetailDto,
  ClientListItemDto,
  EventDto,
  FamilyInviteCreatedDto,
  GroupDto,
  LessonDetailDto,
  MeDto,
  TodayDto,
} from "../src/shared/api-types";
import {
  addMember,
  BYPASS_HEADER,
  bornYearsAgo,
  bypassSecret,
  type Coach,
  expect,
  inviteToken,
  linkFamily,
  type Personas,
  signIn,
  test,
  testEmail,
  uuid,
  visit,
  watchErrors,
} from "./support";

// Academies: staff roles (owner, admin, coach), money only for owner and admin, and where people
// land after sign-in (staff app, family portal, or /welcome).

/** Any money field in a JSON payload: an amount in minor units, `"…Minor": <number|null>`. */
const MONEY_FIELD = /"[A-Za-z]+Minor":\s*(-?\d|null)/;

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * A coach-role member of the seeded academy, signed in in their own browser context, with a
 * collector for page errors, console errors, and failed requests (a 403 from a money route the
 * coach's screens shouldn't call, say), and a check that the current screen shows no money.
 */
async function coachScreens(seeded: Coach, personas: Personas, info: TestInfo) {
  const email = testEmail("coach-ui", info);
  await addMember(seeded.request, { email, name: "Sam Rivera", role: "coach" });
  const { page, api } = await personas.open({ email, name: "Sam Rivera", persona: "none" });
  const errors = watchErrors(page);
  const noMoneyOnScreen = async (where: string) => {
    await page.waitForLoadState("networkidle");
    const text = await page.locator("body").innerText();
    expect(text, where).not.toContain("₱");
    expect(text, where).not.toContain("NaN");
    expect(text, where).not.toMatch(/owe money|balances due|record payment|sell a package/i);
  };
  return { page, api, errors, noMoneyOnScreen };
}

test.describe("a coach in an academy", () => {
  test("gets 403 from money routes and no money in anything they read", async ({
    seeded,
    personas,
  }, info) => {
    const email = testEmail("coach-api", info);
    await addMember(seeded.request, { email, name: "Sam Rivera", role: "coach" });
    const { api } = await personas.open({ email, name: "Sam Rivera", persona: "none" });

    const me = await api.get<MeDto>("/me");
    expect(me.role).toBe("coach");
    expect(Object.values(me.can).some(Boolean)).toBe(false);

    const clients = await api.get<ClientListItemDto[]>("/clients");
    const clientId = clients[0]?.id;
    if (!clientId) throw new Error("The sample academy has no clients");
    const today = await api.get<TodayDto>("/today");
    const date = today.date;

    const denied: [Method, string, unknown?][] = [
      ["GET", "/money/summary"],
      ["GET", "/money/balances"],
      ["GET", `/payments?from=${date}&to=${date}`],
      ["GET", `/charges?from=${date}&to=${date}`],
      ["GET", `/clients/${clientId}/statement`],
      ["POST", "/payments", { clientId, amountMinor: 1000, method: "Cash", paidOn: date }],
      [
        "POST",
        "/charges",
        { clientId, kind: "other", description: "Ball fee", amountMinor: 500, occurredOn: date },
      ],
      [
        "POST",
        `/clients/${clientId}/packages`,
        { custom: { name: "Coach deal", credits: 3, lessonKinds: [] }, priceMinor: 100 },
      ],
      [
        "POST",
        "/rates",
        { name: "Cheap", kind: "private", durationMinutes: 60, priceMinor: 1, unit: "session" },
      ],
      ["POST", "/packages", { name: "Cheap pack", credits: 5, priceMinor: 1 }],
      ["POST", "/groups", { name: "My own group" }],
      [
        "POST",
        "/events",
        { kind: "clinic", name: "Pop-up", startsOn: date, endsOn: date, priceMinor: 0 },
      ],
      ["PATCH", "/workspace", { name: "Taken over" }],
      ["POST", "/venues", { name: "Back court" }],
      ["GET", "/export/clients.csv"],
      ["DELETE", `/clients/${clientId}`],
    ];
    for (const [method, path, body] of denied) {
      const res = await api.raw(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }

    expect(today.alerts.balancesDue).toEqual([]);
    const events = await api.get<EventDto[]>("/events?scope=all");
    const groups = await api.get<GroupDto[]>("/groups");
    const reads = [
      "/today",
      "/clients",
      `/clients/${clientId}`,
      "/events?scope=all",
      "/rates",
      "/packages",
      "/offline-pack",
      "/me",
      ...(events[0] ? [`/events/${events[0].id}`] : []),
      ...(groups[0] ? [`/groups/${groups[0].id}`] : []),
      ...(today.lessons[0] ? [`/lessons/${today.lessons[0].id}`] : []),
    ];
    for (const path of reads) {
      const res = await api.raw("GET", path);
      expect(res.status, path).toBe(200);
      expect(res.text, path).not.toMatch(MONEY_FIELD);
    }
  });

  test("runs sessions at catalog prices but can't set a price", async ({
    seeded,
    personas,
  }, info) => {
    const email = testEmail("coach-court", info);
    await addMember(seeded.request, { email, name: "Sam Rivera", role: "coach" });
    const { api } = await personas.open({ email, name: "Sam Rivera", persona: "none" });
    const { date } = await api.get<TodayDto>("/today");

    const added = await api.post<{ id: string }>("/clients", {
      firstName: "Kai",
      lastName: "Mendoza",
    });
    const session = { kind: "private", date, startTime: "06:00", durationMinutes: 60 };
    const priced = await api.raw("POST", "/lessons", { ...session, priceMinor: 50000 });
    expect(priced.status).toBe(403);

    const created = await api.raw("POST", "/lessons", { ...session, clientIds: [added.id] });
    expect(created.status).toBe(201);
    expect(created.text).not.toMatch(MONEY_FIELD);
    const lesson = (created.json as { lesson: LessonDetailDto }).lesson;
    const entry = lesson.roster[0];
    if (!entry) throw new Error("No roster entry");

    const checkIn = await api.raw("POST", `/attendance/${entry.attendanceId}`, {
      status: "present",
      mutationId: uuid(),
    });
    expect(checkIn.status).toBe(200);
    expect(checkIn.text).not.toMatch(MONEY_FIELD);
    const waived = await api.raw("POST", `/attendance/${entry.attendanceId}`, {
      status: "present",
      complimentary: true,
      mutationId: uuid(),
    });
    expect(waived.status).toBe(403);
    expect(
      (await api.raw("PATCH", `/lessons/${lesson.lesson.id}`, { priceMinor: 100 })).status,
    ).toBe(403);
    expect((await api.raw("PATCH", `/lessons/${lesson.lesson.id}`, { court: "4" })).status).toBe(
      200,
    );

    // The owner sees the money behind the same records.
    const owner = await seeded.api.get<ClientDetailDto>(`/clients/${added.id}`);
    expect(typeof owner.client.balanceMinor).toBe("number");
  });

  test("sees no money on Today, Clients, a profile, the Schedule, or a session", async ({
    seeded,
    personas,
  }, info) => {
    const { page, api, errors, noMoneyOnScreen } = await coachScreens(seeded, personas, info);
    const clients = await api.get<ClientListItemDto[]>("/clients");
    const today = await api.get<TodayDto>("/today");

    await visit(page, "/");
    await expect(page.getByRole("heading", { name: "Today", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Money", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Packages & rates" })).toHaveCount(0);
    await noMoneyOnScreen("Today");

    await visit(page, "/clients");
    await expect(page.getByRole("heading", { name: "Clients" }).first()).toBeVisible();
    await noMoneyOnScreen("Clients");

    const client = clients[0];
    if (!client) throw new Error("No clients");
    await visit(page, `/clients/${client.id}`);
    await expect(page.getByRole("heading", { name: client.firstName }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Progress" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Money" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sell a package" })).toHaveCount(0);
    await noMoneyOnScreen("Client profile");

    await visit(page, "/schedule");
    await expect(page.getByRole("heading", { name: "Schedule" }).first()).toBeVisible();
    await noMoneyOnScreen("Schedule");

    const lesson = today.lessons[0];
    if (lesson) {
      await visit(page, `/sessions/${lesson.id}`);
      await expect(page.getByRole("heading", { name: lesson.title }).first()).toBeVisible();
      await expect(page.getByText("Price per player")).toHaveCount(0);
      await noMoneyOnScreen("Session");
    }

    expect(errors).toEqual([]);
  });

  test("sees no money on Groups or Events, and no academy settings", async ({
    seeded,
    personas,
  }, info) => {
    const { page, api, errors, noMoneyOnScreen } = await coachScreens(seeded, personas, info);
    const groups = await api.get<GroupDto[]>("/groups");
    const events = await api.get<EventDto[]>("/events?scope=all");

    await visit(page, "/groups");
    await expect(page.getByRole("heading", { name: "Groups" }).first()).toBeVisible();
    const group = groups[0];
    if (group) {
      await visit(page, `/groups/${group.id}`);
      await expect(page.getByRole("heading", { name: group.name }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit group" })).toHaveCount(0);
      await noMoneyOnScreen("Group");
    }

    await visit(page, "/events?scope=all");
    await expect(page.getByRole("heading", { name: "Events" }).first()).toBeVisible();
    await noMoneyOnScreen("Events");
    const event = events[0];
    if (event) {
      await visit(page, `/events/${event.id}`);
      await expect(page.getByRole("heading", { name: event.name }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit event" })).toHaveCount(0);
      await noMoneyOnScreen("Event");
    }

    // An old link to Money explains instead of failing.
    await visit(page, "/money");
    await expect(
      page.getByRole("heading", { name: "Your academy's owner and admins handle this" }),
    ).toBeVisible();

    await visit(page, "/settings");
    await expect(page.getByRole("heading", { name: "Sign-in & security" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payment methods" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Export your data" })).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
test.describe("owners and admins", () => {
  test("keep money in the API and in the app", async ({ page, seeded, personas }, info) => {
    const email = testEmail("admin", info);
    await addMember(seeded.request, { email, name: "Alex Admin", role: "admin" });
    const admin = await personas.open({ email, name: "Alex Admin", persona: "none" });

    const me = await admin.api.get<MeDto>("/me");
    expect(me.role).toBe("admin");
    expect(me.can.money).toBe(true);
    expect(me.can.ownership).toBe(false);
    expect((await admin.api.raw("GET", "/money/summary")).status).toBe(200);
    expect((await admin.api.raw("GET", "/clients")).text).toMatch(MONEY_FIELD);

    const owner = await seeded.api.get<MeDto>("/me");
    expect(owner.role).toBe("owner");
    expect(Object.values(owner.can).every(Boolean)).toBe(true);

    await visit(page, "/");
    await expect(page.getByRole("link", { name: "Money", exact: true }).first()).toBeVisible();
    await visit(admin.page, "/money");
    await expect(admin.page.getByRole("heading", { name: "Money" }).first()).toBeVisible();
    await expect(admin.page.getByRole("button", { name: "Record payment" }).first()).toBeVisible();
  });

  test("staff of two academies switch between them", async ({ seeded, personas }, info) => {
    const email = testEmail("two-hats", info);
    // Their own workspace first (persona "coach" provisions one), then a coach seat at the academy.
    const own = await personas.open({ email, name: "Robin Two", persona: "coach" });
    const ownMe = await own.api.get<MeDto>("/me");
    expect(ownMe.role).toBe("owner");
    const { workspaceId: academyId } = await addMember(seeded.request, {
      email,
      name: "Robin Two",
      role: "coach",
    });

    const accountRes = await own.context.request.get("/api/account");
    const account = (await accountRes.json()) as AccountDto;
    expect(account.staff.map((s) => s.workspaceId).sort()).toEqual(
      [ownMe.workspace.id, academyId].sort(),
    );
    expect(account.activeWorkspaceId).toBe(ownMe.workspace.id);

    const switched = await own.context.request.post("/api/account/active-workspace", {
      data: { workspaceId: academyId },
    });
    expect(switched.ok(), await switched.text()).toBe(true);
    const there = await own.api.get<MeDto>("/me");
    expect(there.workspace.id).toBe(academyId);
    expect(there.role).toBe("coach");

    const elsewhere = await own.context.request.post("/api/account/active-workspace", {
      data: { workspaceId: uuid() },
    });
    expect(elsewhere.status()).toBe(403);
  });

  test("export a full backup: the academy's records too, never an invite link's secret", async ({
    seeded,
  }, info) => {
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Ana",
      lastName: "Reyes",
      birthDate: bornYearsAgo(10),
      isJunior: true,
    });
    const linked = await linkFamily(seeded.request, {
      clientId: kid.id,
      email: testEmail("export-parent", info),
      name: "Pia Reyes",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);
    const invite = await seeded.api.post<FamilyInviteCreatedDto>(
      `/clients/${kid.id}/family/invites`,
      { relation: "guardian" },
    );

    const res = await seeded.api.raw("GET", "/export/workspace.json");
    expect(res.status, res.text).toBe(200);
    const backup = res.json as Record<string, unknown>;
    expect(backup.format).toBe("coachman-export-v1");
    expect(backup.academy).toEqual({ name: expect.any(String), slug: expect.any(String) });
    for (const key of [
      "clients",
      "lessons",
      "payments",
      "academyProfile",
      "academyPhotos",
      "coachProfiles",
      "teamPeople",
      "studentCoaches",
      "familyAccess",
      "enrollmentRequests",
      "paymentProofs",
      "consentDocuments",
      "consentDocumentVersions",
      "consentSignatures",
      "pickupPeople",
      "announcements",
      "auditLog",
    ]) {
      expect(Array.isArray(backup[key]), key).toBe(true);
    }
    expect((backup.familyAccess as { clientId: string }[]).map((a) => a.clientId)).toContain(
      kid.id,
    );
    // Invite links stay out: a backup file must never be a way in.
    expect(Object.keys(backup).filter((k) => /invite/i.test(k))).toEqual([]);
    expect(res.text).not.toContain("tokenHash");
    expect(res.text).not.toContain(inviteToken(invite.link));
  });
});

test.describe("signing in without an academy", () => {
  test("a new account lands on /welcome and can set up its own workspace", async ({
    personas,
  }, info) => {
    const { page } = await personas.open({
      email: testEmail("newcomer", info),
      name: "Jordan Lake",
      persona: "none",
    });
    await visit(page, "/");
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole("heading", { name: "Welcome, Jordan" })).toBeVisible();

    await page.getByRole("button", { name: /I'm a student or a parent/ }).click();
    await expect(page.getByText(/Open the invite link your academy sent you/)).toBeVisible();

    await page.getByRole("button", { name: /Set up CoachMan for my coaching or academy/ }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole("heading", { name: "Set up your academy" })).toBeVisible();
    await page.getByLabel("Academy name").fill("Jordan's coaching");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Add a passkey" })).toBeVisible();
  });

  test("the staff API says so, and setting up is idempotent", async ({ personas }, info) => {
    const { api, context } = await personas.open({
      email: testEmail("bare", info),
      name: "Jordan Lake",
      persona: "none",
    });
    const me = await api.raw("GET", "/me");
    expect(me.status).toBe(403);
    expect((me.json as { error: { code: string } }).error.code).toBe("no_workspace");

    const first = await context.request.post("/api/account/workspaces");
    expect(first.status()).toBe(201);
    const second = await context.request.post("/api/account/workspaces");
    expect(second.status()).toBe(200);
    const a = (await first.json()) as { workspaceId: string };
    const b = (await second.json()) as { workspaceId: string };
    expect(b.workspaceId).toBe(a.workspaceId);
    expect((await api.get<MeDto>("/me")).role).toBe("owner");
  });

  test("a parent linked to a student lands on their family page", async ({
    seeded,
    personas,
  }, info) => {
    const birthYear = new Date().getFullYear() - 10;
    const kid = await seeded.api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: `${birthYear}-04-02`,
      isJunior: true,
    });
    // Under 13: no login of their own, whoever asks.
    const own = await linkFamily(seeded.request, {
      clientId: kid.id,
      email: testEmail("kid", info),
      name: "Mia Santos",
      relation: "self",
    });
    expect(own.status).toBe(409);

    const email = testEmail("parent", info);
    const linked = await linkFamily(seeded.request, {
      clientId: kid.id,
      email,
      name: "Pat Santos",
      relation: "guardian",
    });
    expect(linked.status).toBe(201);

    const parent = await personas.open({ email, name: "Pat Santos", persona: "none" });
    const me = await parent.api.raw("GET", "/me");
    expect(me.status).toBe(403);
    const account = (await (await parent.context.request.get("/api/account")).json()) as AccountDto;
    expect(account.staff).toEqual([]);
    expect(account.family[0]?.students).toEqual([
      { clientId: kid.id, firstName: "Mia", lastName: "Santos", relation: "guardian" },
    ]);

    const errors = watchErrors(parent.page);
    await visit(parent.page, "/my");
    await expect(parent.page.getByRole("heading", { name: "Hi, Pat" })).toBeVisible();
    await expect(parent.page.getByText("Mia Santos")).toBeVisible();
    expect(errors).toEqual([]);

    // Wherever they start, they end up on their family page.
    await visit(parent.page, "/welcome");
    await expect(parent.page).toHaveURL(/\/my\/?$/);
    await visit(parent.page, "/");
    await expect(parent.page).toHaveURL(/\/my\/?$/);
    await expect(parent.page.getByText("Mia Santos")).toBeVisible();
  });
});

test.describe("auth surface", () => {
  test("the organization plugin's own endpoints stay closed", async ({ request }, info) => {
    await signIn(request, { email: testEmail("org", info), name: "Org Probe" });
    expect((await request.get("/api/auth/organization/list")).status()).toBe(404);
    const create = await request.post("/api/auth/organization/create", {
      data: { name: "Side academy", slug: `side-${uuid().slice(0, 8)}` },
    });
    expect(create.status()).toBe(404);
    await request
      .post("/api/test/reset", { headers: { [BYPASS_HEADER]: bypassSecret() } })
      .catch(() => undefined);
  });
});
