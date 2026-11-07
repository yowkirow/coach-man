/**
 * Invite tokens. A token is 32 random bytes, base64url-encoded (43 characters), shared once as
 * `${APP_URL}/join/<token>`. Only its SHA-256 (hex) is stored, so a database leak can't be
 * turned back into working links.
 */

import type { InviteStatus } from "../../shared/domain";

export const TOKEN_BYTES = 32;
/** Invite links work for seven days. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 32 bytes of base64url without padding. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 of the token as lowercase hex: what `invite.token_hash` holds. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh token to hand out, and the hash to store. */
export async function newToken(): Promise<{ token: string; hash: string }> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
  return { token, hash: await hashToken(token) };
}

export const isTokenShaped = (value: string) => TOKEN_RE.test(value);

export type { InviteStatus };

/** Where an invite stands at `now`. Revoked and used win over expired. */
export function inviteStatus(
  invite: { expiresAt: number; acceptedAt: number | null; revokedAt: number | null },
  now: number = Date.now(),
): InviteStatus {
  if (invite.revokedAt !== null) return "revoked";
  if (invite.acceptedAt !== null) return "used";
  return now >= invite.expiresAt ? "expired" : "valid";
}
