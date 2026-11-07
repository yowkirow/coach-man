/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
};

// App shell: every built asset, versioned by Workbox. Data is cached by the app (IndexedDB), not here.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Public academy pages (/a/…) come from the Worker, which writes the academy's link-preview tags
// and page data into the HTML; the cached shell has neither.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//, /^\/a\//],
  }),
);

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | undefined)?.type === "SKIP_WAITING")
    void self.skipWaiting();
});

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener("push", (event) => {
  let data: PushPayload = {};
  try {
    data = (event.data?.json() as PushPayload) ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  const options: NotificationOptions & { renotify?: boolean } = {
    body: data.body ?? "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    tag: data.tag,
    // A newer notification with the same tag (a reminder, then its cancellation) alerts again.
    renotify: Boolean(data.tag),
    data: { url: data.url ?? "/" },
  };
  event.waitUntil(self.registration.showNotification(data.title ?? "CoachMan", options));
});

/** The family portal lives under /my; everything else is the staff app (or a public page). */
const isPortalPath = (path: string) => path === "/my" || path.startsWith("/my/");

/** Only this app's own pages open from a notification (anything else opens the app's start). */
function targetOf(raw: unknown): URL {
  try {
    const url = new URL(typeof raw === "string" && raw ? raw : "/", self.location.origin);
    if (url.origin === self.location.origin) return url;
  } catch {
    // Not a URL: fall back to the start page.
  }
  return new URL("/", self.location.origin);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = targetOf((event.notification.data as { url?: string } | null)?.url);
  event.waitUntil(
    (async () => {
      const windows = (
        await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      ).filter((w) => new URL(w.url).origin === self.location.origin);
      // Already showing it: just bring it forward.
      const exact = windows.find((w) => w.url === target.href);
      if (exact) return exact.focus();
      // A window on the same side (portal or staff app) is reused; the other side's tab is left
      // alone (a coach who is also a parent may have both open).
      const portal = isPortalPath(target.pathname);
      const sameSide = windows.find((w) => isPortalPath(new URL(w.url).pathname) === portal);
      if (sameSide) {
        try {
          const focused = await sameSide.focus();
          const moved = await focused.navigate(target.href);
          if (moved) return moved;
        } catch {
          // A window this worker doesn't control can't be navigated: open a new one instead.
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
