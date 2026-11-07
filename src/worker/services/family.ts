import { and, count, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { FamilyAccessDto, FamilyInviteDto, FamilyLinkDto } from "../../shared/api-types";
import { type FamilyRelation, isPlaceholderEmail } from "../../shared/domain";
import { checkFamilyAccess, endsTeenLogins } from "../../shared/family";
import { uuidv7 } from "../../shared/ids";
import type { Db } from "../db/client";
import { account, auditLog, type client, clientAccess, invite, user } from "../db/schema";
import { INVITE_TTL_MS, inviteStatus, newToken } from "../lib/tokens";
import { appOrigin } from "../routes/academy";
import { runBatch } from "./credits";

type ClientRow = typeof client.$inferSelect;
type InviteRow = typeof invite.$inferSelect;

/** Expired family invites stay listed (so they can be sent again) for this long. */
const EXPIRED_INVITES_SHOWN_MS = 30 * 24 * 60 * 60 * 1000;

/** Builds (does not run) an audit insert for a family-access change. */
export function familyAudit(
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    action: string;
    entity: "family_invite" | "client_access";
    entityId: string;
    data: Record<string, unknown>;
  },
) {
  return db.insert(auditLog).values({ id: uuidv7(), ...input });
}

/** How many parents are linked to a student now (optionally not counting one link). */
export async function activeGuardianCount(
  db: Db,
  clientId: string,
  exceptAccessId?: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(clientAccess)
    .where(
      and(
        eq(clientAccess.clientId, clientId),
        eq(clientAccess.relation, "guardian"),
        isNull(clientAccess.revokedAt),
        exceptAccessId ? ne(clientAccess.id, exceptAccessId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

export function toFamilyInviteDto(
  row: InviteRow,
  invitedBy: string | null,
  now = Date.now(),
): FamilyInviteDto {
  return {
    id: row.id,
    relation: row.relation ?? "guardian",
    status: inviteStatus(row, now),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    invitedBy,
  };
}

/**
 * Makes a family invite link (single use, seven days). A student has one live "own login" link
 * at a time, so a new one withdraws the last; parents' links don't replace each other (a mother
 * and a father can both be invited). Audited.
 */
export async function createFamilyInvite(
  db: Db,
  env: Env,
  input: {
    workspaceId: string;
    clientId: string;
    relation: FamilyRelation;
    createdBy: string;
    /** "staff" or "guardian": who made it, for the audit log. */
    by: "staff" | "guardian";
  },
): Promise<{ row: InviteRow; link: string }> {
  const now = Date.now();
  const { token, hash } = await newToken();
  const id = uuidv7();
  await runBatch({ db }, [
    ...(input.relation === "self"
      ? [
          db
            .update(invite)
            .set({ revokedAt: now })
            .where(
              and(
                eq(invite.workspaceId, input.workspaceId),
                eq(invite.kind, "family"),
                eq(invite.clientId, input.clientId),
                eq(invite.relation, "self"),
                isNull(invite.acceptedAt),
                isNull(invite.revokedAt),
              ),
            ),
        ]
      : []),
    db.insert(invite).values({
      id,
      workspaceId: input.workspaceId,
      kind: "family",
      tokenHash: hash,
      clientId: input.clientId,
      relation: input.relation,
      createdBy: input.createdBy,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    }),
    familyAudit(db, {
      workspaceId: input.workspaceId,
      userId: input.createdBy,
      action: "invite",
      entity: "family_invite",
      entityId: id,
      data: { clientId: input.clientId, relation: input.relation, by: input.by },
    }),
  ]);
  const row = await db.query.invite.findFirst({ where: eq(invite.id, id) });
  if (!row) throw new Error("The invite wasn't saved.");
  return { row, link: `${appOrigin(env)}/join/${token}` };
}

/** Family invites of a student that can still be used, or expired in the last 30 days. */
export async function familyInvites(
  db: Db,
  workspaceId: string,
  clientId: string,
  relation?: FamilyRelation,
) {
  const now = Date.now();
  return db
    .select({ i: invite, invitedBy: user.name })
    .from(invite)
    .leftJoin(user, eq(user.id, invite.createdBy))
    .where(
      and(
        eq(invite.workspaceId, workspaceId),
        eq(invite.kind, "family"),
        eq(invite.clientId, clientId),
        relation ? eq(invite.relation, relation) : undefined,
        isNull(invite.acceptedAt),
        isNull(invite.revokedAt),
        gt(invite.expiresAt, now - EXPIRED_INVITES_SHOWN_MS),
      ),
    )
    .orderBy(desc(invite.createdAt));
}

/** Active links to a student, with each person's name, how they sign in, and who granted it. */
export async function familyLinks(
  db: Db,
  workspaceId: string,
  clientId: string,
  relation?: FamilyRelation,
): Promise<FamilyLinkDto[]> {
  const rows = await db
    .select({
      a: clientAccess,
      name: user.name,
      email: user.email,
      google: sql<number>`exists (select 1 from account ac where ac.user_id = "user"."id" and ac.provider_id = 'google')`,
      grantedBy: sql<
        string | null
      >`(select g.name from "user" g where g.id = "client_access"."granted_by")`,
    })
    .from(clientAccess)
    .innerJoin(user, eq(user.id, clientAccess.userId))
    .where(
      and(
        eq(clientAccess.workspaceId, workspaceId),
        eq(clientAccess.clientId, clientId),
        isNull(clientAccess.revokedAt),
        relation ? eq(clientAccess.relation, relation) : undefined,
      ),
    )
    .orderBy(clientAccess.createdAt);
  return rows.map((r) => {
    const placeholder = isPlaceholderEmail(r.email);
    return {
      id: r.a.id,
      name: r.name,
      email: placeholder ? null : r.email,
      signIn: placeholder && !Number(r.google) ? "passkey" : "google",
      relation: r.a.relation,
      since: r.a.createdAt,
      grantedBy: r.grantedBy ?? null,
    };
  });
}

/** The Family access card on a student's page (staff with `familyAccess`). */
export async function loadFamilyAccess(
  db: Db,
  student: ClientRow,
  today: string,
): Promise<FamilyAccessDto> {
  const [links, invites] = await Promise.all([
    familyLinks(db, student.workspaceId, student.id),
    familyInvites(db, student.workspaceId, student.id),
  ]);
  const hasGuardian = links.some((l) => l.relation === "guardian");
  const rule = (relation: FamilyRelation) => {
    const check = checkFamilyAccess({
      relation,
      birthDate: student.birthDate,
      isJunior: student.isJunior,
      today,
      hasGuardian,
    });
    return check.ok ? { ok: true as const } : check;
  };
  const now = Date.now();
  return {
    clientId: student.id,
    firstName: student.firstName,
    links,
    invites: invites.map((r) => toFamilyInviteDto(r.i, r.invitedBy ?? null, now)),
    rules: { guardian: rule("guardian"), self: rule("self") },
  };
}

/**
 * Ends someone's access to a student (idempotent). When the last parent of a minor goes, the
 * minor's own logins end too: a teen's login depends on a parent being linked. Every change is
 * audited. Returns the access ids revoked (empty when it was already revoked).
 */
export async function revokeFamilyAccess(
  db: Db,
  input: { student: ClientRow; accessId: string; actorId: string; today: string; by: string },
): Promise<string[] | null> {
  const { student } = input;
  const row = await db.query.clientAccess.findFirst({
    where: and(
      eq(clientAccess.id, input.accessId),
      eq(clientAccess.clientId, student.id),
      eq(clientAccess.workspaceId, student.workspaceId),
    ),
  });
  if (!row) return null;
  if (row.revokedAt !== null) return [];
  const ids = [row.id];
  if (row.relation === "guardian") {
    const left = await activeGuardianCount(db, student.id, row.id);
    if (
      endsTeenLogins({
        birthDate: student.birthDate,
        isJunior: student.isJunior,
        today: input.today,
        guardiansLeft: left,
      })
    ) {
      const teens = await db
        .select({ id: clientAccess.id })
        .from(clientAccess)
        .where(
          and(
            eq(clientAccess.clientId, student.id),
            eq(clientAccess.relation, "self"),
            isNull(clientAccess.revokedAt),
          ),
        );
      ids.push(...teens.map((t) => t.id));
    }
  }
  const now = Date.now();
  await runBatch({ db }, [
    ...ids.map((id) =>
      db
        .update(clientAccess)
        .set({ revokedAt: now })
        .where(and(eq(clientAccess.id, id), isNull(clientAccess.revokedAt))),
    ),
    ...ids.map((id) =>
      familyAudit(db, {
        workspaceId: student.workspaceId,
        userId: input.actorId,
        action: "revoke",
        entity: "client_access",
        entityId: id,
        data: {
          clientId: student.id,
          by: input.by,
          ...(id === row.id
            ? { relation: row.relation, userId: row.userId }
            : { relation: "self", reason: "last_guardian_revoked" }),
        },
      }),
    ),
  ]);
  return ids;
}

/** Whether the user has a Google account linked (it can sign them in). */
export async function hasGoogleAccount(db: Db, userId: string): Promise<boolean> {
  const row = await db.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, "google")),
    columns: { id: true },
  });
  return Boolean(row);
}
