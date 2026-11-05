import { useRegisterSW } from "virtual:pwa-register/react";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "../components/ui/feedback";
import { notify } from "../lib/notify";
import { isPublicPath } from "../lib/public-path";

export interface RouterContext {
  queryClient: QueryClient;
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });
  useEffect(() => {
    if (!needRefresh) return;
    notify({
      tone: "neutral",
      title: "A new version of CoachMan is ready",
      body: "Reload when you're between sessions.",
      duration: 0,
      action: { label: "Reload", onAction: () => void updateServiceWorker(true) },
    });
  }, [needRefresh, updateServiceWorker]);
  return null;
}

function Root() {
  // No service worker for someone who only opened an academy's link; it registers once they
  // reach the app itself.
  const publicPage = useRouterState({ select: (s) => isPublicPath(s.location.pathname) });
  return (
    <>
      <Outlet />
      <Toaster />
      {publicPage ? null : <UpdatePrompt />}
    </>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({ component: Root });
