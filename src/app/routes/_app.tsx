import { createFileRoute, isRedirect, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "../components/layout/app-shell";
import { ApiRequestError } from "../lib/api";
import { meQuery } from "../lib/hooks";
import { claimCache, useOfflinePack, whenCacheRestored } from "../lib/offline";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    // Restore the offline cache first, so whose data it holds is settled before anything renders.
    await whenCacheRestored();
    try {
      const me = await context.queryClient.ensureQueryData(meQuery);
      claimCache(me.user.id);
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
