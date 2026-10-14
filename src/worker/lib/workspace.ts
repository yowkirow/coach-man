import { asc, eq } from "drizzle-orm";
import { DEFAULT_PAYMENT_METHODS } from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import { rubricFor } from "../../shared/rubric";
import { chunkRows, type Db } from "../db/client";
import { member, notificationPref, organization, skill, workspaceSettings } from "../db/schema";

/** Oldest workspace the user belongs to, or null. */
export async function firstWorkspaceForUser(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
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
 * Creates a private workspace for a new coach: organization + owner membership, settings,
 * notification preferences, and the default pickleball skill rubric. Idempotent per user.
 */
export async function provisionWorkspace(
  db: Db,
  user: { id: string; name: string },
): Promise<string> {
  const existing = await firstWorkspaceForUser(db, user.id);
  if (existing) return existing;

  const workspaceId = uuidv7();
  const now = new Date();
  const firstName = user.name.trim().split(/\s+/)[0] || "Coach";
  const skills = skillRows(workspaceId, "pickleball");

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
    db.insert(workspaceSettings).values({ workspaceId, paymentMethods: DEFAULT_PAYMENT_METHODS }),
    db.insert(notificationPref).values({ userId: user.id, workspaceId }),
    ...chunkRows(skills, 9).map((rows) => db.insert(skill).values(rows)),
  ]);
  return workspaceId;
}
