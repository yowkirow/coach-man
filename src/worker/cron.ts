import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { workspaceSettings } from "./db/schema";
import { extendAllSeries } from "./services/lessons";
import { runMaintenance, runReminders } from "./services/push";

const MAINTENANCE_CRON = "15 3 * * *";

export async function handleScheduled(cron: string, env: Env, now: Date) {
  const db = getDb(env.DB);
  if (cron === MAINTENANCE_CRON) {
    await runMaintenance(db, now, async (workspaceId) => {
      const settings = await db.query.workspaceSettings.findFirst({
        where: eq(workspaceSettings.workspaceId, workspaceId),
      });
      if (!settings) return;
      await extendAllSeries({ db, env, workspaceId, userId: "system", settings });
    });
    return;
  }
  await runReminders(db, env, now);
}
