import { Hono } from "hono";
import type { AnnouncementDto, AnnouncementListDto } from "../../shared/api-types";
import { can } from "../../shared/roles";
import { announcementListQuerySchema, announcementSchema } from "../../shared/schemas";
import { v } from "../lib/validate";
import { assertCan, ctxOf, requireCap } from "../middleware";
import {
  announcementDetail,
  deleteAnnouncement,
  listAnnouncements,
  saveAnnouncement,
  unpublishAnnouncement,
} from "../services/announcements";
import type { AppBindings } from "../types";

const composeOnly = requireCap("announcements");

/**
 * Announcements, from the staff side (/api/v1). Every staff role reads the live ones (Today shows
 * them); composing, editing, scheduling, unpublishing, deleting, and the other tabs (drafts,
 * scheduled, expired) take `announcements` (owners and admins).
 */
export const announcementRoutes = new Hono<AppBindings>()
  .get("/announcements", v("query", announcementListQuerySchema), async (c) => {
    const status = c.req.valid("query").status ?? "live";
    if (status !== "live") assertCan(c.var.role, "announcements");
    return c.json<AnnouncementListDto>(
      await listAnnouncements(ctxOf(c), status, Date.now(), can(c.var.role, "announcements")),
    );
  })

  .get("/announcements/:id", composeOnly, async (c) =>
    c.json<AnnouncementDto>(await announcementDetail(ctxOf(c), c.req.param("id"), Date.now())),
  )

  .post("/announcements", composeOnly, v("json", announcementSchema), async (c) =>
    c.json<AnnouncementDto>(
      await saveAnnouncement(ctxOf(c), c.req.valid("json"), null, Date.now()),
      201,
    ),
  )

  .patch("/announcements/:id", composeOnly, v("json", announcementSchema), async (c) =>
    c.json<AnnouncementDto>(
      await saveAnnouncement(ctxOf(c), c.req.valid("json"), c.req.param("id"), Date.now()),
    ),
  )

  .post("/announcements/:id/unpublish", composeOnly, async (c) => {
    await c.req.raw.arrayBuffer().catch(() => undefined);
    return c.json<AnnouncementDto>(
      await unpublishAnnouncement(ctxOf(c), c.req.param("id"), Date.now()),
    );
  })

  .delete("/announcements/:id", composeOnly, async (c) => {
    await deleteAnnouncement(ctxOf(c), c.req.param("id"), Date.now());
    return c.body(null, 204);
  });
