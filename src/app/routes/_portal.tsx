import type { AccountDto } from "@shared/api-types";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { PortalTabBar } from "../features/portal/shell";
import { ApiRequestError } from "../lib/api";
import { accountQuery } from "../lib/hooks";
import { claimCache, whenCacheRestored } from "../lib/offline";
import { keys } from "../lib/query";

/**
 * The family portal (/my/*): students and parents see what their academy shares with them.
 * Phone-first and calmer than the staff app, under the academy's own name and logo. It reads only
 * /api/account and /api/portal (families get 403 from the staff API).
 */
export const Route = createFileRoute("/_portal")({
  beforeLoad: async ({ context, location }) => {
    await whenCacheRestored();
    let account: AccountDto;
    try {
      account = await context.queryClient.ensureQueryData(accountQuery);
      // A cached account without family links may be out of date (an invite was just accepted).
      if (!account.family.length) {
        account = await context.queryClient.fetchQuery({ ...accountQuery, staleTime: 0 });
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        throw redirect({ to: "/sign-in", search: { next: location.href } });
      }
      // Offline with nothing cached yet: the page shows what it can.
      return;
    }
    // Whose data this device's cache holds is settled before anything renders.
    claimCache(account.user.id);
    if (!account.family.length) throw redirect({ to: account.staff.length ? "/" : "/welcome" });
  },
  component: PortalLayout,
});

/**
 * Drops this device's cached portal reads of students and academies the person is no longer
 * linked to (the academy or a parent ended the access), once the server has said so: nothing of
 * theirs stays readable offline afterwards. A page still open on one answers 404 and says so;
 * its copy goes the next time the portal opens.
 */
function forgetUnlinked(qc: QueryClient, account: AccountDto) {
  const students = new Set(account.family.flatMap((f) => f.students.map((s) => s.clientId)));
  const academies = new Set(account.family.map((f) => f.workspaceId));
  qc.removeQueries({
    queryKey: keys.portal.all,
    type: "inactive",
    predicate: (q) => {
      const [, userId, kind, id] = q.queryKey as string[];
      if (userId !== account.user.id || kind === "home") return false;
      return kind === "academy" ? !academies.has(id ?? "") : !students.has(id ?? "");
    },
  });
}

function PortalLayout() {
  // Rechecked whenever the portal opens: links are granted and revoked from elsewhere.
  const account = useQuery({ ...accountQuery, refetchOnMount: "always" });
  const qc = useQueryClient();
  useEffect(() => {
    if (account.data && account.isFetchedAfterMount) forgetUnlinked(qc, account.data);
  }, [qc, account.data, account.isFetchedAfterMount]);
  return (
    <div className="min-h-dvh lg:px-3">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:rounded-full focus:bg-lime focus:px-5 focus:py-2.5 focus:font-semibold focus:text-ink"
      >
        Skip to content
      </a>
      <div className="mx-auto w-full max-w-[1080px]">
        <Outlet />
      </div>
      <PortalTabBar />
    </div>
  );
}
