import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ApiErrorBody } from "../shared/api-types";
import { ApiError } from "./lib/errors";
import { apiHeaders, originGuard, requireWorkspace, withServices } from "./middleware";
import { catalogRoutes } from "./routes/catalog";
import { clientRoutes } from "./routes/clients";
import { dataRoutes } from "./routes/data";
import { eventRoutes } from "./routes/events";
import { fileRoutes } from "./routes/files";
import { groupRoutes } from "./routes/groups";
import { lessonRoutes } from "./routes/lessons";
import { meRoutes } from "./routes/me";
import { moneyRoutes } from "./routes/money";
import { packageRoutes } from "./routes/packages";
import { progressRoutes } from "./routes/progress";
import { pushRoutes } from "./routes/push";
import { testRoutes } from "./routes/test";
import type { AppBindings } from "./types";

const v1 = new Hono<AppBindings>()
  .use("*", originGuard, requireWorkspace)
  .route("/", meRoutes)
  .route("/", clientRoutes)
  .route("/", groupRoutes)
  .route("/", catalogRoutes)
  .route("/", packageRoutes)
  .route("/", lessonRoutes)
  .route("/", eventRoutes)
  .route("/", moneyRoutes)
  .route("/", progressRoutes)
  .route("/", pushRoutes)
  .route("/", dataRoutes)
  .route("/", fileRoutes);

export const app = new Hono<AppBindings>()
  .basePath("/api")
  .use("*", withServices, apiHeaders)
  .on(["GET", "POST"], "/auth/*", (c) => c.var.auth.handler(c.req.raw))
  .get("/health", (c) => c.json({ ok: true, env: c.env.APP_ENV }))
  .route("/test", testRoutes)
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
