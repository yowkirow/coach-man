import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ApiErrorBody } from "../shared/api-types";
import { drainUnreadBody } from "./lib/drain";
import { ApiError } from "./lib/errors";
import {
  apiHeaders,
  originGuard,
  redactMoneyForRole,
  requireWorkspace,
  withServices,
} from "./middleware";
import { academyRoutes } from "./routes/academy";
import { accountRoutes } from "./routes/account";
import { announcementRoutes } from "./routes/announcements";
import { catalogRoutes } from "./routes/catalog";
import { clientRoutes } from "./routes/clients";
import { coachRoutes } from "./routes/coaches";
import { consentRoutes } from "./routes/consents";
import { dataRoutes } from "./routes/data";
import { enrollmentRoutes } from "./routes/enrollments";
import { eventRoutes } from "./routes/events";
import { familyRoutes } from "./routes/family";
import { fileRoutes } from "./routes/files";
import { groupRoutes } from "./routes/groups";
import { inviteRoutes } from "./routes/invites";
import { lessonRoutes } from "./routes/lessons";
import { meRoutes } from "./routes/me";
import { moneyRoutes } from "./routes/money";
import { packageRoutes } from "./routes/packages";
import { paymentProofRoutes } from "./routes/payment-proofs";
import { pickupRoutes } from "./routes/pickups";
import { portalRoutes } from "./routes/portal";
import { progressRoutes } from "./routes/progress";
import { publicRoutes } from "./routes/public";
import { pushRoutes } from "./routes/push";
import { teamRoutes } from "./routes/team";
import { testRoutes } from "./routes/test";
import type { AppBindings } from "./types";

// Staff API: members of the workspace only; capabilities are checked per route and money is
// redacted for roles without it.
const v1 = new Hono<AppBindings>()
  .use("*", originGuard, requireWorkspace, redactMoneyForRole)
  .route("/", meRoutes)
  .route("/", academyRoutes)
  .route("/", teamRoutes)
  .route("/", coachRoutes)
  .route("/", clientRoutes)
  .route("/", pickupRoutes)
  .route("/", familyRoutes)
  .route("/", consentRoutes)
  .route("/", enrollmentRoutes)
  .route("/", announcementRoutes)
  .route("/", groupRoutes)
  .route("/", catalogRoutes)
  .route("/", packageRoutes)
  .route("/", lessonRoutes)
  .route("/", eventRoutes)
  .route("/", moneyRoutes)
  .route("/", paymentProofRoutes)
  .route("/", progressRoutes)
  .route("/", pushRoutes)
  .route("/", dataRoutes)
  .route("/", fileRoutes);

export const app = new Hono<AppBindings>()
  .basePath("/api")
  .use("*", drainUnreadBody, withServices, apiHeaders)
  // Academies are managed through our own API (roles, invites); the organization plugin is only
  // there for the data model and the session's active workspace, so its HTTP endpoints stay shut.
  .all("/auth/organization/*", async (c) => {
    await c.req.raw.arrayBuffer().catch(() => undefined);
    return c.json<ApiErrorBody>(
      { error: { code: "not_found", message: "No such endpoint." } },
      404,
    );
  })
  .on(["GET", "POST"], "/auth/*", (c) => c.var.auth.handler(c.req.raw))
  .get("/health", (c) => c.json({ ok: true, env: c.env.APP_ENV }))
  .route("/test", testRoutes)
  .route("/account", accountRoutes)
  .route("/invites", inviteRoutes)
  .route("/public", publicRoutes)
  // Family portal: signed in, scoped to the students the caller is linked to.
  .route("/portal", portalRoutes)
  .route("/v1", v1);

app.notFound((c) =>
  c.json<ApiErrorBody>({ error: { code: "not_found", message: "No such endpoint." } }, 404),
);

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json<ApiErrorBody>(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.status,
    );
  }
  if (err instanceof HTTPException) {
    return c.json<ApiErrorBody>(
      { error: { code: "http_error", message: err.message } },
      err.status,
    );
  }
  console.error("Unhandled error", err);
  return c.json<ApiErrorBody>(
    {
      error: {
        code: "internal",
        message: "Something went wrong on our side. Try again in a moment.",
      },
    },
    500,
  );
});
