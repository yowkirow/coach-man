import { useRegisterSW } from "virtual:pwa-register/react";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "../components/ui/feedback";
import { notify } from "../lib/notify";

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
  return (
    <>
      <Outlet />
      <Toaster />
      <UpdatePrompt />
    </>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({ component: Root });
