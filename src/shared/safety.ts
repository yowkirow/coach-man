// Kids' safety: who may change a student's health and emergency details and their authorized
// pickup people, what counts as a change, and how the change is described. Pure, so the Worker,
// the app, and the unit tests share one set of rules.

import type { FamilyRelation } from "./domain";
import { isMinor } from "./family";

/** Who made the last change to a student's health and emergency details. */
export const SAFETY_EDITORS = ["guardian", "self", "staff"] as const;
export type SafetyEditor = (typeof SAFETY_EDITORS)[number];

export const SAFETY_EDITOR_LABELS: Record<SafetyEditor, string> = {
  guardian: "parent or guardian",
  self: "student",
  staff: "academy staff",
};

/** The fields a family may change from the portal's Profile (when their rights allow). */
export const FAMILY_SAFETY_FIELDS = [
  "medicalNotes",
  "emergencyName",
  "emergencyPhone",
  "guardianPhone",
  "guardianEmail",
  "shirtSize",
] as const;
export type FamilySafetyField = (typeof FAMILY_SAFETY_FIELDS)[number];

/**
 * The health and emergency details proper: a change to any of these moves the "Updated by" line
 * staff see. (A shirt size is audited too, but isn't safety information.)
 */
export const SAFETY_FIELDS = [
  "medicalNotes",
  "emergencyName",
  "emergencyPhone",
  "guardianName",
  "guardianPhone",
  "guardianEmail",
] as const;
export type SafetyField = (typeof SAFETY_FIELDS)[number];

export const SAFETY_FIELD_LABELS: Record<SafetyField | "shirtSize", string> = {
  medicalNotes: "Medical notes",
  emergencyName: "Emergency contact",
  emergencyPhone: "Emergency phone",
  guardianName: "Parent or guardian",
  guardianPhone: "Parent's phone",
  guardianEmail: "Parent's email",
  shirtSize: "Shirt size",
};

/** At most this many authorized pickup people per student. */
export const MAX_PICKUPS_ON_FILE = 10;

/** What a family member may change on a student's profile from the portal. */
export interface SafetyRights {
  /** Medical notes (allergies, conditions, medications). */
  medical: boolean;
  /** The emergency contact's name and phone. */
  emergency: boolean;
  /** The parent or guardian contact's phone and email (parents only). */
  guardianContact: boolean;
  shirtSize: boolean;
  /** Add, change, and remove authorized pickup people (juniors only). */
  pickups: boolean;
}

const NONE: SafetyRights = {
  medical: false,
  emergency: false,
  guardianContact: false,
  shirtSize: false,
  pickups: false,
};

/** Authorized pickup people apply to juniors: under 18, or marked junior without a birth date. */
export function pickupsApply(student: {
  birthDate: string | null;
  isJunior: boolean;
  today: string;
}): boolean {
  return isMinor(student);
}

/**
 * A family member's rights over a student's safety details:
 * - a parent or guardian of a minor: everything (medical, emergency contact, their own contact,
 *   shirt size, pickup people);
 * - an adult student, for themselves: medical, emergency contact, shirt size (no pickups);
 * - a teen's own login: read only (their parent keeps these up to date);
 * - a guardian whose student has turned 18: read only (adults keep their own details).
 */
export function familySafetyRights(input: {
  relation: FamilyRelation;
  birthDate: string | null;
  isJunior: boolean;
  today: string;
}): SafetyRights {
  const minor = isMinor(input);
  if (input.relation === "guardian") {
    return minor
      ? { medical: true, emergency: true, guardianContact: true, shirtSize: true, pickups: true }
      : NONE;
  }
  return minor
    ? NONE
    : { medical: true, emergency: true, guardianContact: false, shirtSize: true, pickups: false };
}

/**
 * Staff (any role) keep editing medical notes and the rest from the client form as before, and
 * manage pickup people (coaches meet them at the court).
 */
export function staffSafetyRights(): SafetyRights {
  return { medical: true, emergency: true, guardianContact: true, shirtSize: true, pickups: true };
}

export function canEditAnySafety(rights: SafetyRights): boolean {
  return Object.values(rights).some(Boolean);
}

/** Which right a field needs. */
const FIELD_RIGHT: Record<FamilySafetyField, keyof SafetyRights> = {
  medicalNotes: "medical",
  emergencyName: "emergency",
  emergencyPhone: "emergency",
  guardianPhone: "guardianContact",
  guardianEmail: "guardianContact",
  shirtSize: "shirtSize",
};

/** The first field in `input` the rights don't allow (null when every one sent is allowed). */
export function forbiddenSafetyField(
  rights: SafetyRights,
  input: Partial<Record<FamilySafetyField, unknown>>,
): FamilySafetyField | null {
  for (const field of FAMILY_SAFETY_FIELDS) {
    if (input[field] === undefined) continue;
    if (!rights[FIELD_RIGHT[field]]) return field;
  }
  return null;
}

const norm = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

/**
 * The names of the fields whose value really changes (blank and missing count as the same), in a
 * fixed order. Audit entries record these names only, never the values: medical text stays out
 * of the audit log.
 */
export function changedFields<K extends string>(
  fields: readonly K[],
  before: Partial<Record<K, unknown>>,
  after: Partial<Record<K, unknown>>,
): K[] {
  return fields.filter((f) => after[f] !== undefined && norm(before[f]) !== norm(after[f]));
}

/** Whether a set of changed fields moves the "Updated by" line (health and emergency details). */
export function touchesSafety(fields: readonly string[]): boolean {
  return fields.some((f) => (SAFETY_FIELDS as readonly string[]).includes(f));
}

/** The changed fields of a pickup person (photo changes are named separately). */
export const PICKUP_FIELDS = ["name", "relationship", "phone", "notes"] as const;
export type PickupField = (typeof PICKUP_FIELDS)[number];

/** What happened to a pickup person's photo in one save. */
export type PhotoChange = "added" | "replaced" | "removed" | null;

export function photoChange(input: {
  hadPhoto: boolean;
  newPhoto: boolean;
  removePhoto: boolean;
}): PhotoChange {
  if (input.newPhoto) return input.hadPhoto ? "replaced" : "added";
  if (input.removePhoto && input.hadPhoto) return "removed";
  return null;
}

/** A phone number as a tel: link (digits and a leading +). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
