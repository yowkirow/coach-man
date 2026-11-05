import { describe, expect, it } from "vitest";
import {
  checkTeenInvite,
  endsTeenLogins,
  familyInviteMessage,
  familyRefusalMessage,
} from "../../src/shared/family";
import { staffInviteSchema } from "../../src/shared/schemas";
import { checkFamilyAcceptance, checkStaffAcceptance } from "../../src/worker/lib/invites";

const today = "2026-11-05";
const minor = { firstName: "Mia", birthDate: "2014-03-01", isJunior: true }; // 12
const teen = { firstName: "Leo", birthDate: "2011-01-15", isJunior: true }; // 15
const adult = { firstName: "Ana", birthDate: "1990-06-01", isJunior: false };
const unknownJunior = { firstName: "Kai", birthDate: null, isJunior: true };
const unknownAdult = { firstName: "Sam", birthDate: null, isJunior: false };
const google = { email: "pat@gmail.com", passkeys: 0, hasGoogle: true };

const base = {
  status: "valid" as const,
  relation: "guardian" as const,
  student: minor,
  today,
  hasGuardian: false,
  alreadyLinked: false,
  user: google,
};

describe("accepting a family invite", () => {
  it("links a parent to a minor, or to a junior whose birth date is unknown", () => {
    expect(checkFamilyAcceptance(base)).toEqual({ ok: true });
    expect(checkFamilyAcceptance({ ...base, student: unknownJunior })).toEqual({ ok: true });
    expect(checkFamilyAcceptance({ ...base, student: teen })).toEqual({ ok: true });
  });

  it("refuses a parent link to an adult, explaining it to the family", () => {
    for (const student of [adult, unknownAdult]) {
      const res = checkFamilyAcceptance({ ...base, student });
      expect(res).toMatchObject({ ok: false, status: 409, code: "not_a_minor" });
      if (!res.ok) expect(res.message).toContain(student.firstName);
    }
  });

  it("gives adults their own login, with or without a birth date", () => {
    expect(checkFamilyAcceptance({ ...base, relation: "self", student: adult })).toEqual({
      ok: true,
    });
    expect(checkFamilyAcceptance({ ...base, relation: "self", student: unknownAdult })).toEqual({
      ok: true,
    });
  });

  it("gives a 13–17 year old their own login only once a parent is linked", () => {
    const self = { ...base, relation: "self" as const, student: teen };
    expect(checkFamilyAcceptance(self)).toMatchObject({
      ok: false,
      status: 409,
      code: "needs_guardian",
    });
    expect(checkFamilyAcceptance({ ...self, hasGuardian: true })).toEqual({ ok: true });
  });

  it("never gives an under-13 their own login, and needs a birth date for a junior's", () => {
    const self = { ...base, relation: "self" as const, hasGuardian: true };
    expect(checkFamilyAcceptance({ ...self, student: minor })).toMatchObject({
      ok: false,
      code: "too_young",
    });
    expect(checkFamilyAcceptance({ ...self, student: unknownJunior })).toMatchObject({
      ok: false,
      code: "needs_birth_date",
    });
  });

  it("checks the age on the day of acceptance (a birthday since the invite counts)", () => {
    const turns13 = { firstName: "Zoe", birthDate: "2013-11-05", isJunior: true };
    const self = { ...base, relation: "self" as const, hasGuardian: true };
    expect(checkFamilyAcceptance({ ...self, student: turns13 })).toEqual({ ok: true });
    expect(checkFamilyAcceptance({ ...self, student: turns13, today: "2026-11-04" })).toMatchObject(
      {
        ok: false,
        code: "too_young",
      },
    );
    const turns18 = { firstName: "Max", birthDate: "2008-11-05", isJunior: true };
    expect(checkFamilyAcceptance({ ...base, student: turns18 })).toMatchObject({
      code: "not_a_minor",
    });
  });

  it("never answers yes to a used, withdrawn, or expired link, whatever else holds", () => {
    for (const [status, code] of [
      ["used", "invite_used"],
      ["revoked", "invite_revoked"],
      ["expired", "invite_expired"],
    ] as const) {
      expect(checkFamilyAcceptance({ ...base, status })).toMatchObject({
        ok: false,
        status: 410,
        code,
      });
      // Even for someone already linked, and before the age rules.
      expect(
        checkFamilyAcceptance({ ...base, status, alreadyLinked: true, student: adult }),
      ).toMatchObject({ ok: false, status: 410, code });
    }
  });

  it("tells someone already following the student so, and changes nothing", () => {
    const res = checkFamilyAcceptance({ ...base, alreadyLinked: true });
    expect(res).toMatchObject({ ok: false, status: 409, code: "already_linked" });
    if (!res.ok) expect(res.message).toContain("Mia");
    // Whatever the relation of the link they already have.
    expect(
      checkFamilyAcceptance({ ...base, relation: "self", student: adult, alreadyLinked: true }),
    ).toMatchObject({ code: "already_linked" });
  });

  it("needs a passkey before a passkey-only account holds access", () => {
    const fresh = { email: "u-123@passkey.coachman.invalid", passkeys: 0, hasGoogle: false };
    expect(checkFamilyAcceptance({ ...base, user: fresh })).toMatchObject({
      ok: false,
      code: "passkey_required",
    });
    expect(checkFamilyAcceptance({ ...base, user: { ...fresh, passkeys: 1 } })).toEqual({
      ok: true,
    });
    expect(checkFamilyAcceptance({ ...base, user: { ...fresh, hasGoogle: true } })).toEqual({
      ok: true,
    });
  });

  it("refuses an invite whose student is gone", () => {
    expect(checkFamilyAcceptance({ ...base, student: null })).toMatchObject({
      ok: false,
      status: 404,
      code: "invite_not_found",
    });
  });

  it("explains each age rule to the family in plain words", () => {
    expect(familyRefusalMessage("needs_guardian", "Leo")).toMatch(/parent linked first/);
    expect(familyRefusalMessage("needs_birth_date", "Kai")).toMatch(/Kai's birth date/);
    expect(familyRefusalMessage("too_young", "Mia")).toMatch(/under 13/);
    expect(familyRefusalMessage("not_a_minor", "Ana")).toMatch(/under 18, and Ana isn't/);
  });
});

describe("parents making their teen's own login", () => {
  const input = { today, firstName: "Leo" };
  it("is for 13 to 17 year olds with a birth date", () => {
    expect(checkTeenInvite({ ...input, birthDate: "2011-01-15", isJunior: true })).toEqual({
      ok: true,
    });
    expect(checkTeenInvite({ ...input, birthDate: "2013-11-05", isJunior: true })).toEqual({
      ok: true,
    });
  });

  it("refuses under-13s, adults, and juniors without a birth date", () => {
    expect(checkTeenInvite({ ...input, birthDate: "2014-03-01", isJunior: true })).toMatchObject({
      ok: false,
      code: "too_young",
    });
    expect(checkTeenInvite({ ...input, birthDate: "2008-11-05", isJunior: true })).toMatchObject({
      ok: false,
      code: "not_a_minor",
    });
    expect(checkTeenInvite({ ...input, birthDate: null, isJunior: true })).toMatchObject({
      ok: false,
      code: "needs_birth_date",
    });
    expect(checkTeenInvite({ ...input, birthDate: null, isJunior: false })).toMatchObject({
      ok: false,
      code: "not_a_minor",
    });
  });
});

describe("when a parent's access ends", () => {
  it("ends a minor's own login with the last parent, and only then", () => {
    const teenRow = { birthDate: "2011-01-15", isJunior: true, today };
    expect(endsTeenLogins({ ...teenRow, guardiansLeft: 0 })).toBe(true);
    expect(endsTeenLogins({ ...teenRow, guardiansLeft: 1 })).toBe(false);
    // An adult's own login never depended on a parent.
    expect(
      endsTeenLogins({ birthDate: "1990-01-01", isJunior: false, today, guardiansLeft: 0 }),
    ).toBe(false);
  });
});

describe("family invite messages", () => {
  it("names the academy, the student, the link, and the expiry, with no email involved", () => {
    const parent = familyInviteMessage({
      academyName: "Riverside Pickleball Academy",
      firstName: "Mia",
      relation: "guardian",
      link: "https://coachman.cloud/join/abc",
      expires: "Wed 12 Nov",
    });
    expect(parent).toContain("Riverside Pickleball Academy invited you to follow Mia's training");
    expect(parent).toContain("https://coachman.cloud/join/abc");
    expect(parent).toContain("until Wed 12 Nov");
    expect(parent).toContain("passkey");
    const own = familyInviteMessage({
      academyName: "Riverside",
      firstName: "Leo",
      relation: "self",
      link: "https://x/join/y",
      expires: "Fri 14 Nov",
    });
    expect(own).toContain("to see your own training");
    expect(own).not.toContain("Leo's");
  });
});

describe("placeholder emails never meet staff invites", () => {
  const placeholder = "u-5f2b8c1e-0000-4000-8000-000000000000@passkey.coachman.invalid";

  it("can't be invited as staff", () => {
    expect(staffInviteSchema.safeParse({ email: placeholder, role: "coach" }).success).toBe(false);
    expect(
      staffInviteSchema.safeParse({ email: placeholder.toUpperCase(), role: "admin" }).success,
    ).toBe(false);
    expect(staffInviteSchema.safeParse({ email: "sam@gmail.com", role: "coach" }).success).toBe(
      true,
    );
  });

  it("can't accept a staff invite, even one made out to the same address", () => {
    expect(
      checkStaffAcceptance({
        status: "valid",
        inviteEmail: placeholder,
        user: { email: placeholder, emailVerified: true },
      }),
    ).toMatchObject({ ok: false, status: 403, code: "wrong_email" });
  });
});
