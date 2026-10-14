import { passkey } from "@better-auth/passkey";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { organization } from "better-auth/plugins";
import { z } from "zod";
import { uuidv7 } from "../shared/ids";
import { getDb } from "./db/client";
import { authSchema } from "./db/schema";
import { E2E_HEADER, isBypassEnabled, isBypassRequestAllowed } from "./lib/bypass";
import { firstWorkspaceForUser, provisionWorkspace } from "./lib/workspace";

/**
 * Test-only sign-in endpoint (POST /api/auth/e2e/sign-in). Never registered in production;
 * also requires the `x-e2e-bypass` header to match E2E_BYPASS_SECRET.
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
          }),
        },
        async (ctx) => {
          const header = ctx.headers?.get(E2E_HEADER);
          if (!isBypassRequestAllowed(env, header)) {
            throw new APIError("NOT_FOUND", { message: "Not found" });
          }
          const { email, name } = ctx.body;
          const found = await ctx.context.internalAdapter.findUserByEmail(email);
          const user =
            found?.user ??
            (await ctx.context.internalAdapter.createUser(
              { email, name, emailVerified: true },
              { method: "e2e" },
            ));
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
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
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
        "/passkey/*": { window: 60, max: 30 },
        "/e2e/*": { window: 60, max: 120 },
      },
    },
    advanced: {
      database: { generateId: () => uuidv7() },
      useSecureCookies: secureCookies,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await provisionWorkspace(db, { id: user.id, name: user.name });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const workspaceId = await firstWorkspaceForUser(db, session.userId);
            return { data: { ...session, activeOrganizationId: workspaceId } };
          },
        },
      },
    },
    plugins: [
      organization({ allowUserToCreateOrganization: false }),
      passkey({ rpID: env.PASSKEY_RP_ID, rpName: env.PASSKEY_RP_NAME, origin: env.APP_URL }),
      ...(isBypassEnabled(env) ? [e2eSignIn(env)] : []),
    ],
  });
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
