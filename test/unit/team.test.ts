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

  it("keeps coaches from changing anyone", () => {
    expect(
      checkRoleChange({ actorRole: "coach", targetRole: "coach", newRole: "admin", ownerCount: 1 }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("lets only an owner make or unmake an owner", () => {
    expect(
      checkRoleChange({ actorRole: "admin", targetRole: "coach", newRole: "owner", ownerCount: 1 }),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      checkRoleChange({ actorRole: "admin", targetRole: "owner", newRole: "admin", ownerCount: 2 }),
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
      checkRoleChange({ actorRole: "owner", targetRole: "owner", newRole: "owner", ownerCount: 1 })
        .ok,
    ).toBe(true);
  });

  it("offers each actor only the roles that would work", () => {
    expect(assignableRoles("owner", "coach", 1)).toEqual(["owner", "admin", "coach"]);
    expect(assignableRoles("admin", "coach", 1)).toEqual(["admin", "coach"]);
    expect(assignableRoles("admin", "owner", 2)).toEqual(["owner"]);
    expect(assignableRoles("owner", "owner", 1)).toEqual(["owner"]);
    expect(assignableRoles("coach", "coach", 1)).toEqual(["coach"]);
  });
});

describe("removing people and transferring ownership", () => {
  it("lets owners and admins remove coaches and admins", () => {
    expect(checkRemoval({ actorRole: "admin", targetRole: "coach", ownerCount: 1 }).ok).toBe(true);
    expect(checkRemoval({ actorRole: "admin", targetRole: "admin", ownerCount: 1 }).ok).toBe(true);
    expect(checkRemoval({ actorRole: "coach", targetRole: "coach", ownerCount: 1 })).toMatchObject({
      ok: false,
      status: 403,
    });
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
    expect(checkTransfer({ actorRole: "owner", actorId: "a", targetId: "a" })).toMatchObject({
      ok: false,
      status: 409,
    });
  });
});

describe("the invite message", () => {
  it("names the academy, the role, the Google address, the link, and the expiry", () => {
    const text = staffInviteMessage({
      academyName: "Riverside Academy",
      role: "admin",
      email: "alex@example.com",
      link: "https://coachman.cloud/join/abc",
      expires: "Mon 10 Nov",
    });
    expect(text).toContain("join Riverside Academy on CoachMan as an admin");
    expect(text).toContain(
      "sign in with Google as alex@example.com: https://coachman.cloud/join/abc",
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
});
