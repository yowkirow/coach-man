import "./styles.css";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setNoWorkspaceHandler, setUnauthorizedHandler } from "./lib/api";
import { onCacheRestored, requestPersistentStorage } from "./lib/offline";
import { isPublicPath } from "./lib/public-path";
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

setUnauthorizedHandler(() => {
  queryClient.removeQueries({ queryKey: keys.me });
  const path = window.location.pathname;
  // Invite pages work signed out: they offer sign-in themselves and come back to the link.
  if (path === "/sign-in" || path.startsWith("/join/")) return;
  // A staff preview of the public page (/a/…?preview=1) comes back to the preview.
  const next = isPublicPath(path) ? `${path}${window.location.search}` : path;
  void router.navigate({ to: "/sign-in", search: { next } });
});

// Removed from their last academy (or never staff): the staff app has nothing to show them.
// The family portal, /welcome, invite pages, and public academy pages don't use the staff API
// (a staff-only preview there says so itself), so they stay put.
setNoWorkspaceHandler(() => {
  queryClient.removeQueries({ queryKey: keys.me });
  void queryClient.invalidateQueries({ queryKey: keys.account });
  const path = window.location.pathname;
  if (
    path === "/welcome" ||
    path === "/my" ||
    path.startsWith("/my/") ||
    path.startsWith("/join/") ||
    isPublicPath(path)
  )
    return;
  void router.navigate({ to: "/welcome" });
});

// Someone who only opened an academy's link isn't using the app: no storage request for them.
if (!isPublicPath(window.location.pathname)) void requestPersistentStorage();

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
          shouldDehydrateMutation: (m) => m.state.isPaused,
        },
      }}
      onSuccess={onCacheRestored}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
);
