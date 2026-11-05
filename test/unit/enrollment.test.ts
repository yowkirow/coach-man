import { describe, expect, it } from "vitest";
import { ENROLLMENT_STATUSES } from "../../src/shared/domain";
import {
  ALL_UNIFORM_SIZES,
  ASK_GUARDIAN_MESSAGE,
  canTransition,
  capacityState,
  checkChildEnrollment,
  checkNewChild,
  checkNewSelf,
  checkPeriod,
  checkSelfEnrollment,
  daysLeftInMonth,
  ENROLLMENT_TRANSITIONS,
  enrollmentMode,
  findDuplicate,
  isLastWeekOfMonth,
  isOpenEnrollment,
  isSelfRating,
  isTeenLogin,
  monthChoices,
  nextStatus,
  periodKey,
  programAgeNote,
  type RenewalPackageFacts,
  type RenewalTierFacts,
  type RequestFacts,
  renewalFor,
  renewalReminderMessage,
  SELF_RATINGS,
  seatsLeft,
  selfRatingHint,
  suggestedStartMonth,
} from "../../src/shared/enrollment";
import { enrollmentSubmitSchema } from "../../src/shared/schemas";
import {
  ABANDONED_ACCOUNT_MS,
  type AccountFootprint,
  isAbandonedPasskeyAccount,
} from "../../src/worker/lib/passkey-accounts";
import { paymentSummary, requestPayment } from "../../src/worker/services/enrollment-core";

const TODAY = "2026-11-05";

describe("the enrollment state machine", () => {
  it("lets open requests be decided once, and decided ones never again", () => {
    expect(ENROLLMENT_TRANSITIONS.requested).toEqual([
      "approved",
      "waitlisted",
      "declined",
      "cancelled",
    ]);
    expect(canTransition("waitlisted", "approved")).toBe(true);
    expect(canTransition("waitlisted", "waitlisted")).toBe(false);
    expect(canTransition("waitlisted", "requested")).toBe(false);
    for (const done of ["approved", "declined", "cancelled"] as const) {
      for (const to of ENROLLMENT_STATUSES) expect(canTransition(done, to)).toBe(false);
    }
    expect(isOpenEnrollment("requested")).toBe(true);
    expect(isOpenEnrollment("waitlisted")).toBe(true);
    expect(isOpenEnrollment("approved")).toBe(false);
  });

  it("approves requested and waitlisted requests, and treats a second approval as a replay", () => {
    expect(nextStatus("requested", "approve", "staff")).toEqual({
      ok: true,
      status: "approved",
      replay: false,
    });
    expect(nextStatus("waitlisted", "approve", "staff")).toEqual({
      ok: true,
      status: "approved",
      replay: false,
    });
    // Approving twice changes nothing (and never sells twice).
    expect(nextStatus("approved", "approve", "staff")).toEqual({
      ok: true,
      status: "approved",
      replay: true,
    });
    expect(nextStatus("declined", "approve", "staff")).toMatchObject({
      ok: false,
      code: "invalid_transition",
      message: "This request was declined.",
    });
    expect(nextStatus("cancelled", "approve", "staff")).toMatchObject({ ok: false });
  });

  it("waitlists only new requests, and declines open ones", () => {
    expect(nextStatus("requested", "waitlist", "staff")).toMatchObject({ ok: true, replay: false });
    expect(nextStatus("waitlisted", "waitlist", "staff")).toMatchObject({ ok: true, replay: true });
    expect(nextStatus("approved", "waitlist", "staff")).toMatchObject({ ok: false });
    expect(nextStatus("waitlisted", "decline", "staff")).toMatchObject({
      ok: true,
      status: "declined",
    });
    expect(nextStatus("approved", "decline", "staff")).toMatchObject({
      ok: false,
      message: "This request was already approved.",
    });
  });

  it("lets only the family cancel, and only while it's open", () => {
    expect(nextStatus("requested", "cancel", "family")).toMatchObject({ ok: true });
    expect(nextStatus("waitlisted", "cancel", "family")).toMatchObject({ ok: true });
    expect(nextStatus("cancelled", "cancel", "family")).toMatchObject({ ok: true, replay: true });
    expect(nextStatus("approved", "cancel", "family")).toMatchObject({ ok: false });
    expect(nextStatus("requested", "cancel", "staff")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(nextStatus("requested", "approve", "family")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });
});

describe("modes and periods", () => {
  it("picks the mode from the tier", () => {
    expect(enrollmentMode({ validityMode: "month_end", credits: 6, programId: "p" })).toBe("month");
    // A month-end tier stays monthly even at one credit.
    expect(enrollmentMode({ validityMode: "month_end", credits: 1, programId: "p" })).toBe("month");
    expect(enrollmentMode({ validityMode: "days", credits: 1, programId: "p" })).toBe("session");
    // A single session needs a program to pick a session of.
    expect(enrollmentMode({ validityMode: "days", credits: 1, programId: null })).toBe("date");
    expect(enrollmentMode({ validityMode: "days", credits: 10, programId: "p" })).toBe("date");
  });

  it("offers this month and next with their expiry, across year ends", () => {
    expect(monthChoices("2026-12-30")).toEqual([
      { month: "2026-12", startsOn: "2026-12-01", expiresOn: "2026-12-31", current: true },
      { month: "2027-01", startsOn: "2027-01-01", expiresOn: "2027-01-31", current: false },
    ]);
    expect(monthChoices("2028-01-31")[1]?.expiresOn).toBe("2028-02-29");
  });

  it("suggests next month in the month's last ten days", () => {
    expect(suggestedStartMonth("2026-11-05")).toBe("2026-11");
    expect(suggestedStartMonth("2026-11-20")).toBe("2026-11");
    expect(suggestedStartMonth("2026-11-21")).toBe("2026-12");
    expect(suggestedStartMonth("2026-12-31")).toBe("2027-01");
    expect(daysLeftInMonth("2026-11-30")).toBe(0);
    expect(daysLeftInMonth("2026-02-01")).toBe(27);
  });

  it("knows the month's last week", () => {
    expect(isLastWeekOfMonth("2026-11-23")).toBe(false);
    expect(isLastWeekOfMonth("2026-11-24")).toBe(true);
    expect(isLastWeekOfMonth("2026-11-30")).toBe(true);
    expect(isLastWeekOfMonth("2026-12-01")).toBe(false);
  });

  it("checks the period against the mode", () => {
    expect(checkPeriod("month", { startMonth: "2026-12" }, TODAY)).toEqual({
      ok: true,
      period: { mode: "month", startMonth: "2026-12" },
    });
    expect(checkPeriod("month", { startMonth: "2026-10" }, TODAY)).toMatchObject({
      ok: false,
      field: "startMonth",
    });
    expect(checkPeriod("month", { startMonth: "2027-01" }, TODAY)).toMatchObject({ ok: false });
    expect(checkPeriod("month", {}, TODAY)).toMatchObject({ ok: false, field: "startMonth" });
    expect(checkPeriod("session", { lessonId: "l1" }, TODAY)).toEqual({
      ok: true,
      period: { mode: "session", lessonId: "l1" },
    });
    expect(checkPeriod("session", {}, TODAY)).toMatchObject({ ok: false, field: "lessonId" });
    expect(checkPeriod("date", { startDate: TODAY }, TODAY)).toMatchObject({ ok: true });
    expect(checkPeriod("date", { startDate: "2026-11-04" }, TODAY)).toMatchObject({
      ok: false,
      field: "startDate",
    });
    expect(checkPeriod("date", { startDate: "2027-02-03" }, TODAY)).toMatchObject({ ok: true });
    expect(checkPeriod("date", { startDate: "2027-02-04" }, TODAY)).toMatchObject({ ok: false });
    expect(checkPeriod("date", { startDate: "nope" }, TODAY)).toMatchObject({ ok: false });
  });

  it("keys a request by its period", () => {
    expect(periodKey({ startMonth: "2026-12", lessonId: null })).toBe("month:2026-12");
    expect(periodKey({ startMonth: null, lessonId: "l1" })).toBe("session:l1");
    expect(periodKey({ startMonth: null, lessonId: null })).toBe("date");
  });
});

describe("duplicate requests", () => {
  const base: RequestFacts = {
    id: "r1",
    clientId: "c1",
    packageId: "monthly",
    startMonth: "2026-12",
    lessonId: null,
    status: "requested",
  };

  it("finds an open request for the same student, tier, and month", () => {
    expect(
      findDuplicate([base], {
        clientId: "c1",
        packageId: "monthly",
        startMonth: "2026-12",
        lessonId: null,
      }),
    ).toEqual({ kind: "open", request: base });
    expect(
      findDuplicate([{ ...base, status: "waitlisted" }], {
        clientId: "c1",
        packageId: "monthly",
        startMonth: "2026-12",
        lessonId: null,
      })?.kind,
    ).toBe("open");
  });

  it("lets another month, tier, or student through", () => {
    const candidate = {
      clientId: "c1",
      packageId: "monthly",
      startMonth: "2026-12",
      lessonId: null,
    };
    expect(findDuplicate([{ ...base, startMonth: "2026-11" }], candidate)).toBeNull();
    expect(findDuplicate([{ ...base, packageId: "plus" }], candidate)).toBeNull();
    expect(findDuplicate([{ ...base, clientId: "c2" }], candidate)).toBeNull();
    // Declined and cancelled requests can be asked again.
    expect(findDuplicate([{ ...base, status: "declined" }], candidate)).toBeNull();
    expect(findDuplicate([{ ...base, status: "cancelled" }], candidate)).toBeNull();
    // The request itself (a resend) isn't its own duplicate.
    expect(findDuplicate([base], { ...candidate, id: "r1" })).toBeNull();
  });

  it("refuses enrolling again for a month or a session already approved", () => {
    const candidate = {
      clientId: "c1",
      packageId: "monthly",
      startMonth: "2026-12",
      lessonId: null,
    };
    expect(findDuplicate([{ ...base, status: "approved" }], candidate)?.kind).toBe("approved");
    const trial = { ...base, packageId: "trial", startMonth: null, lessonId: "l1" };
    expect(
      findDuplicate([{ ...trial, status: "approved" }], {
        clientId: "c1",
        packageId: "trial",
        startMonth: null,
        lessonId: "l1",
      })?.kind,
    ).toBe("approved");
    expect(
      findDuplicate([trial], {
        clientId: "c1",
        packageId: "trial",
        startMonth: null,
        lessonId: "l2",
      }),
    ).toBeNull();
  });

  it("keeps one open request per date-based tier, and lets it be bought again once approved", () => {
    const pack = { ...base, packageId: "pack", startMonth: null, lessonId: null };
    const candidate = { clientId: "c1", packageId: "pack", startMonth: null, lessonId: null };
    expect(findDuplicate([pack], candidate)?.kind).toBe("open");
    expect(findDuplicate([{ ...pack, status: "approved" }], candidate)).toBeNull();
  });
});

describe("who can be enrolled", () => {
  const born = (age: number) => `${2026 - age}-10-01`;

  it("needs a self-enrolling student to be 18 or older", () => {
    expect(checkSelfEnrollment({ birthDate: born(30), isJunior: false, today: TODAY })).toEqual({
      ok: true,
      relation: "self",
    });
    expect(checkSelfEnrollment({ birthDate: born(16), isJunior: false, today: TODAY })).toEqual({
      ok: false,
      code: "minor_self",
      message: ASK_GUARDIAN_MESSAGE,
    });
    // Without a birth date, the junior flag decides (as for guardian links).
    expect(checkSelfEnrollment({ birthDate: null, isJunior: true, today: TODAY }).ok).toBe(false);
    expect(checkSelfEnrollment({ birthDate: null, isJunior: false, today: TODAY }).ok).toBe(true);
  });

  it("asks a new adult student for a birth date that shows they're 18", () => {
    expect(checkNewSelf({ birthDate: null, today: TODAY })).toMatchObject({
      ok: false,
      code: "needs_birth_date",
    });
    expect(checkNewSelf({ birthDate: "2008-11-05", today: TODAY })).toEqual({
      ok: true,
      relation: "self",
    });
    expect(checkNewSelf({ birthDate: "2008-11-06", today: TODAY })).toMatchObject({
      ok: false,
      code: "minor_self",
    });
    expect(checkNewSelf({ birthDate: "2030-01-01", today: TODAY })).toMatchObject({
      ok: false,
      code: "bad_birth_date",
    });
    expect(checkNewSelf({ birthDate: "1900-01-01", today: TODAY })).toMatchObject({
      ok: false,
      code: "bad_birth_date",
    });
  });

  it("lets a parent enroll their child while the child is under 18", () => {
    expect(
      checkChildEnrollment({ birthDate: born(9), isJunior: true, today: TODAY, firstName: "Mia" }),
    ).toEqual({ ok: true, relation: "guardian" });
    expect(
      checkChildEnrollment({
        birthDate: born(19),
        isJunior: false,
        today: TODAY,
        firstName: "Mia",
      }),
    ).toEqual({
      ok: false,
      code: "adult_enrolls",
      message: "Mia is 18 or older, so Mia enrolls on their own account.",
    });
  });

  it("needs a new child's birth date, under 18", () => {
    expect(checkNewChild({ birthDate: null, today: TODAY })).toMatchObject({
      ok: false,
      code: "needs_birth_date",
    });
    expect(checkNewChild({ birthDate: "2008-11-06", today: TODAY })).toEqual({
      ok: true,
      relation: "guardian",
    });
    expect(checkNewChild({ birthDate: "2008-11-05", today: TODAY })).toMatchObject({
      ok: false,
      code: "not_a_minor",
    });
    expect(checkNewChild({ birthDate: "2027-01-01", today: TODAY })).toMatchObject({
      ok: false,
      code: "bad_birth_date",
    });
  });

  it("knows a teen's own login", () => {
    expect(isTeenLogin({ birthDate: born(15), isJunior: true }, TODAY)).toBe(true);
    expect(isTeenLogin({ birthDate: born(25), isJunior: false }, TODAY)).toBe(false);
    expect(isTeenLogin(null, TODAY)).toBe(false);
  });

  it("notes a student outside the program's ages without refusing", () => {
    const program = { name: "Evening program", ageMin: 10, ageMax: null };
    expect(programAgeNote(program, born(9), TODAY)).toBe(
      "Evening program is for ages 10 and up, and this student is 9. The academy will check before approving.",
    );
    // Staff read it on the request page, where approving is theirs to decide.
    expect(programAgeNote(program, born(9), TODAY, "staff")).toBe(
      "Evening program is for ages 10 and up, and this student is 9. You can still approve.",
    );
    expect(programAgeNote(program, born(12), TODAY)).toBeNull();
    expect(programAgeNote({ name: "Juniors", ageMin: 9, ageMax: 14 }, born(15), TODAY)).toMatch(
      /ages 9–14/,
    );
    expect(programAgeNote(program, null, TODAY)).toBeNull();
  });
});

describe("capacity", () => {
  it("says how much room is left and whether approving goes over", () => {
    expect(capacityState({ capacity: 16, taken: 12, alreadyIn: false })).toEqual({
      capacity: 16,
      taken: 12,
      left: 4,
      full: false,
      over: false,
    });
    expect(capacityState({ capacity: 16, taken: 16, alreadyIn: false })).toMatchObject({
      left: 0,
      full: true,
      over: true,
    });
    // Someone already in (a renewal) doesn't take another place.
    expect(capacityState({ capacity: 16, taken: 16, alreadyIn: true })).toMatchObject({
      full: true,
      over: false,
    });
    expect(capacityState({ capacity: null, taken: 40, alreadyIn: false })).toEqual({
      capacity: null,
      taken: 40,
      left: null,
      full: false,
      over: false,
    });
    expect(capacityState({ capacity: 0, taken: 3, alreadyIn: false }).over).toBe(false);
  });

  it("counts seats left on a session", () => {
    expect(seatsLeft(8, 5)).toBe(3);
    expect(seatsLeft(8, 9)).toBe(0);
    expect(seatsLeft(null, 5)).toBeNull();
    expect(seatsLeft(undefined, 0)).toBeNull();
  });
});

describe("renewal", () => {
  const tiers = new Map<string, RenewalTierFacts>([
    ["monthly", { id: "monthly", active: true, validityMode: "month_end" }],
    ["retired", { id: "retired", active: false, validityMode: "month_end" }],
    ["pack", { id: "pack", active: true, validityMode: "days" }],
  ]);
  const current: RenewalPackageFacts = {
    id: "cp1",
    packageId: "monthly",
    startMonth: "2026-11",
    status: "active",
    purchasedOn: "2026-11-02",
    enrollmentId: "req1",
  };

  it("offers next month for this month's month-end package", () => {
    expect(renewalFor({ today: TODAY, packages: [current], requests: [], tiers })).toEqual({
      packageId: "monthly",
      fromClientPackageId: "cp1",
      enrollmentId: "req1",
      startMonth: "2026-12",
      startsOn: "2026-12-01",
      expiresOn: "2026-12-31",
    });
    // Used up all its credits: still renewable.
    expect(
      renewalFor({
        today: "2026-11-28",
        packages: [{ ...current, status: "exhausted" }],
        requests: [],
        tiers,
      })?.startMonth,
    ).toBe("2026-12");
  });

  it("offers nothing once next month is covered or asked for", () => {
    const next = { ...current, id: "cp2", startMonth: "2026-12", purchasedOn: "2026-11-20" };
    expect(renewalFor({ today: TODAY, packages: [current, next], requests: [], tiers })).toBeNull();
    for (const status of ["requested", "waitlisted", "approved"] as const) {
      expect(
        renewalFor({
          today: TODAY,
          packages: [current],
          requests: [{ startMonth: "2026-12", status }],
          tiers,
        }),
      ).toBeNull();
    }
    // A declined or cancelled renewal can be asked again.
    expect(
      renewalFor({
        today: TODAY,
        packages: [current],
        requests: [{ startMonth: "2026-12", status: "declined" }],
        tiers,
      }),
    ).not.toBeNull();
    // A voided next-month package doesn't count.
    expect(
      renewalFor({
        today: TODAY,
        packages: [current, { ...next, status: "void" }],
        requests: [],
        tiers,
      }),
    ).not.toBeNull();
  });

  it("offers nothing for other months, retired tiers, day-based packages, or voided ones", () => {
    expect(
      renewalFor({
        today: TODAY,
        packages: [{ ...current, startMonth: "2026-10" }],
        requests: [],
        tiers,
      }),
    ).toBeNull();
    expect(
      renewalFor({
        today: TODAY,
        packages: [{ ...current, packageId: "retired" }],
        requests: [],
        tiers,
      }),
    ).toBeNull();
    expect(
      renewalFor({
        today: TODAY,
        packages: [{ ...current, packageId: "pack", startMonth: null }],
        requests: [],
        tiers,
      }),
    ).toBeNull();
    expect(
      renewalFor({ today: TODAY, packages: [{ ...current, status: "void" }], requests: [], tiers }),
    ).toBeNull();
    expect(
      renewalFor({
        today: TODAY,
        packages: [{ ...current, packageId: null }],
        requests: [],
        tiers,
      }),
    ).toBeNull();
  });

  it("renews across the year end", () => {
    expect(
      renewalFor({
        today: "2026-12-29",
        packages: [{ ...current, startMonth: "2026-12" }],
        requests: [],
        tiers,
      })?.startMonth,
    ).toBe("2027-01");
  });

  it("writes a reminder ready to paste", () => {
    expect(
      renewalReminderMessage({
        academyName: "Riverside Pickleball",
        studentFirstName: "Mia",
        tierName: "Monthly",
        endsOn: "Nov 30",
        nextMonth: "December",
        link: "https://coachman.cloud/my",
      }),
    ).toBe(
      "Hi from Riverside Pickleball. Mia's Monthly ends on Nov 30.\nTo keep training in December, open https://coachman.cloud/my and tap “Renew for next month”.\nThank you.",
    );
  });
});

describe("answers", () => {
  it("rates on a 1.0–5.5 scale with plain-language hints", () => {
    expect(SELF_RATINGS[0]).toBe(1);
    expect(SELF_RATINGS.at(-1)).toBe(5.5);
    expect(isSelfRating(3.5)).toBe(true);
    expect(isSelfRating(3.25)).toBe(false);
    expect(isSelfRating(6)).toBe(false);
    expect(selfRatingHint(1)).toMatch(/New to the game/);
    expect(selfRatingHint(3.5)).toMatch(/drops and resets/);
    expect(selfRatingHint(5.5)).toMatch(/Professional/);
    // Every level reads differently.
    expect(new Set(SELF_RATINGS.map(selfRatingHint)).size).toBe(SELF_RATINGS.length);
  });

  it("validates the wizard's request", () => {
    const valid = {
      slug: "riverside",
      packageId: "0190f4a8-6a1c-7cc0-9a5e-3f1d2c4b5a60",
      who: { kind: "new_child", firstName: "Mia", birthDate: "2017-03-04" },
      startMonth: "2026-12",
      answers: {
        phone: "0917 555 0100",
        emergencyName: "Pat Santos",
        emergencyPhone: "0917 555 0101",
        shirtSize: "Kids M",
        selfRating: 2.5,
        pickups: [{ name: "Lola Santos", relationship: "Grandmother", phone: "0917 555 0102" }],
      },
    };
    const parsed = enrollmentSubmitSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.who).toEqual({
      kind: "new_child",
      firstName: "Mia",
      lastName: "",
      birthDate: "2017-03-04",
    });
    expect(parsed.data?.signatures).toEqual([]);
    const bad = enrollmentSubmitSchema.safeParse({
      ...valid,
      answers: { ...valid.answers, shirtSize: "Huge", selfRating: 3.3, phone: "1" },
    });
    expect(bad.success).toBe(false);
    const paths = (bad.error?.issues ?? []).map((i) => i.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining(["answers.shirtSize", "answers.selfRating", "answers.phone"]),
    );
    expect(ALL_UNIFORM_SIZES).toContain("Kids M");
    expect(ALL_UNIFORM_SIZES).toContain("Adult XL");
  });
});

describe("what's owed for an approved request", () => {
  it("summarizes a charge and the payments covering it", () => {
    expect(paymentSummary("ch1", 600000, 0)).toEqual({
      chargeId: "ch1",
      amountMinor: 600000,
      paidMinor: 0,
      dueMinor: 600000,
      status: "unpaid",
    });
    expect(paymentSummary("ch1", 600000, 200000)).toMatchObject({
      dueMinor: 400000,
      status: "partial",
    });
    expect(paymentSummary("ch1", 600000, 700000)).toMatchObject({
      paidMinor: 600000,
      dueMinor: 0,
      status: "paid",
    });
  });

  it("shows a payment only once approved; a free tier owes nothing", () => {
    const payments = new Map([["ch1", paymentSummary("ch1", 1000, 0)]]);
    expect(requestPayment({ status: "requested", chargeId: null }, payments)).toBeNull();
    expect(requestPayment({ status: "approved", chargeId: "ch1" }, payments)?.status).toBe(
      "unpaid",
    );
    expect(requestPayment({ status: "approved", chargeId: null }, payments)).toMatchObject({
      dueMinor: 0,
      status: "paid",
    });
    // A charge voided since (the package was voided): nothing to show.
    expect(requestPayment({ status: "approved", chargeId: "gone" }, payments)).toBeNull();
  });
});

describe("abandoned passkey-only accounts and enrollment", () => {
  const old: AccountFootprint = {
    email: "u-0190f4a8-6a1c-7cc0-9a5e-3f1d2c4b5a60@passkey.coachman.invalid",
    createdAt: 0,
    passkeys: 0,
    familyLinks: 0,
    memberships: 0,
  };
  const now = ABANDONED_ACCOUNT_MS + 1;

  it("keeps an account that sent an enrollment request", () => {
    expect(isAbandonedPasskeyAccount(old, now)).toBe(true);
    expect(isAbandonedPasskeyAccount({ ...old, enrollmentRequests: 0 }, now)).toBe(true);
    expect(isAbandonedPasskeyAccount({ ...old, enrollmentRequests: 1 }, now)).toBe(false);
  });
});
