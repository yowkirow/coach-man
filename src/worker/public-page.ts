import { getDb } from "./db/client";
import {
  academyPageMeta,
  type InfoPageKind,
  infoPageMeta,
  PUBLIC_CONFIG_ID,
  parseAcademyPath,
  publicConfig,
  renderDataIsland,
  renderMetaTags,
} from "./lib/page-meta";
import { clientIp, hit } from "./lib/rate-limit";
import { loadPublicAcademy } from "./services/public-academy";

/** Same budget as the public API (/api/public): pages and data share one count per connection. */
const PUBLIC_RULE = { windowMs: 60_000, max: 300 };

/** The app's index.html from the assets binding (a clean GET: conditional headers would 304). */
async function fetchShell(request: Request, env: Env): Promise<Response | null> {
  const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url), { method: "GET" }));
  const type = shell.headers.get("Content-Type") ?? "";
  return shell.ok && type.includes("text/html") ? shell : null;
}

/** The shell with its title and description replaced by `head` (tags and data blocks). */
function withHead(request: Request, shell: Response, head: string): Response {
  const headers = new Headers(shell.headers);
  // The body changes, so the shell's length and validator no longer describe it.
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Vary", "Accept-Encoding");
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.remove();
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        el.remove();
      },
    })
    .on("head", {
      element(el) {
        el.append(head, { html: true });
      },
    })
    .transform(new Response(shell.body, { status: 200, headers }));
}

/**
 * /about, /privacy, and /terms (CoachMan's own public pages) run through the Worker first: the
 * app shell with the page's own title, description, and link-preview tags, and the public
 * settings (the contact address) in a JSON block, so the page has them on first paint. The app
 * renders them like any other route, so they also work from the service worker's cached shell.
 */
export async function serveInfoPage(
  request: Request,
  env: Env,
  kind: InfoPageKind,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);
  const shell = await fetchShell(request, env);
  if (!shell) return env.ASSETS.fetch(request);
  const head =
    renderMetaTags(infoPageMeta(kind, env.APP_URL)) +
    renderDataIsland(publicConfig(env), PUBLIC_CONFIG_ID);
  return withHead(request, shell, head);
}

/**
 * /a/* (the public academy page and its rates sheet) runs through the Worker first
 * (`assets.run_worker_first`): it serves the app's index.html with the academy's own title,
 * description, and preview image, and the page's data in a JSON block so the app doesn't fetch
 * it again. Unknown and unlisted academies get the plain app shell with CoachMan's own tags and a
 * 200 (the app shows its not-found page). The shell's headers, security headers from `_headers`
 * included, are kept.
 */
export async function servePublicPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);
  const url = new URL(request.url);
  // A clean request for the shell: conditional headers would turn it into an empty 304.
  const shell = await env.ASSETS.fetch(new Request(new URL("/", url), { method: "GET" }));
  const type = shell.headers.get("Content-Type") ?? "";
  if (!shell.ok || !type.includes("text/html")) return shell;

  const target = parseAcademyPath(url.pathname);
  let academy: Awaited<ReturnType<typeof loadPublicAcademy>> = null;
  if (target) {
    try {
      const db = getDb(env.DB);
      const limit = await hit(db, `public:${clientIp(request.headers)}`, PUBLIC_RULE);
      // Over the limit, the page still loads; it just goes without the academy's tags.
      if (limit.allowed) academy = await loadPublicAcademy(db, { slug: target.slug });
    } catch (err) {
      console.error("Public page data failed", err);
    }
  }

  const meta = academyPageMeta({
    academy: academy?.academy ?? null,
    page: target?.page ?? "home",
    appUrl: env.APP_URL,
  });
  const head = renderMetaTags(meta) + (academy ? renderDataIsland(academy.academy) : "");
  return withHead(request, shell, head);
}
