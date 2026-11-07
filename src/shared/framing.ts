// Photo framing: how a website photo sits in the frames that show it (the home page's photo
// sticker, the team page's 4:5 portraits, the On court tiles). It is non-destructive: the file
// stays whole and every frame crops it the same way, so one framing serves every shape. DOM-free,
// so the math is unit-tested.

/** Where a photo sits in its frame, and how far it's zoomed in. */
export interface PhotoFraming {
  /** 0–100: the point of the photo (across, then down) that lines up with the same point of the frame. */
  x: number;
  y: number;
  /** 1–3: 1 just fills the frame (cover); 2 shows half as much, twice as big. */
  zoom: number;
}

export const FRAMING_ZOOM_MAX = 3;

/** Photos of places and sessions: the middle. */
export const SCENE_FRAMING: PhotoFraming = { x: 50, y: 50, zoom: 1 };

/** Half-body portraits: the middle across, a fifth of the way down, so faces stay in. */
export const PORTRAIT_FRAMING: PhotoFraming = { x: 50, y: 20, zoom: 1 };

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A framing kept in range, at two decimals. */
export function clampFraming(f: PhotoFraming): PhotoFraming {
  return {
    x: round2(clamp(Number.isFinite(f.x) ? f.x : 50, 0, 100)),
    y: round2(clamp(Number.isFinite(f.y) ? f.y : 50, 0, 100)),
    zoom: round2(clamp(Number.isFinite(f.zoom) ? f.zoom : 1, 1, FRAMING_ZOOM_MAX)),
  };
}

export function sameFraming(a: PhotoFraming, b: PhotoFraming): boolean {
  const ca = clampFraming(a);
  const cb = clampFraming(b);
  return ca.x === cb.x && ca.y === cb.y && ca.zoom === cb.zoom;
}

/**
 * The CSS for an image that fills its frame (`object-fit: cover`, full width and height, inside an
 * `overflow: hidden` frame). `object-position` lines the photo's (x, y) point up with the frame's
 * (x, y) point; zooming scales about that same point, so it stays put and the frame stays filled.
 */
export function framingStyle(f: PhotoFraming): {
  objectPosition: string;
  transform?: string;
  transformOrigin?: string;
} {
  const { x, y, zoom } = clampFraming(f);
  const objectPosition = `${x}% ${y}%`;
  return zoom > 1
    ? { objectPosition, transform: `scale(${zoom})`, transformOrigin: objectPosition }
    : { objectPosition };
}

/** Width and height, in pixels. */
export interface Size {
  width: number;
  height: number;
}

/**
 * How far the photo can travel in a frame at a zoom, in screen pixels (across, then down): the
 * part of the photo, drawn to cover the frame and zoomed, that the frame can't show at once.
 */
export function framingSlack(frame: Size, image: Size, zoom: number): Size {
  if (frame.width <= 0 || frame.height <= 0 || image.width <= 0 || image.height <= 0) {
    return { width: 0, height: 0 };
  }
  const cover = Math.max(frame.width / image.width, frame.height / image.height);
  return {
    width: Math.max(0, image.width * cover * zoom - frame.width),
    height: Math.max(0, image.height * cover * zoom - frame.height),
  };
}

/**
 * The framing after dragging the photo `dx`, `dy` screen pixels: the photo follows the pointer.
 * Moving it across all of its slack takes `x` (or `y`) from one end to the other. A direction with
 * no slack (a 4:5 photo in a 4:5 frame, unzoomed, up and down) doesn't move.
 */
export function dragFraming(
  f: PhotoFraming,
  dx: number,
  dy: number,
  frame: Size,
  image: Size,
): PhotoFraming {
  const slack = framingSlack(frame, image, clampFraming(f).zoom);
  return clampFraming({
    x: slack.width >= 0.5 ? f.x - (dx / slack.width) * 100 : f.x,
    y: slack.height >= 0.5 ? f.y - (dy / slack.height) * 100 : f.y,
    zoom: f.zoom,
  });
}

/** The same framing at another zoom (kept in range). */
export function zoomFraming(f: PhotoFraming, zoom: number): PhotoFraming {
  return clampFraming({ ...f, zoom });
}

/** A stored framing, or the fallback when there's none (or it's malformed). */
export function framingOr(
  f: PhotoFraming | null | undefined,
  fallback: PhotoFraming,
): PhotoFraming {
  if (!f || typeof f !== "object") return fallback;
  const { x, y, zoom } = f as Partial<PhotoFraming>;
  if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return fallback;
  return clampFraming({ x, y, zoom });
}
