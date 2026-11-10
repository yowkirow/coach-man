// Team rules: who may change whose role, remove whom, and hand over ownership. The Worker enforces
// them; the app uses them to offer only what will work. An academy always keeps an owner.

import { can, STAFF_ROLE_NOUNS, STAFF_ROLES, type StaffRole } from "./roles";

export type TeamRuleResult =
  | { ok: true }
  | { ok: false; status: 403 | 409; code: string; message: string };

const ok: TeamRuleResult = { ok: true };
const deny = (status: 403 | 409, code: string, message: string): TeamRuleResult => ({
  ok: false,
  status,
  code,
  message,
});

export const LAST_OWNER_MESSAGE =
  "Every academy needs an owner. Make someone else an owner first, or transfer ownership.";

export interface RoleChangeInput {
  actorRole: StaffRole;
  targetRole: StaffRole;
  newRole: StaffRole;
  /** Owners in the academy now, the target included if they are one. */
  ownerCount: number;
}

/**
 * Changing a member's role: `team` for admins, the front desk, and coaches; owners only for
 * anything owner.
 */
export function checkRoleChange({
  actorRole,
  targetRole,
  newRole,
  ownerCount,
}: RoleChangeInput): TeamRuleResult {
  if (!can(actorRole, "team")) {
    return deny(403, "forbidden", "Only the academy's owner and admins can change roles.");
  }
  if (targetRole === newRole) return ok;
  if ((targetRole === "owner" || newRole === "owner") && !can(actorRole, "ownership")) {
    return deny(403, "forbidden", "Only an owner can make someone an owner or change an owner.");
  }
  if (targetRole === "owner" && ownerCount <= 1) return deny(409, "last_owner", LAST_OWNER_MESSAGE);
  return ok;
}

export interface RemovalInput {
  actorRole: StaffRole;
  targetRole: StaffRole;
  ownerCount: number;
}

/** Removing someone from the academy (yourself included). The last owner always stays. */
export function checkRemoval({ actorRole, targetRole, ownerCount }: RemovalInput): TeamRuleResult {
  if (!can(actorRole, "team")) {
    return deny(403, "forbidden", "Only the academy's owner and admins can remove people.");
  }
  if (targetRole === "owner" && !can(actorRole, "ownership")) {
    return deny(403, "forbidden", "Only an owner can remove an owner.");
  }
  if (targetRole === "owner" && ownerCount <= 1) return deny(409, "last_owner", LAST_OWNER_MESSAGE);
  return ok;
}

export interface TransferInput {
  actorRole: StaffRole;
  actorId: string;
  targetId: string;
}

/** Handing the academy over: the other person becomes an owner and the owner becomes an admin. */
export function checkTransfer({ actorRole, actorId, targetId }: TransferInput): TeamRuleResult {
  if (!can(actorRole, "ownership")) {
    return deny(403, "forbidden", "Only an owner can transfer ownership.");
  }
  if (actorId === targetId) return deny(409, "same_person", "You already own this academy.");
  return ok;
}

/** The roles an actor may give a member, for the role picker (the current role included). */
export function assignableRoles(
  actorRole: StaffRole,
  targetRole: StaffRole,
  ownerCount: number,
): StaffRole[] {
  return STAFF_ROLES.filter(
    (r) =>
      r === targetRole || checkRoleChange({ actorRole, targetRole, newRole: r, ownerCount }).ok,
  );
}

/**
 * The message staff paste into Messenger, Viber, or a text: who is invited, as what, the link, and
 * which Google account to use. CoachMan also emails the link (src/shared/email.ts).
 */
export function staffInviteMessage(input: {
  academyName: string;
  role: StaffRole;
  email: string;
  link: string;
  /** Already formatted for the reader, e.g. "Mon 10 Nov". */
  expires: string;
}): string {
  return [
    `You're invited to join ${input.academyName} on CoachMan as ${STAFF_ROLE_NOUNS[input.role]}.`,
    `Open this link and sign in with Google as ${input.email}: ${input.link}`,
    `The link works once, until ${input.expires}.`,
  ].join("\n");
}
