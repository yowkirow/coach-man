import { describe, expect, it } from "vitest";
import { localDate, todayIn } from "../../src/shared/time";
import {
  addMonths,
  coversDate,
  isAllowedStartMonth,
  lastDayOf,
  monthOf,
  packageStartsOn,
  saleTerms,
  startMonthChoices,
} from "../../src/shared/validity";
import {
  decideFunding,
  type PackageWithRemaining,
  unusableReason,
  usablePackages,
} from "../../src/worker/services/credits";

const MANILA = "Asia/Manila";

describe("months", () => {
  it("finds the last day of every kind of month", () => {
    expect(lastDayOf("2026-01")).toBe("2026-01-31");
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2028-02")).toBe("2028-02-29");
    expect(lastDayOf("2100-02")).toBe("2100-02-28");
    expect(lastDayOf("2026-04")).toBe("2026-04-30");
    expect(lastDayOf("2026-12")).toBe("2026-12-31");
  });

  it("moves across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 14)).toBe("2028-01");
    expect(monthOf("2026-11-05")).toBe("2026-11");
  });

  it("offers this month and next, by the academy's own date", () => {
    expect(startMonthChoices("2026-11-30")).toEqual(["2026-11", "2026-12"]);
    expect(startMonthChoices("2026-12-31")).toEqual(["2026-12", "2027-01"]);
    expect(isAllowedStartMonth("2026-12", "2026-11-01")).toBe(true);
    expect(isAllowedStartMonth("2027-01", "2026-11-30")).toBe(false);
    expect(isAllowedStartMonth("2026-10", "2026-11-01")).toBe(false);
    expect(isAllowedStartMonth("2026-13", "2026-12-01")).toBe(false);
  });

  it("uses the academy's time zone for 'this month' near midnight", () => {
    // 16:30 UTC on Nov 30 is already 00:30 on Dec 1 in Manila (UTC+8).
    const instant = Date.UTC(2026, 10, 30, 16, 30);
    expect(todayIn("UTC", instant)).toBe("2026-11-30");
    expect(todayIn(MANILA, instant)).toBe("2026-12-01");
    expect(startMonthChoices(todayIn(MANILA, instant))).toEqual(["2026-12", "2027-01"]);
    expect(startMonthChoices(todayIn("UTC", instant))).toEqual(["2026-11", "2026-12"]);
  });
});

describe("saleTerms", () => {
  const monthly = { validityMode: "month_end" as const, validityDays: null };
  const days30 = { validityMode: "days" as const, validityDays: 30 };

  it("starts a month-end package this month by default and ends it on the month's last day", () => {
    const result = saleTerms({ ...monthly, today: "2026-11-20" });
    expect(result).toEqual({
      ok: true,
      terms: { purchasedOn: "2026-11-20", startMonth: "2026-11", expiresOn: "2026-11-30" },
    });
  });

  it("starts next month on request, without proration, whatever expiry was asked for", () => {
    const result = saleTerms({
      ...monthly,
      today: "2026-11-20",
      startMonth: "2026-12",
      expiresOn: "2027-06-30",
    });
    expect(result).toEqual({
      ok: true,
      terms: { purchasedOn: "2026-11-20", startMonth: "2026-12", expiresOn: "2026-12-31" },
    });
  });

  it("rolls into the new year", () => {
    const result = saleTerms({ ...monthly, today: "2026-12-28", startMonth: "2027-01" });
    expect(result.ok && result.terms.expiresOn).toBe("2027-01-31");
  });

  it("refuses months other than this one and the next", () => {
    for (const startMonth of ["2026-10", "2027-01", "2026-13"]) {
      const result = saleTerms({ ...monthly, today: "2026-11-20", startMonth });
      expect(result).toMatchObject({ ok: false, field: "startMonth" });
    }
  });

  it("keeps day-based packages as they were: purchase day plus the validity", () => {
    expect(saleTerms({ ...days30, today: "2026-11-20" })).toEqual({
      ok: true,
      terms: { purchasedOn: "2026-11-20", startMonth: null, expiresOn: "2026-12-19" },
    });
    expect(
      saleTerms({ ...days30, today: "2026-11-20", purchasedOn: "2026-11-01", expiresOn: null }),
    ).toEqual({
      ok: true,
      terms: { purchasedOn: "2026-11-01", startMonth: null, expiresOn: null },
    });
    expect(saleTerms({ validityMode: "days", validityDays: null, today: "2026-11-20" })).toEqual({
      ok: true,
      terms: { purchasedOn: "2026-11-20", startMonth: null, expiresOn: null },
    });
  });
});

describe("coversDate", () => {
  const nextMonth = { purchasedOn: "2026-11-20", startMonth: "2026-12", expiresOn: "2026-12-31" };
  const days = { purchasedOn: "2026-11-20", startMonth: null, expiresOn: "2026-12-19" };

  it("starts a month-end package on the first of its month", () => {
    expect(packageStartsOn(nextMonth)).toBe("2026-12-01");
    expect(coversDate(nextMonth, "2026-11-30")).toBe(false);
    expect(coversDate(nextMonth, "2026-12-01")).toBe(true);
    expect(coversDate(nextMonth, "2026-12-31")).toBe(true);
    expect(coversDate(nextMonth, "2027-01-01")).toBe(false);
  });

  it("starts a day-based package on its purchase day", () => {
    expect(packageStartsOn(days)).toBe("2026-11-20");
    expect(coversDate(days, "2026-11-19")).toBe(false);
    expect(coversDate(days, "2026-11-20")).toBe(true);
    expect(coversDate(days, "2026-12-19")).toBe(true);
    expect(coversDate(days, "2026-12-20")).toBe(false);
  });

  it("judges a session by its local date in the academy's time zone", () => {
    // A 7 a.m. session in Manila on Dec 1 is still Nov 30 in UTC.
    const startsAt = Date.UTC(2026, 10, 30, 23, 0);
    expect(coversDate(nextMonth, localDate(startsAt, MANILA))).toBe(true);
    expect(coversDate(nextMonth, localDate(startsAt, "UTC"))).toBe(false);
    // 11 p.m. on Nov 30 in Manila is 15:00 UTC: still November, not paid by December's package.
    const lateNovember = Date.UTC(2026, 10, 30, 15, 0);
    expect(coversDate(nextMonth, localDate(lateNovember, MANILA))).toBe(false);
  });
});

const pkg = (over: Partial<PackageWithRemaining>): PackageWithRemaining => ({
  id: "p",
  clientId: "c",
  packageId: null,
  name: "Monthly",
  creditsTotal: 6,
  remaining: 6,
  expiresOn: null,
  purchasedOn: "2026-11-20",
  startMonth: null,
  startsOn: "2026-11-20",
  status: "active",
  lessonKinds: [],
  includesUniform: false,
  uniformSize: null,
  uniformIssuedAt: null,
  ...over,
});

describe("credit eligibility", () => {
  const december = pkg({
    id: "december",
    startMonth: "2026-12",
    startsOn: "2026-12-01",
    expiresOn: "2026-12-31",
  });
  const pack = pkg({ id: "pack", name: "10-pack", expiresOn: "2027-02-01" });

  it("never lets next month's package pay for this month's session", () => {
    expect(usablePackages([december], "group", "2026-11-26")).toEqual([]);
    expect(usablePackages([december, pack], "group", "2026-11-26").map((p) => p.id)).toEqual([
      "pack",
    ]);
    // With nothing usable, the check-in falls back to a pay-per-session charge.
    expect(
      decideFunding({
        consumes: true,
        requestedPackageId: undefined,
        current: { type: "none" },
        usable: usablePackages([december], "group", "2026-11-26"),
      }),
    ).toEqual({ type: "charge" });
  });

  it("uses it from the first of its month, earliest expiry first", () => {
    expect(usablePackages([pack, december], "group", "2026-12-01").map((p) => p.id)).toEqual([
      "december",
      "pack",
    ]);
    expect(usablePackages([december], "group", "2027-01-01")).toEqual([]);
  });

  it("doesn't pay for sessions before a day-based package was bought", () => {
    expect(usablePackages([pack], "private", "2026-11-19")).toEqual([]);
    expect(usablePackages([pack], "private", "2026-11-20")).toHaveLength(1);
  });

  it("says why a chosen package can't pay", () => {
    const label = (ymd: string) => `[${ymd}]`;
    expect(unusableReason(december, "group", "2026-11-26", label)).toBe(
      "it starts on [2026-12-01]",
    );
    expect(unusableReason(december, "group", "2027-01-02", label)).toBe(
      "it expired on [2026-12-31]",
    );
    expect(unusableReason({ ...pack, remaining: 0 }, "group", "2026-12-02", label)).toBe(
      "it has no credits left",
    );
    expect(
      unusableReason({ ...pack, lessonKinds: ["group"] }, "private", "2026-12-02", label),
    ).toBe("it doesn't cover this kind of session");
    expect(unusableReason(december, "group", "2026-12-02", label)).toBeNull();
  });
});
