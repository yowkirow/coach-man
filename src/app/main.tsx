import "./styles.css";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setNoWorkspaceHandler, setUnauthorizedHandler } from "./lib/api";
import { onCacheRestored, requestPersistentStorage } from "./lib/offline";
import { shouldPersistMutation } from "./lib/outbox";
import { isEnrollPath, isInfoPath, isPublicPath, isStandalone } from "./lib/public-path";
import {
  CACHE_BUSTER,
  CACHE_MAX_AGE,
  keys,
  persister,
  queryClient,
  shouldPersistQuery,
} from "./lib/query";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Whether a session ended on this page (someone was signed in, then wasn't): they sign in again,
// even from the front door.
let sessionEnded = false;

setUnauthorizedHandler(() => {
  if (queryClient.getQueryData(keys.me) !== undefined) sessionEnded = true;
  queryClient.removeQueries({ queryKey: keys.me });
  // The portal's "who is this" goes too: a failed refetch keeps the old answer, and the next
  // person to sign in on this page (a family phone passed around) must never be greeted with it,
  // even for a frame. Only when there was someone, so signed-out pages asking don't loop.
  if (queryClient.getQueryData(keys.account) !== undefined) {
    sessionEnded = true;
    queryClient.removeQueries({ queryKey: keys.account });
  }
  const path = window.location.pathname;
  // Invite pages and the enrollment wizard work signed out: they offer sign-in themselves and
  // come back to the same page. CoachMan's public pages need no sign-in at all.
  if (path === "/sign-in" || path.startsWith("/join/") || isEnrollPath(path) || isInfoPath(path))
    return;
  // A first, signed-out visit to the front door meets CoachMan (as the /_app route decides too).
  if (!sessionEnded && path === "/" && !window.location.search && !isStandalone()) {
    void router.navigate({ to: "/about", replace: true });
    return;
  }
  // A staff preview of the public page (/a/…?preview=1) comes back to the preview.
  const next = isPublicPath(path) ? `${path}${window.location.search}` : path;
  void router.navigate({ to: "/sign-in", search: { next } });
});

// Removed from their last academy (or never staff): the staff app has nothing to show them.
// The family portal, /welcome, invite pages, public academy pages, and CoachMan's public pages
// don't use the staff API (a staff-only preview there says so itself), so they stay put.
setNoWorkspaceHandler(() => {
  queryClient.removeQueries({ queryKey: keys.me });
  void queryClient.invalidateQueries({ queryKey: keys.account });
  const path = window.location.pathname;
  if (
    path === "/welcome" ||
    path === "/my" ||
    path.startsWith("/my/") ||
    path.startsWith("/join/") ||
    isPublicPath(path) ||
    isInfoPath(path)
  )
    return;
  void router.navigate({ to: "/welcome" });
});

// Someone who only opened an academy's link, or is reading CoachMan's public pages, isn't using
// the app: no storage request for them.
const startPath = window.location.pathname;
if (!isPublicPath(startPath) && !isInfoPath(startPath)) void requestPersistentStorage();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE,
        buster: CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => shouldPersistQuery(q.queryKey, q.state.status),
          shouldDehydrateMutation: shouldPersistMutation,
        },
      }}
      onSuccess={onCacheRestored}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
);
