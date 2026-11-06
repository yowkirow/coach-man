import { describe, expect, it } from "vitest";
import { normalizeCoaches, planCoachChanges } from "../../src/shared/coaches";
import { isAcademySlug, isHttpUrl, slugify } from "../../src/shared/domain";
import { academyUpdateSchema, staffInviteSchema } from "../../src/shared/schemas";
import { clientIp, nextWindow } from "../../src/worker/lib/rate-limit";
import { hasImageSignature, PUBLIC_KEY_RE, publicKey } from "../../src/worker/lib/uploads";

describe("academy addresses", () => {
  it("suggests a public address from the academy's name", () => {
    expect(slugify("The Pickle Spot Academy")).toBe("the-pickle-spot-academy");
    expect(slugify("  Café   Dink & Drive!! ")).toBe("cafe-dink-drive");
    expect(slugify("ws-legacy")).toBe("academy-legacy");
    expect(slugify("A")).toBe("");
    expect(slugify("x".repeat(60))).toHaveLength(40);
    for (const name of ["The Pickle Spot Academy", "Riverside – Juniors", "ws 12"]) {
      const slug = slugify(name);
      expect(slug === "" || isAcademySlug(slug)).toBe(true);
    }
  });

  it("accepts only full http(s) links", () => {
    expect(isHttpUrl("https://facebook.com/picklespot")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("facebook.com/picklespot")).toBe(false);
  });

  it("validates profile edits", () => {
    expect(academyUpdateSchema.safeParse({ slug: "Pickle-Spot" }).data?.slug).toBe("pickle-spot");
    expect(academyUpdateSchema.safeParse({ slug: "ws-0190" }).success).toBe(false);
    expect(academyUpdateSchema.safeParse({ slug: "a--b" }).success).toBe(false);
    expect(academyUpdateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(academyUpdateSchema.safeParse({ contactEmail: "nope" }).success).toBe(false);
    expect(academyUpdateSchema.safeParse({ contactEmail: "" }).data?.contactEmail).toBeNull();
    expect(
      academyUpdateSchema.safeParse({ socials: { instagram: "https://instagram.com/x" } }).success,
    ).toBe(true);
    expect(academyUpdateSchema.safeParse({ socials: { instagram: "@x" } }).success).toBe(false);
    expect(academyUpdateSchema.safeParse({ socials: { myspace: "https://m.com" } }).success).toBe(
      false,
    );
    expect(academyUpdateSchema.safeParse({ mapUrl: "maps" }).success).toBe(false);
  });

  it("invites admins and coaches by a lowercased email", () => {
    expect(staffInviteSchema.parse({ email: " Sam@Example.COM ", role: "coach" })).toEqual({
      email: "sam@example.com",
      role: "coach",
    });
    expect(staffInviteSchema.safeParse({ email: "sam@example.com", role: "owner" }).success).toBe(
      false,
    );
  });
});

describe("assigning a student's coaches", () => {
  const current = [
    { id: "r1", coachUserId: "sam", role: "primary" as const },
    { id: "r2", coachUserId: "kim", role: "assistant" as const },
  ];

  it("keeps what didn't change", () => {
    expect(
      planCoachChanges(current, { primaryCoachUserId: "sam", assistantCoachIds: ["kim"] }),
    ).toEqual({ end: [], start: [], previousPrimary: "sam", primaryChanged: false });
  });

  it("ends the old primary and starts the new one, keeping history", () => {
    expect(
      planCoachChanges(current, { primaryCoachUserId: "alex", assistantCoachIds: ["kim"] }),
    ).toEqual({
      end: ["r1"],
      start: [{ coachUserId: "alex", role: "primary" }],
      previousPrimary: "sam",
      primaryChanged: true,
    });
  });

  it("moves an assistant up to primary", () => {
    expect(planCoachChanges(current, { primaryCoachUserId: "kim", assistantCoachIds: [] })).toEqual(
      {
        end: ["r1", "r2"],
        start: [{ coachUserId: "kim", role: "primary" }],
        previousPrimary: "sam",
        primaryChanged: true,
      },
    );
  });

  it("starts a first coach and clears coaches", () => {
    expect(planCoachChanges([], { primaryCoachUserId: "sam", assistantCoachIds: [] })).toEqual({
      end: [],
      start: [{ coachUserId: "sam", role: "primary" }],
      previousPrimary: null,
      primaryChanged: true,
    });
    expect(planCoachChanges(current, { primaryCoachUserId: null, assistantCoachIds: [] })).toEqual({
      end: ["r1", "r2"],
      start: [],
      previousPrimary: "sam",
      primaryChanged: true,
    });
  });

  it("closes duplicate open rows and never lists the primary as an assistant", () => {
    const messy = [...current, { id: "r3", coachUserId: "sam", role: "primary" as const }];
    expect(
      planCoachChanges(messy, { primaryCoachUserId: "sam", assistantCoachIds: ["sam", "kim"] }),
    ).toEqual({ end: ["r3"], start: [], previousPrimary: "sam", primaryChanged: false });
    expect(
      normalizeCoaches({ primaryCoachUserId: "", assistantCoachIds: ["kim", "kim", ""] }),
    ).toEqual({ primaryCoachUserId: null, assistantCoachIds: ["kim"] });
  });
});

describe("public images", () => {
  const ws = "01a1a989-a20f-70a5-a5d5-0073bf85f373";

  it("serves only keys under ws/<id>/public/", () => {
    for (const key of [
      publicKey.logo(ws, "png"),
      publicKey.cover(ws, "jpg"),
      publicKey.paymentQr(ws, "jpg"),
      publicKey.coachPhoto(ws, "01a1a990-35d2-76ad-a71b-a2be5c7c3de3", "webp"),
      publicKey.coachPortrait(ws, "01a1a990-35d2-76ad-a71b-a2be5c7c3de4", "jpg"),
      publicKey.teamPersonPortrait(ws, "01a1a990-35d2-76ad-a71b-a2be5c7c3de5", "jpg"),
      publicKey.academyPhoto(ws, "jpg"),
      `ws/${ws}/public/photos/01a1a990-35d2-76ad-a71b-a2be5c7c3de6.webp`,
    ]) {
      expect(PUBLIC_KEY_RE.test(key)).toBe(true);
    }
    for (const key of [
      `ws/${ws}/clients/c1/photo.jpg`,
      `ws/${ws}/clients/c1/payments/proof.jpg`,
      `ws/${ws}/public/../clients/c1/photo.jpg`,
      `ws/${ws}/public/coaches/a/b.jpg`,
      `ws/${ws}/public/photos/../x`,
      `ws/${ws}/public/photos/a/b.jpg`,
      `ws/${ws}/public/photos/`,
      `ws/${ws}/public/albums/a.jpg`,
      `ws/${ws}/public/`,
      `public/logo.png`,
    ]) {
      expect(PUBLIC_KEY_RE.test(key)).toBe(false);
    }
    expect(publicKey.cover(ws, "jpg")).toMatch(new RegExp(`^ws/${ws}/public/cover-[\\w-]+\\.jpg$`));
    expect(publicKey.academyPhoto(ws, "png")).toMatch(
      new RegExp(`^ws/${ws}/public/photos/[\\w-]+\\.png$`),
    );
  });

  it("checks that an upload really is the image type it claims", () => {
    const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0);
    const webp = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect(hasImageSignature(png, "image/png")).toBe(true);
    expect(hasImageSignature(jpeg, "image/jpeg")).toBe(true);
    expect(hasImageSignature(webp, "image/webp")).toBe(true);
    expect(hasImageSignature(png, "image/jpeg")).toBe(false);
    expect(hasImageSignature(html, "image/png")).toBe(false);
    expect(hasImageSignature(jpeg, "image/svg+xml")).toBe(false);
  });
});

describe("rate limits", () => {
  const rule = { windowMs: 60_000, max: 3 };

  it("counts hits in a fixed window and refuses past the limit", () => {
    let state = nextWindow(null, 1_000, rule);
    expect(state).toMatchObject({ count: 1, windowStart: 1_000, allowed: true });
    state = nextWindow(state, 2_000, rule);
    state = nextWindow(state, 3_000, rule);
    expect(state).toMatchObject({ count: 3, allowed: true });
    state = nextWindow(state, 4_000, rule);
    expect(state).toMatchObject({ count: 4, allowed: false, retryAfterMs: 57_000 });
  });

  it("starts a fresh window once the last one is over", () => {
    const full = { count: 10, windowStart: 1_000 };
    expect(nextWindow(full, 61_000, rule)).toMatchObject({
      count: 1,
      windowStart: 61_000,
      allowed: true,
    });
    expect(nextWindow(full, 60_999, rule).allowed).toBe(false);
  });

  it("keys on the address Cloudflare reports", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe(
      "198.51.100.1",
    );
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
