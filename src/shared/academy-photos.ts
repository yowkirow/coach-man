// The academy's website photos (courts, sessions, camps): how many it may show, how long a caption
// may be, and the checks the API and the app share.

/** The most photos an academy's website shows. */
export const MAX_ACADEMY_PHOTOS = 24;

/** The longest line under a photo. */
export const PHOTO_CAPTION_MAX = 140;

export const PHOTO_LIMIT_MESSAGE = `You can show up to ${MAX_ACADEMY_PHOTOS} photos. Remove one to add another.`;

/** A caption as it's saved: trimmed, and null when nothing is left. */
export function normalizeCaption(raw: string | null | undefined): string | null {
  const caption = raw?.trim() ?? "";
  return caption === "" ? null : caption;
}

/**
 * Whether a new order names exactly the academy's photos: each one once, and nothing else (a
 * photo added or removed in the meantime makes it stale).
 */
export function isPhotoOrder(current: readonly string[], requested: readonly string[]): boolean {
  if (requested.length !== current.length) return false;
  const known = new Set(current);
  const seen = new Set<string>();
  for (const id of requested) {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** The list with the item at `index` swapped with its neighbour `by` away (unchanged at an end). */
export function movePhoto<T>(items: readonly T[], index: number, by: -1 | 1): T[] {
  const next = [...items];
  const a = next[index];
  const b = next[index + by];
  if (a === undefined || b === undefined) return next;
  next[index] = b;
  next[index + by] = a;
  return next;
}
