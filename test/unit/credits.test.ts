import { describe, expect, it } from "vitest";
import {
  decideFunding,
  effectivePrice,
  type PackageWithRemaining,
  packageCovers,
  statusConsumes,
  usablePackages,
} from "../../src/worker/services/credits";

const pkg = (over: Partial<PackageWithRemaining>): PackageWithRemaining => ({
  id: "p",
  clientId: "c",
  name: "10-session pack",
  creditsTotal: 10,
  remaining: 5,
  expiresOn: null,
  purchasedOn: "2026-01-01",
  status: "active",
  lessonKinds: [],
  ...over,
});

describe("packageCovers", () => {
  it("covers every kind when no kinds are listed, except event sessions", () => {
    expect(packageCovers({ lessonKinds: [] }, "private")).toBe(true);
    expect(packageCovers({ lessonKinds: [] }, "group")).toBe(true);
    expect(packageCovers({ lessonKinds: [] }, "event")).toBe(false);
  });

  it("covers only the listed kinds", () => {
    expect(packageCovers({ lessonKinds: ["group", "clinic"] }, "clinic")).toBe(true);
    expect(packageCovers({ lessonKinds: ["group", "clinic"] }, "private")).toBe(false);
  });
});

describe("usablePackages", () => {
  it("uses the earliest-expiring package first and never-expiring ones last", () => {
    const list = usablePackages(
      [
        pkg({ id: "never", expiresOn: null, purchasedOn: "2026-01-01" }),
        pkg({ id: "late", expiresOn: "2026-12-31" }),
        pkg({ id: "soon", expiresOn: "2026-03-01" }),
      ],
      "private",
      "2026-02-01",
    );
    expect(list.map((p) => p.id)).toEqual(["soon", "late", "never"]);
  });

  it("breaks expiry ties by purchase date", () => {
    const list = usablePackages(
      [
        pkg({ id: "newer", expiresOn: null, purchasedOn: "2026-02-01" }),
        pkg({ id: "older", expiresOn: null, purchasedOn: "2026-01-01" }),
      ],
      "group",
      "2026-02-10",
    );
    expect(list.map((p) => p.id)).toEqual(["older", "newer"]);
  });

  it("skips empty, expired, voided, and non-covering packages", () => {
    const list = usablePackages(
      [
        pkg({ id: "empty", remaining: 0 }),
        pkg({ id: "lapsed", expiresOn: "2026-01-31" }),
        pkg({ id: "expired", status: "expired" }),
        pkg({ id: "void", status: "void" }),
        pkg({ id: "groups-only", lessonKinds: ["group"] }),
        pkg({ id: "ok" }),
      ],
      "private",
      "2026-02-01",
    );
    expect(list.map((p) => p.id)).toEqual(["ok"]);
  });

  it("still allows a package on its expiry date", () => {
    const list = usablePackages(
      [pkg({ id: "last-day", expiresOn: "2026-02-01" })],
      "private",
      "2026-02-01",
    );
    expect(list).toHaveLength(1);
  });
});

describe("statusConsumes", () => {
  const strict = { noShowUsesCredit: true, lateCancelUsesCredit: true };
  const lenient = { noShowUsesCredit: false, lateCancelUsesCredit: false };

  it("always consumes for present and late", () => {
    expect(statusConsumes("present", lenient)).toBe(true);
    expect(statusConsumes("late", lenient)).toBe(true);
  });

  it("follows workspace policy for no-shows and late cancels", () => {
    expect(statusConsumes("no_show", strict)).toBe(true);
    expect(statusConsumes("no_show", lenient)).toBe(false);
    expect(statusConsumes("late_cancel", strict)).toBe(true);
    expect(statusConsumes("late_cancel", lenient)).toBe(false);
  });

  it("never consumes for booked, absent, or excused", () => {
    for (const s of ["booked", "absent", "excused"] as const) {
      expect(statusConsumes(s, strict)).toBe(false);
    }
  });
});

describe("decideFunding", () => {
  const usable = [{ id: "first" }, { id: "second" }];

  it("releases funding when the status no longer consumes", () => {
    expect(
      decideFunding({
        consumes: false,
        requestedPackageId: undefined,
        current: { type: "package", id: "x" },
        usable,
      }),
    ).toEqual({ type: "none" });
  });

  it("picks the first usable package automatically", () => {
    expect(
      decideFunding({
        consumes: true,
        requestedPackageId: undefined,
        current: { type: "none" },
        usable,
      }),
    ).toEqual({
      type: "package",
      id: "first",
    });
  });

  it("falls back to a pay-per-session charge without a usable package", () => {
    expect(
      decideFunding({
        consumes: true,
        requestedPackageId: undefined,
        current: { type: "none" },
        usable: [],
      }),
    ).toEqual({
      type: "charge",
    });
  });

  it("keeps existing funding when re-marking (present → late)", () => {
    expect(
      decideFunding({
        consumes: true,
        requestedPackageId: undefined,
        current: { type: "package", id: "second" },
        usable,
      }),
    ).toEqual({ type: "package", id: "second" });
  });

  it("honours an explicit package or pay-per-session choice", () => {
    expect(
      decideFunding({
        consumes: true,
        requestedPackageId: "second",
        current: { type: "none" },
        usable,
      }),
    ).toEqual({
      type: "package",
      id: "second",
    });
    expect(
      decideFunding({
        consumes: true,
        requestedPackageId: "none",
        current: { type: "package", id: "first" },
        usable,
      }),
    ).toEqual({ type: "charge" });
  });
});

describe("effectivePrice", () => {
  const hour = 3_600_000;
  it("prefers the session's own price", () => {
    expect(
      effectivePrice(
        { priceMinor: 50000, startsAt: 0, endsAt: hour },
        { priceMinor: 80000, unit: "session" },
      ),
    ).toBe(50000);
  });

  it("uses a per-session rate as is", () => {
    expect(
      effectivePrice(
        { priceMinor: null, startsAt: 0, endsAt: 2 * hour },
        { priceMinor: 80000, unit: "session" },
      ),
    ).toBe(80000);
  });

  it("prorates hourly rates by duration", () => {
    expect(
      effectivePrice(
        { priceMinor: null, startsAt: 0, endsAt: 1.5 * hour },
        { priceMinor: 100000, unit: "hour" },
      ),
    ).toBe(150000);
  });

  it("is free without a price or rate", () => {
    expect(effectivePrice({ priceMinor: null, startsAt: 0, endsAt: hour }, null)).toBe(0);
  });
});
