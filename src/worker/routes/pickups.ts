import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { PickupDto } from "../../shared/api-types";
import { pickupInputSchema } from "../../shared/schemas";
import { client } from "../db/schema";
import { notFound } from "../lib/errors";
import { readFormWithImage } from "../lib/uploads";
import { parseWith } from "../lib/validate";
import { deletePickup, pickupsOf, savePickup } from "../services/safety";
import type { AppBindings } from "../types";

/** The student in the path, in the caller's academy (404 otherwise; the body is drained first). */
async function studentOf(c: Context<AppBindings>) {
  const row = await c.var.db.query.client.findFirst({
    where: and(eq(client.id, c.req.param("id") ?? ""), eq(client.workspaceId, c.var.workspaceId)),
    columns: { id: true },
  });
  if (!row) {
    if (c.req.method !== "GET") await c.req.raw.arrayBuffer().catch(() => undefined);
    throw notFound("Client");
  }
  return row;
}

/**
 * Authorized pickup people, from the staff side (/api/v1, every staff role: coaches meet them at
 * the court). A person arrives as multipart/form-data (the photo in `photo`, the details as JSON
 * in `data`) or as JSON alone; the photo is checked by its bytes and stored privately under the
 * student's `pickups/` folder. Every change is audited (field names, never values).
 */
export const pickupRoutes = new Hono<AppBindings>()
  .get("/clients/:id/pickups", async (c) => {
    const row = await studentOf(c);
    const map = await pickupsOf(c.var.db, c.var.workspaceId, [row.id]);
    return c.json<PickupDto[]>(map.get(row.id) ?? []);
  })

  .post("/clients/:id/pickups", async (c) => {
    const row = await studentOf(c);
    const { data, image } = await readFormWithImage(c, { fileField: "photo", noun: "photo" });
    const input = parseWith(pickupInputSchema, data);
    const saved = await savePickup(c.var.db, c.env, {
      workspaceId: c.var.workspaceId,
      clientId: row.id,
      data: input,
      image,
      actor: { userId: c.var.user.id, by: "staff" },
    });
    return c.json<PickupDto>(saved, 201);
  })

  .patch("/clients/:id/pickups/:pickupId", async (c) => {
    const row = await studentOf(c);
    const { data, image } = await readFormWithImage(c, { fileField: "photo", noun: "photo" });
    const input = parseWith(pickupInputSchema, data);
    const saved = await savePickup(c.var.db, c.env, {
      workspaceId: c.var.workspaceId,
      clientId: row.id,
      pickupId: c.req.param("pickupId"),
      data: input,
      image,
      actor: { userId: c.var.user.id, by: "staff" },
    });
    return c.json<PickupDto>(saved);
  })

  .delete("/clients/:id/pickups/:pickupId", async (c) => {
    const row = await studentOf(c);
    await deletePickup(c.var.db, c.env, {
      workspaceId: c.var.workspaceId,
      clientId: row.id,
      pickupId: c.req.param("pickupId"),
      actor: { userId: c.var.user.id, by: "staff" },
    });
    return c.body(null, 204);
  });
