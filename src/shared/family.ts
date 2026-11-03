import type { FamilyRelation } from "./domain";
import { ageOn } from "./time";

/** Students this age and up are adults: their own login, and no guardian links. */
export const ADULT_AGE = 18;
/** Teens this age and up may have their own login, linked to a parent. */
export const OWN_LOGIN_MIN_AGE = 13;

export type FamilyAccessCheck =
  | { ok: true }
  | {
      ok: false;
      code: "needs_birth_date" | "too_young" | "needs_guardian" | "not_a_minor";
      message: string;
    };

/**
 * The portal's age rules for linking a person to a student:
 * - `guardian`: the student must be a minor (under 18, or marked junior when the birth date is
 *   unknown). Adults manage their own access.
 * - `self`: the student must be 13 or older; a 13–17 year old also needs an active guardian link.
 */
export function checkFamilyAccess(input: {
  relation: FamilyRelation;
  birthDate: string | null;
  isJunior: boolean;
  today: string;
  /** Whether the student already has an active guardian link. */
  hasGuardian: boolean;
}): FamilyAccessCheck {
  const age = input.birthDate ? ageOn(input.birthDate, input.today) : null;
  const minor = age === null ? input.isJunior : age < ADULT_AGE;

  if (input.relation === "guardian") {
    return minor
      ? { ok: true }
      : {
          ok: false,
          code: "not_a_minor",
          message: "Parent access is for students under 18. Adults sign in themselves.",
        };
  }
  if (!minor) return { ok: true };
  if (age === null) {
    return {
      ok: false,
      code: "needs_birth_date",
      message: "Add the student's birth date first: own logins depend on age.",
    };
  }
  if (age < OWN_LOGIN_MIN_AGE) {
    return {
      ok: false,
      code: "too_young",
      message: "Students under 13 don't get their own login. Invite a parent instead.",
    };
  }
  return input.hasGuardian
    ? { ok: true }
    : {
        ok: false,
        code: "needs_guardian",
        message: "A teen's own login needs a parent linked first.",
      };
}
