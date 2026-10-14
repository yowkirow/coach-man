import { uuidv7 } from "../../shared/ids";
import { auditLog } from "../db/schema";
import type { Ctx } from "../types";

/** Builds (does not run) an audit insert so callers can include it in a db.batch(). */
export function auditEntry(
  ctx: Ctx,
  action: string,
  entity: string,
  entityId: string | null,
  data?: Record<string, unknown>,
) {
  return ctx.db.insert(auditLog).values({
    id: uuidv7(),
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action,
    entity,
    entityId,
    data: data ?? null,
  });
}
