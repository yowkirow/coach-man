import { Hono } from "hono";
import { notFound } from "../lib/errors";
import { limitByIp } from "../lib/rate-limit";
import { PUBLIC_KEY_RE } from "../lib/uploads";
import type { AppBindings } from "../types";

/**
 * Unauthenticated reads (/api/public, rate-limited). For now, the academy's public images (logo,
 * payment QR, coach photos) under ws/<id>/public/, which invite pages show before anyone signs in.
 * The public academy page's data API joins this router later (WS4).
 */
export const publicRoutes = new Hono<AppBindings>()
  .use("*", limitByIp("public", { windowMs: 60_000, max: 300 }))

  .get("/files/*", async (c) => {
    let key: string;
    try {
      key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/api\/public\/files\//, ""));
    } catch {
      throw notFound("File");
    }
    if (!PUBLIC_KEY_RE.test(key) || key.includes("..")) throw notFound("File");
    const obj = await c.env.FILES.get(key);
    if (!obj) throw notFound("File");
    // Keys are never reused (each upload gets a new uuid), so browsers may keep them a while.
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
