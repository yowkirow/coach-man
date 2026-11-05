import { and, asc, eq } from "drizzle-orm";
import { DEFAULT_PAYMENT_METHODS } from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import { normalizeRole, type StaffRole } from "../../shared/roles";
import { rubricFor } from "../../shared/rubric";
import { chunkRows, type Db } from "../db/client";
import {
  academyProfile,
  coachProfile,
  member,
  notificationPref,
  organization,
  skill,
  workspaceSettings,
} from "../db/schema";

export interface Membership {
  workspaceId: string;
  /** The stored role; normalise with normalizeRole() before checking capabilities. */
  role: string;
}

/** Every workspace the user is staff in, oldest membership first. */
export async function membershipsForUser(db: Db, userId: string): Promise<Membership[]> {
  return db
    .select({ workspaceId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));
}

/**
 * The membership a request acts in: the preferred workspace (the session's active one) when the
 * user still belongs to it, otherwise their oldest. Null when they aren't staff anywhere.
 */
export async function activeMembership(
  db: Db,
  userId: string,
  preferredWorkspaceId: string | null | undefined,
): Promise<Membership | null> {
  const all = await membershipsForUser(db, userId);
  return all.find((m) => m.workspaceId === preferredWorkspaceId) ?? all[0] ?? null;
}

/** Oldest workspace the user belongs to, or null. */
export async function firstWorkspaceForUser(db: Db, userId: string): Promise<string | null> {
  return (await membershipsForUser(db, userId))[0]?.workspaceId ?? null;
}

/** Oldest workspace the user owns, or null. */
export async function ownedWorkspaceForUser(db: Db, userId: string): Promise<string | null> {
  const all = await membershipsForUser(db, userId);
  return all.find((m) => normalizeRole(m.role) === "owner")?.workspaceId ?? null;
}

export function skillRows(workspaceId: string, sport: string) {
  const now = Date.now();
  return rubricFor(sport).skills.map((s, i) => ({
    id: uuidv7(now + i),
    workspaceId,
    category: s.category,
    name: s.name,
    description: s.description,
    sortOrder: i,
    active: true,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Creates a workspace (a one-person academy) owned by the user: organization + owner membership,
 * their coach profile, the academy profile, settings, notification preferences, and the default
 * pickleball rubric. Idempotent per user: returns the workspace they already own, if any. Joining
 * someone else's academy as staff doesn't count.
 */
export async function provisionWorkspace(
  db: Db,
  user: { id: string; name: string },
): Promise<string> {
  const existing = await ownedWorkspaceForUser(db, user.id);
  if (existing) return existing;

  const workspaceId = uuidv7();
  const now = new Date();
  const firstName = user.name.trim().split(/\s+/)[0] || "Coach";
  const skills = skillRows(workspaceId, "pickleball");
  // notification_pref is keyed by user, so for a brand-new user it doubles as the guard against
  // two requests provisioning at once (see the catch below). Staff of another academy keep theirs.
  const hasPrefs = Boolean(
    await db.query.notificationPref.findFirst({ where: eq(notificationPref.userId, user.id) }),
  );

  try {
    await db.batch([
      db.insert(organization).values({
        id: workspaceId,
        name: `${firstName}'s coaching`,
        slug: `ws-${workspaceId}`,
        createdAt: now,
      }),
      db.insert(member).values({
        id: uuidv7(),
        organizationId: workspaceId,
        userId: user.id,
        role: "owner",
        createdAt: now,
      }),
      db.insert(coachProfile).values({ id: uuidv7(), workspaceId, userId: user.id }),
      db.insert(academyProfile).values({ workspaceId }),
      db.insert(workspaceSettings).values({ workspaceId, paymentMethods: DEFAULT_PAYMENT_METHODS }),
      ...(hasPrefs ? [] : [db.insert(notificationPref).values({ userId: user.id, workspaceId })]),
      ...chunkRows(skills, 9).map((rows) => db.insert(skill).values(rows)),
    ]);
  } catch (err) {
    // Two requests can provision at once. The batch is atomic, so the loser rolls back entirely;
    // adopt the winner's workspace instead of failing.
    if (/UNIQUE constraint failed/i.test(String((err as Error)?.message ?? err))) {
      const winner = await ownedWorkspaceForUser(db, user.id);
      if (winner) return winner;
    }
    throw err;
  }
  return workspaceId;
}

/**
 * Adds a user to a workspace's staff with a role, with a coach profile and (when they have none
 * yet) notification preferences. Re-adding an existing member updates their role.
 */
export async function addStaffMember(
  db: Db,
  input: { workspaceId: string; userId: string; role: StaffRole },
): Promise<void> {
  const { workspaceId, userId, role } = input;
  const existing = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)))
    .limit(1);
  await db.batch([
    existing[0]
      ? db.update(member).set({ role }).where(eq(member.id, existing[0].id))
      : db.insert(member).values({
          id: uuidv7(),
          organizationId: workspaceId,
          userId,
          role,
          createdAt: new Date(),
        }),
    db.insert(coachProfile).values({ id: uuidv7(), workspaceId, userId }).onConflictDoNothing(),
    db.insert(notificationPref).values({ userId, workspaceId }).onConflictDoNothing(),
  ]);
}
