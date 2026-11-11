import { passkeyClient } from "@better-auth/passkey/client";
import { INVITE_HEADER } from "@shared/domain";
import { createAuthClient } from "better-auth/react";

// Academies (Better Auth organizations) are managed through /api/account and /api/v1, never the
// organization plugin's own endpoints, so its client plugin isn't loaded here.
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [passkeyClient()],
});

export async function signInWithGoogle(next = "/", errorNext = "/sign-in") {
  await authClient.signIn.social({
    provider: "google",
    callbackURL: next,
    errorCallbackURL: errorNext,
  });
}

/** A refusal from one of Better Auth's endpoints (`{ code, message }`). */
export class AuthRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function authPost<T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/auth${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthRequestError(0, "offline", "You're offline. Reconnect and try again.");
  }
  const text = await res.text();
  let json: { code?: string; message?: string } & Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new AuthRequestError(
      res.status,
      json.code ?? "error",
      json.message ?? "Something went wrong. Try again.",
    );
  }
  return json as T;
}

/**
 * Starts a passkey-only account from a family invite: the account (no email, just a name) is
 * created and signed in; the passkey is added next. Only works with an invite link that's valid.
 */
export function startPasskeyAccount(name: string, inviteToken: string) {
  return authPost<{ userId: string }>("/passkey-account/start", { name, inviteToken });
}

/**
 * The same from an academy's enrollment page: only while that academy's page is listed and it
 * takes new students.
 */
export function startEnrollPasskeyAccount(name: string, slug: string) {
  return authPost<{ userId: string }>("/passkey-account/start", { name, enrollment: { slug } });
}

/** After a cancelled or failed passkey: deletes the empty account and signs out. */
export function abandonPasskeyAccount() {
  return authPost<{ deleted: boolean }>("/passkey-account/abandon", {}).catch(() => ({
    deleted: false,
  }));
}

/** Better Auth's refusals of a code, in CoachMan's words. */
const CODE_ERRORS: Record<string, string> = {
  INVALID_OTP: "That code isn't right. Check the newest email from CoachMan.",
  OTP_EXPIRED: "That code has expired. Send a new one.",
  TOO_MANY_ATTEMPTS: "That code was tried too many times. Send a new one.",
  INVALID_EMAIL: "Enter one email address, like name@example.com.",
};

/** Refusals of our own (auth.ts), already in CoachMan's words. */
const OWN_REFUSAL = /^(invalid_email|wrong_email|name_required|rate_limited|invite_[a-z]+)$/;

function codeError(err: unknown): AuthRequestError {
  if (!(err instanceof AuthRequestError)) {
    return new AuthRequestError(0, "error", "Something went wrong. Try again.");
  }
  // Offline already says so.
  if (err.status === 0) return err;
  const mapped = CODE_ERRORS[err.code];
  if (mapped) return new AuthRequestError(err.status, err.code, mapped);
  if (OWN_REFUSAL.test(err.code)) return err;
  // Better Auth's own limit, which answers in its words.
  if (err.status === 429) {
    return new AuthRequestError(
      429,
      "rate_limited",
      "Too many tries. Wait a minute, then try again.",
    );
  }
  return new AuthRequestError(err.status, err.code, "Something went wrong. Try again.");
}

const inviteHeaders = (inviteToken: string | undefined): Record<string, string> =>
  inviteToken ? { [INVITE_HEADER]: inviteToken } : {};

/**
 * Asks for a 6-digit sign-in code by email. Without an invite the answer is the same whether or not
 * the address has an account (only an account's address gets one); with an invite link's token (the
 * join page), the invite decides, and a refusal says why.
 */
export async function sendSignInCode(email: string, inviteToken?: string): Promise<void> {
  try {
    await authPost(
      "/email-otp/send-verification-otp",
      { email, type: "sign-in" },
      inviteHeaders(inviteToken),
    );
  } catch (err) {
    throw codeError(err);
  }
}

/**
 * Signs in with an emailed code. A new account (only with an invite that lets its address in) takes
 * `name`; an existing one keeps its own.
 */
export async function signInWithCode(
  email: string,
  code: string,
  options: { name?: string; inviteToken?: string } = {},
): Promise<void> {
  try {
    await authPost(
      "/sign-in/email-otp",
      { email, otp: code, ...(options.name ? { name: options.name } : {}) },
      inviteHeaders(options.inviteToken),
    );
  } catch (err) {
    throw codeError(err);
  }
  await refreshSession();
}

/**
 * Links a Google account to a passkey-only account (portal settings). Google's sign-in page opens;
 * coming back, `next` gets `?google=linked`, or `?error=<code>` when the link was refused.
 */
export async function linkGoogle(next: string) {
  const res = await authClient.linkSocial({
    provider: "google",
    callbackURL: `${next}?google=linked`,
    errorCallbackURL: next,
  });
  if (res?.error) {
    throw new AuthRequestError(
      res.error.status ?? 400,
      res.error.code ?? "error",
      res.error.message ?? "Couldn't start linking Google. Try again.",
    );
  }
}

/** Refreshes the session's cached copy of the account (after its name or email changed). */
export async function refreshSession() {
  await authClient.getSession({ query: { disableCookieCache: true } }).catch(() => undefined);
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

export async function conditionalMediationAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const pkc = window.PublicKeyCredential as unknown as {
    isConditionalMediationAvailable?: () => Promise<boolean>;
  };
  try {
    return (await pkc.isConditionalMediationAvailable?.()) ?? false;
  } catch {
    return false;
  }
}

export function defaultPasskeyName(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android phone"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows PC"
            : "This device";
  return `${device} · ${new Date().toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}
