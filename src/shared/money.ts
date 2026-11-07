// Money is stored as integer minor units (cents, centavos, ...) plus the workspace currency.

const digitsCache = new Map<string, number>();

export function currencyDigits(currency: string): number {
  const cached = digitsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  digitsCache.set(currency, digits);
  return digits;
}

export function formatMoney(minor: number, currency: string, locale = "en-US"): string {
  const digits = currencyDigits(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** digits);
  } catch {
    return `${(minor / 10 ** digits).toFixed(digits)} ${currency}`;
  }
}

/** Short form without trailing zeros for whole amounts (e.g. "₱1,500" instead of "₱1,500.00"). */
export function formatMoneyShort(minor: number, currency: string, locale = "en-US"): string {
  const digits = currencyDigits(currency);
  const whole = minor % 10 ** digits === 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** digits);
  } catch {
    return formatMoney(minor, currency, locale);
  }
}

/** Parses user input like "1,500.50" into minor units. Returns null when invalid. */
export function parseMoney(input: string, currency: string): number | null {
  const cleaned = input.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;
  // Treat the last separator as decimal when followed by 1-2 digits; strip the rest as grouping.
  const match = cleaned.match(/^(-?)([\d.,]*?)(?:[.,](\d{1,2}))?$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const intPart = (match[2] ?? "").replace(/[.,]/g, "") || "0";
  const frac = match[3] ?? "";
  const digits = currencyDigits(currency);
  if (frac.length > digits) return null;
  const minor = Number(intPart) * 10 ** digits + Number(frac.padEnd(digits, "0") || "0");
  if (!Number.isFinite(minor)) return null;
  return sign * minor;
}

export function minorToInput(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

export const COMMON_CURRENCIES = [
  "PHP",
  "USD",
  "SGD",
  "MYR",
  "AUD",
  "CAD",
  "EUR",
  "GBP",
  "HKD",
  "IDR",
  "INR",
  "JPY",
  "KRW",
  "NZD",
  "THB",
  "VND",
  "MXN",
];
