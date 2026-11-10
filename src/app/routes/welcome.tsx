import type { AccountDto } from "@shared/api-types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Building2, ChevronDown, Users } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "../components/auth-layout";
import { InlineError } from "../components/ui/feedback";
import { SignOutButton } from "../features/settings/sign-out";
import { ApiRequestError, accountApi, errorMessage } from "../lib/api";
import { accountQuery, useAccount } from "../lib/hooks";
import { claimCache } from "../lib/offline";
import { keys } from "../lib/query";

/**
 * Where signed-in people who aren't staff anywhere land. Families go to their portal; everyone
 * else chooses: set up CoachMan for their own coaching, or follow their academy's invite.
 */
export const Route = createFileRoute("/welcome")({
  beforeLoad: async ({ context }) => {
    let account: AccountDto | undefined;
    try {
      // Always ask the server: an invite accepted elsewhere changes where this person belongs.
      account = await context.queryClient.fetchQuery({ ...accountQuery, staleTime: 0 });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401)
        throw redirect({ to: "/sign-in", search: { next: "/welcome" } });
      account = context.queryClient.getQueryData<AccountDto>(keys.account);
    }
    if (!account) return;
    claimCache(account.user.id);
    if (account.family.length) throw redirect({ to: "/my" });
    if (account.staff.length) throw redirect({ to: "/" });
  },
  component: Welcome,
});

function Welcome() {
  const account = useAccount().data;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [familyOpen, setFamilyOpen] = useState(false);

  const setUp = useMutation({
    meta: { silent: true },
    mutationFn: () => accountApi.post<{ workspaceId: string }>("/workspaces"),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: keys.me });
      await qc.invalidateQueries({ queryKey: keys.account });
      void navigate({ to: "/onboarding" });
    },
  });

  const firstName = account?.user.name.trim().split(/\s+/)[0];

  return (
    <AuthLayout
      panel={
        <div className="mt-10 flex flex-1 flex-col lg:justify-end">
          <p className="max-w-[16ch] text-[2.5rem] leading-[1.04] font-light tracking-[-0.025em] lg:text-[3.5rem]">
            One place for coaches, players, and parents.
          </p>
          <p className="mt-4 max-w-[46ch] text-[0.9375rem] text-night-ink-2">
            Coaches and academies run their sessions, check-ins, and progress here. Students and
            parents see their own schedule and progress once their academy links them.
          </p>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-[2rem] leading-tight font-light tracking-[-0.02em]">
            {firstName ? `Welcome, ${firstName}` : "Welcome to CoachMan"}
          </h1>
          <p className="mt-2 text-ink-2">
            {account ? (
              <>
                You're signed in as{" "}
                <span className="font-medium text-ink">{account.user.email}</span>. How will you use
                CoachMan?
              </>
            ) : (
              "How will you use CoachMan?"
            )}
          </p>
        </div>

        <ul className="flex flex-col gap-2.5">
          <li>
            <button
              type="button"
              disabled={setUp.isPending}
              onClick={() => setUp.mutate()}
              className="flex w-full cursor-pointer items-center gap-4 rounded-[22px] bg-panel px-4 py-4 text-left outline-none transition-colors hover:bg-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-wait disabled:opacity-70"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-lime text-ink">
                <Building2 aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[1rem] font-medium">
                  Set up CoachMan for my coaching or academy
                </span>
                <span className="block text-[0.875rem] text-ink-2">
                  {setUp.isPending
                    ? "Setting up your workspace…"
                    : "Name it, pick your currency and time zone, then invite your coaches."}
                </span>
              </span>
              <ArrowRight aria-hidden className="size-5 shrink-0 text-ink-2" />
            </button>
          </li>
          <li>
            <button
              type="button"
              aria-expanded={familyOpen}
              aria-controls="welcome-family"
              onClick={() => setFamilyOpen((v) => !v)}
              className="flex w-full cursor-pointer items-center gap-4 rounded-[22px] bg-panel px-4 py-4 text-left outline-none transition-colors hover:bg-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-card text-ink ring-1 ring-line-strong">
                <Users aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[1rem] font-medium">I'm a student or a parent</span>
                <span className="block text-[0.875rem] text-ink-2">
                  See your sessions and progress at your academy
                </span>
              </span>
              <ChevronDown
                aria-hidden
                className={`size-5 shrink-0 text-ink-2 transition-transform duration-200 ${familyOpen ? "rotate-180" : ""}`}
              />
            </button>
            {familyOpen ? (
              <div
                id="welcome-family"
                className="mt-2.5 flex flex-col gap-2 rounded-[22px] bg-panel px-5 py-4 text-[0.9375rem]"
              >
                <p>Your academy links your account to the right player. To get started:</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
                  <li>
                    Open the invite link your academy sent you, by email, on Messenger, Viber, or by
                    text.
                  </li>
                  <li>Or enroll from your academy's CoachMan page.</li>
                </ul>
                <p className="text-ink-2">
                  If you signed in with a different account than the one they invited, sign out and
                  use that one.
                </p>
              </div>
            ) : null}
          </li>
        </ul>

        {setUp.error ? <InlineError>{errorMessage(setUp.error)}</InlineError> : null}

        <div className="border-t border-line pt-4">
          <SignOutButton variant="ghost" />
        </div>
      </div>
    </AuthLayout>
  );
}
