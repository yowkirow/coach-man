import { readFileSync } from "node:fs";
import type { APIRequestContext } from "@playwright/test";
import type {
  AccountDto,
  AnnouncementDto,
  EnrollmentContextDto,
  FamilyAccessDto,
  PortalAnnouncementsDto,
  PortalEnrollAcademyDto,
  PortalHomeDto,
} from "../src/shared/api-types";
import { pushes, sinkOf, subscribeFamily } from "./push-support";
import { type FamilyWorld, familyWorld } from "./scope-support";
import {
  auditLog,
  expect,
  linkFamily,
  portalCall,
  portalGet,
  type RawResponse,
  test,
} from "./support";

// The family portal's scope (plan: "Security and privacy"; spec §7): every /api/portal route that
// takes a student answers 404 for a student the caller isn't linked to (the same answer as an
// unknown id, so nothing about the student leaks), and a link the academy revokes stops working
// at once: the API, the files, and the pushes. The routes are read from the Worker's source, so a
// new portal route that isn't in the table below fails this spec until it's added.

test.use({ serviceWorkers: "block" });

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface PortalProbe {
  /** The route as written in the Worker ("POST /students/:clientId/renew"). */
  route: string;
  method: Method;
  path: string;
  body?: unknown;
}

/** Every route of the student the caller asks about (Mia's, with her records' ids). */
function studentRoutes(w: FamilyWorld, id = w.mia.id): PortalProbe[] {
  const m = w.mia;
  return [
    { route: "GET /students/:clientId", method: "GET", path: `/students/${id}` },
    { route: "GET /students/:clientId/schedule", method: "GET", path: `/students/${id}/schedule` },
    { route: "GET /students/:clientId/progress", method: "GET", path: `/students/${id}/progress` },
    { route: "GET /students/:clientId/money", method: "GET", path: `/students/${id}/money` },
    { route: "GET /students/:clientId/consents", method: "GET", path: `/students/${id}/consents` },
    {
      route: "POST /students/:clientId/consents/:documentId/sign",
      method: "POST",
      path: `/students/${id}/consents/${w.consent.id}/sign`,
      body: { signerName: "Someone Else", version: w.consent.version },
    },
    {
      route: "POST /students/:clientId/teen-invite",
      method: "POST",
      path: `/students/${id}/teen-invite`,
    },
    {
      route: "DELETE /students/:clientId/teen-invites/:inviteId",
      method: "DELETE",
      path: `/students/${id}/teen-invites/${m.teenInviteId}`,
    },
    {
      route: "DELETE /students/:clientId/access/:accessId",
      method: "DELETE",
      path: `/students/${id}/access/${m.accessA}`,
    },
    {
      route: "GET /students/:clientId/enrollments",
      method: "GET",
      path: `/students/${id}/enrollments`,
    },
    {
      route: "POST /students/:clientId/renew",
      method: "POST",
      path: `/students/${id}/renew`,
      body: {},
    },
    {
      route: "GET /students/:clientId/payment-proofs",
      method: "GET",
      path: `/students/${id}/payment-proofs`,
    },
    {
      route: "POST /students/:clientId/payment-proofs",
      method: "POST",
      path: `/students/${id}/payment-proofs`,
      body: { amountMinor: 1000, method: "Cash", paidOn: w.today },
    },
    {
      route: "POST /students/:clientId/payment-proofs/:id/withdraw",
      method: "POST",
      path: `/students/${id}/payment-proofs/${m.proofId}/withdraw`,
    },
    {
      route: "PATCH /students/:clientId/safety",
      method: "PATCH",
      path: `/students/${id}/safety`,
      body: { medicalNotes: "Changed by someone else" },
    },
    {
      route: "POST /students/:clientId/pickups",
      method: "POST",
      path: `/students/${id}/pickups`,
      body: { name: "A stranger" },
    },
    {
      route: "PATCH /students/:clientId/pickups/:pickupId",
      method: "PATCH",
      path: `/students/${id}/pickups/${m.pickupId}`,
      body: { name: "A stranger" },
    },
    {
      route: "DELETE /students/:clientId/pickups/:pickupId",
      method: "DELETE",
      path: `/students/${id}/pickups/${m.pickupId}`,
    },
  ];
}

/** Routes that don't name a student but reach one of Mia's records (or her academy). */
function recordRoutes(w: FamilyWorld): PortalProbe[] {
  return [
    {
      route: "POST /enrollments",
      method: "POST",
      path: "/enrollments",
      body: {
        slug: w.slug,
        packageId: w.tierId,
        who: { kind: "child", clientId: w.mia.id },
        startMonth: w.today.slice(0, 7),
        answers: {
          phone: "0917 555 0199",
          emergencyName: "Someone Else",
          emergencyPhone: "0917 555 0198",
        },
        signatures: [
          { documentId: w.consent.id, version: w.consent.version, signerName: "Someone Else" },
        ],
      },
    },
    {
      route: "POST /enrollments/:id/cancel",
      method: "POST",
      path: `/enrollments/${w.mia.requestId}/cancel`,
    },
    { route: "GET /files/*", method: "GET", path: `/files/${w.mia.photoKey}` },
    { route: "GET /files/*", method: "GET", path: `/files/${w.mia.pickupPhotoKey}` },
    { route: "GET /files/*", method: "GET", path: `/files/${w.mia.proofKey}` },
  ];
}

/**
 * Routes that answer about the caller themself (their home, academies, announcements, what they
 * can enroll in, their notification settings): checked below for what they contain, not for 404.
 */
const CALLER_ROUTES = new Set([
  "GET /home",
  "GET /announcements",
  "GET /academies/:workspaceId",
  "GET /enrollment-context",
  "GET /enroll",
  "GET /notifications",
  "PUT /notifications",
  "POST /notifications/devices",
  "DELETE /notifications/devices",
  "GET /notifications/device",
  "POST /notifications/test",
  "POST /notifications/prompt-dismissed",
]);

/** Every route the portal's Hono routers declare, as "METHOD /path". */
function declaredPortalRoutes(): string[] {
  const files = [
    "portal",
    "portal-enrollment",
    "portal-payments",
    "portal-safety",
    "portal-notifications",
  ];
  const found: string[] = [];
  for (const file of files) {
    const source = readFileSync(`src/worker/routes/${file}.ts`, "utf8");
    for (const m of source.matchAll(/\.(get|post|put|patch|delete)\(\s*"(\/[^"]*)"/g)) {
      found.push(`${(m[1] ?? "").toUpperCase()} ${m[2]}`);
    }
  }
  return found;
}

async function call(request: APIRequestContext, p: PortalProbe): Promise<RawResponse> {
  if (p.path.startsWith("/files/")) {
    const res = await request.get(`/api/portal${p.path}`);
    return { status: res.status(), text: await res.text(), json: undefined };
  }
  return portalCall(request, p.method, p.path, p.body);
}

/**
 * What a caller who isn't linked to Mia gets from every probe: "404" (a refusal that matched the
 * route; "No such endpoint." would mean the table has a typo) and nothing of hers in the answer.
 */
async function refusals(request: APIRequestContext, probes: PortalProbe[], w: FamilyWorld) {
  const seen: Record<string, string> = {};
  for (const p of probes) {
    const res = await call(request, p);
    const message = (res.json as { error?: { message?: string } } | undefined)?.error?.message;
    const leaked = [w.mia.id, w.tag, "Pat Santos"].some((s) => res.text.includes(s));
    seen[`${p.route} ${p.path}`] =
      `${res.status}${message === "No such endpoint." ? " (no such endpoint)" : ""}${leaked ? " (leaks Mia)" : ""}`;
  }
  return seen;
}

const all404 = (probes: PortalProbe[]) =>
  Object.fromEntries(probes.map((p) => [`${p.route} ${p.path}`, "404"]));

test.describe("the family portal's scope", () => {
  test.skip(({ isMobile }) => isMobile, "An API matrix: one browser is enough");

  test("every portal route answers 404 for a student the caller isn't linked to", async ({
    coach: owner,
    personas,
    playwright,
  }, info) => {
    test.slow();
    const w = await familyWorld(owner, personas, info);
    const probes = [...studentRoutes(w), ...recordRoutes(w)];

    // The table covers every portal route the Worker declares.
    const declared = declaredPortalRoutes();
    expect(declared.length).toBeGreaterThan(30);
    const covered = new Set([...probes.map((p) => p.route), ...CALLER_ROUTES]);
    expect(declared.filter((r) => !covered.has(r))).toEqual([]);

    // Mia's parent reads all of it (so the ids are real and the routes exist).
    for (const p of probes.filter((x) => x.method === "GET")) {
      expect((await call(w.parentA.context.request, p)).status, p.path).toBe(200);
    }

    // Another family of the same academy, a family of another academy, and someone linked to
    // nobody: 404 everywhere, whatever the route does.
    const callers = {
      "same academy, other student": w.parentB.context.request,
      "another academy": w.other.family.context.request,
      "linked to nobody": w.nobody.context.request,
    };
    for (const [who, request] of Object.entries(callers)) {
      expect(await refusals(request, probes, w), who).toEqual(all404(probes));
    }
    // Through their own student's path, another family can't reach Mia's records either.
    const confused = studentRoutes(w, w.leo.id).filter((p) =>
      /:pickupId|withdraw|teen-invites|access\/:accessId/.test(p.route),
    );
    const own = await refusals(w.parentB.context.request, confused, w);
    expect(own).toEqual(all404(confused));

    // Signed out: 401 for every route.
    const anonymous = await playwright.request.newContext({
      baseURL: info.project.use.baseURL,
      extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    });
    try {
      const signedOut: Record<string, number> = {};
      for (const p of probes) signedOut[`${p.route} ${p.path}`] = (await call(anonymous, p)).status;
      expect(signedOut).toEqual(
        Object.fromEntries(probes.map((p) => [`${p.route} ${p.path}`, 401])),
      );
    } finally {
      await anonymous.dispose();
    }

    // Nothing the refused calls asked for happened.
    const access = await owner.api.get<FamilyAccessDto>(`/clients/${w.mia.id}/family`);
    expect(access.links.map((l) => l.name).sort()).toEqual(["Pat Santos", "Sam Santos"]);
    const mine = await portalGet<{ requests: { id: string; status: string }[] }>(
      w.parentA.context.request,
      `/students/${w.mia.id}/enrollments`,
    );
    expect(mine.requests.map((r) => [r.id, r.status])).toEqual([[w.mia.requestId, "requested"]]);

    // The routes about the caller show their own students and academies, never Mia's.
    const b = w.parentB.context.request;
    const home = await portalGet<PortalHomeDto>(b, "/home");
    expect(home.students.map((s) => s.clientId)).toEqual([w.leo.id]);
    const context = await portalGet<EnrollmentContextDto>(b, `/enrollment-context?slug=${w.slug}`);
    expect(context.children.map((c) => c.clientId)).toEqual([w.leo.id]);
    expect(context.requests).toEqual([]);
    for (const [who, request] of Object.entries(callers)) {
      const answers = await Promise.all(
        ["/home", "/announcements", "/enroll", `/enrollment-context?slug=${w.slug}`].map((path) =>
          portalCall(request, "GET", path),
        ),
      );
      for (const res of answers) {
        expect(res.status, `${who}: ${res.text}`).toBe(200);
        expect(res.text, who).not.toContain(w.mia.id);
        expect(res.text, who).not.toContain(w.tag);
      }
    }
    // Academies: your own students' only.
    const academy = `/academies/${w.workspaceId}`;
    expect((await portalCall(b, "GET", academy)).status).toBe(200);
    expect((await portalCall(w.other.family.context.request, "GET", academy)).status).toBe(404);
    expect((await portalCall(w.nobody.context.request, "GET", academy)).status).toBe(404);
    const enroll = await portalGet<PortalEnrollAcademyDto[]>(w.nobody.context.request, "/enroll");
    expect(enroll).toEqual([]);
  });

  test("a link the academy revokes loses the API, the files, and the pushes at once", async ({
    coach: owner,
    personas,
  }, info) => {
    test.slow();
    const w = await familyWorld(owner, personas, info);
    const a = w.parentA.context.request;
    const c = w.coParent.context.request;
    await subscribeFamily(a);
    await subscribeFamily(c);
    const probes = [
      ...studentRoutes(w),
      ...recordRoutes(w).filter((p) => p.route === "GET /files/*"),
    ];
    for (const p of probes.filter((x) => x.method === "GET")) {
      expect((await call(a, p)).status, `before: ${p.path}`).toBe(200);
    }
    // Pat's phone gets Mia's news while the link lasts.
    const before = await owner.api.post<{ id: string }>("/notes", {
      clientId: w.mia.id,
      body: "Good serve today.",
      visibility: "shared",
    });
    await pushes(owner.request, w.parentA.userId, (p) => p.payload.tag === `note:${before.id}`);

    // The owner ends Pat's access from Mia's page.
    await owner.api.del(`/clients/${w.mia.id}/family/access/${w.mia.accessA}`);

    // Every route, every file: 404 at once, like for a stranger.
    expect(await refusals(a, probes, w)).toEqual(all404(probes));
    const home = await portalGet<PortalHomeDto>(a, "/home");
    expect(home.students).toEqual([]);
    expect(home.academies).toEqual([]);
    expect((await portalCall(a, "GET", `/academies/${w.workspaceId}`)).status).toBe(404);
    const account = (await (await a.get("/api/account")).json()) as AccountDto;
    expect(account.family).toEqual([]);
    const announcements = await portalGet<PortalAnnouncementsDto>(a, "/announcements");
    expect(announcements.items).toEqual([]);

    // News about Mia reaches her co-parent, never Pat, even with Pat's phone still registered.
    const note = await owner.api.post<{ id: string }>("/notes", {
      clientId: w.mia.id,
      body: "Lovely resets today.",
      visibility: "shared",
    });
    const news = await owner.api.post<AnnouncementDto>("/announcements", {
      title: `Courts closed on Monday ${w.tag}`,
      body: "Resurfacing.",
      audience: "all",
      publish: "now",
    });
    await pushes(owner.request, w.coParent.userId, (p) => p.payload.tag === `note:${note.id}`);
    await pushes(
      owner.request,
      w.coParent.userId,
      (p) => p.payload.tag === `announcement:${news.id}`,
    );
    const toPat = (await sinkOf(owner.request, w.parentA.userId)).items.map((p) => p.payload.tag);
    expect(toPat).not.toContain(`note:${note.id}`);
    expect(toPat).not.toContain(`announcement:${news.id}`);

    // Sam keeps everything; the academy's record says who ended Pat's access.
    expect((await portalCall(c, "GET", `/students/${w.mia.id}`)).status).toBe(200);
    expect((await c.get(`/api/portal/files/${w.mia.proofKey}`)).status()).toBe(200);
    const access = await owner.api.get<FamilyAccessDto>(`/clients/${w.mia.id}/family`);
    expect(access.links.map((l) => l.name)).toEqual(["Sam Santos"]);
    const revoked = (await auditLog(owner.request)).filter(
      (e) => e.action === "revoke" && e.entity === "client_access",
    );
    expect(revoked.map((e) => e.entityId)).toEqual([w.mia.accessA]);

    // Linked again later, Pat sees Mia again (the link is restored, not duplicated).
    const relinked = await linkFamily(owner.request, {
      clientId: w.mia.id,
      email: w.parentA.email,
      name: "Pat Santos",
      relation: "guardian",
    });
    expect(relinked.status).toBe(201);
    expect((await portalCall(a, "GET", `/students/${w.mia.id}`)).status).toBe(200);
    const again = await owner.api.get<FamilyAccessDto>(`/clients/${w.mia.id}/family`);
    expect(again.links.map((l) => l.name).sort()).toEqual(["Pat Santos", "Sam Santos"]);
  });
});
