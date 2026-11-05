import type { APIRequestContext, TestInfo } from "@playwright/test";
import type {
  AnnouncementDto,
  ApiErrorBody,
  ConsentDocumentDto,
  FamilyAccessDto,
  FamilyInviteCreatedDto,
  LessonDetailDto,
  MeDto,
  StaffInviteCreatedDto,
  TodayDto,
} from "../src/shared/api-types";
import { type Capability, can, type StaffRole } from "../src/shared/roles";
import {
  Api,
  addMember,
  bornYearsAgo,
  type Coach,
  expect,
  linkFamily,
  onboard,
  pngImage,
  test,
  testEmail,
  uuid,
} from "./support";

// Who can do what, at the API (plan: "Who can do what"; spec §3). Every staff route that needs a
// capability is probed by every role: roles without it get 403 `forbidden` naming the capability
// they lack, roles with it get through (whatever the route then answers), and everything that
// isn't a capability stays open to coaches. Families and signed-out visitors have no staff API at
// all. One table drives every check, so a route added later is one line here.

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface Probe {
  /** The capability the route needs. */
  cap: Capability;
  /** A capability checked before `cap` (e.g. ownership changes go through `team` routes). */
  gate?: Capability;
  /** Refused by the team rules without naming a capability (they answer 403 `forbidden` alone). */
  plainRefusal?: boolean;
  name: string;
  method: Method;
  path: string;
  body?: unknown;
  /** Sends a small PNG as the body (image uploads). */
  image?: boolean;
}

interface Open {
  name: string;
  method: Method;
  path: string;
  body?: unknown;
}

/** Any money field in a JSON payload: an amount in minor units, `"…Minor": <number|null>`. */
const MONEY_FIELD = /"[A-Za-z]+Minor":\s*(-?\d|null)/;

/** An academy with one of everything a probe can point at, owned by the `coach` fixture. */
async function academyWithEverything(owner: Coach, info: TestInfo) {
  const { api, request } = owner;
  await onboard(api);
  const me = await api.get<MeDto>("/me");
  const { date: today } = await api.get<TodayDto>("/today");
  const venue = await api.post<{ id: string }>("/venues", { name: "Probe courts" });
  const rate = await api.post<{ id: string }>("/rates", {
    name: "Probe private",
    kind: "private",
    durationMinutes: 60,
    priceMinor: 50000,
    unit: "session",
  });
  const tier = await api.post<{ id: string }>("/packages", {
    name: "Probe pack",
    credits: 5,
    priceMinor: 250000,
    validityDays: 60,
  });
  const group = await api.post<{ id: string }>("/groups", { name: "Probe program" });
  const event = await api.post<{ id: string }>("/events", {
    kind: "clinic",
    name: "Probe clinic",
    startsOn: today,
    endsOn: today,
    priceMinor: 100000,
  });
  const student = await api.post<{ id: string }>("/clients", {
    firstName: "Mia",
    lastName: "Probe",
    birthDate: bornYearsAgo(10),
    isJunior: true,
  });
  const sold = await api.post<{ id: string }>(`/clients/${student.id}/packages`, {
    packageId: tier.id,
  });
  const paymentId = uuid();
  await api.post("/payments", {
    id: paymentId,
    clientId: student.id,
    amountMinor: 1000,
    method: "Cash",
    paidOn: today,
  });
  const chargeId = uuid();
  await api.post("/charges", {
    id: chargeId,
    clientId: student.id,
    kind: "other",
    description: "Ball fee",
    amountMinor: 500,
    occurredOn: today,
  });
  const created = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
    kind: "private",
    date: today,
    startTime: "06:00",
    durationMinutes: 60,
    clientIds: [student.id],
  });
  const attendanceId = created.lesson.roster[0]?.attendanceId ?? "";
  const consent = await api.post<ConsentDocumentDto>("/consent-documents", {
    kind: "other",
    title: "Court rules",
    body: "Be kind on court.",
  });
  const news = await api.post<AnnouncementDto>("/announcements", {
    title: "Probe news",
    body: "Hello, everyone.",
    audience: "all",
    publish: "draft",
  });
  const skills = await api.get<{ id: string }[]>("/skills");
  const staffInvite = await api.post<StaffInviteCreatedDto>("/team/invites", {
    email: testEmail("probe-invitee", info),
    role: "coach",
  });
  const familyInvite = await api.post<FamilyInviteCreatedDto>(
    `/clients/${student.id}/family/invites`,
    { relation: "guardian" },
  );
  const parentEmail = testEmail("probe-parent", info);
  const linked = await linkFamily(request, {
    clientId: student.id,
    email: parentEmail,
    name: "Pat Probe",
    relation: "guardian",
  });
  expect(linked.status).toBe(201);
  const access = await api.get<FamilyAccessDto>(`/clients/${student.id}/family`);
  // Two spare coaches: one an admin removes (team), one the owner promotes last (ownership).
  const spareA = await addMember(request, {
    email: testEmail("spare-a", info),
    name: "Spare Coach A",
    role: "coach",
  });
  const spareB = await addMember(request, {
    email: testEmail("spare-b", info),
    name: "Spare Coach B",
    role: "coach",
  });
  return {
    ownerId: me.user.id,
    today,
    venueId: venue.id,
    rateId: rate.id,
    tierId: tier.id,
    groupId: group.id,
    eventId: event.id,
    studentId: student.id,
    clientPackageId: sold.id,
    paymentId,
    chargeId,
    lessonId: created.lesson.lesson.id,
    attendanceId,
    consentId: consent.id,
    consentVersion: consent.version,
    announcementId: news.id,
    skillIds: skills.map((s) => s.id),
    staffInviteId: staffInvite.invite.id,
    familyInviteId: familyInvite.invite.id,
    accessId: access.links[0]?.id ?? "",
    parentEmail,
    spareA: spareA.userId,
    spareB: spareB.userId,
  };
}

type World = Awaited<ReturnType<typeof academyWithEverything>>;

/**
 * Every capability-gated staff route, grouped by capability, ownership first (its probes leave
 * the team as it was until the very last one). `self` is the user id of whoever probes.
 */
function capabilityProbes(w: World, self: string): Probe[] {
  const s = w.studentId;
  const announcement = {
    title: "Probe news, edited",
    body: "Hello again.",
    audience: "all",
    publish: "draft",
  };
  return [
    // ownership: delete academy isn't built; transferring and changing owners is.
    {
      cap: "ownership",
      name: "POST /team/transfer-ownership",
      method: "POST",
      path: "/team/transfer-ownership",
      body: { userId: w.ownerId },
    },
    {
      cap: "ownership",
      gate: "team",
      plainRefusal: true,
      name: "PATCH /team/members/:owner (demote an owner)",
      method: "PATCH",
      path: `/team/members/${w.ownerId}`,
      body: { role: "admin" },
    },
    {
      cap: "ownership",
      gate: "team",
      plainRefusal: true,
      name: "DELETE /team/members/:owner (remove an owner)",
      method: "DELETE",
      path: `/team/members/${w.ownerId}`,
    },
    {
      cap: "ownership",
      gate: "team",
      plainRefusal: true,
      name: "PATCH /team/members/:coach (make an owner)",
      method: "PATCH",
      path: `/team/members/${w.spareB}`,
      body: { role: "owner" },
    },
    // team
    {
      cap: "team",
      name: "POST /team/invites",
      method: "POST",
      path: "/team/invites",
      body: { email: `probe-${uuid().slice(0, 8)}@coachman.test`, role: "coach" },
    },
    {
      cap: "team",
      name: "DELETE /team/invites/:id",
      method: "DELETE",
      path: `/team/invites/${w.staffInviteId}`,
    },
    {
      cap: "team",
      name: "PATCH /team/members/:coach (change a role)",
      method: "PATCH",
      path: `/team/members/${w.spareA}`,
      body: { role: "admin" },
    },
    {
      cap: "team",
      name: "GET /coaches/:other (someone else's profile)",
      method: "GET",
      path: `/coaches/${w.ownerId}`,
    },
    {
      cap: "team",
      name: "PATCH /coaches/:other",
      method: "PATCH",
      path: `/coaches/${w.ownerId}`,
      body: { title: "Head of everything" },
    },
    {
      cap: "team",
      name: "PUT /coaches/:other/photo",
      method: "PUT",
      path: `/coaches/${w.ownerId}/photo`,
      image: true,
    },
    {
      cap: "team",
      name: "DELETE /coaches/:other/photo",
      method: "DELETE",
      path: `/coaches/${w.ownerId}/photo`,
    },
    {
      cap: "team",
      name: "PATCH /coaches/:self { sortOrder } (the page's order)",
      method: "PATCH",
      path: `/coaches/${self}`,
      body: { sortOrder: 5 },
    },
    {
      cap: "team",
      name: "DELETE /team/members/:coach (remove someone)",
      method: "DELETE",
      path: `/team/members/${w.spareA}`,
    },
    // money
    { cap: "money", name: "GET /money/summary", method: "GET", path: "/money/summary" },
    { cap: "money", name: "GET /money/balances", method: "GET", path: "/money/balances" },
    {
      cap: "money",
      name: "GET /clients/:id/statement",
      method: "GET",
      path: `/clients/${s}/statement`,
    },
    {
      cap: "money",
      name: "GET /payments",
      method: "GET",
      path: `/payments?from=${w.today}&to=${w.today}`,
    },
    {
      cap: "money",
      name: "POST /payments",
      method: "POST",
      path: "/payments",
      body: { clientId: s, amountMinor: 1000, method: "Cash", paidOn: w.today },
    },
    {
      cap: "money",
      name: "POST /payments/:id/void",
      method: "POST",
      path: `/payments/${w.paymentId}/void`,
      body: { reason: "Probe" },
    },
    {
      cap: "money",
      name: "GET /charges",
      method: "GET",
      path: `/charges?from=${w.today}&to=${w.today}`,
    },
    {
      cap: "money",
      name: "POST /charges",
      method: "POST",
      path: "/charges",
      body: {
        clientId: s,
        kind: "other",
        description: "Probe fee",
        amountMinor: 500,
        occurredOn: w.today,
      },
    },
    {
      cap: "money",
      name: "POST /charges/:id/void",
      method: "POST",
      path: `/charges/${w.chargeId}/void`,
      body: { reason: "Probe" },
    },
    {
      cap: "money",
      name: "POST /clients/:id/packages (sell)",
      method: "POST",
      path: `/clients/${s}/packages`,
      body: { packageId: w.tierId },
    },
    {
      cap: "money",
      name: "PATCH /client-packages/:id",
      method: "PATCH",
      path: `/client-packages/${w.clientPackageId}`,
      body: { notes: "Probe" },
    },
    {
      cap: "money",
      name: "POST /client-packages/:id/adjust",
      method: "POST",
      path: `/client-packages/${w.clientPackageId}/adjust`,
      body: { delta: 1, note: "Probe" },
    },
    {
      cap: "money",
      name: "POST /lessons with a price",
      method: "POST",
      path: "/lessons",
      body: {
        kind: "private",
        date: w.today,
        startTime: "07:00",
        durationMinutes: 60,
        priceMinor: 50000,
      },
    },
    {
      cap: "money",
      name: "PATCH /lessons/:id { priceMinor }",
      method: "PATCH",
      path: `/lessons/${w.lessonId}`,
      body: { priceMinor: 100 },
    },
    {
      cap: "money",
      name: "POST /events/:id/registrations at another price",
      method: "POST",
      path: `/events/${w.eventId}/registrations`,
      body: { clientId: s, priceMinor: 0 },
    },
    {
      cap: "money",
      name: "POST /attendance/:id { complimentary }",
      method: "POST",
      path: `/attendance/${w.attendanceId}`,
      body: { status: "present", complimentary: true, mutationId: uuid() },
    },
    // catalog
    {
      cap: "catalog",
      name: "POST /rates",
      method: "POST",
      path: "/rates",
      body: {
        name: "Cheap",
        kind: "private",
        durationMinutes: 60,
        priceMinor: 1,
        unit: "session",
      },
    },
    {
      cap: "catalog",
      name: "PATCH /rates/:id",
      method: "PATCH",
      path: `/rates/${w.rateId}`,
      body: { name: "Renamed rate" },
    },
    {
      cap: "catalog",
      name: "POST /packages",
      method: "POST",
      path: "/packages",
      body: { name: "Cheap pack", credits: 5, priceMinor: 1 },
    },
    {
      cap: "catalog",
      name: "PATCH /packages/:id",
      method: "PATCH",
      path: `/packages/${w.tierId}`,
      body: { isPublic: true },
    },
    {
      cap: "catalog",
      name: "POST /packages/reorder",
      method: "POST",
      path: "/packages/reorder",
      body: { ids: [w.tierId] },
    },
    {
      cap: "catalog",
      name: "POST /groups",
      method: "POST",
      path: "/groups",
      body: { name: "My own group" },
    },
    {
      cap: "catalog",
      name: "PATCH /groups/:id",
      method: "PATCH",
      path: `/groups/${w.groupId}`,
      body: { isPublic: true },
    },
    {
      cap: "catalog",
      name: "POST /groups/reorder",
      method: "POST",
      path: "/groups/reorder",
      body: { ids: [w.groupId] },
    },
    {
      cap: "catalog",
      name: "POST /events",
      method: "POST",
      path: "/events",
      body: { kind: "clinic", name: "Pop-up", startsOn: w.today, endsOn: w.today, priceMinor: 0 },
    },
    {
      cap: "catalog",
      name: "PATCH /events/:id",
      method: "PATCH",
      path: `/events/${w.eventId}`,
      body: { name: "Renamed clinic" },
    },
    {
      cap: "catalog",
      name: "POST /groups/:id/archive",
      method: "POST",
      path: `/groups/${w.groupId}/archive`,
    },
    // settings
    {
      cap: "settings",
      name: "PATCH /academy",
      method: "PATCH",
      path: "/academy",
      body: { tagline: "Taken over" },
    },
    {
      cap: "settings",
      name: "GET /academy/public-preview",
      method: "GET",
      path: "/academy/public-preview",
    },
    {
      cap: "settings",
      name: "PUT /academy/logo",
      method: "PUT",
      path: "/academy/logo",
      image: true,
    },
    { cap: "settings", name: "DELETE /academy/logo", method: "DELETE", path: "/academy/logo" },
    {
      cap: "settings",
      name: "PUT /academy/payment-qr",
      method: "PUT",
      path: "/academy/payment-qr",
      image: true,
    },
    {
      cap: "settings",
      name: "DELETE /academy/payment-qr",
      method: "DELETE",
      path: "/academy/payment-qr",
    },
    {
      cap: "settings",
      name: "PATCH /workspace",
      method: "PATCH",
      path: "/workspace",
      body: { paymentMethods: ["Cash", "GCash"] },
    },
    {
      cap: "settings",
      name: "POST /workspace/onboard",
      method: "POST",
      path: "/workspace/onboard",
      body: { name: "E2E Coaching", currency: "PHP", timezone: "Asia/Manila", locale: "en-PH" },
    },
    {
      cap: "settings",
      name: "POST /venues",
      method: "POST",
      path: "/venues",
      body: { name: "Back court" },
    },
    {
      cap: "settings",
      name: "PATCH /venues/:id",
      method: "PATCH",
      path: `/venues/${w.venueId}`,
      body: { name: "Front court" },
    },
    {
      cap: "settings",
      name: "POST /skills",
      method: "POST",
      path: "/skills",
      body: { category: "Serve", name: "Probe skill" },
    },
    {
      cap: "settings",
      name: "PATCH /skills/:id",
      method: "PATCH",
      path: `/skills/${w.skillIds[0]}`,
      body: { description: "Probe" },
    },
    {
      cap: "settings",
      name: "POST /skills/reorder",
      method: "POST",
      path: "/skills/reorder",
      body: { ids: w.skillIds },
    },
    {
      cap: "settings",
      name: "GET /consent-documents",
      method: "GET",
      path: "/consent-documents",
    },
    {
      cap: "settings",
      name: "POST /consent-documents",
      method: "POST",
      path: "/consent-documents",
      body: { kind: "other", title: "My own rules", body: "Mine." },
    },
    {
      cap: "settings",
      name: "POST /consent-documents/templates",
      method: "POST",
      path: "/consent-documents/templates",
      body: { kind: "waiver" },
    },
    {
      cap: "settings",
      name: "PATCH /consent-documents/:id",
      method: "PATCH",
      path: `/consent-documents/${w.consentId}`,
      body: { title: "Court rules, edited" },
    },
    {
      cap: "settings",
      name: "DELETE /consent-documents/:id",
      method: "DELETE",
      path: `/consent-documents/${w.consentId}`,
    },
    {
      cap: "settings",
      name: "DELETE /venues/:id",
      method: "DELETE",
      path: `/venues/${w.venueId}`,
    },
    // enrollment (the inbox and payment-proof review)
    { cap: "enrollment", name: "GET /enrollments", method: "GET", path: "/enrollments" },
    {
      cap: "enrollment",
      name: "GET /enrollments?status=all",
      method: "GET",
      path: "/enrollments?status=all",
    },
    {
      cap: "enrollment",
      name: "GET /enrollments/count",
      method: "GET",
      path: "/enrollments/count",
    },
    {
      cap: "enrollment",
      name: "GET /enrollments/renewals",
      method: "GET",
      path: "/enrollments/renewals",
    },
    {
      cap: "enrollment",
      name: "GET /enrollments/:id",
      method: "GET",
      path: `/enrollments/${uuid()}`,
    },
    {
      cap: "enrollment",
      name: "POST /enrollments/:id/approve",
      method: "POST",
      path: `/enrollments/${uuid()}/approve`,
      body: {},
    },
    {
      cap: "enrollment",
      name: "POST /enrollments/:id/waitlist",
      method: "POST",
      path: `/enrollments/${uuid()}/waitlist`,
      body: {},
    },
    {
      cap: "enrollment",
      name: "POST /enrollments/:id/decline",
      method: "POST",
      path: `/enrollments/${uuid()}/decline`,
      body: { reason: "No room." },
    },
    { cap: "enrollment", name: "GET /payment-proofs", method: "GET", path: "/payment-proofs" },
    {
      cap: "enrollment",
      name: "GET /payment-proofs/count",
      method: "GET",
      path: "/payment-proofs/count",
    },
    {
      cap: "enrollment",
      name: "GET /payment-proofs/:id",
      method: "GET",
      path: `/payment-proofs/${uuid()}`,
    },
    {
      cap: "money",
      gate: "enrollment",
      name: "POST /payment-proofs/:id/confirm",
      method: "POST",
      path: `/payment-proofs/${uuid()}/confirm`,
      body: {},
    },
    {
      cap: "enrollment",
      name: "POST /payment-proofs/:id/reject",
      method: "POST",
      path: `/payment-proofs/${uuid()}/reject`,
      body: { reason: "Not ours." },
    },
    {
      cap: "enrollment",
      name: "GET /clients/:id/payment-proofs",
      method: "GET",
      path: `/clients/${s}/payment-proofs`,
    },
    // familyAccess
    {
      cap: "familyAccess",
      name: "GET /clients/:id/family",
      method: "GET",
      path: `/clients/${s}/family`,
    },
    {
      cap: "familyAccess",
      name: "POST /clients/:id/family/invites",
      method: "POST",
      path: `/clients/${s}/family/invites`,
      body: { relation: "guardian" },
    },
    {
      cap: "familyAccess",
      name: "DELETE /clients/:id/family/invites/:id",
      method: "DELETE",
      path: `/clients/${s}/family/invites/${w.familyInviteId}`,
    },
    {
      cap: "familyAccess",
      name: "DELETE /clients/:id/family/access/:id",
      method: "DELETE",
      path: `/clients/${s}/family/access/${w.accessId}`,
    },
    // announcements
    {
      cap: "announcements",
      name: "GET /announcements?status=draft",
      method: "GET",
      path: "/announcements?status=draft",
    },
    {
      cap: "announcements",
      name: "GET /announcements?status=all",
      method: "GET",
      path: "/announcements?status=all",
    },
    {
      cap: "announcements",
      name: "GET /announcements/:id",
      method: "GET",
      path: `/announcements/${w.announcementId}`,
    },
    {
      cap: "announcements",
      name: "POST /announcements",
      method: "POST",
      path: "/announcements",
      body: { title: "My news", body: "Mine.", audience: "all", publish: "draft" },
    },
    {
      cap: "announcements",
      name: "PATCH /announcements/:id",
      method: "PATCH",
      path: `/announcements/${w.announcementId}`,
      body: announcement,
    },
    {
      cap: "announcements",
      name: "POST /announcements/:id/unpublish",
      method: "POST",
      path: `/announcements/${w.announcementId}/unpublish`,
    },
    {
      cap: "announcements",
      name: "DELETE /announcements/:id",
      method: "DELETE",
      path: `/announcements/${w.announcementId}`,
    },
    // data
    {
      cap: "data",
      name: "POST /clients/import",
      method: "POST",
      path: "/clients/import",
      body: { rows: [{ firstName: "Imported", lastName: "Player" }] },
    },
    { cap: "data", name: "GET /export/clients.csv", method: "GET", path: "/export/clients.csv" },
    {
      cap: "data",
      name: "DELETE /workspace/sample-data",
      method: "DELETE",
      path: "/workspace/sample-data",
    },
    {
      cap: "data",
      name: "DELETE /clients/:id",
      method: "DELETE",
      path: `/clients/${uuid()}`,
    },
  ];
}

/** What every staff role may do: the people, their progress, the schedule, and check-in. */
function openProbes(w: World, self: string): Open[] {
  const s = w.studentId;
  return [
    { name: "GET /me", method: "GET", path: "/me" },
    { name: "GET /today", method: "GET", path: "/today" },
    { name: "GET /clients", method: "GET", path: "/clients" },
    { name: "GET /clients/:id", method: "GET", path: `/clients/${s}` },
    {
      name: "POST /clients",
      method: "POST",
      path: "/clients",
      body: { firstName: "Kai", lastName: "Probe" },
    },
    {
      name: "PATCH /clients/:id",
      method: "PATCH",
      path: `/clients/${s}`,
      body: { phone: "0917 555 0100" },
    },
    {
      name: "PUT /clients/:id/coaches",
      method: "PUT",
      path: `/clients/${s}/coaches`,
      body: { primaryCoachUserId: self, assistantCoachIds: [] },
    },
    { name: "GET /clients/:id/progress", method: "GET", path: `/clients/${s}/progress` },
    {
      name: "POST /notes (shared)",
      method: "POST",
      path: "/notes",
      body: { clientId: s, body: "Good footwork.", visibility: "shared" },
    },
    { name: "GET /clients/:id/ledger (credits)", method: "GET", path: `/clients/${s}/ledger` },
    {
      name: "GET /lessons",
      method: "GET",
      path: `/lessons?from=${w.today}&to=${w.today}`,
    },
    { name: "GET /lessons/:id", method: "GET", path: `/lessons/${w.lessonId}` },
    {
      name: "POST /lessons (catalog price)",
      method: "POST",
      path: "/lessons",
      body: {
        kind: "private",
        date: w.today,
        startTime: "08:00",
        durationMinutes: 60,
        clientIds: [s],
      },
    },
    {
      name: "POST /attendance/:id (check in)",
      method: "POST",
      path: `/attendance/${w.attendanceId}`,
      body: { status: "present", mutationId: uuid() },
    },
    {
      name: "POST /groups/:id/members",
      method: "POST",
      path: `/groups/${w.groupId}/members`,
      body: { clientIds: [s] },
    },
    { name: "GET /groups", method: "GET", path: "/groups" },
    { name: "GET /events", method: "GET", path: "/events?scope=all" },
    { name: "GET /packages (no prices)", method: "GET", path: "/packages" },
    { name: "GET /rates (no prices)", method: "GET", path: "/rates" },
    { name: "GET /team", method: "GET", path: "/team" },
    { name: "GET /coaches", method: "GET", path: "/coaches" },
    { name: "GET /coaches/:self", method: "GET", path: `/coaches/${self}` },
    {
      name: "PATCH /coaches/:self (own profile)",
      method: "PATCH",
      path: `/coaches/${self}`,
      body: { title: "Junior coach" },
    },
    { name: "GET /academy", method: "GET", path: "/academy" },
    { name: "GET /announcements (live)", method: "GET", path: "/announcements" },
    { name: "GET /clients/:id/consents", method: "GET", path: `/clients/${s}/consents` },
    {
      name: "POST /clients/:id/consents/:doc/paper",
      method: "POST",
      path: `/clients/${s}/consents/${w.consentId}/paper`,
      body: { signerName: "Pat Probe", version: w.consentVersion },
    },
    { name: "GET /clients/:id/pickups", method: "GET", path: `/clients/${s}/pickups` },
    {
      name: "POST /clients/:id/pickups",
      method: "POST",
      path: `/clients/${s}/pickups`,
      body: { name: "Lola Probe", relationship: "Grandmother" },
    },
  ];
}

async function send(
  request: APIRequestContext,
  p: { method: Method; path: string; body?: unknown; image?: boolean },
) {
  if (p.image) {
    const res = await request.fetch(`/api/v1${p.path}`, {
      method: p.method,
      data: pngImage(),
      headers: { "Content-Type": "image/png" },
    });
    let json: unknown;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status(), text, json };
  }
  return new Api(request).raw(p.method, p.path, p.body);
}

/**
 * One line per answer: "allowed" past the capability check (any 2xx–4xx but 401/403), the refusal
 * with its code and the capability it names, or what went wrong.
 */
function verdict(res: { status: number; json: unknown }): string {
  const error = (res.json as ApiErrorBody | undefined)?.error;
  if (res.status === 403) {
    const cap = (error?.details as { cap?: string } | undefined)?.cap;
    return `403 ${error?.code}${cap ? ` (${cap})` : ""}`;
  }
  if (res.status === 401) return "401";
  if (res.status === 404 && error?.message === "No such endpoint.") return "no such endpoint";
  if (res.status >= 500) return `${res.status} ${error?.code ?? "error"}`;
  return "allowed";
}

function expected(role: StaffRole, p: Probe): string {
  if (p.gate && !can(role, p.gate)) return `403 forbidden (${p.gate})`;
  if (can(role, p.cap)) return "allowed";
  return p.plainRefusal ? "403 forbidden" : `403 forbidden (${p.cap})`;
}

async function probeAll(request: APIRequestContext, probes: (Probe | Open)[]) {
  const seen: Record<string, string> = {};
  for (const p of probes) seen[p.name] = verdict(await send(request, p));
  return seen;
}

test.describe("who can do what, at the API", () => {
  test.skip(({ isMobile }) => isMobile, "An API matrix: one browser is enough");

  test(
    "a coach is refused every capability and keeps everything else, without money",
    { tag: "@smoke" },
    async ({ coach: owner, personas }, info) => {
      test.slow();
      const w = await academyWithEverything(owner, info);
      const email = testEmail("matrix-coach", info);
      const { userId } = await addMember(owner.request, {
        email,
        name: "Casey Coach",
        role: "coach",
      });
      const coach = await personas.open({ email, name: "Casey Coach", persona: "none" });

      const probes = capabilityProbes(w, userId);
      const want = Object.fromEntries(probes.map((p) => [p.name, expected("coach", p)]));
      expect(await probeAll(coach.context.request, probes)).toEqual(want);
      // Every capability is probed, and coaches have none of them.
      expect(new Set(probes.map((p) => p.cap))).toEqual(
        new Set([
          "money",
          "catalog",
          "team",
          "settings",
          "enrollment",
          "familyAccess",
          "announcements",
          "data",
          "ownership",
        ]),
      );

      // Students, progress, notes, the schedule, check-in, credits, their own profile: open, and
      // nothing they read carries money.
      const open = openProbes(w, userId);
      const answers: Record<string, string> = {};
      for (const p of open) {
        const res = await send(coach.context.request, p);
        answers[p.name] = res.status < 300 ? "ok" : `${res.status} ${Api.code(res)}`;
        if (res.status < 300) expect(res.text, p.name).not.toMatch(MONEY_FIELD);
      }
      expect(answers).toEqual(Object.fromEntries(open.map((p) => [p.name, "ok"])));
    },
  );

  test("an admin has every capability but ownership", async ({ coach: owner, personas }, info) => {
    test.slow();
    const w = await academyWithEverything(owner, info);
    const email = testEmail("matrix-admin", info);
    const { userId } = await addMember(owner.request, { email, name: "Alex Admin", role: "admin" });
    const admin = await personas.open({ email, name: "Alex Admin", persona: "none" });

    const probes = capabilityProbes(w, userId);
    const want = Object.fromEntries(probes.map((p) => [p.name, expected("admin", p)]));
    expect(await probeAll(admin.context.request, probes)).toEqual(want);
    // The refusals left the owner as the owner.
    const team = await owner.api.get<{ members: { userId: string; role: string }[] }>("/team");
    expect(team.members.find((m) => m.userId === w.ownerId)?.role).toBe("owner");
    expect(team.members.find((m) => m.userId === w.spareB)?.role).toBe("coach");
  });

  test("only the owner hands the academy over or changes an owner", async ({
    coach: owner,
  }, info) => {
    const w = await academyWithEverything(owner, info);
    const probes = capabilityProbes(w, w.ownerId).filter((p) => p.cap === "ownership");
    // Past the capability check, the team rules still hold: no handing the academy to yourself,
    // never without an owner. The last probe makes a coach an owner.
    const seen: Record<string, string> = {};
    for (const p of probes) {
      const res = await send(owner.request, p);
      seen[p.name] = `${res.status} ${Api.code(res) ?? ""}`.trim();
    }
    expect(seen).toEqual({
      "POST /team/transfer-ownership": "409 same_person",
      "PATCH /team/members/:owner (demote an owner)": "409 last_owner",
      "DELETE /team/members/:owner (remove an owner)": "409 last_owner",
      "PATCH /team/members/:coach (make an owner)": "200",
    });
    const team = await owner.api.get<{ members: { userId: string; role: string }[] }>("/team");
    expect(team.members.find((m) => m.userId === w.spareB)?.role).toBe("owner");
    expect(team.members.find((m) => m.userId === w.ownerId)?.role).toBe("owner");
  });

  test("families and signed-out visitors have no staff API at all", async ({
    coach: owner,
    personas,
    playwright,
  }, info) => {
    test.slow();
    const w = await academyWithEverything(owner, info);
    const parent = await personas.open({
      email: w.parentEmail,
      name: "Pat Probe",
      persona: "none",
    });
    const all = [...capabilityProbes(w, w.ownerId), ...openProbes(w, w.ownerId)];
    expect(await probeAll(parent.context.request, all)).toEqual(
      Object.fromEntries(all.map((p) => [p.name, "403 no_workspace"])),
    );
    const anonymous = await playwright.request.newContext({
      baseURL: info.project.use.baseURL,
      extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    });
    try {
      expect(await probeAll(anonymous, all)).toEqual(
        Object.fromEntries(all.map((p) => [p.name, "401"])),
      );
    } finally {
      await anonymous.dispose();
    }
    // Nothing changed: the owner's academy still has its student and the parent's link.
    const access = await owner.api.get<FamilyAccessDto>(`/clients/${w.studentId}/family`);
    expect(access.links.map((l) => l.id)).toEqual([w.accessId]);
  });
});
