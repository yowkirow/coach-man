import type { InviteKind, InviteStatus } from "../../shared/domain";
import { maskEmail, normalizeEmail } from "./invites";

/**
 * "Email me a code" sign-in (Better Auth's email-OTP plugin, wired up in auth.ts): who may get a
 * code, and whom a code may sign up. Codes only go to addresses CoachMan already knows: an account's,
 * or one an invite lets in (a staff invite's own address; any address for a family invite, whose
 * link holder is the family member it was made for). Pure, so the unit tests read it: auth.ts looks
 * the account and the invite up, counts the request, then asks these. The invite travels in the
 * INVITE_HEADER request header, and a code works SIGN_IN_CODE_MINUTES (src/shared/domain.ts).
 */

/** Wrong tries a code takes: the last one spends it. */
export const CODE_ATTEMPTS = 3;

export const SEND_CODE_PATH = "/email-otp/send-verification-otp";
export const SIGN_IN_CODE_PATH = "/sign-in/email-otp";

/**
 * The plugin's other endpoints, which answer 404: changing an address would get around Google's
 * identity rules, and there are no passwords to reset. Anything new under /email-otp/ is shut too.
 */
export function isBlockedCodePath(path: string): boolean {
  return (
    (path.startsWith("/email-otp/") && path !== SEND_CODE_PATH) ||
    path === "/forget-password/email-otp"
  );
}

/** What a code request needs to know about the invite it came with. */
export interface CodeInvite {
  kind: InviteKind;
  status: InviteStatus;
  /** Staff invites: the address it was sent to. */
  email: string | null;
}

export interface CodeRefusal {
  status: 400 | 403 | 404 | 410;
  code: string;
  message: string;
}

/**
 * Better Auth's own answer to a wrong code, word for word: a sign-up without an invite gets it too,
 * so the answer never says whether an address has an account (the app words it for people).
 */
export const WRONG_CODE: CodeRefusal = { status: 400, code: "INVALID_OTP", message: "Invalid OTP" };

/** Why an invite doesn't let this address get a code or sign up with one, or null when it does. */
export function inviteRefusal(invite: CodeInvite | null, email: string): CodeRefusal | null {
  if (!invite) {
    return {
      status: 404,
      code: "invite_not_found",
      message: "This invite link doesn't work. Ask the academy for a new one.",
    };
  }
  if (invite.status !== "valid") {
    return {
      status: 410,
      code: `invite_${invite.status}`,
      message: "This invite link no longer works. Ask the academy for a new one.",
    };
  }
  if (
    invite.kind === "staff" &&
    (!invite.email || normalizeEmail(invite.email) !== normalizeEmail(email))
  ) {
    return {
      status: 403,
      code: "wrong_email",
      message: `This invite was sent to another address (${maskEmail(invite.email ?? "")}). Use that one.`,
    };
  }
  return null;
}

export type CodeRequestDecision =
  | { kind: "send" }
  /** Answered as if a code went: nothing is stored or sent. */
  | { kind: "silent" }
  | { kind: "refuse"; refusal: CodeRefusal };

/**
 * What happens to a request for a code, once its address is deliverable and the request is counted.
 * With an invite, the invite decides. Without one, only an account's address gets a code, and any
 * other is answered as if one went, so the answer never says whether an address has an account.
 */
export function decideCodeRequest(input: {
  email: string;
  hasAccount: boolean;
  /** Undefined without the invite header; null when its token matches no invite. */
  invite?: CodeInvite | null;
}): CodeRequestDecision {
  if (input.invite !== undefined) {
    const refusal = inviteRefusal(input.invite, input.email);
    return refusal ? { kind: "refuse", refusal } : { kind: "send" };
  }
  return input.hasAccount ? { kind: "send" } : { kind: "silent" };
}

export type CodeSignInDecision =
  | { kind: "continue"; name?: string }
  | { kind: "refuse"; refusal: CodeRefusal };

/**
 * Whether a sign-in with a code may go on to Better Auth, which checks the code. An account always
 * may. A new account (a sign-up) needs an invite that lets its address in, and a name of 1 to 80
 * characters. Without a live code there's nothing to sign up with: Better Auth refuses it exactly as
 * it refuses an account's wrong code, so these checks never tell anyone whether an address has an
 * account.
 */
export function decideCodeSignIn(input: {
  email: string;
  hasAccount: boolean;
  /** An unexpired code waits for this address. */
  liveCode: boolean;
  /** Undefined without the invite header; null when its token matches no invite. */
  invite?: CodeInvite | null;
  name: unknown;
}): CodeSignInDecision {
  if (input.hasAccount || !input.liveCode) return { kind: "continue" };
  if (input.invite === undefined) return { kind: "refuse", refusal: WRONG_CODE };
  const refusal = inviteRefusal(input.invite, input.email);
  if (refusal) return { kind: "refuse", refusal };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80) {
    return {
      kind: "refuse",
      refusal: { status: 400, code: "name_required", message: "Add your name." },
    };
  }
  return { kind: "continue", name };
}

/** Where the plugin keeps the code for an address (better-auth's `toOTPIdentifier`). */
export const codeIdentifier = (email: string) => `sign-in-otp-${email}`;

/** Wrong tries a stored code has taken: the plugin stores `<hash>:<tries>`. */
export function codeAttempts(stored: string): number {
  const at = stored.lastIndexOf(":");
  const tries = at === -1 ? 0 : Number(stored.slice(at + 1));
  return Number.isInteger(tries) && tries > 0 ? tries : 0;
}

/**
 * HMAC-SHA256 under the server's secret, as hex. Codes are stored this way (six digits hashed
 * without a key could be found by trying them all), and so are the addresses in rate-limit keys.
 */
export async function hmacHex(secret: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}
