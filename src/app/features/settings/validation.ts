/**
 * Turns schema issues into one message per top-level field, preferring the friendly copy a form
 * provides over the schema's generic wording.
 */
export function issuesToFields(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  friendly: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = friendly[key] ?? issue.message;
  }
  return out;
}

/** Fields of `next` that differ from `prev` (arrays compared by value), for partial PATCH bodies. */
export function changedFields<T extends object>(next: T, prev: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (JSON.stringify(next[key] ?? null) !== JSON.stringify(prev[key] ?? null)) {
      out[key] = next[key];
    }
  }
  return out;
}

/** Number typed into a text input: null when empty, NaN when unreadable (the schema flags it). */
export function wholeNumber(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}
