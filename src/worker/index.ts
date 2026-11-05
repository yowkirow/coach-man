import { app } from "./app";
import { handleScheduled } from "./cron";
import { servePublicPage } from "./public-page";

export default {
  fetch(request, env, ctx) {
    // /api/* and /a/* reach the Worker first (wrangler.jsonc `run_worker_first`); everything else
    // is a static asset or the app shell.
    if (new URL(request.url).pathname.startsWith("/a/")) return servePublicPage(request, env);
    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(controller.cron, env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
