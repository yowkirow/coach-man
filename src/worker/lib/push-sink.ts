/**
 * The test sink for push notifications. E2E tests can't receive real pushes, so outside production
 * with the E2E bypass on, a subscription whose endpoint starts with `https://push-sink.invalid/`
 * is never sent over the network: the payload is recorded in the `push_sink` table instead (read
 * and cleared through the bypass-gated /api/test/push-sink). Production never records anything
 * there and refuses such endpoints, whatever its other settings say.
 */

import { type BypassEnv, isBypassEnabled } from "./bypass";

export const PUSH_SINK_PREFIX = "https://push-sink.invalid/";

export const isSinkEndpoint = (endpoint: string) => endpoint.startsWith(PUSH_SINK_PREFIX);

/** The sink is on only outside production and only with the E2E bypass enabled (both checked). */
export function isPushSinkEnabled(env: BypassEnv): boolean {
  if (env.APP_ENV === "production") return false;
  return isBypassEnabled(env);
}

/**
 * Where a push to this endpoint goes: the push service (`network`), the test sink (`sink`), or
 * nowhere (`refuse`: a sink endpoint while the sink is off, e.g. in production).
 */
export function pushRoute(env: BypassEnv, endpoint: string): "network" | "sink" | "refuse" {
  if (!isSinkEndpoint(endpoint)) return "network";
  return isPushSinkEnabled(env) ? "sink" : "refuse";
}
