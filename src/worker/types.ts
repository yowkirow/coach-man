import type { StaffRole } from "../shared/roles";
import type { Auth } from "./auth";
import type { Db } from "./db/client";
import type { workspaceSettings } from "./db/schema";
import type { PortalScope } from "./lib/portal-scope";

export type SessionUser = Auth["$Infer"]["Session"]["user"];
export type WorkspaceSettingsRow = typeof workspaceSettings.$inferSelect;

export interface AppBindings {
  Bindings: Env;
  Variables: {
    db: Db;
    auth: Auth;
    user: SessionUser;
    workspaceId: string;
    settings: WorkspaceSettingsRow;
    /** The caller's staff role in the workspace (see src/shared/roles.ts). */
    role: StaffRole;
    /** Family portal only (/api/portal): the students the caller is linked to. */
    portal: PortalScope;
  };
}

/** What services need to know about the caller. */
export interface Ctx {
  db: Db;
  env: Env;
  workspaceId: string;
  userId: string;
  settings: WorkspaceSettingsRow;
  role: StaffRole;
  /**
   * Work to finish after the response (push notifications): `executionCtx.waitUntil` in a request
   * (see lib/defer.ts). Absent outside a request (cron, scripts): callers then await the work.
   */
  defer?: (work: Promise<unknown>) => void;
}
