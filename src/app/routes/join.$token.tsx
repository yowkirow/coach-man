import type { AccountDto, InviteAcceptedDto, InvitePreviewDto } from "@shared/api-types";
import { FAMILY_RELATION_LABELS } from "@shared/domain";
import { STAFF_ROLE_LABELS } from "@shared/roles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AuthLayout, GoogleG } from "../components/auth-layout";
import { Button, buttonClass } from "../components/ui/button";
import { InlineError, Skeleton } from "../components/ui/feedback";
import { ROLE_DESCRIPTIONS } from "../features/team/team";
import {
  ApiRequestError,
  accountApi,
  errorHint,
  errorMessage,
  inviteApi,
  publicFileUrl,
} from "../lib/api";
import { authClient, passkeysSupported, signInWithGoogle } from "../lib/auth-client";
import { initials, plural } from "../lib/format";
import { clearLocalData, usePendingChanges } from "../lib/offline";

export const Route = createFileRoute("/join/$token")({
  // Google sends people back here with ?error=… when sign-in didn't finish.
  validateSearch: (s: Record<string, unknown>): { error?: string } =>
    typeof s.error === "string" && s.error ? { error: s.error } : {},
  component: JoinPage,
});

function AcademyBadge({ name, logoKey }: { name: string; logoKey: string | null }) {
  const src = publicFileUrl(logoKey);
  const [first = "", second = ""] = name.trim().split(/\s+/);
  return (
    <div className="flex items-center gap-4">
      {src ? (
        <img src={src} alt="" className="size-16 shrink-0 rounded-[22px] bg-panel object-contain" />
      ) : (
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-[22px] bg-night text-[1.125rem] font-semibold text-night-ink"
        >
          {initials({ firstName: first, lastName: second })}
        </span>
      )}
      <p className="min-w-0 text-[1.375rem] leading-tight font-light tracking-[-0.01em] break-words">
        {name}
      </p>
    </div>
  );
}

function State({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[2rem] leading-tight font-light tracking-[-0.02em]">{title}</h1>
      {children ? <div className="flex flex-col gap-3 text-ink-2">{children}</div> : null}
      {actions ? <div className="mt-2 flex flex-col gap-3">{actions}</div> : null}
    </div>
  );
}

/** What the invite makes you: "a coach", "an admin", "Mia's parent or guardian". */
function inviteRole(p: InvitePreviewDto): string {
  if (p.kind === "staff" && p.role) {
    const label = STAFF_ROLE_LABELS[p.role].toLowerCase();
    return `${/^[aeiou]/.test(label) ? "an" : "a"} ${label}`;
  }
  if (p.relation === "guardian") {
    return `${p.student?.firstName ? `${p.student.firstName}'s ` : "a student's "}${FAMILY_RELATION_LABELS.guardian.toLowerCase()}`;
  }
  return "a student";
}

/**
 * Invite acceptance (/join/<token>): who invited you and as what, then sign in with the invited
 * Google account (or a passkey) and join. Works signed out; Google brings you back here.
 */
function JoinPage() {
  const { token } = Route.useParams();
  const { error: googleError } = Route.useSearch();
  const pending = usePendingChanges();
  const [signingIn, setSigningIn] = useState<null | "google" | "passkey" | "out">(null);
  const [signInError, setSignInError] = useState<string | null>(
    googleError
      ? /access_denied|cancel/i.test(googleError)
        ? "Google sign-in was cancelled. Try again whenever you're ready."
        : "Google sign-in didn't finish. Try again, or use a passkey if you've added one."
      : null,
  );

  const preview = useQuery({
    queryKey: ["invite", token],
    queryFn: () => inviteApi.preview<InvitePreviewDto>(token),
    retry: false,
    staleTime: 0,
  });
  const account = useQuery({
    queryKey: ["invite-account", token],
    queryFn: async () => {
      try {
        return await accountApi.get<AccountDto>();
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 0,
  });
  const accept = useMutation({
    meta: { silent: true },
    mutationFn: () => inviteApi.accept<InviteAcceptedDto>(token),
    onSuccess: async (res) => {
      // A different academy's (or nobody's) data may be cached here: start clean.
      await clearLocalData();
      window.location.assign(res.kind === "family" ? "/my" : "/");
    },
    // Used, withdrawn, or expired since the page opened: show that state instead.
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 410) void preview.refetch();
    },
  });
  // Already on the team (the link was used): open that academy instead.
  const openAcademy = useMutation({
    meta: { silent: true },
    mutationFn: async (workspaceId: string) => {
      await accountApi.post("/active-workspace", { workspaceId });
      await clearLocalData();
    },
    onSuccess: () => window.location.assign("/"),
  });

  const refresh = async () => {
    await Promise.all([account.refetch(), preview.refetch()]);
  };
  const google = async () => {
    setSigningIn("google");
    setSignInError(null);
    try {
      await signInWithGoogle(`/join/${token}`, `/join/${token}`);
    } catch {
      setSigningIn(null);
      setSignInError("Couldn't reach Google. Check your connection and try again.");
    }
  };
  const passkey = async () => {
    setSigningIn("passkey");
    setSignInError(null);
    const res = await authClient.signIn.passkey();
    setSigningIn(null);
    if (res?.error) {
      setSignInError(
        /cancel|not allowed/i.test(res.error.message ?? "")
          ? "Passkey sign-in was cancelled."
          : "That passkey didn't work here. Continue with Google instead.",
      );
      return;
    }
    await refresh();
  };
  const switchAccount = async () => {
    setSigningIn("out");
    try {
      await authClient.signOut();
    } finally {
      await clearLocalData();
      window.location.assign(`/join/${token}`);
    }
  };

  const p = preview.data;
  const me = account.data;
  const academy = p?.academy.name ?? "your academy";

  let body: ReactNode;
  if (preview.isPending || account.isPending) {
    body = (
      <div className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">Loading the invite…</span>
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-13 w-full rounded-full" />
      </div>
    );
  } else if (!p) {
    const notFound = preview.error instanceof ApiRequestError && preview.error.status === 404;
    body = (
      <State
        title={notFound ? "This invite link doesn't work" : "Couldn't open this invite"}
        actions={
          notFound ? (
            <Link to="/" className={buttonClass("light", "lg")}>
              Go to CoachMan
            </Link>
          ) : (
            <Button variant="dark" size="lg" onPress={() => void preview.refetch()}>
              Try again
            </Button>
          )
        }
      >
        <p>
          {notFound
            ? "Check that you opened the whole link. If it still doesn't work, ask your academy for a new one."
            : errorMessage(preview.error)}
        </p>
      </State>
    );
  } else if (p.status !== "valid") {
    const copy = {
      expired: {
        title: "This invite has expired",
        text: `Invite links work for seven days. Ask ${academy} for a new one.`,
      },
      used: {
        title: "This invite has already been used",
        text: `Each link works once. If you already joined, open CoachMan. Otherwise ask ${academy} for a new link.`,
      },
      revoked: {
        title: "This invite was withdrawn",
        text: `${academy} withdrew this link. Ask them for a new one if you still need it.`,
      },
    }[p.status];
    const joined = p.alreadyMember && p.workspaceId ? p.workspaceId : null;
    body = (
      <State
        title={copy.title}
        actions={
          joined ? (
            <Button
              variant="dark"
              size="lg"
              isDisabled={pending > 0}
              isPending={openAcademy.isPending || openAcademy.isSuccess}
              onPress={() => openAcademy.mutate(joined)}
            >
              Open {academy}
            </Button>
          ) : (
            <Link to="/" className={buttonClass(p.status === "used" ? "dark" : "light", "lg")}>
              Open CoachMan
            </Link>
          )
        }
      >
        <p>
          {joined
            ? `You're already on the team at ${academy}, so you don't need this link.`
            : copy.text}
        </p>
        {joined && pending > 0 ? (
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem] text-ink">
            {plural(pending, "change")} from this device still need to sync. Reconnect and wait for
            them before you switch academies.
          </p>
        ) : null}
        {openAcademy.error ? <InlineError>{errorMessage(openAcademy.error)}</InlineError> : null}
      </State>
    );
  } else if (!me) {
    body = (
      <State
        title={`Join ${academy}`}
        actions={
          <>
            <Button
              variant="dark"
              size="lg"
              icon={<GoogleG />}
              isPending={signingIn === "google"}
              isDisabled={signingIn !== null && signingIn !== "google"}
              onPress={() => void google()}
            >
              Continue with Google
            </Button>
            {passkeysSupported() ? (
              <Button
                variant="light"
                size="lg"
                icon={<KeyRound aria-hidden className="size-5" />}
                isPending={signingIn === "passkey"}
                isDisabled={signingIn !== null && signingIn !== "passkey"}
                onPress={() => void passkey()}
              >
                Sign in with a passkey
              </Button>
            ) : null}
          </>
        }
      >
        <p>
          {academy} invited you to CoachMan as {inviteRole(p)}.
          {p.kind === "staff"
            ? " Sign in with the Google account the invite was sent to."
            : " Sign in to see their training."}
        </p>
        {p.kind === "staff" && p.role ? (
          <p className="text-[0.875rem]">{ROLE_DESCRIPTIONS[p.role]}</p>
        ) : null}
        {signInError ? <InlineError>{signInError}</InlineError> : null}
      </State>
    );
  } else if (p.forYou === false) {
    body = (
      <State
        title="This invite is for a different account"
        actions={
          <>
            <Button
              variant="dark"
              size="lg"
              isPending={signingIn === "out"}
              onPress={() => void switchAccount()}
            >
              Use another account
            </Button>
            {me.staff.length || me.family.length ? (
              <Link to="/" className={buttonClass("ghost", "lg")}>
                Back to CoachMan
              </Link>
            ) : null}
          </>
        }
      >
        <p>
          You're signed in as{" "}
          <span className="font-medium break-all text-ink">{me.user.email}</span>, but {academy}{" "}
          sent this invite to another email address. Sign out, then sign in with the Google account
          it was sent to.
        </p>
      </State>
    );
  } else {
    const blocked = pending > 0;
    body = (
      <State
        title={`Join ${academy}`}
        actions={
          <Button
            variant="dark"
            size="lg"
            isPending={accept.isPending || accept.isSuccess}
            isDisabled={blocked}
            onPress={() => accept.mutate()}
          >
            Join {academy}
          </Button>
        }
      >
        <p>
          You're signed in as{" "}
          <span className="font-medium break-all text-ink">{me.user.email}</span>. You'll join as{" "}
          {inviteRole(p)}.
        </p>
        {p.kind === "staff" && p.role ? (
          <p className="text-[0.875rem]">{ROLE_DESCRIPTIONS[p.role]}</p>
        ) : null}
        {blocked ? (
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem] text-ink">
            {plural(pending, "change")} from this device still need to sync. Reconnect and wait for
            them before joining.
          </p>
        ) : null}
        {accept.error ? (
          <InlineError>
            {errorMessage(accept.error)}
            {errorHint(accept.error) ? ` It was sent to ${errorHint(accept.error)}.` : ""}
          </InlineError>
        ) : null}
        {accept.error instanceof ApiRequestError && accept.error.code === "wrong_email" ? (
          <Button variant="light" size="lg" onPress={() => void switchAccount()}>
            Use another account
          </Button>
        ) : null}
      </State>
    );
  }

  return (
    <AuthLayout
      panel={
        <div className="mt-10 flex flex-1 flex-col lg:justify-end">
          <p className="max-w-[16ch] text-[2.5rem] leading-[1.04] font-light tracking-[-0.025em] lg:text-[3.5rem]">
            Your academy runs on CoachMan.
          </p>
          <p className="mt-4 max-w-[46ch] text-[0.9375rem] text-night-ink-2">
            Coaches check players in on court, even offline, and keep every player's progress in one
            place. The invite brings you into the academy that sent it.
          </p>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {p ? <AcademyBadge name={p.academy.name} logoKey={p.academy.logoKey} /> : null}
        {body}
      </div>
    </AuthLayout>
  );
}
