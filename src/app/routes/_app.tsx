import { createFileRoute, isRedirect, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "../components/layout/app-shell";
import { ApiRequestError } from "../lib/api";
import { meQuery } from "../lib/hooks";
import { useOfflinePack } from "../lib/offline";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    try {
      const me = await context.queryClient.ensureQueryData(meQuery);
      if (!me.settings.onboardedAt) throw redirect({ to: "/onboarding" });
    } catch (err) {
      if (isRedirect(err)) throw err;
      if (err instanceof ApiRequestError && err.status === 401) {
        throw redirect({ to: "/sign-in", search: { next: location.href } });
      }
      // Offline with nothing cached yet: let the page render its own offline state.
    }
  },
  component: AppLayout,
});

function AppLayout() {
  useOfflinePack();
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
