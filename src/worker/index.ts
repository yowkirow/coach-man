import { app } from "./app";
import { handleScheduled } from "./cron";

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(controller.cron, env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
