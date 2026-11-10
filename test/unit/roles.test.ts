import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_NAMES,
  type Capability,
  COACHING_ROLES,
  can,
  capabilitiesFor,
  isCoachingRole,
  normalizeRole,
  STAFF_ROLE_LABELS,
  STAFF_ROLE_NOUNS,
  STAFF_ROLES,
  type StaffRole,
} from "../../src/shared/roles";

// The permission matrix, written out by hand so a change to CAPABILITIES has to be deliberate.
const MATRIX: Record<Capability, Record<StaffRole, boolean>> = {
  money: { owner: true, admin: true, front_desk: true, coach: false },
  catalog: { owner: true, admin: true, front_desk: false, coach: false },
  team: { owner: true, admin: true, front_desk: false, coach: false },
  settings: { owner: true, admin: true, front_desk: false, coach: false },
  enrollment: { owner: true, admin: true, front_desk: true, coach: false },
  familyAccess: { owner: true, admin: true, front_desk: true, coach: false },
  announcements: { owner: true, admin: true, front_desk: false, coach: false },
  data: { owner: true, admin: true, front_desk: false, coach: false },
  ownership: { owner: true, admin: false, front_desk: false, coach: false },
};

describe("roles and capabilities", () => {
  it("covers every capability in the matrix", () => {
    expect(new Set(CAPABILITY_NAMES)).toEqual(new Set(Object.keys(MATRIX)));
    expect(CAPABILITY_NAMES).toEqual(Object.keys(CAPABILITIES));
  });

  it("lists the roles most senior first, each with a label and a noun", () => {
    expect(STAFF_ROLES).toEqual(["owner", "admin", "front_desk", "coach"]);
    expect(STAFF_ROLE_LABELS).toEqual({
      owner: "Owner",
      admin: "Admin",
      front_desk: "Front desk",
      coach: "Coach",
    });
    expect(STAFF_ROLE_NOUNS).toEqual({
      owner: "an owner",
      admin: "an admin",
      front_desk: "front desk staff",
      coach: "a coach",
    });
  });

  for (const cap of Object.keys(MATRIX) as Capability[]) {
    for (const role of STAFF_ROLES) {
      it(`${role} ${MATRIX[cap][role] ? "can" : "can't"} use ${cap}`, () => {
        expect(can(role, cap)).toBe(MATRIX[cap][role]);
      });
    }
  }

  it("gives coaches no capabilities at all", () => {
    expect(Object.values(capabilitiesFor("coach")).some(Boolean)).toBe(false);
  });

  it("reports every capability for a role", () => {
    expect(capabilitiesFor("admin")).toEqual({
      money: true,
      catalog: true,
      team: true,
      settings: true,
      enrollment: true,
      familyAccess: true,
      announcements: true,
      data: true,
      ownership: false,
    });
    expect(Object.values(capabilitiesFor("owner")).every(Boolean)).toBe(true);
  });

  it("gives the front desk money, enrollments, and family access, and nothing else", () => {
    expect(capabilitiesFor("front_desk")).toEqual({
      money: true,
      catalog: false,
      team: false,
      settings: false,
      enrollment: true,
      familyAccess: true,
      announcements: false,
      data: false,
      ownership: false,
    });
  });

  it("treats legacy and unknown roles as coach", () => {
    expect(normalizeRole("member")).toBe("coach");
    expect(normalizeRole("superuser")).toBe("coach");
    expect(normalizeRole("")).toBe("coach");
    expect(normalizeRole(null)).toBe("coach");
    expect(normalizeRole(undefined)).toBe("coach");
    expect(can("member", "money")).toBe(false);
    expect(can(undefined, "money")).toBe(false);
  });

  it("reads comma-separated roles by their most senior part", () => {
    expect(normalizeRole("admin,member")).toBe("admin");
    expect(normalizeRole("member, owner")).toBe("owner");
    expect(normalizeRole("coach,admin")).toBe("admin");
    expect(normalizeRole(" Owner ")).toBe("owner");
    expect(can("member,admin", "money")).toBe(true);
    expect(can("member,admin", "ownership")).toBe(false);
  });

  it("reads the front desk's role, alone or with others", () => {
    expect(normalizeRole("front_desk")).toBe("front_desk");
    expect(normalizeRole(" Front_Desk ")).toBe("front_desk");
    expect(normalizeRole("member,front_desk")).toBe("front_desk");
    expect(normalizeRole("front_desk, coach")).toBe("front_desk");
    expect(normalizeRole("front_desk,admin")).toBe("admin");
    expect(normalizeRole("owner,front_desk")).toBe("owner");
    // Only the stored id counts: a label or a camelCase id is an unknown role, so a coach.
    expect(normalizeRole("front desk")).toBe("coach");
    expect(normalizeRole("frontDesk")).toBe("coach");
    expect(can("member,front_desk", "money")).toBe(true);
    expect(can("member,front_desk", "catalog")).toBe(false);
  });
});

describe("who coaches", () => {
  it("is everyone but the front desk", () => {
    expect(COACHING_ROLES).toEqual(["owner", "admin", "coach"]);
    expect(STAFF_ROLES.filter((r) => isCoachingRole(r))).toEqual(["owner", "admin", "coach"]);
    expect(isCoachingRole("front_desk")).toBe(false);
  });

  it("reads stored roles like the capabilities do", () => {
    expect(isCoachingRole("member")).toBe(true);
    expect(isCoachingRole(null)).toBe(true);
    expect(isCoachingRole("admin,member")).toBe(true);
    expect(isCoachingRole("member,front_desk")).toBe(false);
    expect(isCoachingRole("front_desk,admin")).toBe(true);
  });

  it("isn't a capability: it decides who can be named a coach, not what anyone may do", () => {
    expect(CAPABILITY_NAMES).not.toContain("coaching");
  });
});
