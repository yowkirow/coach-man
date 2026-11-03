import { describe, expect, it } from "vitest";
import { checkFamilyAccess } from "../../src/shared/family";

const today = "2026-11-03";
const base = { birthDate: null, isJunior: false, today, hasGuardian: false };

describe("family access age rules", () => {
  it("lets parents link to minors only", () => {
    expect(checkFamilyAccess({ ...base, relation: "guardian", birthDate: "2016-05-01" }).ok).toBe(
      true,
    );
    expect(checkFamilyAccess({ ...base, relation: "guardian", birthDate: "2000-05-01" })).toEqual(
      expect.objectContaining({ ok: false, code: "not_a_minor" }),
    );
    // Without a birth date, "junior" decides.
    expect(checkFamilyAccess({ ...base, relation: "guardian", isJunior: true }).ok).toBe(true);
    expect(checkFamilyAccess({ ...base, relation: "guardian" }).ok).toBe(false);
  });

  it("gives adults their own login", () => {
    expect(checkFamilyAccess({ ...base, relation: "self", birthDate: "1990-01-01" }).ok).toBe(true);
    expect(checkFamilyAccess({ ...base, relation: "self" }).ok).toBe(true);
  });

  it("gives teens a login only once a parent is linked", () => {
    const teen = { ...base, relation: "self" as const, birthDate: "2011-01-01" };
    expect(checkFamilyAccess(teen)).toEqual(
      expect.objectContaining({ ok: false, code: "needs_guardian" }),
    );
    expect(checkFamilyAccess({ ...teen, hasGuardian: true }).ok).toBe(true);
  });

  it("never gives under-13s their own login", () => {
    const child = {
      ...base,
      relation: "self" as const,
      birthDate: "2015-01-01",
      hasGuardian: true,
    };
    expect(checkFamilyAccess(child)).toEqual(
      expect.objectContaining({ ok: false, code: "too_young" }),
    );
    expect(
      checkFamilyAccess({ ...base, relation: "self", isJunior: true, hasGuardian: true }),
    ).toEqual(expect.objectContaining({ ok: false, code: "needs_birth_date" }));
  });

  it("counts birthdays exactly", () => {
    // Turns 13 today: may have a login (with a parent); turns 13 tomorrow: not yet.
    const t = { ...base, relation: "self" as const, hasGuardian: true };
    expect(checkFamilyAccess({ ...t, birthDate: "2013-11-03" }).ok).toBe(true);
    expect(checkFamilyAccess({ ...t, birthDate: "2013-11-04" }).ok).toBe(false);
    // Turns 18 today: an adult, so parent access no longer applies.
    expect(checkFamilyAccess({ ...base, relation: "guardian", birthDate: "2008-11-03" }).ok).toBe(
      false,
    );
    expect(checkFamilyAccess({ ...base, relation: "guardian", birthDate: "2008-11-04" }).ok).toBe(
      true,
    );
  });
});
