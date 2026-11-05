import type { InviteStatus } from "../../shared/domain";

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
  if (status === "revoked") {
    return {
      ok: false,
      status: 410,
      code: "invite_revoked",
      message: "This invite was withdrawn. Ask the academy for a new link.",
    };
  }
  if (status === "used") {
    return {
      ok: false,
      status: 410,
      code: "invite_used",
      message: "This invite has already been used. Ask the academy for a new link if you need one.",
    };
  }
  if (status === "expired") {
    return {
      ok: false,
      status: 410,
      code: "invite_expired",
      message:
        "This invite has expired. Invite links work for seven days; ask the academy for a new one.",
    };
  }
  if (!inviteEmail || normalizeEmail(user.email) !== normalizeEmail(inviteEmail)) {
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

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** "jordan@gmail.com" → "j•••@gmail.com": enough to pick the right account, no more. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = normalizeEmail(email).split("@");
  if (!domain) return "•••";
  return `${local.slice(0, 1)}•••@${domain}`;
}
