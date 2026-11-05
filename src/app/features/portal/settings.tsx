import type { PortalTeenInviteCreatedDto } from "@shared/api-types";
import { familyInviteMessage } from "@shared/family";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Share, Smartphone, Trash2, UserRoundPlus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { GoogleG } from "../../components/auth-layout";
import { InviteLinkPanel } from "../../components/domain/invite-link";
import { Button, IconButton } from "../../components/ui/button";
import { Card, Pill } from "../../components/ui/display";
import { ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { errorMessage, portalApi } from "../../lib/api";
import {
  authClient,
  defaultPasskeyName,
  linkGoogle,
  passkeysSupported,
  refreshSession,
} from "../../lib/auth-client";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { useInstallPrompt } from "../../lib/pwa";
import { keys } from "../../lib/query";
import { SignOutButton } from "../settings/sign-out";
import { PortalCard } from "./bits";
import {
  type FamilyStudent,
  familyStudents,
  useAcademyFormat,
  usePortalAccount,
  usePortalStudent,
} from "./queries";
import { PortalPage } from "./shell";

/** What Google (or our own checks) said when linking didn't work, in plain words. */
export function googleLinkError(code: string, description?: string): string {
  switch (code) {
    case "google_email_taken":
    case "google_email_unverified":
    case "google_email_missing":
    case "google_link_not_allowed":
      return (
        description ||
        "That Google account couldn't be linked. Pick a different Google account and try again."
      );
    case "account_already_linked_to_different_user":
      return "That Google account already signs in to another CoachMan account. Pick a different Google account, or sign out and continue with Google to use that one.";
    case "access_denied":
      return "Linking Google was cancelled. Try again whenever you're ready.";
    default:
      return "Google didn't link. Try again, or pick a different Google account.";
  }
}

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt: Date | string;
}

function unwrap<T>(res: { data: T | null; error: { message?: string } | null }): T {
  if (res.error) throw new Error(res.error.message || "Something went wrong. Try again.");
  return res.data as T;
}

function SignIn({
  google,
  error,
  description,
}: {
  google?: string;
  error?: string;
  description?: string;
}) {
  const account = usePortalAccount();
  const me = account.data;
  const online = useOnline();
  const qc = useQueryClient();
  const supported = passkeysSupported();
  const [removing, setRemoving] = useState<PasskeyRow | null>(null);
  const [linkError, setLinkError] = useState<string | null>(
    error ? googleLinkError(error, description) : null,
  );
  const settled = useRef(false);

  // Back from Google: refresh the session's copy of the account (its email and name changed).
  useEffect(() => {
    if (google !== "linked" || settled.current) return;
    settled.current = true;
    void (async () => {
      await refreshSession();
      const fresh = await account.refetch();
      if (fresh.data && !fresh.data.emailIsPlaceholder) {
        notify({
          tone: "success",
          title: "Google linked",
          body: `You can sign in with Google (${fresh.data.user.email}) or your passkey.`,
        });
      } else {
        setLinkError(
          "Google didn't finish linking. Try again, or pick a different Google account.",
        );
      }
    })();
  }, [google, account]);

  const passkeys = useQuery({
    queryKey: ["passkeys"],
    queryFn: async () => unwrap<PasskeyRow[]>(await authClient.passkey.listUserPasskeys()) ?? [],
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["passkeys"] });
    void qc.invalidateQueries({ queryKey: keys.account });
  };
  const add = useMutation({
    meta: { silent: true },
    mutationFn: async () =>
      unwrap(await authClient.passkey.addPasskey({ name: defaultPasskeyName() })),
    onSuccess: () => {
      refresh();
      notify({ tone: "success", title: "Passkey added", body: "This device signs you in now." });
    },
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: async (p: PasskeyRow) =>
      unwrap(await authClient.passkey.deletePasskey({ id: p.id })),
    onSuccess: () => {
      refresh();
      setRemoving(null);
      notify({ tone: "success", title: "Passkey removed" });
    },
  });
  const link = useMutation({
    meta: { silent: true },
    mutationFn: () => linkGoogle("/my/settings"),
    onError: (err) => setLinkError(errorMessage(err)),
  });

  const placeholder = Boolean(me?.emailIsPlaceholder);
  const count = passkeys.data?.length ?? me?.passkeyCount ?? 0;
  const onlyWayIn = placeholder && !me?.hasGoogle && count <= 1;

  return (
    <PortalCard title="Signing in">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3 rounded-[22px] bg-panel p-4">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-card"
          >
            <GoogleG />
          </span>
          <div className="min-w-[12rem] flex-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Google</span>
              {placeholder ? (
                <Pill tone="outline">Not linked</Pill>
              ) : me?.hasGoogle ? (
                <Pill tone="mint">Linked</Pill>
              ) : null}
            </p>
            <p className="mt-0.5 text-[0.875rem] break-all text-ink-2">
              {placeholder
                ? "Link a Google account to sign in with it too. Its email address becomes your account's address."
                : me?.user.email}
            </p>
          </div>
          {placeholder ? (
            <Button
              variant="dark"
              size="sm"
              icon={<Link2 aria-hidden className="size-4" />}
              isDisabled={!online}
              isPending={link.isPending}
              onPress={() => {
                setLinkError(null);
                link.mutate();
              }}
            >
              Link Google
            </Button>
          ) : null}
        </div>
        {linkError ? <InlineError>{linkError}</InlineError> : null}

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[0.9375rem] font-medium">Passkeys</h3>
            <Button
              variant="light"
              size="sm"
              icon={<KeyRound aria-hidden className="size-4" />}
              isDisabled={!online || !supported}
              isPending={add.isPending}
              onPress={() => add.mutate()}
            >
              Add a passkey
            </Button>
          </div>
          <p className="mt-1 max-w-[60ch] text-[0.875rem] text-ink-2">
            Your fingerprint, face, or screen lock signs you in. Add one on each phone or computer
            you use.
          </p>
          {add.error ? (
            <div className="mt-3">
              <InlineError>
                {/cancel|not allowed|abort|timed out/i.test(errorMessage(add.error))
                  ? "The passkey wasn't saved. Try again when you're ready."
                  : errorMessage(add.error)}
              </InlineError>
            </div>
          ) : null}
          <div className="mt-3">
            {passkeys.isPending ? (
              <RowsSkeleton rows={1} />
            ) : passkeys.isError ? (
              <ErrorState
                title="Couldn't load passkeys"
                message={errorMessage(passkeys.error)}
                onRetry={() => void passkeys.refetch()}
              />
            ) : passkeys.data.length === 0 ? (
              <p className="rounded-[22px] border border-dashed border-line-strong px-4 py-4 text-[0.9375rem] text-ink-2">
                No passkeys yet. You're signing in with Google.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {passkeys.data.map((p) => {
                  const name = p.name?.trim() || "Passkey";
                  return (
                    <li key={p.id} className="flex items-center gap-3 py-3">
                      <span
                        aria-hidden
                        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lime text-ink"
                      >
                        <KeyRound className="size-5" />
                      </span>
                      <p className="min-w-0 flex-1 font-medium break-words">{name}</p>
                      <IconButton
                        label={`Remove ${name}`}
                        isDisabled={!online || onlyWayIn}
                        onPress={() => {
                          remove.reset();
                          setRemoving(p);
                        }}
                      >
                        <Trash2 aria-hidden className="size-4.5" />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {onlyWayIn ? (
            <p className="mt-2 text-[0.8125rem] text-ink-2">
              Your passkey is the only way into this account, so it can't be removed. Add another
              passkey or link Google first.
            </p>
          ) : null}
          {placeholder ? (
            <p className="mt-2 text-[0.8125rem] text-ink-2">
              Lost every passkey and no Google linked? Ask the academy for a new invite link: it
              sets up a fresh account.
            </p>
          ) : null}
        </div>
      </div>
      <ConfirmSheet
        isOpen={removing !== null}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
        title="Remove this passkey?"
        body={
          <div className="flex flex-col gap-3">
            <p>It stops signing you in right away. Your other ways of signing in keep working.</p>
            {remove.error ? <InlineError>{errorMessage(remove.error)}</InlineError> : null}
          </div>
        }
        confirmLabel="Remove passkey"
        isPending={remove.isPending}
        onConfirm={() => {
          if (removing && online) remove.mutate(removing);
        }}
      />
    </PortalCard>
  );
}

/** One teen's own login, as their parent manages it. */
function TeenRow({ student }: { student: FamilyStudent }) {
  const q = usePortalStudent(student.clientId);
  const online = useOnline();
  const qc = useQueryClient();
  const fmt = useAcademyFormat(q.data?.academy);
  const [created, setCreated] = useState<PortalTeenInviteCreatedDto | null>(null);
  const [revoking, setRevoking] = useState<{ accessId: string; name: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.portal.all });
  const path = `/students/${encodeURIComponent(student.clientId)}`;
  const create = useMutation({
    meta: { silent: true },
    mutationFn: () => portalApi.post<PortalTeenInviteCreatedDto>(`${path}/teen-invite`),
    onSuccess: (res) => {
      setCreated(res);
      refresh();
    },
  });
  const withdraw = useMutation({
    meta: { silent: true },
    mutationFn: (id: string) => portalApi.del(`${path}/teen-invites/${encodeURIComponent(id)}`),
    onSuccess: () => {
      refresh();
      notify({ tone: "neutral", title: "Link withdrawn", body: "It no longer works." });
    },
    onError: (err) =>
      notify({ tone: "danger", title: "Couldn't withdraw the link", body: errorMessage(err) }),
  });
  const revoke = useMutation({
    meta: { silent: true },
    mutationFn: (accessId: string) =>
      portalApi.del(`${path}/access/${encodeURIComponent(accessId)}`),
    onSuccess: () => {
      refresh();
      setRevoking(null);
      notify({
        tone: "neutral",
        title: "Login ended",
        body: `${student.firstName}'s own login no longer works.`,
      });
    },
  });
  const teen = q.data?.teenAccess;
  if (q.isPending) return <RowsSkeleton rows={1} />;
  if (!teen) return null;
  const name = student.firstName;
  let body: ReactNode;
  if (teen.logins.length) {
    body = (
      <ul className="flex flex-col gap-2">
        {teen.logins.map((l) => (
          <li key={l.accessId} className="flex flex-wrap items-center gap-3">
            <span className="min-w-[10rem] flex-1 text-[0.9375rem]">
              <span className="font-medium">{l.name}</span>
              <span className="num block text-[0.8125rem] text-ink-2">
                Own login since {fmt.date(fmt.dayOf(l.since))}
              </span>
            </span>
            <Button
              variant="light"
              size="sm"
              isDisabled={!online}
              aria-label={`End ${l.name}'s own login`}
              onPress={() => {
                revoke.reset();
                setRevoking({ accessId: l.accessId, name: l.name });
              }}
            >
              End login
            </Button>
          </li>
        ))}
      </ul>
    );
  } else if (teen.invites.length) {
    const inv = teen.invites[0];
    body = inv ? (
      <div className="flex flex-wrap items-center gap-3">
        <span className="num min-w-[10rem] flex-1 text-[0.875rem] text-ink-2">
          A login link is waiting for {name}, until {fmt.day(fmt.dayOf(inv.expiresAt))}.
        </span>
        <Button variant="light" size="sm" isDisabled={!online} onPress={() => create.mutate()}>
          New link
        </Button>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={!online}
          isPending={withdraw.isPending}
          onPress={() => withdraw.mutate(inv.id)}
        >
          Withdraw
        </Button>
      </div>
    ) : null;
  } else if (teen.eligible.ok) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-[10rem] flex-1 text-[0.875rem] text-ink-2">
          {name} can have their own login, linked to yours. They'd see their sessions, progress, and
          payments.
        </span>
        <Button
          variant="dark"
          size="sm"
          icon={<UserRoundPlus aria-hidden className="size-4" />}
          isDisabled={!online}
          isPending={create.isPending}
          onPress={() => create.mutate()}
        >
          Create {name}'s login link
        </Button>
      </div>
    );
  } else {
    body = <p className="text-[0.875rem] text-ink-2">{teen.eligible.message}</p>;
  }
  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <p className="font-medium">
        {student.firstName} {student.lastName}
      </p>
      {body}
      {create.error ? <InlineError>{errorMessage(create.error)}</InlineError> : null}
      <Sheet
        isOpen={created !== null}
        onOpenChange={(o) => {
          if (!o) setCreated(null);
        }}
        title={`${name}'s login link`}
        description={`Send it to ${name} on Messenger, Viber, or by text. They open it on their own phone.`}
        footer={
          <Button variant="dark" onPress={() => setCreated(null)}>
            Done
          </Button>
        }
      >
        {created ? (
          <InviteLinkPanel
            link={created.link}
            message={familyInviteMessage({
              academyName: q.data?.academy.name ?? "Your academy",
              firstName: name,
              relation: "self",
              link: created.link,
              expires: fmt.day(fmt.dayOf(created.invite.expiresAt)),
            })}
            shareTitle={`${name}'s CoachMan login`}
            footnote={`The link works once, until ${fmt.day(fmt.dayOf(created.invite.expiresAt))}. It's shown only now: if it gets lost, make a new one.`}
          />
        ) : null}
      </Sheet>
      <ConfirmSheet
        isOpen={revoking !== null}
        onOpenChange={(o) => {
          if (!o) setRevoking(null);
        }}
        title={`End ${revoking?.name ?? name}'s own login?`}
        body={
          <div className="flex flex-col gap-3">
            <p>
              They stop seeing their training on their own account right away. You keep yours, and
              you can make a new login link later.
            </p>
            {revoke.error ? <InlineError>{errorMessage(revoke.error)}</InlineError> : null}
          </div>
        }
        confirmLabel="End login"
        isPending={revoke.isPending}
        onConfirm={() => {
          if (revoking && online) revoke.mutate(revoking.accessId);
        }}
      />
    </li>
  );
}

function TeenLogins({ students }: { students: FamilyStudent[] }) {
  return (
    <PortalCard title="Your children's own logins">
      <p className="mb-4 max-w-[60ch] text-[0.875rem] text-ink-2">
        Teens aged 13 to 17 can have their own login while you're linked. You can end it at any
        time; children under 13 follow along on your account.
      </p>
      <ul className="flex flex-col divide-y divide-line">
        {students.map((s) => (
          <TeenRow key={s.clientId} student={s} />
        ))}
      </ul>
    </PortalCard>
  );
}

function Install() {
  const install = useInstallPrompt();
  return (
    <PortalCard title="Install the app">
      {install.installed ? (
        <p className="text-[0.9375rem] text-ink-2">
          You're using the installed app. It opens from your home screen like any other.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="max-w-[60ch] text-[0.9375rem] text-ink-2">
            Keep the academy one tap away: the app opens full screen, loads fast, and shows what you
            last opened even without signal.
          </p>
          {install.canPrompt ? (
            <Button
              variant="dark"
              className="self-start"
              icon={<Smartphone aria-hidden className="size-4.5" />}
              onPress={() => void install.prompt()}
            >
              Install app
            </Button>
          ) : install.ios ? (
            <p className="text-[0.9375rem]">
              In Safari, tap <Share aria-label="Share" className="inline size-4 align-[-2px]" />{" "}
              then “Add to Home Screen”.
            </p>
          ) : (
            <p className="text-[0.9375rem]">Use your browser's “Install app” menu option.</p>
          )}
        </div>
      )}
    </PortalCard>
  );
}

/** Settings: how you sign in, your teens' own logins, installing the app, and signing out. */
export function PortalSettings(props: { google?: string; error?: string; description?: string }) {
  const account = usePortalAccount().data;
  const guarded = familyStudents(account).filter((s) => s.relation === "guardian");
  return (
    <PortalPage title="Settings" subtitle={account ? account.user.name : undefined}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
        <div className="flex flex-col gap-5">
          <SignIn {...props} />
          {guarded.length ? <TeenLogins students={guarded} /> : null}
        </div>
        <div className="flex flex-col gap-5">
          <Install />
          <Card label="Sign out" className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-[0.9375rem] text-ink-2">
              Signing out clears what this device saved for offline use.
            </p>
            <SignOutButton />
          </Card>
        </div>
      </div>
    </PortalPage>
  );
}
