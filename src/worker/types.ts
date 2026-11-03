import type { StaffRole } from "../shared/roles";
import type { Auth } from "./auth";
import type { Db } from "./db/client";
import type { workspaceSettings } from "./db/schema";

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
}
