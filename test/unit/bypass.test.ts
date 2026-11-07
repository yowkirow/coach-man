import { describe, expect, it } from "vitest";
import { isBypassEnabled, isBypassRequestAllowed, safeEqual } from "../../src/worker/lib/bypass";

const SECRET = "a-long-enough-secret-value";

describe("E2E auth bypass gate", () => {
  it("is off in production no matter what", () => {
    expect(
      isBypassEnabled({ APP_ENV: "production", E2E_AUTH_BYPASS: "1", E2E_BYPASS_SECRET: SECRET }),
    ).toBe(false);
    expect(
      isBypassRequestAllowed(
        { APP_ENV: "production", E2E_AUTH_BYPASS: "1", E2E_BYPASS_SECRET: SECRET },
        SECRET,
      ),
    ).toBe(false);
  });

  it("needs the flag and a secret of at least 16 characters", () => {
    expect(isBypassEnabled({ APP_ENV: "staging", E2E_BYPASS_SECRET: SECRET })).toBe(false);
    expect(
      isBypassEnabled({ APP_ENV: "staging", E2E_AUTH_BYPASS: "true", E2E_BYPASS_SECRET: SECRET }),
    ).toBe(false);
    expect(
      isBypassEnabled({ APP_ENV: "staging", E2E_AUTH_BYPASS: "1", E2E_BYPASS_SECRET: "short" }),
    ).toBe(false);
    expect(
      isBypassEnabled({ APP_ENV: "staging", E2E_AUTH_BYPASS: "1", E2E_BYPASS_SECRET: SECRET }),
    ).toBe(true);
  });

  it("requires the matching header on each request", () => {
    const env = { APP_ENV: "development", E2E_AUTH_BYPASS: "1", E2E_BYPASS_SECRET: SECRET };
    expect(isBypassRequestAllowed(env, SECRET)).toBe(true);
    expect(isBypassRequestAllowed(env, `${SECRET}x`)).toBe(false);
    expect(isBypassRequestAllowed(env, "")).toBe(false);
    expect(isBypassRequestAllowed(env, null)).toBe(false);
    expect(isBypassRequestAllowed(env, undefined)).toBe(false);
  });

  it("compares secrets exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
