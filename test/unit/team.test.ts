import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  checkRemoval,
  checkRoleChange,
  checkTransfer,
  staffInviteMessage,
} from "../../src/shared/team";

describe("changing roles", () => {
  it("lets owners and admins change coaches and admins", () => {
    for (const actorRole of ["owner", "admin"] as const) {
      expect(
        checkRoleChange({ actorRole, targetRole: "coach", newRole: "admin", ownerCount: 1 }).ok,
      ).toBe(true);
      expect(
        checkRoleChange({ actorRole, targetRole: "admin", newRole: "coach", ownerCount: 1 }).ok,
      ).toBe(true);
    }
  });

  it("lets owners and admins move people to and from the front desk", () => {
    for (const actorRole of ["owner", "admin"] as const) {
      for (const [targetRole, newRole] of [
        ["coach", "front_desk"],
        ["admin", "front_desk"],
        ["front_desk", "coach"],
        ["front_desk", "admin"],
      ] as const) {
        expect(checkRoleChange({ actorRole, targetRole, newRole, ownerCount: 1 }).ok).toBe(true);
      }
    }
  });

  it("keeps coaches and the front desk from changing anyone", () => {
    expect(
      checkRoleChange({ actorRole: "coach", targetRole: "coach", newRole: "admin", ownerCount: 1 }),
    ).toMatchObject({ ok: false, status: 403 });
    for (const [targetRole, newRole] of [
      ["coach", "front_desk"],
      ["front_desk", "coach"],
      ["front_desk", "admin"],
    ] as const) {
      expect(
        checkRoleChange({ actorRole: "front_desk", targetRole, newRole, ownerCount: 1 }),
      ).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("lets only an owner make or unmake an owner", () => {
    expect(
      checkRoleChange({ actorRole: "admin", targetRole: "coach", newRole: "owner", ownerCount: 1 }),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      checkRoleChange({ actorRole: "admin", targetRole: "owner", newRole: "admin", ownerCount: 2 }),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      checkRoleChange({
        actorRole: "admin",
        targetRole: "front_desk",
        newRole: "owner",
        ownerCount: 1,
      }),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      checkRoleChange({
        actorRole: "admin",
        targetRole: "owner",
        newRole: "front_desk",
        ownerCount: 2,
      }),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      checkRoleChange({ actorRole: "owner", targetRole: "coach", newRole: "owner", ownerCount: 1 })
        .ok,
    ).toBe(true);
    expect(
      checkRoleChange({ actorRole: "owner", targetRole: "owner", newRole: "admin", ownerCount: 2 })
        .ok,
    ).toBe(true);
  });

  it("never demotes the last owner, even themselves", () => {
    expect(
      checkRoleChange({ actorRole: "owner", targetRole: "owner", newRole: "admin", ownerCount: 1 }),
    ).toMatchObject({ ok: false, status: 409, code: "last_owner" });
    expect(
      checkRoleChange({
        actorRole: "owner",
        targetRole: "owner",
        newRole: "front_desk",
        ownerCount: 1,
      }),
    ).toMatchObject({ ok: false, status: 409, code: "last_owner" });
    expect(
      checkRoleChange({ actorRole: "owner", targetRole: "owner", newRole: "owner", ownerCount: 1 })
        .ok,
    ).toBe(true);
  });

  it("offers each actor only the roles that would work", () => {
    expect(assignableRoles("owner", "coach", 1)).toEqual(["owner", "admin", "front_desk", "coach"]);
    expect(assignableRoles("admin", "coach", 1)).toEqual(["admin", "front_desk", "coach"]);
    expect(assignableRoles("admin", "front_desk", 1)).toEqual(["admin", "front_desk", "coach"]);
    expect(assignableRoles("owner", "front_desk", 1)).toEqual([
      "owner",
      "admin",
      "front_desk",
      "coach",
    ]);
    expect(assignableRoles("admin", "owner", 2)).toEqual(["owner"]);
    expect(assignableRoles("owner", "owner", 1)).toEqual(["owner"]);
    expect(assignableRoles("owner", "owner", 2)).toEqual(["owner", "admin", "front_desk", "coach"]);
    expect(assignableRoles("coach", "coach", 1)).toEqual(["coach"]);
    expect(assignableRoles("front_desk", "coach", 1)).toEqual(["coach"]);
    expect(assignableRoles("front_desk", "front_desk", 1)).toEqual(["front_desk"]);
  });
});

describe("removing people and transferring ownership", () => {
  it("lets owners and admins remove coaches, the front desk, and admins", () => {
    expect(checkRemoval({ actorRole: "admin", targetRole: "coach", ownerCount: 1 }).ok).toBe(true);
    expect(checkRemoval({ actorRole: "admin", targetRole: "front_desk", ownerCount: 1 }).ok).toBe(
      true,
    );
    expect(checkRemoval({ actorRole: "admin", targetRole: "admin", ownerCount: 1 }).ok).toBe(true);
    expect(checkRemoval({ actorRole: "coach", targetRole: "coach", ownerCount: 1 })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      checkRemoval({ actorRole: "front_desk", targetRole: "coach", ownerCount: 1 }),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      checkRemoval({ actorRole: "front_desk", targetRole: "front_desk", ownerCount: 1 }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("keeps owners in the owners' hands, and the last owner in place", () => {
    expect(checkRemoval({ actorRole: "admin", targetRole: "owner", ownerCount: 2 })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkRemoval({ actorRole: "owner", targetRole: "owner", ownerCount: 2 }).ok).toBe(true);
    expect(checkRemoval({ actorRole: "owner", targetRole: "owner", ownerCount: 1 })).toMatchObject({
      ok: false,
      status: 409,
      code: "last_owner",
    });
  });

  it("lets only an owner hand over ownership, to someone else", () => {
    expect(checkTransfer({ actorRole: "owner", actorId: "a", targetId: "b" }).ok).toBe(true);
    expect(checkTransfer({ actorRole: "admin", actorId: "a", targetId: "b" })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkTransfer({ actorRole: "front_desk", actorId: "a", targetId: "b" })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkTransfer({ actorRole: "owner", actorId: "a", targetId: "a" })).toMatchObject({
      ok: false,
      status: 409,
    });
  });
});

describe("the invite message", () => {
  it("names the academy, the role, the address to sign in as, the link, and the expiry", () => {
    const text = staffInviteMessage({
      academyName: "Riverside Academy",
      role: "admin",
      email: "alex@example.com",
      link: "https://coachman.cloud/join/abc",
      expires: "Mon 10 Nov",
    });
    expect(text).toContain("join Riverside Academy on CoachMan as an admin");
    expect(text).toContain(
      "Open this link and sign in as alex@example.com, with Google or a code by email: https://coachman.cloud/join/abc",
    );
    expect(text).toContain("until Mon 10 Nov");
    expect(text).not.toContain("!");
    expect(
      staffInviteMessage({
        academyName: "A",
        role: "coach",
        email: "c@d.e",
        link: "l",
        expires: "x",
      }),
    ).toContain("as a coach");
  });

  it('names the front desk as staff, never as "a front desk"', () => {
    const text = staffInviteMessage({
      academyName: "Riverside Academy",
      role: "front_desk",
      email: "pat@example.com",
      link: "https://coachman.cloud/join/abc",
      expires: "Mon 10 Nov",
    });
    expect(text).toContain("join Riverside Academy on CoachMan as front desk staff.");
    expect(text).not.toMatch(/an? front desk/);
  });
});
