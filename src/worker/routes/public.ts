import { Hono } from "hono";
import type {
  PublicAcademyDto,
  PublicConfigDto,
  PublicConsentDocumentDto,
  PublicSessionDto,
} from "../../shared/api-types";
import { publicSessionsQuerySchema } from "../../shared/schemas";
import { notFound } from "../lib/errors";
import { publicConfig } from "../lib/page-meta";
import { limitByIp } from "../lib/rate-limit";
import { PUBLIC_KEY_RE } from "../lib/uploads";
import { v } from "../lib/validate";
import {
  loadPublicAcademy,
  loadPublicConsents,
  loadPublicSessions,
} from "../services/public-academy";
import type { AppBindings } from "../types";

/** Published data changes rarely and is the same for everyone: browsers and caches keep it a minute. */
const PUBLIC_DATA_CACHE = "public, max-age=60";

/**
 * Unauthenticated reads (/api/public, rate-limited per connection): the academy's public images
 * (logo, payment QR, coach photos) under ws/<id>/public/, and a listed academy's public page data.
 * Unlisted academies, legacy `ws-…` addresses, and unknown ones all answer the same 404.
 */
export const publicRoutes = new Hono<AppBindings>()
  .use("*", limitByIp("public", { windowMs: 60_000, max: 300 }))

  /** What CoachMan's own public pages (/about, /privacy, /terms) need: the contact address. */
  .get("/config", (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json<PublicConfigDto>(publicConfig(c.env));
  })

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
  })

  /** The public academy page: profile, programs, tiers with prices, coaches, consent titles. */
  .get("/academies/:slug", async (c) => {
    const found = await loadPublicAcademy(c.var.db, { slug: c.req.param("slug") });
    if (!found) throw notFound("Academy");
    c.header("Cache-Control", PUBLIC_DATA_CACHE);
    return c.json<PublicAcademyDto>(found.academy);
  })

  /** The texts of the active required consents, which families read before enrolling (WS4b). */
  .get("/academies/:slug/consents", async (c) => {
    const docs = await loadPublicConsents(c.var.db, c.req.param("slug"));
    if (!docs) throw notFound("Academy");
    c.header("Cache-Control", PUBLIC_DATA_CACHE);
    return c.json<PublicConsentDocumentDto[]>(docs);
  })

  /**
   * Upcoming sessions of a public program, for picking a trial session when enrolling: date,
   * time, venue, court, and places left. Never who's booked.
   */
  .get(
    "/academies/:slug/programs/:programId/sessions",
    limitByIp("public-sessions", { windowMs: 60_000, max: 60 }),
    v("query", publicSessionsQuerySchema),
    async (c) => {
      const sessions = await loadPublicSessions(
        c.var.db,
        c.req.param("slug"),
        c.req.param("programId"),
        c.req.valid("query"),
      );
      if (!sessions) throw notFound("Program");
      c.header("Cache-Control", PUBLIC_DATA_CACHE);
      return c.json<PublicSessionDto[]>(sessions);
    },
  );
