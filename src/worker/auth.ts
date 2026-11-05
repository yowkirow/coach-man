import { passkey } from "@better-auth/passkey";
import { type BetterAuthPlugin, betterAuth, type GenericEndpointContext } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sessionMiddleware,
} from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import { organization } from "better-auth/plugins";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { isPlaceholderEmail, placeholderEmail } from "../shared/domain";
import { uuidv7 } from "../shared/ids";
import { type Db, getDb } from "./db/client";
import {
  account as accountTable,
  authSchema,
  clientAccess,
  invite,
  member,
  passkey as passkeyTable,
  user as userTable,
} from "./db/schema";
import { E2E_HEADER, isBypassEnabled, isBypassRequestAllowed } from "./lib/bypass";
import { normalizeEmail } from "./lib/invites";
import { checkGoogleLink, idTokenClaims } from "./lib/passkey-accounts";
import { clientIp, hit, INVITE_MISS_RULE, PASSKEY_ACCOUNT_RULE, spent } from "./lib/rate-limit";
import { hashToken, inviteStatus, isTokenShaped } from "./lib/tokens";
import { firstWorkspaceForUser, provisionWorkspace } from "./lib/workspace";

/**
 * Test-only sign-in endpoint (POST /api/auth/e2e/sign-in). Never registered in production;
 * also requires the `x-e2e-bypass` header to match E2E_BYPASS_SECRET.
 *
 * `persona`: "coach" (default) makes sure the user is staff somewhere, provisioning their own
 * workspace when they aren't; "none" signs in a bare account (no workspace, no family links).
 */
function e2eSignIn(env: Env): BetterAuthPlugin {
  return {
    id: "coachman-e2e-sign-in",
    endpoints: {
      e2eSignIn: createAuthEndpoint(
        "/e2e/sign-in",
        {
          method: "POST",
          body: z.object({
            email: z.email().default("e2e-coach@coachman.test"),
            name: z.string().min(1).max(80).default("Casey Coach"),
            persona: z.enum(["coach", "none"]).default("coach"),
          }),
        },
        async (ctx) => {
          const header = ctx.headers?.get(E2E_HEADER);
          if (!isBypassRequestAllowed(env, header)) {
            throw new APIError("NOT_FOUND", { message: "Not found" });
          }
          const { email, name, persona } = ctx.body;
          const found = await ctx.context.internalAdapter.findUserByEmail(email);
          const user =
            found?.user ??
            (await ctx.context.internalAdapter.createUser(
              { email, name, emailVerified: true },
              { method: "e2e" },
            ));
          if (persona === "coach") {
            const db = getDb(env.DB);
            // Before the session exists, so the session hook makes this workspace active.
            if (!(await firstWorkspaceForUser(db, user.id))) {
              await provisionWorkspace(db, { id: user.id, name: user.name });
            }
          }
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ userId: user.id });
        },
      ),
    },
  };
}

function buildAuth(env: Env) {
  const db = getDb(env.DB);
  const secureCookies = env.APP_ENV !== "development";

  return betterAuth({
    appName: "CoachMan",
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, { provider: "sqlite", schema: authSchema }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        // Only so a passkey-only account (placeholder email) can link the Google account it picks;
        // `user.validateUserInfo` below refuses every other different-email link.
        allowDifferentEmails: true,
      },
    },
    user: {
      validateUserInfo: async ({ user: incoming, source }) => {
        if (source.action !== "link-account" || source.oauth?.providerId !== "google") return;
        const id = typeof incoming.id === "string" ? incoming.id : null;
        const current = id
          ? await db.query.user.findFirst({ where: eq(userTable.id, id), columns: { email: true } })
          : undefined;
        if (!id || !current) return;
        const googleEmail = typeof incoming.email === "string" ? incoming.email : null;
        const check = checkGoogleLink({
          currentEmail: current.email,
          googleEmail,
          googleEmailVerified: incoming.emailVerified === true,
          takenByOther: googleEmail ? await emailTakenByOther(db, googleEmail, id) : false,
        });
        return check.ok
          ? undefined
          : { error: check.error, errorDescription: check.errorDescription };
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // Removing passkeys or deleting the workspace needs a sign-in within the last 15 minutes.
      freshAge: 60 * 15,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    rateLimit: {
      enabled: env.APP_ENV !== "development",
      storage: "database",
      window: 60,
      max: 120,
      customRules: {
        "/sign-in/social": { window: 60, max: 10 },
        "/link-social": { window: 60, max: 10 },
        "/passkey/*": { window: 60, max: 30 },
        "/passkey-account/*": { window: 60, max: 10 },
        "/e2e/*": { window: 60, max: 120 },
      },
    },
    advanced: {
      database: { generateId: () => uuidv7() },
      useSecureCookies: secureCookies,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/link-social") await guardLinkSocial(db, ctx);
        if (ctx.path === "/passkey/delete-passkey") await guardLastPasskey(db, ctx);
      }),
    },
    databaseHooks: {
      // No workspace is created here: coaches set one up from /welcome, staff join through an
      // invite, and families only ever get portal access.
      session: {
        create: {
          before: async (session) => {
            const workspaceId = await firstWorkspaceForUser(db, session.userId);
            return { data: { ...session, activeOrganizationId: workspaceId } };
          },
        },
      },
      account: {
        create: {
          // A passkey-only account linking Google: a backstop for the checks in validateUserInfo.
          before: async (acct) => {
            if (acct.providerId !== "google") return;
            const owner = await placeholderOwner(db, acct.userId);
            if (!owner) return;
            const claims = idTokenClaims(acct.idToken);
            if (!claims?.email || !claims.emailVerified) return false;
            if (await emailTakenByOther(db, claims.email, owner.id)) return false;
          },
          // ...then its placeholder email and name become the Google account's.
          after: async (acct) => {
            if (acct.providerId !== "google") return;
            await adoptGoogleIdentity(db, acct);
          },
        },
      },
    },
    plugins: [
      organization({ allowUserToCreateOrganization: false }),
      passkey({ rpID: env.PASSKEY_RP_ID, rpName: env.PASSKEY_RP_NAME, origin: env.APP_URL }),
      passkeyAccounts(env),
      ...(isBypassEnabled(env) ? [e2eSignIn(env)] : []),
    ],
  });
}

/** Whether another account already uses this email (any letter case). */
async function emailTakenByOther(db: Db, email: string, userId: string): Promise<boolean> {
  const row = await db.query.user.findFirst({
    where: and(eq(sql`lower(${userTable.email})`, normalizeEmail(email)), ne(userTable.id, userId)),
    columns: { id: true },
  });
  return Boolean(row);
}

/** The user when their email is a passkey-only placeholder, else null. */
async function placeholderOwner(db: Db, userId: string) {
  const row = await db.query.user.findFirst({ where: eq(userTable.id, userId) });
  return row && isPlaceholderEmail(row.email) ? row : null;
}

/**
 * After a passkey-only account links Google: Google's verified address and name replace the
 * placeholder. Never throws (the link already happened); if the address was claimed by someone
 * else a moment ago, the link is undone instead, so the account stays passkey-only and consistent.
 */
async function adoptGoogleIdentity(
  db: Db,
  acct: { id: string; userId: string; idToken?: string | null },
) {
  try {
    const owner = await placeholderOwner(db, acct.userId);
    const claims = idTokenClaims(acct.idToken);
    if (!owner || !claims?.email || !claims.emailVerified) return;
    await db
      .update(userTable)
      .set({
        email: claims.email,
        emailVerified: true,
        ...(claims.name ? { name: claims.name } : {}),
        updatedAt: new Date(),
      })
      .where(eq(userTable.id, owner.id));
  } catch (err) {
    console.error("Couldn't adopt the linked Google identity; unlinking", err);
    await db
      .delete(accountTable)
      .where(eq(accountTable.id, acct.id))
      .catch(() => undefined);
  }
}

/**
 * "Link Google" is for passkey-only accounts (placeholder email) only, through Google's own
 * sign-in page. Everyone else already signs in with Google, and the ID-token shortcut (which
 * skips validateUserInfo) is never used by the app.
 */
async function guardLinkSocial(db: Db, ctx: GenericEndpointContext) {
  const session = await getSessionFromCtx(ctx);
  if (!session) return;
  const body = (ctx.body ?? {}) as { idToken?: unknown; provider?: unknown };
  const owner = await placeholderOwner(db, session.user.id);
  if (!owner || body.idToken || body.provider !== "google") {
    throw new APIError("FORBIDDEN", {
      code: "google_link_not_allowed",
      message: "This account already signs in with Google, so there's nothing to link.",
    });
  }
}

/** A passkey-only account without Google keeps at least one passkey: it's the only way in. */
async function guardLastPasskey(db: Db, ctx: GenericEndpointContext) {
  const session = await getSessionFromCtx(ctx);
  if (!session) return;
  const owner = await placeholderOwner(db, session.user.id);
  if (!owner) return;
  const [google, keys] = await Promise.all([
    db.query.account.findFirst({
      where: and(eq(accountTable.userId, owner.id), eq(accountTable.providerId, "google")),
      columns: { id: true },
    }),
    db.select({ n: count() }).from(passkeyTable).where(eq(passkeyTable.userId, owner.id)),
  ]);
  if (!google && (keys[0]?.n ?? 0) <= 1) {
    throw new APIError("CONFLICT", {
      code: "last_sign_in_method",
      message:
        "This passkey is the only way into your account. Add another passkey or link Google first.",
    });
  }
}

/**
 * Passkey-only family accounts (no Google needed), only for someone holding a family invite that
 * still works, so nobody can create anonymous accounts at will:
 * - POST /api/auth/passkey-account/start { name, inviteToken } creates the account (placeholder
 *   email) and signs it in; the page then adds the passkey and accepts the invite.
 * - POST /api/auth/passkey-account/abandon, after a failed or cancelled passkey: deletes the
 *   account while it has nothing (no passkey, no family link, no academy) and signs out.
 * Accounts that are never finished or abandoned are removed by the daily maintenance after a day.
 * Enrollment from the academy page (WS4) is the other context that may start one.
 */
function passkeyAccounts(env: Env): BetterAuthPlugin {
  const db = getDb(env.DB);
  return {
    id: "coachman-passkey-accounts",
    endpoints: {
      passkeyAccountStart: createAuthEndpoint(
        "/passkey-account/start",
        {
          method: "POST",
          body: z.object({
            name: z.string().trim().min(1).max(80),
            inviteToken: z.string().max(200),
          }),
        },
        async (ctx) => {
          if (await getSessionFromCtx(ctx)) {
            throw new APIError("CONFLICT", {
              code: "already_signed_in",
              message:
                "You're already signed in. Accept the invite with this account, or sign out first.",
            });
          }
          const ip = clientIp(ctx.headers ?? new Headers());
          if (await spent(db, `invite-miss:ip:${ip}`, INVITE_MISS_RULE)) {
            throw new APIError("TOO_MANY_REQUESTS", {
              code: "rate_limited",
              message: "Too many tries. Wait a few minutes, then try again.",
            });
          }
          const { name, inviteToken } = ctx.body;
          const found = isTokenShaped(inviteToken)
            ? await db.query.invite.findFirst({
                where: eq(invite.tokenHash, await hashToken(inviteToken)),
              })
            : undefined;
          if (found?.kind !== "family") {
            await hit(db, `invite-miss:ip:${ip}`, INVITE_MISS_RULE);
            throw new APIError("NOT_FOUND", {
              code: "invite_not_found",
              message: "This invite link doesn't work. Ask the academy for a new one.",
            });
          }
          const status = inviteStatus(found);
          if (status !== "valid") {
            throw new APIError("GONE", {
              code: `invite_${status}`,
              message: "This invite link no longer works. Ask the academy for a new one.",
            });
          }
          const counted = await hit(db, `passkey-account:${found.id}`, PASSKEY_ACCOUNT_RULE);
          if (!counted.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              code: "rate_limited",
              message: "Too many accounts were started from this link. Try again in an hour.",
            });
          }
          const created = await ctx.context.internalAdapter.createUser(
            { email: placeholderEmail(crypto.randomUUID()), name, emailVerified: false },
            { method: "passkey" },
          );
          const session = await ctx.context.internalAdapter.createSession(created.id);
          await setSessionCookie(ctx, { session, user: created });
          return ctx.json({ userId: created.id });
        },
      ),
      passkeyAccountAbandon: createAuthEndpoint(
        "/passkey-account/abandon",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const { session, user } = ctx.context.session;
          const owner = await placeholderOwner(db, user.id);
          let deleted = false;
          if (owner) {
            const [keys, links, memberships] = await Promise.all([
              db.select({ n: count() }).from(passkeyTable).where(eq(passkeyTable.userId, owner.id)),
              db.select({ n: count() }).from(clientAccess).where(eq(clientAccess.userId, owner.id)),
              db.select({ n: count() }).from(member).where(eq(member.userId, owner.id)),
            ]);
            if (!keys[0]?.n && !links[0]?.n && !memberships[0]?.n) {
              await db.delete(userTable).where(eq(userTable.id, owner.id));
              deleted = true;
            }
          }
          if (!deleted) await ctx.context.internalAdapter.deleteSession(session.token);
          deleteSessionCookie(ctx);
          return ctx.json({ deleted });
        },
      ),
    },
  };
}

export type Auth = ReturnType<typeof buildAuth>;

const cache = new WeakMap<Env, Auth>();

export function getAuth(env: Env): Auth {
  let auth = cache.get(env);
  if (!auth) {
    auth = buildAuth(env);
    cache.set(env, auth);
  }
  return auth;
}
