import { createFileRoute, isRedirect, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "../components/layout/app-shell";
import { ApiRequestError, isNoWorkspace } from "../lib/api";
import { meQuery } from "../lib/hooks";
import { claimCache, useOfflinePack, whenCacheRestored } from "../lib/offline";
import { isStandalone } from "../lib/public-path";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    // Restore the offline cache first, so whose data it holds is settled before anything renders.
    await whenCacheRestored();
    try {
      const me = await context.queryClient.ensureQueryData(meQuery);
      claimCache(me.user.id);
      // Only someone who can change the academy's settings can finish setting it up; a coach who
      // joins before the owner has finished goes straight in.
      if (!me.settings.onboardedAt && me.can?.settings) throw redirect({ to: "/onboarding" });
    } catch (err) {
      if (isRedirect(err)) throw err;
      if (err instanceof ApiRequestError && err.status === 401) {
        // A signed-out visit to the front door meets CoachMan first (with a clear Sign in); the
        // installed app, and every deeper link, go straight to sign-in and come back.
        if (location.pathname === "/" && !location.searchStr && !isStandalone()) {
          throw redirect({ to: "/about" });
        }
        throw redirect({ to: "/sign-in", search: { next: location.href } });
      }
      // Signed in but not staff anywhere: families and brand-new accounts start at /welcome.
      if (isNoWorkspace(err)) throw redirect({ to: "/welcome" });
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
