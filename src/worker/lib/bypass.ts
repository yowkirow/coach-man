/**
 * Test-only sign-in for Playwright (Google OAuth cannot be automated).
 *
 * Enabled only when ALL of these hold:
 *   - APP_ENV is not "production" (hard gate: production never registers the plugin), and
 *   - E2E_AUTH_BYPASS === "1", and
 *   - E2E_BYPASS_SECRET is set (>= 16 chars) and the request header `x-e2e-bypass` matches it.
 */

export interface BypassEnv {
  APP_ENV?: string;
  E2E_AUTH_BYPASS?: string;
  E2E_BYPASS_SECRET?: string;
}

export function isBypassEnabled(env: BypassEnv): boolean {
  if (env.APP_ENV === "production") return false;
  if (env.E2E_AUTH_BYPASS !== "1") return false;
  return typeof env.E2E_BYPASS_SECRET === "string" && env.E2E_BYPASS_SECRET.length >= 16;
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function isBypassRequestAllowed(
  env: BypassEnv,
  headerValue: string | null | undefined,
): boolean {
  if (!isBypassEnabled(env) || !headerValue) return false;
  return safeEqual(headerValue, env.E2E_BYPASS_SECRET as string);
}

export const E2E_HEADER = "x-e2e-bypass";
