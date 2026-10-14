import { passkeyClient } from "@better-auth/passkey/client";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [passkeyClient(), organizationClient()],
});

export async function signInWithGoogle(next = "/") {
  await authClient.signIn.social({
    provider: "google",
    callbackURL: next,
    errorCallbackURL: "/sign-in",
  });
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
