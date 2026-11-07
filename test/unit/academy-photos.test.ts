import { describe, expect, it } from "vitest";
import {
  isPhotoOrder,
  MAX_ACADEMY_PHOTOS,
  movePhoto,
  normalizeCaption,
  PHOTO_LIMIT_MESSAGE,
} from "../../src/shared/academy-photos";
import { academyPhotoOrderSchema, academyPhotoUpdateSchema } from "../../src/shared/schemas";

const A = "01a1a990-35d2-76ad-a71b-a2be5c7c3de1";
const B = "01a1a990-35d2-76ad-a71b-a2be5c7c3de2";
const C = "01a1a990-35d2-76ad-a71b-a2be5c7c3de3";

describe("website photo captions", () => {
  it("are trimmed, and empty means none", () => {
    expect(normalizeCaption("  Court 3 at dusk  ")).toBe("Court 3 at dusk");
    expect(normalizeCaption("   ")).toBeNull();
    expect(normalizeCaption("")).toBeNull();
    expect(normalizeCaption(null)).toBeNull();
    expect(normalizeCaption(undefined)).toBeNull();
  });

  it("are checked by the API: 140 characters at most, after trimming", () => {
    const parse = (caption: unknown) => academyPhotoUpdateSchema.safeParse({ caption });
    expect(parse("  Summer camp, week one ").data).toEqual({ caption: "Summer camp, week one" });
    expect(parse("  ").data).toEqual({ caption: null });
    expect(parse(null).data).toEqual({ caption: null });
    expect(parse(`  ${"x".repeat(140)}  `).data).toEqual({ caption: "x".repeat(140) });
    expect(parse("x".repeat(141)).success).toBe(false);
    expect(parse(42).success).toBe(false);
    expect(academyPhotoUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("a website photo's framing", () => {
  it("can be sent on its own, or with a caption, and null clears it", () => {
    const parse = (body: unknown) => academyPhotoUpdateSchema.safeParse(body);
    expect(parse({ framing: { x: 30, y: 70.456, zoom: 1.5 } }).data).toEqual({
      framing: { x: 30, y: 70.46, zoom: 1.5 },
    });
    expect(parse({ framing: null }).data).toEqual({ framing: null });
    expect(parse({ caption: "Court 3", framing: { x: 50, y: 50, zoom: 1 } }).data).toEqual({
      caption: "Court 3",
      framing: { x: 50, y: 50, zoom: 1 },
    });
  });

  it("is checked by the API: 0–100 across and down, zoom 1–3", () => {
    const parse = (framing: unknown) => academyPhotoUpdateSchema.safeParse({ framing });
    expect(parse({ x: 0, y: 100, zoom: 3 }).success).toBe(true);
    expect(parse({ x: 101, y: 50, zoom: 1 }).success).toBe(false);
    expect(parse({ x: 50, y: -1, zoom: 1 }).success).toBe(false);
    expect(parse({ x: 50, y: 50, zoom: 3.5 }).success).toBe(false);
    expect(parse({ x: 50, y: 50, zoom: 0.5 }).success).toBe(false);
    expect(parse({ x: 50, y: 50 }).success).toBe(false);
    expect(parse("center").success).toBe(false);
  });
});

describe("the website photos' order", () => {
  it("must name every photo once, and nothing else", () => {
    expect(isPhotoOrder([A, B, C], [C, A, B])).toBe(true);
    expect(isPhotoOrder([], [])).toBe(true);
    // One left out (a stale order would hide it), one repeated, one unknown, one too many.
    expect(isPhotoOrder([A, B, C], [C, A])).toBe(false);
    expect(isPhotoOrder([A, B, C], [C, A, A])).toBe(false);
    expect(isPhotoOrder([A, B, C], [C, A, "01a1a990-35d2-76ad-a71b-a2be5c7c3de9"])).toBe(false);
    expect(isPhotoOrder([A, B], [A, B, C])).toBe(false);
  });

  it("takes uuids, up to the limit", () => {
    expect(academyPhotoOrderSchema.safeParse({ ids: [A, B] }).success).toBe(true);
    expect(academyPhotoOrderSchema.safeParse({ ids: ["photo-1"] }).success).toBe(false);
    const many = Array.from(
      { length: MAX_ACADEMY_PHOTOS + 1 },
      (_, i) => `01a1a990-35d2-76ad-a71b-${String(i).padStart(12, "0")}`,
    );
    expect(academyPhotoOrderSchema.safeParse({ ids: many }).success).toBe(false);
    expect(academyPhotoOrderSchema.safeParse({ ids: many.slice(1) }).success).toBe(true);
  });

  it("moves a photo one place earlier or later, and never past an end", () => {
    expect(movePhoto([A, B, C], 2, -1)).toEqual([A, C, B]);
    expect(movePhoto([A, B, C], 0, 1)).toEqual([B, A, C]);
    expect(movePhoto([A, B, C], 0, -1)).toEqual([A, B, C]);
    expect(movePhoto([A, B, C], 2, 1)).toEqual([A, B, C]);
    const list = [A, B];
    movePhoto(list, 0, 1);
    expect(list).toEqual([A, B]);
  });

  it("stops at 24 photos, and says so", () => {
    expect(MAX_ACADEMY_PHOTOS).toBe(24);
    expect(PHOTO_LIMIT_MESSAGE).toBe("You can show up to 24 photos. Remove one to add another.");
  });
});
