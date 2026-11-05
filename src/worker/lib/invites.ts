import type { FamilyRelation, InviteStatus } from "../../shared/domain";
import { isPlaceholderEmail } from "../../shared/domain";
import {
  checkFamilyAccess,
  type FamilyAccessCode,
  familyRefusalMessage,
} from "../../shared/family";

/**
 * Whether a signed-in person may accept a staff invite. The invite's state is checked first (a new
 * link is the fix for all of those), then that the account is the Google address it was sent to.
 * A link works once: accepting it again is refused as used, even by the person who used it (the
 * Worker tells them they're already on the team, without running anything again).
 */
export type StaffAcceptance =
  | { ok: true }
  | {
      ok: false;
      status: 403 | 410;
      code:
        | "invite_revoked"
        | "invite_used"
        | "invite_expired"
        | "wrong_email"
        | "unverified_email";
      message: string;
    };

export function checkStaffAcceptance(input: {
  status: InviteStatus;
  inviteEmail: string | null;
  user: { email: string; emailVerified: boolean };
}): StaffAcceptance {
  const { status, inviteEmail, user } = input;
  const refusal = statusRefusal(status);
  if (refusal) return refusal;
  // A passkey-only family account's placeholder address never matches a staff invite.
  if (
    !inviteEmail ||
    isPlaceholderEmail(user.email) ||
    normalizeEmail(user.email) !== normalizeEmail(inviteEmail)
  ) {
    return {
      ok: false,
      status: 403,
      code: "wrong_email",
      message:
        "This invite is for a different email address. Sign in with the Google account it was sent to.",
    };
  }
  if (!user.emailVerified) {
    return {
      ok: false,
      status: 403,
      code: "unverified_email",
      message: "Sign in with Google so we can confirm this email address, then accept the invite.",
    };
  }
  return { ok: true };
}

/** Used, withdrawn, and expired links answer 410, whoever opens them (staff and family alike). */
function statusRefusal(status: InviteStatus) {
  if (status === "revoked") {
    return {
      ok: false as const,
      status: 410 as const,
      code: "invite_revoked" as const,
      message: "This invite was withdrawn. Ask the academy for a new link.",
    };
  }
  if (status === "used") {
    return {
      ok: false as const,
      status: 410 as const,
      code: "invite_used" as const,
      message: "This invite has already been used. Ask the academy for a new link if you need one.",
    };
  }
  if (status === "expired") {
    return {
      ok: false as const,
      status: 410 as const,
      code: "invite_expired" as const,
      message:
        "This invite has expired. Invite links work for seven days; ask the academy for a new one.",
    };
  }
  return null;
}

export type FamilyAcceptance =
  | { ok: true }
  | {
      ok: false;
      status: 404 | 409 | 410;
      code:
        | "invite_revoked"
        | "invite_used"
        | "invite_expired"
        | "invite_not_found"
        | "already_linked"
        | "passkey_required"
        | FamilyAccessCode;
      message: string;
    };

/**
 * Whether a signed-in person may accept a family invite, in the order the page explains it: the
 * link must still work; someone already following the student is told so (and the link stays
 * unused); a passkey-only account needs its passkey before it holds access (it couldn't sign in
 * again otherwise); then the age rules, checked again now because a birthday, a birth date, or a
 * parent's link may have changed since the invite was made.
 */
export function checkFamilyAcceptance(input: {
  status: InviteStatus;
  relation: FamilyRelation | null;
  student: { firstName: string; birthDate: string | null; isJunior: boolean } | null;
  today: string;
  /** The student has an active guardian link now. */
  hasGuardian: boolean;
  /** The person already has active access to this student. */
  alreadyLinked: boolean;
  user: { email: string; passkeys: number; hasGoogle: boolean };
}): FamilyAcceptance {
  const refusal = statusRefusal(input.status);
  if (refusal) return refusal;
  const { student, relation } = input;
  if (!student || !relation) {
    return {
      ok: false,
      status: 404,
      code: "invite_not_found",
      message: "This invite link doesn't work any more. Ask the academy for a new one.",
    };
  }
  if (input.alreadyLinked) {
    return {
      ok: false,
      status: 409,
      code: "already_linked",
      message: `You already follow ${student.firstName}'s training, so you don't need this link. It stays unused for whoever it was meant for.`,
    };
  }
  if (isPlaceholderEmail(input.user.email) && !input.user.hasGoogle && input.user.passkeys === 0) {
    return {
      ok: false,
      status: 409,
      code: "passkey_required",
      message: "Add a passkey to your account first, so you can sign in again later.",
    };
  }
  const rule = checkFamilyAccess({
    relation,
    birthDate: student.birthDate,
    isJunior: student.isJunior,
    today: input.today,
    hasGuardian: input.hasGuardian,
  });
  if (!rule.ok) {
    return {
      ok: false,
      status: 409,
      code: rule.code,
      message: familyRefusalMessage(rule.code, student.firstName),
    };
  }
  return { ok: true };
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** "jordan@gmail.com" → "j•••@gmail.com": enough to pick the right account, no more. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = normalizeEmail(email).split("@");
  if (!domain) return "•••";
  return `${local.slice(0, 1)}•••@${domain}`;
}
