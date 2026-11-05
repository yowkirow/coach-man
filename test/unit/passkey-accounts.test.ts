import { describe, expect, it } from "vitest";
import { isPlaceholderEmail, placeholderEmail } from "../../src/shared/domain";
import {
  ABANDONED_ACCOUNT_MS,
  checkGoogleLink,
  idTokenClaims,
  isAbandonedPasskeyAccount,
} from "../../src/worker/lib/passkey-accounts";

const now = Date.UTC(2026, 10, 5, 12);
const placeholder = placeholderEmail("5f2b8c1e-1111-4000-8000-000000000000");

/** A JWT with this payload (the signature isn't read: Better Auth verified the token). */
function idToken(payload: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${enc({ alg: "RS256", typ: "JWT" })}.${enc(payload)}.signature`;
}

describe("passkey-only accounts", () => {
  it("get an address that can never be delivered or matched", () => {
    expect(placeholder).toBe("u-5f2b8c1e-1111-4000-8000-000000000000@passkey.coachman.invalid");
    expect(isPlaceholderEmail(placeholder)).toBe(true);
    expect(isPlaceholderEmail(placeholder.toUpperCase())).toBe(true);
    expect(isPlaceholderEmail("pat@gmail.com")).toBe(false);
    expect(isPlaceholderEmail("pat@passkey.coachman.invalid.example.com")).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
  });

  describe("the daily cleanup", () => {
    const abandoned = {
      email: placeholder,
      createdAt: now - ABANDONED_ACCOUNT_MS - 1,
      passkeys: 0,
      familyLinks: 0,
      memberships: 0,
    };

    it("removes a day-old placeholder account with nothing on it", () => {
      expect(isAbandonedPasskeyAccount(abandoned, now)).toBe(true);
      expect(
        isAbandonedPasskeyAccount({ ...abandoned, createdAt: now - ABANDONED_ACCOUNT_MS }, now),
      ).toBe(true);
    });

    it("leaves accounts younger than a day (someone may be adding their passkey)", () => {
      expect(
        isAbandonedPasskeyAccount({ ...abandoned, createdAt: now - ABANDONED_ACCOUNT_MS + 1 }, now),
      ).toBe(false);
      expect(isAbandonedPasskeyAccount({ ...abandoned, createdAt: now - 60_000 }, now)).toBe(false);
    });

    it("keeps any account with a passkey, a family link (even a revoked one), or an academy", () => {
      expect(isAbandonedPasskeyAccount({ ...abandoned, passkeys: 1 }, now)).toBe(false);
      expect(isAbandonedPasskeyAccount({ ...abandoned, familyLinks: 1 }, now)).toBe(false);
      expect(isAbandonedPasskeyAccount({ ...abandoned, memberships: 1 }, now)).toBe(false);
    });

    it("never touches Google accounts, however empty", () => {
      expect(isAbandonedPasskeyAccount({ ...abandoned, email: "pat@gmail.com" }, now)).toBe(false);
    });
  });
});

describe("linking Google later", () => {
  const link = {
    currentEmail: placeholder,
    googleEmail: "Pat.Santos@gmail.com",
    googleEmailVerified: true,
    takenByOther: false,
  };

  it("lets a passkey-only account link its own verified Google account", () => {
    expect(checkGoogleLink(link)).toEqual({ ok: true });
  });

  it("refuses a Google address another CoachMan account already uses", () => {
    expect(checkGoogleLink({ ...link, takenByOther: true })).toMatchObject({
      ok: false,
      error: "google_email_taken",
    });
    const res = checkGoogleLink({ ...link, takenByOther: true });
    if (!res.ok) expect(res.errorDescription).toMatch(/another CoachMan account/);
  });

  it("refuses an unverified Google address, or none at all", () => {
    expect(checkGoogleLink({ ...link, googleEmailVerified: false })).toMatchObject({
      error: "google_email_unverified",
    });
    expect(checkGoogleLink({ ...link, googleEmail: null })).toMatchObject({
      error: "google_email_missing",
    });
  });

  it("refuses a different address for accounts that aren't passkey-only", () => {
    expect(checkGoogleLink({ ...link, currentEmail: "pat@gmail.com" })).toMatchObject({
      ok: false,
      error: "google_link_not_allowed",
    });
  });

  it("allows the same address (a Google account linking to its own CoachMan account)", () => {
    expect(
      checkGoogleLink({
        ...link,
        currentEmail: "pat.santos@gmail.com",
        googleEmail: "PAT.SANTOS@gmail.com",
        googleEmailVerified: false,
      }),
    ).toEqual({ ok: true });
  });

  it("reads Google's verified address and name from the ID token", () => {
    expect(
      idTokenClaims(
        idToken({
          email: "Pat.Santos@Gmail.com",
          email_verified: true,
          name: "Pat Santos ",
          picture: "https://lh3.example/p.jpg",
        }),
      ),
    ).toEqual({
      email: "pat.santos@gmail.com",
      emailVerified: true,
      name: "Pat Santos",
      picture: "https://lh3.example/p.jpg",
    });
    expect(idTokenClaims(idToken({ email: "a@b.co", email_verified: "true" }))).toMatchObject({
      emailVerified: true,
      name: null,
    });
    expect(idTokenClaims(idToken({ email: "a@b.co" }))?.emailVerified).toBe(false);
    // Non-ASCII names survive the base64url round trip.
    expect(idTokenClaims(idToken({ email: "a@b.co", name: "José Niño" }))?.name).toBe("José Niño");
  });

  it("treats malformed tokens as missing", () => {
    expect(idTokenClaims(null)).toBeNull();
    expect(idTokenClaims("not-a-jwt")).toBeNull();
    expect(idTokenClaims("a.%%%.c")).toBeNull();
  });
});
