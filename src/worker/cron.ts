import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { workspaceSettings } from "./db/schema";
import { runAnnouncements } from "./services/announcements";
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
      await extendAllSeries({ db, env, workspaceId, userId: "system", settings, role: "owner" });
    });
    return;
  }
  // Scheduled announcements whose time has come go live for families and are announced once
  // (whether or not push is configured: the hook decides what to send).
  try {
    await runAnnouncements(db, env, now.getTime());
  } catch (err) {
    console.error("Announcements run failed", err);
  }
  await runReminders(db, env, now);
}
