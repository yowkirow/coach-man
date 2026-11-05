import { and, eq, gt, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { InviteAcceptedDto, InvitePreviewDto } from "../../shared/api-types";
import type { InviteKind } from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import { normalizeRole } from "../../shared/roles";
import { academyProfile, auditLog, client, invite, organization } from "../db/schema";
import { ApiError, unauthorized } from "../lib/errors";
import { checkStaffAcceptance, maskEmail, normalizeEmail } from "../lib/invites";
import { limitByIp } from "../lib/rate-limit";
import { hashToken, inviteStatus, isTokenShaped } from "../lib/tokens";
import { addStaffMember, membershipsForUser } from "../lib/workspace";
import { originGuard } from "../middleware";
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

async function findInvite(c: Context<AppBindings>, token: string): Promise<FoundInvite> {
  if (!isTokenShaped(token)) throw notFoundInvite();
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
  if (!row) throw notFoundInvite();
  return {
    invite: row.invite,
    academyName: row.academyName,
    logoKey: row.logoKey ?? null,
    studentFirstName: row.studentFirstName ?? null,
  };
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
 * verified Google address it was sent to; then they join with the invite's role. A link works
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

/** Family invites arrive with the family portal (WS3); until then they're refused clearly. */
const acceptFamily: Acceptor = async () => {
  throw new ApiError(
    400,
    "family_invites_unavailable",
    "Family invite links can't be accepted yet. Ask the academy to try again later.",
  );
};

/** One acceptor per invite kind: WS3 replaces `family` (client_access + age rules). */
const ACCEPT: Record<InviteKind, Acceptor> = { staff: acceptStaff, family: acceptFamily };

/**
 * Invite links (/api/invites, no workspace needed). The preview is public and shows only the
 * academy, the role or the student's first name, and whether the link still works; accepting needs
 * a signed-in account. Both are rate-limited per IP.
 */
export const inviteRoutes = new Hono<AppBindings>()
  .use("*", originGuard)

  .get("/:token", limitByIp("invite-preview", { windowMs: 60_000, max: 60 }), async (c) => {
    const found = await findInvite(c, c.req.param("token"));
    const inv = found.invite;
    const user = await signedInUser(c);
    // Only about the person asking: whether the invite names them and whether they're on the team.
    const onTeam = user ? await isTeamMember(c, user.id, inv.workspaceId) : false;
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
    };
    return c.json(body);
  })

  .post("/:token/accept", limitByIp("invite-accept", { windowMs: 60_000, max: 20 }), async (c) => {
    await c.req.raw.arrayBuffer().catch(() => undefined);
    const user = await signedInUser(c);
    if (!user) throw unauthorized();
    const found = await findInvite(c, c.req.param("token"));
    return ACCEPT[found.invite.kind](c, found, user);
  });
