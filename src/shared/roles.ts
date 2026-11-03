// Staff roles and what each may do in an academy (a workspace). Shared by the Worker, which
// enforces it, and the app, which hides what a role can't use.

export const STAFF_ROLES = ["owner", "admin", "coach"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  coach: "Coach",
};

export const CAPABILITIES = {
  /** Prices, payments, charges, balances, revenue, selling packages, statements. */
  money: ["owner", "admin"],
  /** Create and edit rates, packages, programs (groups), and events; publishing. */
  catalog: ["owner", "admin"],
  /** Staff invites, roles, removing members, other coaches' profiles. */
  team: ["owner", "admin"],
  /** Academy settings, payment methods, venues, the rubric, consent documents. */
  settings: ["owner", "admin"],
  /** The enrollment inbox and payment-proof review. */
  enrollment: ["owner", "admin"],
  /** Family invites and revoking family access. */
  familyAccess: ["owner", "admin"],
  /** Publishing announcements. */
  announcements: ["owner", "admin"],
  /** CSV import and export, sample data, deleting clients. */
  data: ["owner", "admin"],
  /** Deleting the academy, transferring ownership, changing an owner. */
  ownership: ["owner"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Capability = keyof typeof CAPABILITIES;
export type Capabilities = Record<Capability, boolean>;

export const CAPABILITY_NAMES = Object.keys(CAPABILITIES) as Capability[];

const RANK: Record<StaffRole, number> = { owner: 3, admin: 2, coach: 1 };

/**
 * Maps a stored `member.role` to a staff role. Better Auth may store several roles comma-separated
 * ("admin,member"); the most senior recognised one wins. Anything else, including Better Auth's
 * default "member", is a coach.
 */
export function normalizeRole(role: string | null | undefined): StaffRole {
  let best: StaffRole = "coach";
  for (const part of (role ?? "").split(",")) {
    const r = part.trim().toLowerCase();
    if ((STAFF_ROLES as readonly string[]).includes(r) && RANK[r as StaffRole] > RANK[best]) {
      best = r as StaffRole;
    }
  }
  return best;
}

export function can(role: string | null | undefined, cap: Capability): boolean {
  return (CAPABILITIES[cap] as readonly StaffRole[]).includes(normalizeRole(role));
}

/** Every capability with whether the role has it (what GET /api/v1/me returns as `can`). */
export function capabilitiesFor(role: string | null | undefined): Capabilities {
  const out = {} as Capabilities;
  for (const cap of CAPABILITY_NAMES) out[cap] = can(role, cap);
  return out;
}
