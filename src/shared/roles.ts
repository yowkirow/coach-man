// Staff roles and what each may do in an academy (a workspace). Shared by the Worker, which
// enforces it, and the app, which hides what a role can't use.

export const STAFF_ROLES = ["owner", "admin", "front_desk", "coach"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  front_desk: "Front desk",
  coach: "Coach",
};

/** A role as a sentence names someone with it: "Sam is now an admin", "Sam is front desk staff". */
export const STAFF_ROLE_NOUNS: Record<StaffRole, string> = {
  owner: "an owner",
  admin: "an admin",
  front_desk: "front desk staff",
  coach: "a coach",
};

/** What each role does, in a line: the team's role pickers, the join page, and the invite email. */
export const STAFF_ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  owner: "Everything an admin does, plus owners and the academy itself.",
  admin: "Runs the academy: the team, money, rates and programs, and settings.",
  front_desk:
    "Payments, enrollments, check-in, the schedule, and family invites. Doesn't coach; no prices, settings, or team.",
  coach: "Students, progress, the schedule, and check-in. No prices or payments.",
};

export const CAPABILITIES = {
  /** Prices, payments, charges, balances, revenue, selling packages, statements. */
  money: ["owner", "admin", "front_desk"],
  /** Create and edit rates, packages, programs (groups), and events; publishing. */
  catalog: ["owner", "admin"],
  /** Staff invites, roles, removing members, other coaches' profiles. */
  team: ["owner", "admin"],
  /** Academy settings, payment methods, venues, the rubric, consent documents. */
  settings: ["owner", "admin"],
  /** The enrollment inbox and payment-proof review. */
  enrollment: ["owner", "admin", "front_desk"],
  /** Family invites and revoking family access. */
  familyAccess: ["owner", "admin", "front_desk"],
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

const RANK: Record<StaffRole, number> = { owner: 4, admin: 3, front_desk: 2, coach: 1 };

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

/**
 * The roles that coach. People who coach can be a student's coach, lead or assist sessions,
 * programs, and events, appear on the team page, and write coaching notes, assessments, and goals
 * (see notes.ts). The front desk doesn't coach. Coaching isn't a capability: it closes no page,
 * only coaching's own parts of the pages everyone opens.
 */
export const COACHING_ROLES = ["owner", "admin", "coach"] as const satisfies readonly StaffRole[];

/** Whether a stored `member.role` coaches (see COACHING_ROLES). */
export function isCoachingRole(role: string | null | undefined): boolean {
  return (COACHING_ROLES as readonly StaffRole[]).includes(normalizeRole(role));
}
