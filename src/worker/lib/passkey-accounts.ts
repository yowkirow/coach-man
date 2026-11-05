import { and, like, lt, sql } from "drizzle-orm";
import { isPlaceholderEmail, PLACEHOLDER_EMAIL_DOMAIN } from "../../shared/domain";
import type { Db } from "../db/client";
import { user } from "../db/schema";
import { normalizeEmail } from "./invites";

/**
 * Passkey-only accounts (families without Google). The account is created with a placeholder
 * email the moment someone starts on an invite link, then gets its passkey. One whose passkey never
 * arrived (cancelled, failed, or the tab closed) can't sign in again, so it's removed: at once when
 * the page sees the failure, and by the daily maintenance after this long otherwise.
 */
export const ABANDONED_ACCOUNT_MS = 24 * 60 * 60 * 1000;

/** What the cleanup looks at for one account. */
export interface AccountFootprint {
  email: string;
  createdAt: number;
  passkeys: number;
  /** client_access rows of any state: revoked history is kept with its account. */
  familyLinks: number;
  memberships: number;
}

/**
 * An abandoned passkey-only account: a placeholder email, older than a day, and nothing that
 * makes it usable or worth keeping (no passkey, no family link, no academy).
 */
export function isAbandonedPasskeyAccount(a: AccountFootprint, now: number): boolean {
  return (
    isPlaceholderEmail(a.email) &&
    now - a.createdAt >= ABANDONED_ACCOUNT_MS &&
    a.passkeys === 0 &&
    a.familyLinks === 0 &&
    a.memberships === 0
  );
}

/**
 * Deletes abandoned passkey-only accounts (the SQL form of isAbandonedPasskeyAccount). Sessions
 * and linked accounts go with them (foreign keys). Returns how many were removed.
 */
export async function deleteAbandonedPasskeyAccounts(db: Db, now: number): Promise<number> {
  const removed = await db
    .delete(user)
    .where(
      and(
        like(user.email, `%@${PLACEHOLDER_EMAIL_DOMAIN}`),
        lt(user.createdAt, new Date(now - ABANDONED_ACCOUNT_MS)),
        sql`not exists (select 1 from passkey p where p.user_id = "user"."id")`,
        sql`not exists (select 1 from client_access ca where ca.user_id = "user"."id")`,
        sql`not exists (select 1 from member m where m.user_id = "user"."id")`,
      ),
    )
    .returning({ id: user.id });
  return removed.length;
}

/** The claims CoachMan reads from a Google ID token (already verified by Better Auth). */
export interface GoogleClaims {
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/**
 * Reads the payload of an ID token. Better Auth got the token from Google's token endpoint over
 * TLS and checked it before storing it, so only its claims are needed here. Null when malformed.
 */
export function idTokenClaims(idToken: string | null | undefined): GoogleClaims | null {
  const part = idToken?.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const email = typeof payload.email === "string" ? normalizeEmail(payload.email) : null;
    return {
      email: email || null,
      emailVerified: payload.email_verified === true || payload.email_verified === "true",
      name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null,
      picture: typeof payload.picture === "string" ? payload.picture : null,
    };
  } catch {
    return null;
  }
}

export type GoogleLinkCheck = { ok: true } | { ok: false; error: string; errorDescription: string };

/**
 * Linking a Google account to an existing CoachMan account (Better Auth's `link-account`, from
 * the portal's "Link Google", or a returning Google sign-in matching an account by email):
 * - the same address as the account's: fine (that's how a Google account normally links);
 * - a different address: only for a passkey-only account (placeholder email), only a verified
 *   Google address, and only one no other CoachMan account uses. The placeholder is then
 *   replaced by the Google address.
 */
export function checkGoogleLink(input: {
  /** The account being linked to, as stored now. */
  currentEmail: string;
  googleEmail: string | null | undefined;
  googleEmailVerified: boolean;
  /** Another account already using the Google address, if any. */
  takenByOther: boolean;
}): GoogleLinkCheck {
  const google = input.googleEmail ? normalizeEmail(input.googleEmail) : "";
  if (!google) {
    return {
      ok: false,
      error: "google_email_missing",
      errorDescription: "Google didn't share an email address for that account.",
    };
  }
  if (google === normalizeEmail(input.currentEmail)) return { ok: true };
  if (!isPlaceholderEmail(input.currentEmail)) {
    return {
      ok: false,
      error: "google_link_not_allowed",
      errorDescription:
        "This account already signs in with Google. Sign in with that Google account instead.",
    };
  }
  if (!input.googleEmailVerified) {
    return {
      ok: false,
      error: "google_email_unverified",
      errorDescription: "Google hasn't verified that account's email address. Try another account.",
    };
  }
  if (input.takenByOther) {
    return {
      ok: false,
      error: "google_email_taken",
      errorDescription:
        "That Google account already belongs to another CoachMan account. Pick a different Google account, or sign out and continue with Google to use that one.",
    };
  }
  return { ok: true };
}
