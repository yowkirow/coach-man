import { passkeyClient } from "@better-auth/passkey/client";
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

async function authPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/auth${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
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
