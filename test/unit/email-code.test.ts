import { describe, expect, it } from "vitest";
import {
  type CodeInvite,
  codeAttempts,
  codeIdentifier,
  decideCodeRequest,
  decideCodeSignIn,
  hmacHex,
  inviteRefusal,
  isBlockedCodePath,
  WRONG_CODE,
} from "../../src/worker/lib/email-code";

const SAM = "sam.rivera@outlook.com";
const staff: CodeInvite = { kind: "staff", status: "valid", email: SAM };
const family: CodeInvite = { kind: "family", status: "valid", email: null };

describe("who gets a sign-in code", () => {
  it("an account's address, without an invite", () => {
    expect(decideCodeRequest({ email: SAM, hasAccount: true })).toEqual({ kind: "send" });
  });

  it("anyone else without an invite is answered as if one went, and nothing is sent", () => {
    expect(decideCodeRequest({ email: "nobody@outlook.com", hasAccount: false })).toEqual({
      kind: "silent",
    });
  });

  it("a staff invite's own address, whatever its letter case, account or not", () => {
    for (const hasAccount of [true, false]) {
      expect(decideCodeRequest({ email: SAM, hasAccount, invite: staff })).toEqual({
        kind: "send",
      });
    }
    expect(
      decideCodeRequest({
        email: SAM,
        hasAccount: false,
        invite: { ...staff, email: "Sam.Rivera@Outlook.com" },
      }),
    ).toEqual({ kind: "send" });
  });

  it("refuses another address for a staff invite, naming the right one masked", () => {
    for (const hasAccount of [true, false]) {
      expect(decideCodeRequest({ email: "sam@gmail.com", hasAccount, invite: staff })).toEqual({
        kind: "refuse",
        refusal: {
          status: 403,
          code: "wrong_email",
          message: "This invite was sent to another address (s•••@outlook.com). Use that one.",
        },
      });
    }
  });

  it("any address for a family invite (its link holder is who it was made for)", () => {
    for (const email of [SAM, "pat.santos@yahoo.com"]) {
      expect(decideCodeRequest({ email, hasAccount: false, invite: family })).toEqual({
        kind: "send",
      });
    }
  });

  it("refuses an invite that doesn't work: unknown (404), or used, withdrawn, or expired (410)", () => {
    expect(decideCodeRequest({ email: SAM, hasAccount: true, invite: null })).toEqual({
      kind: "refuse",
      refusal: {
        status: 404,
        code: "invite_not_found",
        message: "This invite link doesn't work. Ask the academy for a new one.",
      },
    });
    for (const status of ["used", "revoked", "expired"] as const) {
      for (const invite of [staff, family]) {
        expect(
          decideCodeRequest({ email: SAM, hasAccount: true, invite: { ...invite, status } }),
        ).toEqual({
          kind: "refuse",
          refusal: {
            status: 410,
            code: `invite_${status}`,
            message: "This invite link no longer works. Ask the academy for a new one.",
          },
        });
      }
    }
  });

  it("a staff invite without an address lets nobody in", () => {
    expect(inviteRefusal({ ...staff, email: null }, SAM)).toMatchObject({
      status: 403,
      code: "wrong_email",
    });
  });
});

describe("who a code signs in", () => {
  const signUp = { email: SAM, hasAccount: false, liveCode: true, name: "  Sam Rivera  " };

  it("an account always goes on to Better Auth, which checks the code; its name stays its own", () => {
    for (const liveCode of [true, false]) {
      expect(
        decideCodeSignIn({ email: SAM, hasAccount: true, liveCode, name: "Someone Else" }),
      ).toEqual({ kind: "continue" });
    }
  });

  it("with no live code, Better Auth refuses it as it refuses any wrong code", () => {
    expect(decideCodeSignIn({ ...signUp, liveCode: false })).toEqual({ kind: "continue" });
    expect(decideCodeSignIn({ ...signUp, liveCode: false, invite: null })).toEqual({
      kind: "continue",
    });
  });

  it("a sign-up needs the invite: without one it gets Better Auth's own wrong-code answer", () => {
    expect(decideCodeSignIn(signUp)).toEqual({ kind: "refuse", refusal: WRONG_CODE });
    expect(WRONG_CODE).toEqual({ status: 400, code: "INVALID_OTP", message: "Invalid OTP" });
  });

  it("a sign-up with an invite that lets it in keeps the trimmed name", () => {
    expect(decideCodeSignIn({ ...signUp, invite: staff })).toEqual({
      kind: "continue",
      name: "Sam Rivera",
    });
    expect(
      decideCodeSignIn({ ...signUp, email: "pat@yahoo.com", invite: family, name: "Pat" }),
    ).toEqual({ kind: "continue", name: "Pat" });
  });

  it("refuses a sign-up for another address, or with an invite that doesn't work", () => {
    expect(decideCodeSignIn({ ...signUp, email: "sam@gmail.com", invite: staff })).toMatchObject({
      kind: "refuse",
      refusal: { status: 403, code: "wrong_email" },
    });
    expect(decideCodeSignIn({ ...signUp, invite: null })).toMatchObject({
      kind: "refuse",
      refusal: { status: 404, code: "invite_not_found" },
    });
    expect(decideCodeSignIn({ ...signUp, invite: { ...family, status: "used" } })).toMatchObject({
      kind: "refuse",
      refusal: { status: 410, code: "invite_used" },
    });
  });

  it("asks a sign-up for a name of 1 to 80 characters", () => {
    for (const name of [undefined, "", "   ", 42, "x".repeat(81)]) {
      expect(decideCodeSignIn({ ...signUp, invite: family, name })).toEqual({
        kind: "refuse",
        refusal: { status: 400, code: "name_required", message: "Add your name." },
      });
    }
    expect(decideCodeSignIn({ ...signUp, invite: family, name: "x".repeat(80) })).toMatchObject({
      kind: "continue",
    });
  });
});

describe("the plugin's endpoints and stored codes", () => {
  it("shuts every endpoint but sending a sign-in code and signing in with one", () => {
    for (const path of [
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/reset-password",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
      "/email-otp/anything-new",
    ]) {
      expect(isBlockedCodePath(path), path).toBe(true);
    }
    for (const path of [
      "/email-otp/send-verification-otp",
      "/sign-in/email-otp",
      "/sign-in/social",
    ]) {
      expect(isBlockedCodePath(path), path).toBe(false);
    }
  });

  it("reads a stored code's wrong tries, and where it's kept", () => {
    expect(codeAttempts("9f86d081884c7d65:0")).toBe(0);
    expect(codeAttempts("9f86d081884c7d65:2")).toBe(2);
    expect(codeAttempts("9f86d081884c7d65:3")).toBe(3);
    expect(codeAttempts("123456")).toBe(0);
    expect(codeAttempts("abc:x")).toBe(0);
    expect(codeIdentifier(SAM)).toBe(`sign-in-otp-${SAM}`);
  });

  it("hashes codes under the server's secret (six digits alone could be tried)", async () => {
    const a = await hmacHex("secret-one", "042917");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacHex("secret-one", "042917")).toBe(a);
    expect(await hmacHex("secret-two", "042917")).not.toBe(a);
    expect(await hmacHex("secret-one", "042918")).not.toBe(a);
    // RFC 4231, test case 2.
    expect(await hmacHex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });
});
