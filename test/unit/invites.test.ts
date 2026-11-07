import { describe, expect, it } from "vitest";
import { checkStaffAcceptance, maskEmail, normalizeEmail } from "../../src/worker/lib/invites";

const coach = { email: "Sam.Rivera@Example.com", emailVerified: true };
const valid = {
  status: "valid" as const,
  inviteEmail: "sam.rivera@example.com",
  user: coach,
};

describe("accepting a staff invite", () => {
  it("accepts the invited Google address, whatever its letter case", () => {
    expect(checkStaffAcceptance(valid)).toEqual({ ok: true });
    expect(
      checkStaffAcceptance({ ...valid, user: { ...coach, email: " SAM.RIVERA@example.COM " } }),
    ).toEqual({ ok: true });
  });

  it("refuses a different address with a 403 and says which account to use", () => {
    const res = checkStaffAcceptance({
      ...valid,
      user: { ...coach, email: "sam.rivera@gmail.com" },
    });
    expect(res).toMatchObject({ ok: false, status: 403, code: "wrong_email" });
    if (!res.ok) expect(res.message).toMatch(/Google account it was sent to/);
  });

  it("refuses an invite without an address (a staff invite always has one)", () => {
    expect(checkStaffAcceptance({ ...valid, inviteEmail: null })).toMatchObject({
      ok: false,
      code: "wrong_email",
    });
  });

  it("needs the address to be verified", () => {
    expect(
      checkStaffAcceptance({ ...valid, user: { ...coach, emailVerified: false } }),
    ).toMatchObject({ ok: false, status: 403, code: "unverified_email" });
  });

  it("refuses expired, used, and withdrawn invites with 410s, before checking the address", () => {
    const stranger = { ...coach, email: "someone@else.com" };
    for (const [status, code] of [
      ["expired", "invite_expired"],
      ["used", "invite_used"],
      ["revoked", "invite_revoked"],
    ] as const) {
      expect(checkStaffAcceptance({ ...valid, status })).toMatchObject({
        ok: false,
        status: 410,
        code,
      });
      expect(checkStaffAcceptance({ ...valid, status, user: stranger })).toMatchObject({
        ok: false,
        code,
      });
    }
  });

  it("never lets a used link work again, even for the person who used it", () => {
    // Revoked wins over used upstream (inviteStatus); either way it's a refusal.
    expect(checkStaffAcceptance({ ...valid, status: "used" })).toMatchObject({
      ok: false,
      status: 410,
      code: "invite_used",
    });
    expect(checkStaffAcceptance({ ...valid, status: "revoked" })).toMatchObject({
      ok: false,
      code: "invite_revoked",
    });
  });

  it("masks addresses down to a hint", () => {
    expect(maskEmail("Jordan@Gmail.com")).toBe("j•••@gmail.com");
    expect(maskEmail("not-an-email")).toBe("•••");
    expect(normalizeEmail("  A@B.co ")).toBe("a@b.co");
  });
});
