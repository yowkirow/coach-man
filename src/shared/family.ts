import type { FamilyRelation } from "./domain";
import { ageOn } from "./time";

/** Students this age and up are adults: their own login, and no guardian links. */
export const ADULT_AGE = 18;
/** Teens this age and up may have their own login, linked to a parent. */
export const OWN_LOGIN_MIN_AGE = 13;

export type FamilyAccessCode = "needs_birth_date" | "too_young" | "needs_guardian" | "not_a_minor";

export type FamilyAccessCheck =
  | { ok: true }
  | {
      ok: false;
      code: FamilyAccessCode;
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
  const minor = isMinor(input);

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

/** Under 18, or marked junior when the birth date is unknown (the rule guardian links follow). */
export function isMinor(input: { birthDate: string | null; isJunior: boolean; today: string }) {
  return input.birthDate ? ageOn(input.birthDate, input.today) < ADULT_AGE : input.isJunior;
}

/**
 * A parent making their teen's own login from the portal: only for students aged 13 to 17 (by
 * birth date). The parent asking is the guardian link the rule needs. Adults get their link from
 * the academy, and under-13s never get one.
 */
export function checkTeenInvite(input: {
  birthDate: string | null;
  isJunior: boolean;
  today: string;
  firstName: string;
}): FamilyAccessCheck {
  const name = input.firstName || "your child";
  if (!input.birthDate) {
    return input.isJunior
      ? {
          ok: false,
          code: "needs_birth_date",
          message: `Ask the academy to add ${name}'s birth date first: own logins depend on age.`,
        }
      : {
          ok: false,
          code: "not_a_minor",
          message: `Students 18 and over sign in on their own. The academy sends them their link.`,
        };
  }
  const age = ageOn(input.birthDate, input.today);
  if (age < OWN_LOGIN_MIN_AGE) {
    return {
      ok: false,
      code: "too_young",
      message: `Children under ${OWN_LOGIN_MIN_AGE} don't get their own login. ${name} follows along on yours.`,
    };
  }
  if (age >= ADULT_AGE) {
    return {
      ok: false,
      code: "not_a_minor",
      message: `Students 18 and over sign in on their own. The academy sends them their link.`,
    };
  }
  return { ok: true };
}

/**
 * What someone opening a family invite reads when the age rules refuse it (the staff-side
 * messages above tell the academy what to fix instead).
 */
export function familyRefusalMessage(code: FamilyAccessCode, firstName: string): string {
  const name = firstName || "this student";
  switch (code) {
    case "not_a_minor":
      return `Parent access is for students under 18, and ${name} isn't. Ask the academy about access.`;
    case "too_young":
      return `Students under 13 don't get their own login. A parent's account follows ${name}'s training instead.`;
    case "needs_guardian":
      return "A teen's own login needs a parent linked first. Once a parent has accepted their invite, open this link again.";
    case "needs_birth_date":
      return `The academy needs ${name}'s birth date before this link can work. Ask them to add it, then open the link again.`;
  }
}

/**
 * When a parent's access ends: a minor's own login depends on a parent being linked, so it ends
 * too once no other parent is (the staff page says so before revoking).
 */
export function endsTeenLogins(input: {
  birthDate: string | null;
  isJunior: boolean;
  today: string;
  /** Active guardian links left after this one is revoked. */
  guardiansLeft: number;
}): boolean {
  return input.guardiansLeft === 0 && isMinor(input);
}

/** What a family invite opens, as its message and its email say it. */
export function familyInviteWhat(relation: FamilyRelation, firstName: string): string {
  return relation === "guardian"
    ? `to follow ${firstName}'s training on CoachMan: sessions, progress, coaches' comments, and payments.`
    : "to see your own training on CoachMan: sessions, progress, coaches' comments, and payments.";
}

/** How someone with a family invite signs in. */
export const FAMILY_SIGN_IN =
  "Sign in with Google, or create a passkey on your phone. No password needed.";

/**
 * The message staff (or a parent, for their teen) paste into Messenger, Viber, or a text: who is
 * invited to what, the link, how to sign in, and until when. Staff can also have CoachMan email
 * the link (src/shared/email.ts).
 */
export function familyInviteMessage(input: {
  academyName: string;
  firstName: string;
  relation: FamilyRelation;
  link: string;
  /** Already formatted for the reader, e.g. "Wed 12 Nov". */
  expires: string;
}): string {
  return [
    `${input.academyName} invited you ${familyInviteWhat(input.relation, input.firstName)}`,
    `Open this link to accept: ${input.link}`,
    FAMILY_SIGN_IN,
    `The link works once, until ${input.expires}.`,
  ].join("\n");
}
