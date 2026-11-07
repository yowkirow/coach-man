import {
  clampFraming,
  dragFraming,
  framingOr,
  framingSlack,
  framingStyle,
  PORTRAIT_FRAMING,
  SCENE_FRAMING,
  sameFraming,
  zoomFraming,
} from "@shared/framing";
import { academyPhotoUpdateSchema, photoFramingSchema } from "@shared/schemas";
import { describe, expect, it } from "vitest";

describe("photo framing", () => {
  it("keeps a framing in range, at two decimals", () => {
    expect(clampFraming({ x: -4, y: 104.567, zoom: 0.5 })).toEqual({ x: 0, y: 100, zoom: 1 });
    expect(clampFraming({ x: 33.3333, y: 50, zoom: 9 })).toEqual({ x: 33.33, y: 50, zoom: 3 });
    expect(clampFraming({ x: Number.NaN, y: Number.POSITIVE_INFINITY, zoom: Number.NaN })).toEqual({
      x: 50,
      y: 50,
      zoom: 1,
    });
    expect(sameFraming({ x: 10.001, y: 20, zoom: 1 }, { x: 10, y: 20, zoom: 1 })).toBe(true);
  });

  it("lines the photo up by a point and zooms about that same point", () => {
    expect(framingStyle(SCENE_FRAMING)).toEqual({ objectPosition: "50% 50%" });
    expect(framingStyle({ x: 30, y: 12.5, zoom: 1.6 })).toEqual({
      objectPosition: "30% 12.5%",
      transform: "scale(1.6)",
      transformOrigin: "30% 12.5%",
    });
  });

  it("knows how far a photo can travel in its frame", () => {
    // A 3:2 photo in a square frame: it covers 300 × 200 → 300 wide, so 100 to spare across.
    const frame = { width: 200, height: 200 };
    const wide = { width: 1500, height: 1000 };
    expect(framingSlack(frame, wide, 1)).toEqual({ width: 100, height: 0 });
    // Zoomed 2×, it covers 600 × 400: 400 across and 200 down.
    expect(framingSlack(frame, wide, 2)).toEqual({ width: 400, height: 200 });
    expect(framingSlack({ width: 0, height: 0 }, wide, 1)).toEqual({ width: 0, height: 0 });
  });

  it("follows the pointer when the photo is dragged", () => {
    const frame = { width: 200, height: 200 };
    const wide = { width: 1500, height: 1000 };
    // Dragging right shows more of the left: x falls by the share of the slack moved.
    expect(dragFraming(SCENE_FRAMING, 50, 0, frame, wide)).toEqual({ x: 0, y: 50, zoom: 1 });
    expect(dragFraming(SCENE_FRAMING, -25, 0, frame, wide)).toEqual({ x: 75, y: 50, zoom: 1 });
    // No slack down at zoom 1: dragging up or down changes nothing.
    expect(dragFraming(SCENE_FRAMING, 0, 80, frame, wide)).toEqual(SCENE_FRAMING);
    // Zoomed 2×: 200 px of slack down, so dragging up 50 px moves y by a quarter.
    expect(dragFraming({ x: 50, y: 50, zoom: 2 }, 0, -50, frame, wide)).toEqual({
      x: 50,
      y: 75,
      zoom: 2,
    });
    // Never past the photo's edges.
    expect(dragFraming(SCENE_FRAMING, 999, 0, frame, wide).x).toBe(0);
  });

  it("zooms in range and falls back on a missing or broken framing", () => {
    expect(zoomFraming(PORTRAIT_FRAMING, 2.5)).toEqual({ x: 50, y: 20, zoom: 2.5 });
    expect(zoomFraming(PORTRAIT_FRAMING, 7)).toEqual({ x: 50, y: 20, zoom: 3 });
    expect(framingOr(null, PORTRAIT_FRAMING)).toBe(PORTRAIT_FRAMING);
    expect(framingOr({ x: "a" } as never, SCENE_FRAMING)).toBe(SCENE_FRAMING);
    expect(framingOr({ x: 10, y: 20, zoom: 1.2 }, SCENE_FRAMING)).toEqual({
      x: 10,
      y: 20,
      zoom: 1.2,
    });
  });

  it("takes only a framing in range from the API", () => {
    expect(photoFramingSchema.parse({ x: 12.345, y: 0, zoom: 1 })).toEqual({
      x: 12.35,
      y: 0,
      zoom: 1,
    });
    expect(photoFramingSchema.safeParse({ x: 101, y: 0, zoom: 1 }).success).toBe(false);
    expect(photoFramingSchema.safeParse({ x: 50, y: 50, zoom: 3.5 }).success).toBe(false);
    expect(photoFramingSchema.safeParse({ x: 50, y: 50 }).success).toBe(false);
    // A website photo's update can be its framing alone (or clearing it).
    expect(academyPhotoUpdateSchema.parse({ framing: { x: 20, y: 30, zoom: 1.5 } })).toEqual({
      framing: { x: 20, y: 30, zoom: 1.5 },
    });
    expect(academyPhotoUpdateSchema.parse({ framing: null })).toEqual({ framing: null });
  });
});
