/**
 * The test sink for email. E2E tests can't read real inboxes, so outside production with the E2E
 * bypass on, every email is recorded in the `email_sink` table instead of sent (read and cleared
 * through the bypass-gated /api/test/email-sink). Production never records anything there,
 * whatever its other settings say.
 */

import { type BypassEnv, isBypassEnabled } from "./bypass";

/** The sink is on only outside production and only with the E2E bypass enabled (both checked). */
export function isEmailSinkEnabled(env: BypassEnv): boolean {
  if (env.APP_ENV === "production") return false;
  return isBypassEnabled(env);
}
