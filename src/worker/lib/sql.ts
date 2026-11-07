import { type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * `column IN (...)` with a single bound JSON parameter, so long id lists never hit D1's
 * 100-parameter limit.
 */
export function inList(column: SQLiteColumn | SQL, values: readonly string[]): SQL {
  if (values.length === 0) return sql`0`;
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

export function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export function fullName(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`.trim();
}
