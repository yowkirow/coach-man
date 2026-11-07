import { describe, expect, it } from "vitest";
import {
  base64url,
  hashToken,
  INVITE_TTL_MS,
  inviteStatus,
  isTokenShaped,
  newToken,
  TOKEN_RE,
} from "../../src/worker/lib/tokens";

describe("invite tokens", () => {
  it("hashes with SHA-256 as lowercase hex", async () => {
    expect(await hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await hashToken("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("makes a 32-byte base64url token and stores only its hash", async () => {
    const { token, hash } = await newToken();
    expect(token).toMatch(TOKEN_RE);
    expect(token).toHaveLength(43);
    expect(isTokenShaped(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await hashToken(token));
    expect(hash).not.toContain(token);
  });

  it("never repeats a token", async () => {
    const tokens = await Promise.all(Array.from({ length: 200 }, () => newToken()));
    expect(new Set(tokens.map((t) => t.token)).size).toBe(200);
    expect(new Set(tokens.map((t) => t.hash)).size).toBe(200);
  });

  it("encodes base64url without padding or URL-unsafe characters", () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe("-_-_");
    expect(base64url(new Uint8Array([0x66]))).toBe("Zg");
    expect(base64url(new Uint8Array(32).fill(255))).toMatch(TOKEN_RE);
    expect(isTokenShaped("not a token")).toBe(false);
    expect(isTokenShaped(`${"a".repeat(43)}=`)).toBe(false);
  });

  it("reports whether an invite is valid, expired, used, or revoked", () => {
    const now = 1_800_000_000_000;
    const fresh = { expiresAt: now + INVITE_TTL_MS, acceptedAt: null, revokedAt: null };
    expect(INVITE_TTL_MS).toBe(7 * 86_400_000);
    expect(inviteStatus(fresh, now)).toBe("valid");
    expect(inviteStatus(fresh, now + INVITE_TTL_MS - 1)).toBe("valid");
    expect(inviteStatus(fresh, now + INVITE_TTL_MS)).toBe("expired");
    expect(inviteStatus({ ...fresh, acceptedAt: now }, now)).toBe("used");
    expect(inviteStatus({ ...fresh, revokedAt: now }, now)).toBe("revoked");
    expect(inviteStatus({ ...fresh, acceptedAt: now, revokedAt: now }, now)).toBe("revoked");
    expect(inviteStatus({ ...fresh, acceptedAt: now }, now + INVITE_TTL_MS * 2)).toBe("used");
  });
});
