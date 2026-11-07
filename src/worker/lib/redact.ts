/**
 * Money redaction for staff without the `money` capability.
 *
 * Every money amount in the API is a number (or null) in a field whose name ends in `Minor`
 * (minor currency units: `priceMinor`, `balanceMinor`, `amountMinor`, ...). Fields that end in
 * "Minor" but hold something else (a boolean `isMinor`, say) are not money and are kept.
 * A few lists name who owes money without an amount; those are emptied, keeping the shape the
 * app expects.
 */

export const MONEY_SUFFIX = "Minor";

/** Arrays that are money by what they list (Today's `alerts.balancesDue`). */
export const MONEY_LISTS: ReadonlySet<string> = new Set(["balancesDue"]);

export function isMoneyField(key: string, value: unknown): boolean {
  return key.endsWith(MONEY_SUFFIX) && (typeof value === "number" || value === null);
}

/** A deep copy of a JSON value with every money field removed. */
export function redactMoney<T>(value: T): T {
  return redact(value) as T;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isMoneyField(key, v)) continue;
    out[key] = MONEY_LISTS.has(key) && Array.isArray(v) ? [] : redact(v);
  }
  return out;
}
