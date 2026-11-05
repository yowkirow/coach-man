import type { APIRequestContext } from "@playwright/test";
import type {
  AnnouncementDto,
  AnnouncementListDto,
  GroupDto,
  PortalAnnouncementsDto,
  PortalHomeDto,
  TodayDto,
} from "../src/shared/api-types";
import {
  Api,
  addMember,
  BYPASS_HEADER,
  bornYearsAgo,
  bypassSecret,
  expect,
  linkFamily,
  onboard,
  type Personas,
  portalGet,
  submitSheet,
  test,
  testEmail,
  toggle,
  uuid,
  visit,
  watchErrors,
} from "./support";

// Announcements (WS5a): owners and admins write news for everyone, one program's members, or one
// event's players, now, later, or as a draft; families see only what reaches their students, in
// their academy, pinned first then newest; every staff role reads the live ones on Today. Service
// workers are blocked (see family.spec.ts).
test.use({ serviceWorkers: "block" });

/** `day` moved by `days` (YYYY-MM-DD). */
function shift(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The 5-minute cron's announcements step, on demand (test route); `id` is brought forward first. */
async function runCron(request: APIRequestContext, id?: string) {
  const res = await request.post("/api/test/run-announcements", {
    headers: { [BYPASS_HEADER]: bypassSecret() },
    data: id ? { id } : {},
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as {
    fired: string[];
    notifiedAt?: number | null;
    publishedAt?: number | null;
  };
}

/** The titles a family's Announcements list shows, in order. */
async function feed(request: APIRequestContext): Promise<string[]> {
  return (await portalGet<PortalAnnouncementsDto>(request, "/announcements")).items.map(
    (a) => a.title,
  );
}

/** A student, and a family member linked to them, signed in in their own browser. */
async function family(
  coach: { request: APIRequestContext; api: Api },
  personas: Personas,
  info: import("@playwright/test").TestInfo,
  student: { firstName: string; lastName: string; age: number },
  member: { name: string; relation: "guardian" | "self" },
) {
  const created = await coach.api.post<{ id: string }>("/clients", {
    firstName: student.firstName,
    lastName: student.lastName,
    birthDate: bornYearsAgo(student.age),
    isJunior: student.age < 18,
  });
  const email = testEmail(`news-${student.firstName.toLowerCase()}`, info);
  const linked = await linkFamily(coach.request, {
    clientId: created.id,
    email,
    name: member.name,
    relation: member.relation,
  });
  expect(linked.status).toBe(201);
  const session = await personas.open({ email, name: member.name, persona: "none" });
  return { clientId: created.id, ...session };
}

test.describe("announcements", () => {
  test("an admin writes to everyone, a program, or an event, and each family sees only theirs", async ({
    seeded,
    personas,
  }, info) => {
    test.slow();
    const { api, request } = seeded;
    const { date: today } = await api.get<TodayDto>("/today");
    const tag = uuid().slice(0, 6);
    const T = (s: string) => `${s} ${tag}`;
    const ALL = T("Courts closed on Saturday");
    const PROGRAM = T("Junior squad: bring water");
    const EVENT = T("Holiday camp packing list");
    const LATER = T("Registration opens Monday");
    const DRAFT = T("Draft: summer rates");

    // Mia trains in the Junior squad, Leo is registered for the Holiday camp, Ana is in neither.
    const squad = await api.post<GroupDto>("/groups", { name: T("Junior squad") });
    const camp = await api.post<{ id: string }>("/events", {
      kind: "camp",
      name: T("Holiday camp"),
      startsOn: shift(today, 10),
      endsOn: shift(today, 12),
      priceMinor: 150000,
    });
    const mia = await family(
      seeded,
      personas,
      info,
      { firstName: "Mia", lastName: "Santos", age: 10 },
      { name: "Pat Santos", relation: "guardian" },
    );
    await api.patch(`/clients/${mia.clientId}`, { groupIds: [squad.id] });
    const leo = await family(
      seeded,
      personas,
      info,
      { firstName: "Leo", lastName: "Cruz", age: 12 },
      { name: "Rey Cruz", relation: "guardian" },
    );
    await api.post(`/events/${camp.id}/registrations`, { clientId: leo.clientId });
    const ana = await family(
      seeded,
      personas,
      info,
      { firstName: "Ana", lastName: "Reyes", age: 30 },
      { name: "Ana Reyes", relation: "self" },
    );

    // An admin writes one for everyone (pinned), one for the program, and one for tomorrow.
    const adminEmail = testEmail("news-admin", info);
    await addMember(request, { email: adminEmail, name: "Alex Admin", role: "admin" });
    const admin = await personas.open({ email: adminEmail, name: "Alex Admin", persona: "none" });
    const ap = admin.page;
    const errors = watchErrors(ap);
    await visit(ap, "/announcements?new=1");
    let sheet = ap.getByRole("dialog", { name: "New announcement" });
    await sheet.getByLabel("Title", { exact: true }).fill(ALL);
    await sheet
      .getByLabel("Message")
      .fill("Courts 1 to 4 are being resurfaced.\n\nThe new schedule: https://example.com/courts.");
    await toggle(sheet.getByRole("switch", { name: /^Pin to the top/ }));
    await submitSheet(sheet, sheet.getByRole("button", { name: "Publish now" }));
    const allCard = ap.getByRole("article", { name: ALL });
    await expect(allCard).toContainText("Pinned");
    await expect(allCard).toContainText("For everyone");
    await expect(allCard.getByRole("link", { name: "https://example.com/courts" })).toHaveAttribute(
      "href",
      "https://example.com/courts",
    );

    await ap.getByRole("button", { name: "New announcement" }).first().click();
    sheet = ap.getByRole("dialog", { name: "New announcement" });
    await sheet.getByLabel("Title", { exact: true }).fill(PROGRAM);
    await sheet.getByLabel("Message").fill("Bring water and a towel to every session.");
    await toggle(sheet.getByRole("radio", { name: "Program", exact: true }));
    await sheet.getByRole("button", { name: /Program/ }).click();
    await ap.getByRole("option", { name: T("Junior squad") }).click();
    await submitSheet(sheet, sheet.getByRole("button", { name: "Publish now" }));
    await expect(ap.getByRole("article", { name: PROGRAM })).toContainText(
      `For the members of ${T("Junior squad")}`,
    );

    await ap.getByRole("button", { name: "New announcement" }).first().click();
    sheet = ap.getByRole("dialog", { name: "New announcement" });
    await sheet.getByLabel("Title", { exact: true }).fill(LATER);
    await sheet.getByLabel("Message").fill("Sign up for the next term from Monday morning.");
    await toggle(sheet.getByRole("radio", { name: "Schedule" }));
    await expect(sheet.getByLabel("Goes live on")).toHaveValue(shift(today, 1));
    await submitSheet(sheet, sheet.getByRole("button", { name: "Schedule", exact: true }));
    await ap
      .getByRole("navigation", { name: "Announcement lists" })
      .getByRole("button", { name: /^Scheduled/ })
      .click();
    await expect(ap.getByRole("article", { name: LATER })).toContainText("Goes live");
    expect(errors).toEqual([]);

    // One for the camp's players, and a draft.
    const event = await admin.api.post<AnnouncementDto>("/announcements", {
      title: EVENT,
      body: "Pack a hat, sunscreen, and two shirts.",
      audience: "event",
      audienceId: camp.id,
      publish: "now",
    });
    expect(event).toMatchObject({ state: "live", audienceName: T("Holiday camp") });
    expect(event.notifiedAt).not.toBeNull();
    const draft = await admin.api.post<AnnouncementDto>("/announcements", {
      title: DRAFT,
      body: "Not ready yet.",
      audience: "all",
      publish: "draft",
    });
    expect(draft).toMatchObject({ state: "draft", notifiedAt: null, publishedAt: null });

    // Each family sees what reaches their student: pinned first, then newest.
    expect(await feed(mia.context.request)).toEqual([ALL, PROGRAM]);
    expect(await feed(leo.context.request)).toEqual([ALL, EVENT]);
    expect(await feed(ana.context.request)).toEqual([ALL]);
    const home = await portalGet<PortalHomeDto>(leo.context.request, "/home");
    expect(home.announcements.map((a) => a.title)).toEqual([ALL, EVENT]);
    expect(home.announcements[1]).toMatchObject({
      audience: "event",
      audienceName: T("Holiday camp"),
      pinned: false,
    });
    for (const text of [JSON.stringify(home), JSON.stringify(await feed(ana.context.request))]) {
      expect(text).not.toContain(DRAFT);
      expect(text).not.toContain(LATER);
    }

    // On the family's pages: Home's card, then the full list.
    const w = mia.page;
    const familyErrors = watchErrors(w);
    await visit(w, "/my");
    const card = w.getByRole("region", { name: "Announcements" });
    await expect(card).toContainText(ALL);
    await expect(card).toContainText(PROGRAM);
    await expect(card).not.toContainText(EVENT);
    await card.getByRole("link", { name: "All announcements" }).click();
    await expect(w).toHaveURL(/\/my\/announcements$/);
    await expect(w.getByRole("heading", { name: "Announcements", level: 1 })).toBeVisible();
    const pinned = w.getByRole("article", { name: ALL });
    await expect(pinned).toContainText("Pinned");
    await expect(pinned.getByRole("link", { name: "https://example.com/courts" })).toBeVisible();
    await expect(w.getByRole("article", { name: PROGRAM })).toContainText(
      `For ${T("Junior squad")}`,
    );
    await expect(w.getByRole("article")).toHaveCount(2);
    expect(familyErrors).toEqual([]);

    // A coach reads the live ones (Today, and the list) and can't write, schedule, or remove.
    const coachEmail = testEmail("news-coach", info);
    await addMember(request, { email: coachEmail, name: "Casey Coach", role: "coach" });
    const coach = await personas.open({ email: coachEmail, name: "Casey Coach", persona: "none" });
    const live = await coach.api.get<AnnouncementListDto>("/announcements");
    expect(live.items.map((a) => a.title)).toEqual([ALL, EVENT, PROGRAM]);
    expect(live.counts).toMatchObject({ live: 3, draft: 0, scheduled: 0, expired: 0 });
    const body = { title: "Mine", body: "Hello", audience: "all", publish: "now" };
    for (const [method, path, data] of [
      ["GET", "/announcements?status=draft", undefined],
      ["GET", "/announcements?status=scheduled", undefined],
      ["GET", `/announcements/${event.id}`, undefined],
      ["POST", "/announcements", body],
      ["PATCH", `/announcements/${event.id}`, body],
      ["POST", `/announcements/${event.id}/unpublish`, {}],
      ["DELETE", `/announcements/${event.id}`, undefined],
    ] as const) {
      const res = await coach.api.raw(method, path, data);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(Api.code(res)).toBe("forbidden");
    }
    const c = coach.page;
    await visit(c, "/");
    const todayCard = c.getByRole("region", { name: "Announcements" });
    await expect(todayCard.getByRole("button").first()).toContainText(ALL);
    await todayCard.getByRole("button", { name: new RegExp(EVENT) }).click();
    await expect(c.getByRole("dialog", { name: EVENT })).toContainText("Pack a hat, sunscreen");
    await visit(c, "/announcements");
    await expect(c.getByRole("article", { name: ALL })).toBeVisible();
    await expect(c.getByRole("button", { name: "New announcement" })).toHaveCount(0);
    await expect(c.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });

  test("scheduled ones go live once, ended ones leave, unpublished and deleted ones disappear, and another academy's never show", async ({
    seeded,
    personas,
  }, info) => {
    test.slow();
    const { api, request } = seeded;
    const tag = uuid().slice(0, 6);
    const T = (s: string) => `${s} ${tag}`;
    const PINNED = T("Welcome back");
    const PLAIN = T("New balls on court 2");
    const LATER = T("Camp sign-ups open");
    const ENDING = T("Rain check today");
    const OTHER = T("Other academy news");
    const text = "Details at the front desk.";
    const mia = await family(
      seeded,
      personas,
      info,
      { firstName: "Mia", lastName: "Santos", age: 10 },
      { name: "Pat Santos", relation: "guardian" },
    );
    const fam = mia.context.request;

    // Scheduled for tomorrow: nobody sees it, and the cron leaves it until its time.
    const later = await api.post<AnnouncementDto>("/announcements", {
      title: LATER,
      body: text,
      audience: "all",
      publish: "schedule",
      publishAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    expect(later).toMatchObject({ state: "scheduled", notifiedAt: null });
    const pinned = await api.post<AnnouncementDto>("/announcements", {
      title: PINNED,
      body: text,
      audience: "all",
      pinned: true,
      publish: "now",
    });
    const plain = await api.post<AnnouncementDto>("/announcements", {
      title: PLAIN,
      body: text,
      audience: "all",
      publish: "now",
    });
    // Published now: the push hook ran at once.
    expect(pinned.notifiedAt).not.toBeNull();
    expect(plain.notifiedAt).not.toBeNull();
    expect(await feed(fam)).toEqual([PINNED, PLAIN]);
    expect((await runCron(request)).fired).toEqual([]);
    expect(await feed(fam)).toEqual([PINNED, PLAIN]);

    // Its time comes: the cron's step announces it, once.
    const ran = await runCron(request, later.id);
    expect(ran.notifiedAt).toEqual(expect.any(Number));
    const afterRun = await feed(fam);
    expect(afterRun[0]).toBe(PINNED);
    expect([...afterRun].sort()).toEqual([PINNED, LATER, PLAIN].sort());
    expect((await runCron(request)).fired).not.toContain(later.id);
    const live = await api.get<AnnouncementListDto>("/announcements");
    expect(live.items.find((a) => a.id === later.id)).toMatchObject({
      state: "live",
      notifiedAt: ran.notifiedAt,
    });

    // Unpublished: back to drafts and gone for families; published again, it isn't re-announced.
    const unpublished = await api.post<AnnouncementDto>(`/announcements/${plain.id}/unpublish`);
    expect(unpublished.state).toBe("draft");
    expect(await feed(fam)).toEqual([PINNED, LATER]);
    const drafts = await api.get<AnnouncementListDto>("/announcements?status=draft");
    expect(drafts.items.map((a) => a.id)).toContain(plain.id);
    const again = await api.patch<AnnouncementDto>(`/announcements/${plain.id}`, {
      title: PLAIN,
      body: text,
      audience: "all",
      publish: "now",
    });
    expect(again.state).toBe("live");
    expect(again.notifiedAt).toBe(plain.notifiedAt);
    expect(await feed(fam)).toEqual([PINNED, PLAIN, LATER]);

    // One that ends in a few seconds leaves when it does, and moves to Expired.
    const ending = await api.post<AnnouncementDto>("/announcements", {
      title: ENDING,
      body: text,
      audience: "all",
      publish: "now",
      expiresAt: Date.now() + 5000,
    });
    expect(await feed(fam)).toContain(ENDING);
    await expect
      .poll(() => feed(fam), { timeout: 30_000, intervals: [1000] })
      .not.toContain(ENDING);
    const expired = await api.get<AnnouncementListDto>("/announcements?status=expired");
    expect(expired.items.map((a) => a.id)).toEqual([ending.id]);

    // Deleted: gone for everyone.
    expect((await api.raw("DELETE", `/announcements/${pinned.id}`)).status).toBe(204);
    expect((await api.raw("GET", `/announcements/${pinned.id}`)).status).toBe(404);
    expect(await feed(fam)).toEqual([PLAIN, LATER]);

    // Another academy's news reaches its own families only.
    const owner = await personas.open({
      email: testEmail("news-other", info),
      name: "Lee Owner",
      persona: "coach",
    });
    await onboard(owner.api);
    await owner.api.post<AnnouncementDto>("/announcements", {
      title: OTHER,
      body: text,
      audience: "all",
      pinned: true,
      publish: "now",
    });
    const theirs = await family(
      { request: owner.context.request, api: owner.api },
      personas,
      info,
      { firstName: "Kai", lastName: "Lim", age: 11 },
      { name: "Jo Lim", relation: "guardian" },
    );
    expect(await feed(theirs.context.request)).toEqual([OTHER]);
    expect(await feed(fam)).toEqual([PLAIN, LATER]);
    const home = await portalGet<PortalHomeDto>(fam, "/home");
    expect(JSON.stringify(home)).not.toContain(OTHER);
  });
});
