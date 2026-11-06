// The team page's one order: staff coach profiles and display-only people, together.

/** Someone on the team page, as far as the order goes. */
export interface TeamPageItem {
  /** `staff`: a member with a coach profile; `listed`: a display-only person. */
  kind: "staff" | "listed";
  /** The staff member's user id, or the display-only person's id. */
  id: string;
  name: string;
  sortOrder: number;
}

/**
 * Staff and display-only people merged into the academy's order: by `sortOrder`, then by name.
 * Ties after that put staff first, then go by id, so the same rows always give the same page.
 */
export function teamPageOrder<T extends TeamPageItem>(
  staff: readonly T[],
  people: readonly T[],
): T[] {
  return [...staff, ...people].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name) ||
      (a.kind === b.kind ? 0 : a.kind === "staff" ? -1 : 1) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Where someone new goes on the team page: one past the highest place taken, by a coach profile
 * or a display-only person (`highest` holds each table's maximum, null when it has none), or 0 on
 * an empty page. So a newcomer never lands above an order the academy arranged.
 */
export function nextTeamPagePlace(highest: readonly (number | null | undefined)[]): number {
  let max = -1;
  for (const n of highest) if (typeof n === "number" && n > max) max = n;
  return max + 1;
}

/**
 * A new order for the page: the entries asked for first, in the order given (anyone no longer on
 * the page is skipped, and repeats count once), then everyone the request left out, in the order
 * they had. Each entry's new `sortOrder` is its index.
 */
export function reorderTeamPage<T extends TeamPageItem>(
  current: readonly T[],
  requested: readonly { kind: TeamPageItem["kind"]; id: string }[],
): T[] {
  const keyOf = (e: { kind: string; id: string }) => `${e.kind}:${e.id}`;
  const byKey = new Map(current.map((e) => [keyOf(e), e]));
  const placed = new Set<string>();
  const out: T[] = [];
  for (const r of requested) {
    const key = keyOf(r);
    const entry = byKey.get(key);
    if (!entry || placed.has(key)) continue;
    placed.add(key);
    out.push(entry);
  }
  for (const e of current) if (!placed.has(keyOf(e))) out.push(e);
  return out;
}
