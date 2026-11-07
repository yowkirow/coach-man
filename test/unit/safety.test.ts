import { describe, expect, it } from "vitest";
import {
  canEditAnySafety,
  changedFields,
  FAMILY_SAFETY_FIELDS,
  familySafetyRights,
  forbiddenSafetyField,
  PICKUP_FIELDS,
  photoChange,
  pickupsApply,
  staffSafetyRights,
  telHref,
  touchesSafety,
} from "../../src/shared/safety";
import { familySafetySchema, pickupInputSchema } from "../../src/shared/schemas";
import type { authorizedPickup, client } from "../../src/worker/db/schema";
import {
  toPickupDto,
  toPortalAnnouncement,
  toPortalSafetyUpdate,
} from "../../src/worker/lib/portal-dto";
import {
  canReadPortalFile,
  isPickupKey,
  isProofKey,
  type PortalScope,
} from "../../src/worker/lib/portal-scope";

const TODAY = "2026-11-05";
/** A birth date that makes someone `age` on TODAY. */
const born = (age: number) => `${2026 - age}-03-01`;

describe("who may change a student's safety details from the portal", () => {
  it("a parent of a minor changes everything, pickups included", () => {
    for (const student of [
      { birthDate: born(9), isJunior: true },
      { birthDate: born(16), isJunior: false },
      // No birth date, marked junior: a minor, as guardian links are.
      { birthDate: null, isJunior: true },
    ]) {
      const rights = familySafetyRights({ relation: "guardian", today: TODAY, ...student });
      expect(rights).toEqual({
        medical: true,
        emergency: true,
        guardianContact: true,
        shirtSize: true,
        pickups: true,
      });
    }
  });

  it("an adult student changes their own health, emergency contact, and shirt size", () => {
    const rights = familySafetyRights({
      relation: "self",
      birthDate: born(25),
      isJunior: false,
      today: TODAY,
    });
    expect(rights).toEqual({
      medical: true,
      emergency: true,
      guardianContact: false,
      shirtSize: true,
      pickups: false,
    });
    expect(forbiddenSafetyField(rights, { medicalNotes: "Knee brace" })).toBeNull();
    expect(forbiddenSafetyField(rights, { guardianPhone: "0917" })).toBe("guardianPhone");
  });

  it("a teen's own login reads but never changes medical info or pickups", () => {
    const rights = familySafetyRights({
      relation: "self",
      birthDate: born(15),
      isJunior: true,
      today: TODAY,
    });
    expect(canEditAnySafety(rights)).toBe(false);
    expect(forbiddenSafetyField(rights, { medicalNotes: "None" })).toBe("medicalNotes");
    expect(forbiddenSafetyField(rights, { emergencyName: "Pat" })).toBe("emergencyName");
    expect(forbiddenSafetyField(rights, { shirtSize: "Adult M" })).toBe("shirtSize");
    expect(rights.pickups).toBe(false);
  });

  it("a guardian whose student turned 18 reads only (adults keep their own details)", () => {
    const rights = familySafetyRights({
      relation: "guardian",
      birthDate: born(18),
      isJunior: true,
      today: TODAY,
    });
    expect(canEditAnySafety(rights)).toBe(false);
  });

  it("staff (any role) keep editing medical notes and manage pickup people", () => {
    expect(staffSafetyRights()).toEqual({
      medical: true,
      emergency: true,
      guardianContact: true,
      shirtSize: true,
      pickups: true,
    });
  });

  it("pickup people apply to juniors only", () => {
    expect(pickupsApply({ birthDate: born(10), isJunior: false, today: TODAY })).toBe(true);
    expect(pickupsApply({ birthDate: null, isJunior: true, today: TODAY })).toBe(true);
    expect(pickupsApply({ birthDate: born(30), isJunior: false, today: TODAY })).toBe(false);
    expect(pickupsApply({ birthDate: null, isJunior: false, today: TODAY })).toBe(false);
  });

  it("omitted fields are never a refusal; every sent field needs its right", () => {
    const parent = familySafetyRights({
      relation: "guardian",
      birthDate: born(8),
      isJunior: true,
      today: TODAY,
    });
    expect(forbiddenSafetyField(parent, {})).toBeNull();
    const all = Object.fromEntries(FAMILY_SAFETY_FIELDS.map((f) => [f, "x"]));
    expect(forbiddenSafetyField(parent, all)).toBeNull();
  });
});

describe("what counts as a change (the audit names fields, never values)", () => {
  const before = {
    medicalNotes: "Peanut allergy: EpiPen in bag",
    emergencyName: "Pat Santos",
    emergencyPhone: "0917 000 0001",
    guardianPhone: null,
    guardianEmail: null,
    shirtSize: "Kids M",
  };

  it("only fields whose value really changes, blank and missing alike", () => {
    expect(changedFields(FAMILY_SAFETY_FIELDS, before, {})).toEqual([]);
    expect(
      changedFields(FAMILY_SAFETY_FIELDS, before, {
        medicalNotes: " Peanut allergy: EpiPen in bag ",
        guardianPhone: "",
        shirtSize: "Kids M",
      }),
    ).toEqual([]);
    expect(
      changedFields(FAMILY_SAFETY_FIELDS, before, {
        medicalNotes: "Peanut and egg allergy",
        emergencyPhone: null,
        guardianEmail: "pat@example.com",
      }),
    ).toEqual(["medicalNotes", "emergencyPhone", "guardianEmail"]);
  });

  it("the names it returns carry nothing of the medical text", () => {
    const fields = changedFields(FAMILY_SAFETY_FIELDS, before, { medicalNotes: "Asthma" });
    expect(JSON.stringify(fields)).not.toContain("Asthma");
    expect(JSON.stringify(fields)).not.toContain("Peanut");
  });

  it("health and emergency changes move the Updated-by line; a shirt size alone doesn't", () => {
    expect(touchesSafety(["medicalNotes"])).toBe(true);
    expect(touchesSafety(["guardianPhone", "shirtSize"])).toBe(true);
    expect(touchesSafety(["shirtSize"])).toBe(false);
    expect(touchesSafety([])).toBe(false);
  });

  it("a pickup person's changed fields and what happened to the photo", () => {
    const row = { name: "Lola Santos", relationship: "Grandmother", phone: null, notes: null };
    expect(changedFields(PICKUP_FIELDS, row, { ...row, phone: "0917 555 0102" })).toEqual([
      "phone",
    ]);
    expect(photoChange({ hadPhoto: false, newPhoto: true, removePhoto: false })).toBe("added");
    expect(photoChange({ hadPhoto: true, newPhoto: true, removePhoto: false })).toBe("replaced");
    expect(photoChange({ hadPhoto: true, newPhoto: false, removePhoto: true })).toBe("removed");
    expect(photoChange({ hadPhoto: false, newPhoto: false, removePhoto: true })).toBeNull();
    expect(photoChange({ hadPhoto: true, newPhoto: false, removePhoto: false })).toBeNull();
  });

  it("tap-to-call numbers keep digits and a leading plus", () => {
    expect(telHref("+63 917 555-0102")).toBe("tel:+639175550102");
    expect(telHref("(0917) 555 0102")).toBe("tel:09175550102");
  });
});

describe("what families send", () => {
  it("the safety form: blanks clear, sizes come from the list, emails must be complete", () => {
    expect(familySafetySchema.parse({ medicalNotes: "", shirtSize: "" })).toEqual({
      medicalNotes: null,
      shirtSize: null,
    });
    expect(familySafetySchema.safeParse({ shirtSize: "Huge" }).success).toBe(false);
    expect(familySafetySchema.safeParse({ guardianEmail: "pat@" }).success).toBe(false);
    expect(familySafetySchema.parse({ guardianEmail: "Pat@Example.com" }).guardianEmail).toBe(
      "pat@example.com",
    );
    expect(familySafetySchema.safeParse({ medicalNotes: "x".repeat(1001) }).success).toBe(false);
  });

  it("a pickup person needs a name; the rest is optional", () => {
    expect(pickupInputSchema.safeParse({ name: " " }).success).toBe(false);
    expect(pickupInputSchema.parse({ name: "Lola", phone: "", notes: "Blue car" })).toEqual({
      name: "Lola",
      phone: null,
      notes: "Blue car",
    });
  });
});

describe("who may read a pickup photo", () => {
  const scope: PortalScope = {
    userId: "u1",
    links: [
      { accessId: "a1", clientId: "c1", workspaceId: "ws1", relation: "guardian" },
      { accessId: "a2", clientId: "c9", workspaceId: "ws2", relation: "self" },
    ],
  };
  const key = "ws/ws1/clients/c1/pickups/0196f3a2.jpg";
  const pickup = { workspaceId: "ws1", clientId: "c1", kind: "pickup" as const };

  it("needs the pickup person the key belongs to, of one of the caller's students", () => {
    expect(isPickupKey(key)).toBe(true);
    expect(isProofKey(key)).toBe(false);
    expect(canReadPortalFile(scope, key, pickup)).toBe(true);
    // A guessed key (no pickup person has it), even in the caller's own student's folder.
    expect(canReadPortalFile(scope, key, null)).toBe(false);
    expect(canReadPortalFile(scope, key)).toBe(false);
    // Another family's pickup person, or one claiming another academy.
    expect(canReadPortalFile(scope, key, { ...pickup, clientId: "c2" })).toBe(false);
    expect(canReadPortalFile(scope, key, { ...pickup, workspaceId: "ws2" })).toBe(false);
    // Someone linked to nobody.
    expect(canReadPortalFile({ userId: "u2", links: [] }, key, pickup)).toBe(false);
  });

  it("the row must come from the pickups table: a proof never opens a pickup photo, or back", () => {
    // A row from payment_submission (the default kind) can't vouch for a pickups/ key...
    expect(canReadPortalFile(scope, key, { workspaceId: "ws1", clientId: "c1" })).toBe(false);
    // ...and a pickup row can't vouch for a payments/ key.
    expect(canReadPortalFile(scope, "ws/ws1/clients/c1/payments/0196.jpg", pickup)).toBe(false);
    // Any other subfolder stays shut, whoever vouches.
    expect(canReadPortalFile(scope, "ws/ws1/clients/c1/other/0196.jpg", pickup)).toBe(false);
  });

  it("no climbing out of the folder", () => {
    expect(canReadPortalFile(scope, "ws/ws1/clients/c1/pickups/../c2/0196.jpg", pickup)).toBe(
      false,
    );
    expect(canReadPortalFile(scope, "ws/ws1/clients/c1/pickups//0196.jpg", pickup)).toBe(false);
    expect(isPickupKey("ws/ws1/clients/c1/pickups/sub/0196.jpg")).toBe(false);
  });
});

describe("what families see of pickups and changes", () => {
  const row: typeof authorizedPickup.$inferSelect = {
    id: "p1",
    workspaceId: "ws1",
    clientId: "c1",
    name: "Lola Santos",
    relationship: "Grandmother",
    phone: "0917 555 0102",
    photoKey: "ws/ws1/clients/c1/pickups/0196.jpg",
    notes: "Drives a blue van",
    createdBy: "staff-user-LEAK",
    createdAt: 1,
    updatedAt: 2,
  };

  it("a pickup person never carries who added them", () => {
    const dto = toPickupDto(row);
    expect(JSON.stringify(dto)).not.toContain("LEAK");
    expect(dto).not.toHaveProperty("createdBy");
    expect(dto).not.toHaveProperty("workspaceId");
    expect(dto).toMatchObject({ id: "p1", name: "Lola Santos", photoKey: row.photoKey });
  });

  it("the last change says you or the academy, never who on either side", () => {
    const changed: Pick<
      typeof client.$inferSelect,
      "safetyUpdatedAt" | "safetyUpdatedBy" | "safetyUpdatedRelation"
    > = {
      safetyUpdatedAt: 50,
      safetyUpdatedBy: "u-parent-LEAK",
      safetyUpdatedRelation: "guardian",
    };
    expect(toPortalSafetyUpdate(changed, "u-parent-LEAK")).toEqual({
      at: 50,
      byYou: true,
      byAcademy: false,
    });
    const other = toPortalSafetyUpdate(changed, "u-other");
    expect(other).toEqual({ at: 50, byYou: false, byAcademy: false });
    expect(JSON.stringify(other)).not.toContain("LEAK");
    expect(
      toPortalSafetyUpdate(
        { safetyUpdatedAt: 60, safetyUpdatedBy: "staff-LEAK", safetyUpdatedRelation: "staff" },
        "u-other",
      ),
    ).toEqual({ at: 60, byYou: false, byAcademy: true });
    expect(
      toPortalSafetyUpdate(
        { safetyUpdatedAt: null, safetyUpdatedBy: null, safetyUpdatedRelation: null },
        "u",
      ),
    ).toBeNull();
  });

  it("an announcement for families: never who wrote it, and drafts never map", () => {
    const base = {
      id: "an1",
      workspaceId: "ws1",
      title: "Courts closed Saturday",
      body: "Resurfacing.",
      audience: "program" as const,
      audienceId: "g1",
      pinned: true,
      publishedAt: 100,
      expiresAt: null,
      notifiedAt: 100,
      createdBy: "staff-user-LEAK",
      createdAt: 1,
      updatedAt: 2,
    };
    const dto = toPortalAnnouncement(base, "Junior program");
    expect(JSON.stringify(dto)).not.toContain("LEAK");
    expect(dto).toEqual({
      id: "an1",
      workspaceId: "ws1",
      title: "Courts closed Saturday",
      body: "Resurfacing.",
      pinned: true,
      publishedAt: 100,
      audience: "program",
      audienceName: "Junior program",
      expiresAt: null,
    });
    expect(toPortalAnnouncement({ ...base, publishedAt: null }, null)).toBeNull();
    expect(toPortalAnnouncement({ ...base, audience: "all" }, "ignored")?.audienceName).toBeNull();
  });
});
