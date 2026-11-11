import { and, count, eq, gt, isNotNull, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { InviteAcceptedDto, InvitePreviewDto } from "../../shared/api-types";
import type { InviteKind } from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import { normalizeRole } from "../../shared/roles";
import { todayIn } from "../../shared/time";
import {
  academyProfile,
  auditLog,
  client,
  clientAccess,
  invite,
  organization,
  passkey,
  workspaceSettings,
} from "../db/schema";
import { ApiError, unauthorized } from "../lib/errors";
import {
  checkFamilyAcceptance,
  checkStaffAcceptance,
  type FamilyAcceptance,
  maskEmail,
  normalizeEmail,
} from "../lib/invites";
import {
  clientIp,
  enforce,
  hit,
  INVITE_ACCEPT_RULE,
  INVITE_MISS_RULE,
  INVITE_PREVIEW_RULE,
  spent,
  tooManyTries,
} from "../lib/rate-limit";
import { hashToken, inviteStatus, isTokenShaped } from "../lib/tokens";
import { addStaffMember, membershipsForUser } from "../lib/workspace";
import { originGuard } from "../middleware";
import { activeGuardianCount, familyAudit, hasGoogleAccount } from "../services/family";
import type { AppBindings, SessionUser } from "../types";
import { setActiveWorkspace } from "./account";

type InviteRow = typeof invite.$inferSelect;

interface FoundInvite {
  invite: InviteRow;
  academyName: string;
  logoKey: string | null;
  studentFirstName: string | null;
}

const notFoundInvite = () =>
  new ApiError(
    404,
    "invite_not_found",
    "This invite link doesn't work. Check that you copied all of it, or ask the academy for a new one.",
  );

async function findInvite(c: Context<AppBindings>, token: string): Promise<FoundInvite | null> {
  if (!isTokenShaped(token)) return null;
  const [row] = await c.var.db
    .select({
      invite,
      academyName: organization.name,
      logoKey: academyProfile.logoKey,
      studentFirstName: client.firstName,
    })
    .from(invite)
    .innerJoin(organization, eq(organization.id, invite.workspaceId))
    .leftJoin(academyProfile, eq(academyProfile.workspaceId, invite.workspaceId))
    .leftJoin(client, eq(client.id, invite.clientId))
    .where(eq(invite.tokenHash, await hashToken(token)))
    .limit(1);
  if (!row) return null;
  return {
    invite: row.invite,
    academyName: row.academyName,
    logoKey: row.logoKey ?? null,
    studentFirstName: row.studentFirstName ?? null,
  };
}

/**
 * Looks an invite up, counting misses against `missKey`: guessing tokens means asking for ones
 * that don't exist, so that's what is limited. Once the misses are used up, every lookup from
 * that key is refused (found or not), so a guesser learns nothing more until the window passes.
 */
async function lookUp(c: Context<AppBindings>, token: string, missKey: string) {
  if (await spent(c.var.db, missKey, INVITE_MISS_RULE)) throw tooManyTries(60);
  const found = await findInvite(c, token);
  if (!found) {
    await hit(c.var.db, missKey, INVITE_MISS_RULE);
    throw notFoundInvite();
  }
  return found;
}

/** Whether the person already has active access to the invite's student (family invites). */
async function isLinked(c: Context<AppBindings>, userId: string, clientId: string | null) {
  if (!clientId) return false;
  const row = await c.var.db.query.clientAccess.findFirst({
    where: and(
      eq(clientAccess.clientId, clientId),
      eq(clientAccess.userId, userId),
      isNull(clientAccess.revokedAt),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}

async function signedInUser(c: Context<AppBindings>): Promise<SessionUser | null> {
  const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  return result?.user ?? null;
}

type Acceptor = (
  c: Context<AppBindings>,
  found: FoundInvite,
  user: SessionUser,
) => Promise<Response>;

const USED_MESSAGE =
  "This invite has already been used. Ask the academy for a new link if you need one.";

/** Whether the signed-in person is already on the invite's academy's team. */
async function isTeamMember(c: Context<AppBindings>, userId: string, workspaceId: string) {
  return (await membershipsForUser(c.var.db, userId)).some((m) => m.workspaceId === workspaceId);
}

/**
 * Staff: the invite must still work (not used, withdrawn, or expired) and the account must be the
 * verified address it was sent to; then they join with the invite's role. A link works
 * once. Opening it again, even as the person who used it, is refused as used (with
 * `details.alreadyMember` so the page can say they're on the team) and changes nothing.
 */
const acceptStaff: Acceptor = async (c, found, user) => {
  const db = c.var.db;
  const inv = found.invite;
  const refuseUnlessUsable = async (row: InviteRow, now: number) => {
    const check = checkStaffAcceptance({
      status: inviteStatus(row, now),
      inviteEmail: row.email,
      user: { email: user.email, emailVerified: user.emailVerified },
    });
    if (check.ok) return;
    let details: Record<string, unknown> | undefined;
    if (check.code === "wrong_email" && row.email) details = { hint: maskEmail(row.email) };
    if (check.code === "invite_used" && (await isTeamMember(c, user.id, row.workspaceId))) {
      details = { alreadyMember: true };
    }
    throw new ApiError(check.status, check.code, check.message, details);
  };

  const now = Date.now();
  await refuseUnlessUsable(inv, now);
  // Claim the invite first, in one guarded update, so a link can't be used twice at once.
  const claimed = await db
    .update(invite)
    .set({ acceptedBy: user.id, acceptedAt: now })
    .where(
      and(
        eq(invite.id, inv.id),
        isNull(invite.acceptedAt),
        isNull(invite.revokedAt),
        gt(invite.expiresAt, now),
      ),
    )
    .returning({ id: invite.id });
  if (!claimed.length) {
    // Used in another tab a moment ago, or withdrawn or expired since it was read.
    const fresh = await db.query.invite.findFirst({ where: eq(invite.id, inv.id) });
    if (!fresh) throw notFoundInvite();
    await refuseUnlessUsable(fresh, Date.now());
    throw new ApiError(410, "invite_used", USED_MESSAGE);
  }

  // Someone already on the team keeps their role; the invite just brings them in.
  const alreadyMember = await isTeamMember(c, user.id, inv.workspaceId);
  if (!alreadyMember) {
    try {
      await addStaffMember(db, {
        workspaceId: inv.workspaceId,
        userId: user.id,
        role: normalizeRole(inv.role),
      });
    } catch (err) {
      // Joining failed: give the link back so it can be tried again.
      await db
        .update(invite)
        .set({ acceptedBy: null, acceptedAt: null })
        .where(and(eq(invite.id, inv.id), eq(invite.acceptedBy, user.id)));
      throw err;
    }
  }
  await db.insert(auditLog).values({
    id: uuidv7(),
    workspaceId: inv.workspaceId,
    userId: user.id,
    action: "accept",
    entity: "staff_invite",
    entityId: inv.id,
    data: { role: inv.role, alreadyMember },
  });
  await setActiveWorkspace(c, inv.workspaceId);
  return c.json<InviteAcceptedDto>({ kind: "staff", workspaceId: inv.workspaceId });
};

/**
 * Family: the age rules are checked again now (a birthday, a birth date, or a parent's link may
 * have changed since the invite was made), then the link is claimed in one guarded update and the
 * person gets access to the student (a revoked link is restored). Someone who already follows the
 * student is told so and the invite stays unused. Used, withdrawn, and expired links answer 410,
 * like staff invites; a used link opened by the person linked through it says so in
 * `details.alreadyLinked`.
 */
const acceptFamily: Acceptor = async (c, found, user) => {
  const db = c.var.db;
  const inv = found.invite;
  const [student, settings, keys, google] = await Promise.all([
    inv.clientId
      ? db.query.client.findFirst({
          where: and(eq(client.id, inv.clientId), eq(client.workspaceId, inv.workspaceId)),
        })
      : undefined,
    db.query.workspaceSettings.findFirst({
      where: eq(workspaceSettings.workspaceId, inv.workspaceId),
      columns: { timezone: true },
    }),
    db.select({ n: count() }).from(passkey).where(eq(passkey.userId, user.id)),
    hasGoogleAccount(db, user.id),
  ]);
  const today = todayIn(settings?.timezone ?? "UTC");

  const check = async (row: InviteRow): Promise<FamilyAcceptance> =>
    checkFamilyAcceptance({
      status: inviteStatus(row, Date.now()),
      relation: row.relation,
      student: student ?? null,
      today,
      hasGuardian: student ? (await activeGuardianCount(db, student.id)) > 0 : false,
      alreadyLinked: await isLinked(c, user.id, row.clientId),
      user: { email: user.email, passkeys: keys[0]?.n ?? 0, hasGoogle: google },
    });
  const refuse = async (result: Exclude<FamilyAcceptance, { ok: true }>): Promise<never> => {
    const linked =
      result.code === "already_linked" ||
      (result.code === "invite_used" && (await isLinked(c, user.id, inv.clientId)));
    throw new ApiError(
      result.status,
      result.code,
      result.message,
      linked ? { alreadyLinked: true } : undefined,
    );
  };

  const first = await check(inv);
  if (!first.ok) return refuse(first);
  if (!student || !inv.relation) throw notFoundInvite();

  const now = Date.now();
  // Claim the invite first, in one guarded update, so a link can't be used twice at once.
  const claimed = await db
    .update(invite)
    .set({ acceptedBy: user.id, acceptedAt: now })
    .where(
      and(
        eq(invite.id, inv.id),
        isNull(invite.acceptedAt),
        isNull(invite.revokedAt),
        gt(invite.expiresAt, now),
      ),
    )
    .returning({ id: invite.id });
  if (!claimed.length) {
    // Used in another tab a moment ago, or withdrawn or expired since it was read.
    const fresh = await db.query.invite.findFirst({ where: eq(invite.id, inv.id) });
    if (!fresh) throw notFoundInvite();
    const again = await check(fresh);
    if (!again.ok) return refuse(again);
    throw new ApiError(410, "invite_used", USED_MESSAGE);
  }

  const release = () =>
    db
      .update(invite)
      .set({ acceptedBy: null, acceptedAt: null })
      .where(and(eq(invite.id, inv.id), eq(invite.acceptedBy, user.id)));
  let granted: { id: string }[];
  try {
    const accessId = uuidv7();
    granted = await db
      .insert(clientAccess)
      .values({
        id: accessId,
        workspaceId: inv.workspaceId,
        clientId: student.id,
        userId: user.id,
        relation: inv.relation,
        grantedBy: inv.createdBy,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [clientAccess.clientId, clientAccess.userId],
        // Restores a revoked link; never rewrites one that's active (two invites at once).
        set: { relation: inv.relation, revokedAt: null, grantedBy: inv.createdBy, createdAt: now },
        setWhere: isNotNull(clientAccess.revokedAt),
      })
      .returning({ id: clientAccess.id });
  } catch (err) {
    // Linking failed: give the link back so it can be tried again.
    await release();
    throw err;
  }
  const access = granted[0];
  if (!access) {
    await release();
    throw new ApiError(
      409,
      "already_linked",
      `You already follow ${student.firstName}'s training, so you don't need this link.`,
      { alreadyLinked: true },
    );
  }
  await db.batch([
    db.insert(auditLog).values({
      id: uuidv7(),
      workspaceId: inv.workspaceId,
      userId: user.id,
      action: "accept",
      entity: "family_invite",
      entityId: inv.id,
      data: { clientId: student.id, relation: inv.relation },
    }),
    familyAudit(db, {
      workspaceId: inv.workspaceId,
      userId: user.id,
      action: "grant",
      entity: "client_access",
      entityId: access.id,
      data: {
        clientId: student.id,
        relation: inv.relation,
        inviteId: inv.id,
        grantedBy: inv.createdBy,
      },
    }),
  ]);
  return c.json<InviteAcceptedDto>({
    kind: "family",
    clientId: student.id,
    workspaceId: inv.workspaceId,
  });
};

/** One acceptor per invite kind. */
const ACCEPT: Record<InviteKind, Acceptor> = { staff: acceptStaff, family: acceptFamily };

/**
 * Invite links (/api/invites, no workspace needed). The preview is public and shows only the
 * academy, the role or the student's first name, and whether the link still works; accepting needs
 * a signed-in account. Rate limits count misses (made-up tokens) per connection for previews and
 * per account for accepting, and real links per invite (and account), so many families behind one
 * mobile carrier address are never locked out by each other.
 */
export const inviteRoutes = new Hono<AppBindings>()
  .use("*", originGuard)

  .get("/:token", async (c) => {
    const found = await lookUp(
      c,
      c.req.param("token"),
      `invite-miss:ip:${clientIp(c.req.raw.headers)}`,
    );
    const inv = found.invite;
    await enforce(c, `invite-preview:${inv.id}`, INVITE_PREVIEW_RULE);
    const user = await signedInUser(c);
    // Only about the person asking: whether the invite names them and whether they're on the team.
    const onTeam = user ? await isTeamMember(c, user.id, inv.workspaceId) : false;
    const linked = user && inv.kind === "family" ? await isLinked(c, user.id, inv.clientId) : false;
    const body: InvitePreviewDto = {
      kind: inv.kind,
      academy: { name: found.academyName, logoKey: found.logoKey },
      status: inviteStatus(inv),
      ...(inv.kind === "staff" ? { role: normalizeRole(inv.role) } : {}),
      ...(inv.kind === "family"
        ? {
            student: { firstName: found.studentFirstName ?? "" },
            ...(inv.relation ? { relation: inv.relation } : {}),
          }
        : {}),
      ...(user && inv.kind === "staff"
        ? { forYou: Boolean(inv.email) && normalizeEmail(user.email) === inv.email }
        : {}),
      ...(onTeam ? { alreadyMember: true, workspaceId: inv.workspaceId } : {}),
      ...(linked ? { alreadyLinked: true } : {}),
    };
    return c.json(body);
  })

  .post("/:token/accept", async (c) => {
    await c.req.raw.arrayBuffer().catch(() => undefined);
    const user = await signedInUser(c);
    if (!user) throw unauthorized();
    const found = await lookUp(c, c.req.param("token"), `invite-miss:user:${user.id}`);
    await enforce(c, `invite-accept:${found.invite.id}:${user.id}`, INVITE_ACCEPT_RULE);
    return ACCEPT[found.invite.kind](c, found, user);
  });
