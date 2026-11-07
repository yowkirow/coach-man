import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_NAMES,
  type Capability,
  can,
  capabilitiesFor,
  normalizeRole,
  STAFF_ROLES,
  type StaffRole,
} from "../../src/shared/roles";

// The permission matrix, written out by hand so a change to CAPABILITIES has to be deliberate.
const MATRIX: Record<Capability, Record<StaffRole, boolean>> = {
  money: { owner: true, admin: true, coach: false },
  catalog: { owner: true, admin: true, coach: false },
  team: { owner: true, admin: true, coach: false },
  settings: { owner: true, admin: true, coach: false },
  enrollment: { owner: true, admin: true, coach: false },
  familyAccess: { owner: true, admin: true, coach: false },
  announcements: { owner: true, admin: true, coach: false },
  data: { owner: true, admin: true, coach: false },
  ownership: { owner: true, admin: false, coach: false },
};

describe("roles and capabilities", () => {
  it("covers every capability in the matrix", () => {
    expect(new Set(CAPABILITY_NAMES)).toEqual(new Set(Object.keys(MATRIX)));
    expect(CAPABILITY_NAMES).toEqual(Object.keys(CAPABILITIES));
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
});
