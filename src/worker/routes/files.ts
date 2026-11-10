import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "../../shared/ids";
import { can } from "../../shared/roles";
import { client } from "../db/schema";
import { badRequest, notFound } from "../lib/errors";
import type { AppBindings } from "../types";

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_BYTES = 1_500_000;
/** ws/<workspaceId>/clients/<clientId>/payments/<file> */
const PAYMENT_PROOF_KEY = /^ws\/[^/]+\/clients\/[^/]+\/payments\//;

export const fileRoutes = new Hono<AppBindings>()
  .put("/clients/:id/photo", async (c) => {
    const { db, workspaceId } = c.var;
    const id = c.req.param("id");
    const row = await db.query.client.findFirst({
      where: and(eq(client.id, id), eq(client.workspaceId, workspaceId)),
    });
    if (!row) throw notFound("Client");
    const type = (c.req.header("Content-Type") ?? "").split(";")[0]?.trim() ?? "";
    const ext = TYPES[type];
    if (!ext) throw badRequest("Use a JPEG, PNG, or WebP photo.");
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) throw badRequest("The photo is empty.");
    if (body.byteLength > MAX_BYTES) throw badRequest("That photo is too large (1.5 MB max).");
    const key = `ws/${workspaceId}/clients/${id}/${uuidv7()}.${ext}`;
    await c.env.FILES.put(key, body, { httpMetadata: { contentType: type } });
    await db.update(client).set({ photoKey: key }).where(eq(client.id, id));
    if (row.photoKey) await c.env.FILES.delete(row.photoKey);
    return c.json({ photoKey: key });
  })

  .delete("/clients/:id/photo", async (c) => {
    const { db, workspaceId } = c.var;
    const id = c.req.param("id");
    const row = await db.query.client.findFirst({
      where: and(eq(client.id, id), eq(client.workspaceId, workspaceId)),
    });
    if (!row) throw notFound("Client");
    if (row.photoKey) await c.env.FILES.delete(row.photoKey);
    await db.update(client).set({ photoKey: null }).where(eq(client.id, id));
    return c.body(null, 204);
  })

  .get("/files/*", async (c) => {
    const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/api\/v1\/files\//, ""));
    if (!key.startsWith(`ws/${c.var.workspaceId}/`) || key.includes("..")) throw notFound("File");
    // Payment proofs are money: roles with `money` or `enrollment` (owners, admins, front desk).
    if (
      PAYMENT_PROOF_KEY.test(key) &&
      !can(c.var.role, "money") &&
      !can(c.var.role, "enrollment")
    ) {
      throw notFound("File");
    }
    const obj = await c.env.FILES.get(key);
    if (!obj) throw notFound("File");
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
