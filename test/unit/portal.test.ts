import { describe, expect, it } from "vitest";
import type {
  academyProfile,
  assessment,
  client,
  clientCoach,
  goal,
  lesson,
  note,
  workspaceSettings,
} from "../../src/worker/db/schema";
import {
  portalSessionTitle,
  toPortalAcademy,
  toPortalAssessment,
  toPortalCharge,
  toPortalCoach,
  toPortalCoachRef,
  toPortalComment,
  toPortalGoal,
  toPortalPackage,
  toPortalPayment,
  toPortalSafety,
  toPortalSession,
  toPortalStudent,
  toPortalStudentRef,
} from "../../src/worker/lib/portal-dto";
import {
  canReadPortalFile,
  inWorkspace,
  linkFor,
  ownsRow,
  type PortalScope,
  parsePortalFileKey,
  workspacesOf,
} from "../../src/worker/lib/portal-scope";
import { INVITE_MISS_RULE, isSpent, nextWindow } from "../../src/worker/lib/rate-limit";

// Every forbidden value carries LEAK, so one search over the serialized output proves it's gone.
const STAFF_ID = "staff-user-LEAK";

const clientRow: typeof client.$inferSelect = {
  id: "c1",
  workspaceId: "ws1",
  firstName: "Mia",
  lastName: "Santos",
  email: "mia@example.com",
  phone: "0917 000 0001",
  birthDate: "2014-03-01",
  isJunior: true,
  guardianName: "Pat Santos",
  guardianPhone: "0917 000 0002",
  guardianEmail: "LEAK-guardian-email@example.com",
  emergencyName: "Chris Santos",
  emergencyPhone: "0917 000 0003",
  level: "3.0",
  duprId: "LEAK-dupr-id",
  duprRating: 3.1,
  dominantHand: "right",
  paddle: "LEAK-paddle",
  goals: "LEAK-client-goals",
  medicalNotes: "Asthma: inhaler in bag",
  notes: "LEAK-client-notes",
  status: "lead",
  source: "LEAK-client-source",
  tags: ["LEAK-client-tag"],
  photoKey: "ws/ws1/clients/c1/0192.jpg",
  joinedOn: "2026-01-10",
  shirtSize: "YM",
  safetyUpdatedAt: 5,
  safetyUpdatedBy: STAFF_ID,
  safetyUpdatedRelation: "staff",
  createdAt: 1,
  updatedAt: 2,
};

const link = { accessId: "a1", clientId: "c1", workspaceId: "ws1", relation: "guardian" as const };

const lessonRow: typeof lesson.$inferSelect = {
  id: "l1",
  workspaceId: "ws1",
  kind: "semi_private",
  title: null,
  startsAt: 1_000,
  endsAt: 2_000,
  venueId: "v1",
  court: "3",
  groupId: null,
  eventId: null,
  rateId: "LEAK-rate",
  priceMinor: 999_999,
  capacity: 2,
  status: "scheduled",
  cancelReason: "LEAK-cancel-reason",
  seriesId: "LEAK-series",
  occurrenceDate: "2026-11-06",
  detached: false,
  notes: "LEAK-lesson-notes",
  completedAt: null,
  coachUserId: STAFF_ID,
  assistantCoachIds: [STAFF_ID],
  createdAt: 1,
  updatedAt: 1,
};

const noteRow = (over: Partial<typeof note.$inferSelect>): typeof note.$inferSelect => ({
  id: "n1",
  workspaceId: "ws1",
  clientId: "c1",
  lessonId: null,
  body: "Great footwork today.",
  pinned: false,
  createdBy: STAFF_ID,
  visibility: "shared",
  kind: "comment",
  editedAt: null,
  createdAt: 10,
  updatedAt: 10,
  ...over,
});

const assessmentRow = (
  over: Partial<typeof assessment.$inferSelect>,
): typeof assessment.$inferSelect => ({
  id: "as1",
  workspaceId: "ws1",
  clientId: "c1",
  assessedOn: "2026-10-30",
  overallLevel: "3.0",
  notes: "Steady at the kitchen line.",
  lessonId: "l1",
  createdBy: STAFF_ID,
  sharedWithFamily: true,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const coach = { name: "Ana Reyes", photoKey: "ws/ws1/public/coaches/u-1.jpg" };

function expectClean(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain("LEAK");
  return text;
}

describe("portal DTOs leave out everything families must not see", () => {
  it("students: no internal notes, tags, source, intake goals, status, or staff details", () => {
    const student = toPortalStudent(clientRow, link, null);
    expectClean(student);
    for (const key of ["notes", "tags", "source", "goals", "status", "guardianEmail", "duprId"]) {
      expect(student).not.toHaveProperty(key);
    }
    expect(student).toMatchObject({ clientId: "c1", firstName: "Mia", relation: "guardian" });
    // The client's level follows unshared assessments too: only a shared one's level goes out.
    const unshared = toPortalStudent({ ...clientRow, level: "LEAK-unshared-level" }, link, null);
    expect(unshared.level).toBeNull();
    expectClean(unshared);
    expect(toPortalStudent(clientRow, link, "2.5").level).toBe("2.5");
    expectClean(toPortalStudentRef(clientRow, link));
    // Medical and emergency details are for the family's own student only (the route's job).
    expect(toPortalSafety(clientRow)).toEqual({
      medicalNotes: "Asthma: inhaler in bag",
      emergencyName: "Chris Santos",
      emergencyPhone: "0917 000 0003",
      guardianName: "Pat Santos",
      guardianPhone: "0917 000 0002",
    });
    expectClean(toPortalSafety(clientRow));
  });

  it("sessions: no notes, cancel reasons, prices, staff ids, or other players' names", () => {
    // What coachRefs returns for a staff member: the portal keeps only name and photo.
    const staffRef = { ...coach, userId: STAFF_ID };
    const session = toPortalSession(
      {
        lesson: lessonRow,
        venueName: "Riverside Courts",
        venueAddress: "1 River Rd",
        groupName: null,
        eventName: null,
        attendance: "booked",
      },
      toPortalCoachRef(staffRef),
    );
    const text = expectClean(session);
    expect(text).not.toContain("priceMinor");
    expect(session.title).toBe("Semi-private");
    expect(session.coach).toEqual(coach);
    expect(session).not.toHaveProperty("notes");
    expect(session).not.toHaveProperty("cancelReason");
    // Titles come from the session, its program, or its event; never from the roster.
    expect(portalSessionTitle({ title: " ", kind: "group" }, "Juniors A", null)).toBe("Juniors A");
    expect(portalSessionTitle({ title: "Drills", kind: "group" }, "Juniors A", null)).toBe(
      "Drills",
    );
  });

  it("comments: only shared ones, never coaches-only or handoff notes, and no author ids", () => {
    const shared = toPortalComment(noteRow({}), toPortalCoachRef(coach), null);
    expect(shared).toMatchObject({ body: "Great footwork today.", author: coach });
    expectClean(shared);
    expect(shared).not.toHaveProperty("createdBy");
    expect(
      toPortalComment(noteRow({ visibility: "staff", body: "LEAK-staff" }), null, null),
    ).toBeNull();
    expect(
      toPortalComment(
        noteRow({ kind: "handoff", visibility: "shared", body: "LEAK-handoff" }),
        null,
        null,
      ),
    ).toBeNull();
    // Session-only notes (no student) never reach a family.
    expect(toPortalComment(noteRow({ clientId: null }), null, null)).toBeNull();
  });

  it("assessments: only shared ones, without staff ids", () => {
    const shared = toPortalAssessment(
      assessmentRow({}),
      [{ skillId: "s1", score: 4, note: "Soft hands" }],
      toPortalCoachRef(coach),
    );
    expect(shared).toMatchObject({
      assessedOn: "2026-10-30",
      scores: [{ skillId: "s1", score: 4 }],
    });
    expectClean(shared);
    expect(shared).not.toHaveProperty("createdBy");
    expect(shared).not.toHaveProperty("lessonId");
    expect(
      toPortalAssessment(
        assessmentRow({ sharedWithFamily: false, notes: "LEAK-unshared" }),
        [],
        null,
      ),
    ).toBeNull();
  });

  it("goals and coaches: names and public profile facts only", () => {
    const goalRow: typeof goal.$inferSelect = {
      id: "g1",
      workspaceId: "ws1",
      clientId: "c1",
      title: "Third-shot drop",
      detail: "8 of 10 in drills",
      targetDate: null,
      status: "active",
      achievedOn: null,
      createdBy: STAFF_ID,
      createdAt: 1,
      updatedAt: 1,
    };
    expectClean(toPortalGoal(goalRow, toPortalCoachRef(coach)));

    const row: typeof clientCoach.$inferSelect = {
      id: "cc1",
      workspaceId: "ws1",
      clientId: "c1",
      coachUserId: STAFF_ID,
      role: "primary",
      startedOn: "2026-01-10",
      endedOn: null,
      assignedBy: STAFF_ID,
      createdAt: 1,
    };
    const facts = {
      name: "Ana Reyes",
      title: "Head coach",
      photoKey: null,
      bio: "Twelve years on court.",
      certifications: ["RPO Level 2"],
      specialties: [],
      languages: ["English", "Filipino"],
      yearsCoaching: 12,
      isPublic: true,
      // A staff row carries more than the portal may show.
      email: "LEAK-coach@example.com",
      phone: "LEAK-coach-phone",
      userId: STAFF_ID,
      role: "owner",
    };
    const open = toPortalCoach(row, facts);
    expectClean(open);
    expect(open).toMatchObject({ role: "primary", bio: "Twelve years on court." });
    expect(open).not.toHaveProperty("email");
    const closed = toPortalCoach(row, { ...facts, isPublic: false });
    expect(closed).toMatchObject({ name: "Ana Reyes", title: "Head coach", bio: null });
    expect(closed.certifications).toEqual([]);
  });

  it("money: the family's own amounts, without voided entries or staff notes", () => {
    expect(
      toPortalCharge({
        id: "ch1",
        kind: "package",
        description: "Monthly A",
        amountMinor: 600_000,
        paidMinor: 0,
        occurredOn: "2026-11-01",
        voidedAt: null,
      }),
    ).toEqual({
      id: "ch1",
      kind: "package",
      description: "Monthly A",
      amountMinor: 600_000,
      paidMinor: 0,
      occurredOn: "2026-11-01",
    });
    expect(
      toPortalCharge({
        id: "ch2",
        kind: "other",
        description: "LEAK-voided",
        amountMinor: 1,
        paidMinor: 0,
        occurredOn: "2026-11-01",
        voidedAt: 5,
      }),
    ).toBeNull();
    const payment = toPortalPayment({
      id: "p1",
      amountMinor: 150_000,
      method: "GCash",
      paidOn: "2026-11-02",
      reference: "REF123",
      voidedAt: null,
      ...{ note: "LEAK-payment-note", clientName: "LEAK-name", clientId: "c1" },
    });
    expectClean(payment);
    expect(payment).not.toHaveProperty("note");
    expect(
      toPortalPayment({
        id: "p2",
        amountMinor: 1,
        method: "Cash",
        paidOn: "2026-11-02",
        reference: null,
        voidedAt: 9,
      }),
    ).toBeNull();
    const pkg = toPortalPackage(
      {
        id: "cp1",
        name: "Monthly A",
        creditsTotal: 6,
        remaining: 4,
        purchasedOn: "2026-11-01",
        expiresOn: "2026-10-31",
        status: "active",
        ...{ notes: "LEAK-package-notes", priceMinor: 600_000 },
      },
      "2026-11-05",
    );
    expect(pkg).toMatchObject({ remaining: 4, status: "expired" });
    expectClean(pkg);
    expect(pkg).not.toHaveProperty("priceMinor");
    expect(
      toPortalPackage(
        {
          id: "cp2",
          name: "x",
          creditsTotal: 1,
          remaining: 1,
          purchasedOn: "2026-11-01",
          expiresOn: null,
          status: "void",
        },
        "2026-11-05",
      ),
    ).toBeNull();
  });

  it("academies: the public face and formats, not the academy's switches", () => {
    const profile: typeof academyProfile.$inferSelect = {
      workspaceId: "ws1",
      tagline: "No noise, all game",
      about: null,
      contactPhone: "0917 000 0000",
      contactEmail: "hello@example.com",
      address: "1 River Rd",
      mapUrl: "https://maps.example/1",
      socials: { facebook: "https://facebook.com/x", LEAKY: "https://x" },
      logoKey: "ws/ws1/public/logo-1.png",
      coverKey: "LEAK-cover",
      paymentInstructions: "GCash 0917 000 0000",
      paymentQrKey: "ws/ws1/public/payment-qr-1.png",
      policies: "Rain cancels.",
      enrollmentOpen: true,
      listed: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const settings: typeof workspaceSettings.$inferSelect = {
      workspaceId: "ws1",
      currency: "PHP",
      timezone: "Asia/Manila",
      locale: "en-PH",
      sport: "pickleball",
      paymentMethods: ["Cash", "GCash"],
      noShowUsesCredit: true,
      lateCancelUsesCredit: true,
      lateCancelHours: 24,
      defaultSessionMinutes: 60,
      weekStartsOn: 1,
      onboardedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const academy = toPortalAcademy(
      { id: "ws1", name: "Riverside", slug: "riverside" },
      profile,
      settings,
      "https://coachman.cloud",
    );
    expectClean(academy);
    expect(academy).toMatchObject({
      currency: "PHP",
      timezone: "Asia/Manila",
      locale: "en-PH",
      publicUrl: "https://coachman.cloud/a/riverside",
      socials: { facebook: "https://facebook.com/x" },
      paymentMethods: ["Cash", "GCash"],
    });
    for (const key of ["enrollmentOpen", "listed", "coverKey", "lateCancelHours", "sport"]) {
      expect(academy).not.toHaveProperty(key);
    }
    // Legacy ws- addresses aren't public.
    expect(
      toPortalAcademy({ id: "ws1", name: "R", slug: "ws-123" }, profile, settings, "https://x")
        .publicUrl,
    ).toBeNull();
  });
});

describe("portal scope", () => {
  const scope: PortalScope = {
    userId: "u1",
    links: [
      { accessId: "a1", clientId: "c1", workspaceId: "ws1", relation: "guardian" },
      { accessId: "a2", clientId: "c2", workspaceId: "ws1", relation: "guardian" },
      { accessId: "a3", clientId: "c9", workspaceId: "ws2", relation: "self" },
    ],
  };
  const empty: PortalScope = { userId: "u2", links: [] };

  it("finds only linked students, each in its own academy", () => {
    expect(linkFor(scope, "c1")?.accessId).toBe("a1");
    expect(linkFor(scope, "c3")).toBeNull();
    expect(linkFor(empty, "c1")).toBeNull();
    expect(workspacesOf(scope)).toEqual(["ws1", "ws2"]);
    expect(workspacesOf(empty)).toEqual([]);
    expect(inWorkspace(scope, "ws2")).toBe(true);
    expect(inWorkspace(scope, "ws3")).toBe(false);
    expect(ownsRow(scope, { workspaceId: "ws1", clientId: "c1" })).toBe(true);
    // The same student id under another academy is not theirs.
    expect(ownsRow(scope, { workspaceId: "ws2", clientId: "c1" })).toBe(false);
    expect(ownsRow(scope, { workspaceId: "ws1", clientId: null })).toBe(false);
  });

  it("serves their students' photos and their academies' public images only", () => {
    expect(canReadPortalFile(scope, "ws/ws1/clients/c1/0192a.jpg")).toBe(true);
    expect(canReadPortalFile(scope, "ws/ws2/clients/c9/0192b.webp")).toBe(true);
    expect(canReadPortalFile(scope, "ws/ws1/public/logo-1.png")).toBe(true);
    expect(canReadPortalFile(scope, "ws/ws1/public/coaches/u-1.jpg")).toBe(true);
    expect(canReadPortalFile(scope, "ws/ws1/public/photos/0196a.jpg")).toBe(true);
    // Other students, other academies, and someone with no links.
    expect(canReadPortalFile(scope, "ws/ws1/clients/c3/0192.jpg")).toBe(false);
    expect(canReadPortalFile(scope, "ws/ws3/public/logo-1.png")).toBe(false);
    expect(canReadPortalFile(scope, "ws/ws3/public/photos/0196a.jpg")).toBe(false);
    expect(canReadPortalFile(scope, "ws/ws2/clients/c1/0192.jpg")).toBe(false);
    expect(canReadPortalFile(empty, "ws/ws1/clients/c1/0192.jpg")).toBe(false);
  });

  it("refuses payment proofs and pickup photos for now, and anything malformed", () => {
    expect(canReadPortalFile(scope, "ws/ws1/clients/c1/payments/0192.jpg")).toBe(false);
    expect(canReadPortalFile(scope, "ws/ws1/clients/c1/pickups/0192.jpg")).toBe(false);
    expect(parsePortalFileKey("ws/ws1/clients/c1/payments/0192.jpg")).toEqual({
      kind: "student-folder",
      workspaceId: "ws1",
      clientId: "c1",
      folder: "payments",
    });
    for (const key of [
      "ws/ws1/clients/c1/../c3/0192.jpg",
      "ws/ws1/clients/c1/..%2F0192.jpg",
      "ws/ws1/clients/c1//0192.jpg",
      "ws/ws1/clients/c1/0192.svg",
      "ws/ws1/clients/c1/.hidden.jpg",
      "/ws/ws1/clients/c1/0192.jpg",
      "ws/ws1/public/../clients/c3/0192.jpg",
      "ws/ws1/public/photos/../../clients/c3/0192.jpg",
      "ws/ws1/public/photos/a/0192.jpg",
      "ws\\ws1\\public\\logo.png",
      "",
    ]) {
      expect(canReadPortalFile(scope, key)).toBe(false);
    }
  });
});

describe("invite rate limits", () => {
  it("counts misses in a window and refuses once they're used up", () => {
    const rule = INVITE_MISS_RULE;
    const now = 1_000_000;
    let state = null as ReturnType<typeof nextWindow> | null;
    for (let i = 0; i < rule.max; i++) {
      expect(isSpent(state, now, rule)).toBe(false);
      state = nextWindow(state, now, rule);
    }
    expect(isSpent(state, now, rule)).toBe(true);
    // The window passes, and lookups work again.
    expect(isSpent(state, now + rule.windowMs, rule)).toBe(false);
    expect(isSpent(null, now, rule)).toBe(false);
  });
});
