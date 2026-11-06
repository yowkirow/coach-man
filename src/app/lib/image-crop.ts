// Crop math for images prepared in the browser (lib/images.ts), kept free of the DOM so it can be
// unit-tested.

/** A rectangle of the source image, in whole pixels. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The 4:5 part of a `width` × `height` picture a team page photo keeps: the full height of a wider
 * picture, centered; the full width of a taller one, starting 10% of the way down the extra
 * height, so a half-body photo keeps the head and loses mostly legs. Never empty, never outside.
 */
export function portraitCrop(width: number, height: number): CropRect {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (w * 5 > h * 4) {
    const cropW = Math.min(w, Math.max(1, Math.round((h * 4) / 5)));
    return { x: Math.floor((w - cropW) / 2), y: 0, width: cropW, height: h };
  }
  const cropH = Math.min(h, Math.max(1, Math.round((w * 5) / 4)));
  return { x: 0, y: Math.round((h - cropH) * 0.1), width: w, height: cropH };
}

/** The size a portrait crop is drawn at: `maxEdge` tall at most (never enlarged), 4:5. */
export function portraitSize(crop: CropRect, maxEdge: number): { width: number; height: number } {
  const height = Math.max(1, Math.min(Math.round(maxEdge), crop.height));
  return { width: Math.max(1, Math.round((height * 4) / 5)), height };
}
