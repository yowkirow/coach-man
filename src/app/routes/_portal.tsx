import type { AccountDto } from "@shared/api-types";
import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { ArrowLeftRight } from "lucide-react";
import { buttonClass } from "../components/ui/button";
import { SignOutButton } from "../features/settings/sign-out";
import { ApiRequestError } from "../lib/api";
import { initials } from "../lib/format";
import { accountQuery, useAccount } from "../lib/hooks";
import { claimCache, whenCacheRestored } from "../lib/offline";

/**
 * The family portal (/my/*): students and parents see what their academy shares with them.
 * Phone-first and calmer than the staff app, under the academy's name.
 */
export const Route = createFileRoute("/_portal")({
  beforeLoad: async ({ context, location }) => {
    await whenCacheRestored();
    let account: AccountDto;
    try {
      account = await context.queryClient.ensureQueryData(accountQuery);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        throw redirect({ to: "/sign-in", search: { next: location.href } });
      }
      // Offline with nothing cached yet: the page shows what it can.
      return;
    }
    claimCache(account.user.id);
    if (!account.family.length) throw redirect({ to: account.staff.length ? "/" : "/welcome" });
  },
  component: PortalLayout,
});

function AcademyMark({ name }: { name: string }) {
  const [first = "", second = ""] = name.trim().split(/\s+/);
  return (
    <span
      aria-hidden
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-night-3 text-[0.875rem] font-semibold text-night-ink"
    >
      {initials({ firstName: first, lastName: second })}
    </span>
  );
}

function PortalLayout() {
  const account = useAccount().data;
  const academy = account?.family[0];
  const isStaff = Boolean(account?.staff.length);

  return (
    <div className="min-h-dvh lg:p-3">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:rounded-full focus:bg-lime focus:px-5 focus:py-2.5 focus:font-semibold focus:text-ink"
      >
        Skip to content
      </a>
      <header className="dark-zone mx-auto w-full max-w-3xl rounded-b-[32px] bg-night px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-5 text-night-ink sm:px-6 lg:rounded-[32px] lg:pt-5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-3">
            <AcademyMark name={academy?.academyName ?? "CoachMan"} />
            <span className="min-w-0">
              <span className="block truncate text-[1rem] font-medium">
                {academy?.academyName ?? "Your academy"}
              </span>
              <span className="block text-[0.8125rem] text-night-ink-2">On CoachMan</span>
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {isStaff ? (
              <Link to="/" className={buttonClass("night", "sm")}>
                <ArrowLeftRight aria-hidden className="size-4" />
                Coach view
              </Link>
            ) : null}
            <SignOutButton variant="night" className="h-9 px-4 text-[0.875rem]" />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-5 pb-10 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
