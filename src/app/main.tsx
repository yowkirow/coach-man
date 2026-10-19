import "./styles.css";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setUnauthorizedHandler } from "./lib/api";
import { onCacheRestored, requestPersistentStorage } from "./lib/offline";
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
  if (path !== "/sign-in") void router.navigate({ to: "/sign-in", search: { next: path } });
});

void requestPersistentStorage();

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
