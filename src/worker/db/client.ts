import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof getDb>;

/** D1 allows at most 100 bound parameters per statement; split multi-row inserts accordingly. */
export function chunkRows<T>(rows: T[], paramsPerRow: number, maxParams = 100): T[][] {
  const size = Math.max(1, Math.floor(maxParams / Math.max(1, paramsPerRow)));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
