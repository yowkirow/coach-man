import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Mail, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Pill } from "../../components/ui/display";
import { ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { TextField } from "../../components/ui/field";
import { ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { errorMessage } from "../../lib/api";
import { authClient, defaultPasskeyName, passkeysSupported } from "../../lib/auth-client";
import { useFormat } from "../../lib/format";
import { useMe } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "./offline";
import { SettingsSection } from "./sections";

const PASSKEYS = ["passkeys"] as const;

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt: Date | string;
  backedUp?: boolean;
}

/** better-auth answers `{ data, error }`; this throws the error so queries and mutations see it. */
function unwrap<T>(res: { data: T | null; error: { message?: string } | null }): T {
  if (res.error) throw new Error(res.error.message || "Something went wrong. Try again.");
  return res.data as T;
}

function friendlyPasskeyError(err: unknown): string {
  const msg = errorMessage(err);
  return /cancel|not allowed|abort|timed out/i.test(msg)
    ? "Passkey setup was cancelled. Try again when you're ready."
    : msg;
}

export function SecuritySection() {
  const me = useMe().data;
  const fmt = useFormat();
  const online = useOnline();
  const qc = useQueryClient();
  const supported = passkeysSupported();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<PasskeyRow | null>(null);
  const [removingName, setRemovingName] = useState("");

  const passkeys = useQuery({
    queryKey: PASSKEYS,
    queryFn: async () => unwrap<PasskeyRow[]>(await authClient.passkey.listUserPasskeys()) ?? [],
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: PASSKEYS });
    void qc.invalidateQueries({ queryKey: keys.me });
  };

  const add = useMutation({
    meta: { silent: true },
    mutationFn: async () =>
      unwrap(await authClient.passkey.addPasskey({ name: defaultPasskeyName() })),
    onSuccess: () => {
      refresh();
      notify({ tone: "success", title: "Passkey added", body: "Next time, sign in with a tap." });
    },
  });
  const rename = useMutation({
    meta: { silent: true },
    mutationFn: async (v: { id: string; name: string }) =>
      unwrap(await authClient.passkey.updatePasskey({ id: v.id, name: v.name.trim() })),
    onSuccess: () => {
      refresh();
      notify({ tone: "success", title: "Passkey renamed" });
      setRenaming(null);
    },
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: async (p: PasskeyRow) =>
      unwrap(await authClient.passkey.deletePasskey({ id: p.id })),
    onSuccess: () => {
      refresh();
      notify({ tone: "success", title: "Passkey removed" });
      setRemoving(null);
    },
  });

  const added = (p: PasskeyRow) => {
    const d = new Date(p.createdAt);
    return Number.isNaN(d.getTime())
      ? null
      : new Intl.DateTimeFormat(fmt.locale, {
          day: "numeric",
          month: "short",
          year: "numeric",
        }).format(d);
  };

  return (
    <SettingsSection
      id="security"
      title="Sign-in & security"
      description="Google and passkeys both sign you in. Google sign-in always stays available, so removing passkeys never locks you out."
    >
      <div className="flex items-center gap-3 rounded-[22px] bg-panel p-4">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-ink"
        >
          <Mail className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Google</span>
            <Pill tone="mint">Always on</Pill>
          </p>
          <p className="mt-0.5 text-[0.875rem] break-all text-ink-2">{me?.user.email}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[1.0625rem] font-medium">Passkeys</h3>
        <Button
          variant="dark"
          icon={<KeyRound aria-hidden className="size-4.5" />}
          isDisabled={!online || !supported}
          isPending={add.isPending}
          onPress={() => add.mutate()}
        >
          Add a passkey
        </Button>
      </div>
      <p className="mt-1 max-w-[60ch] text-[0.875rem] text-ink-2">
        Sign in with your fingerprint, face, or screen lock. Add one on each device you coach from.
      </p>
      {!supported ? (
        <div className="mt-3">
          <InlineError>
            This browser can't create passkeys. Add one from your phone or another browser.
          </InlineError>
        </div>
      ) : null}
      {add.error ? (
        <div className="mt-3">
          <InlineError>{friendlyPasskeyError(add.error)}</InlineError>
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
              const name = p.name?.trim() || "Unnamed passkey";
              const when = added(p);
              return (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <span
                    aria-hidden
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lime text-ink"
                  >
                    <KeyRound className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{name}</p>
                    <p className="num text-[0.8125rem] text-ink-2">
                      {when ? `Added ${when}` : "Added"}
                      {p.backedUp ? " · Synced across devices" : ""}
                    </p>
                  </div>
                  <IconButton
                    label={`Rename ${name}`}
                    isDisabled={!online}
                    onPress={() => {
                      rename.reset();
                      setRenaming({ id: p.id, name: p.name ?? "" });
                    }}
                  >
                    <Pencil aria-hidden className="size-4.5" />
                  </IconButton>
                  <IconButton
                    label={`Remove ${name}`}
                    isDisabled={!online}
                    onPress={() => {
                      remove.reset();
                      setRemovingName(name);
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
      <div className="mt-3">
        <OfflineNote>You're offline. Reconnect to change how you sign in.</OfflineNote>
      </div>

      <Sheet
        isOpen={renaming !== null}
        onOpenChange={(o) => {
          if (!o) setRenaming(null);
        }}
        title="Rename passkey"
        description="Name it after the device it lives on, so you can tell them apart."
        footer={
          <>
            <Button variant="light" onPress={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="dark"
              isDisabled={!online || !renaming?.name.trim()}
              isPending={rename.isPending}
              onPress={() => renaming && rename.mutate(renaming)}
            >
              Save
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (online && renaming?.name.trim()) rename.mutate(renaming);
          }}
        >
          <TextField
            label="Name"
            value={renaming?.name ?? ""}
            onChange={(v) => setRenaming((r) => (r ? { ...r, name: v } : r))}
            placeholder="Work laptop"
            autoFocus
          />
          {rename.error ? <InlineError>{errorMessage(rename.error)}</InlineError> : null}
          <button type="submit" hidden />
        </form>
      </Sheet>

      <ConfirmSheet
        isOpen={removing !== null}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
        title={`Remove ${removingName}?`}
        body={
          <div className="flex flex-col gap-3">
            <p>
              It stops working right away. You can still sign in with Google
              {me?.user.email ? ` (${me.user.email})` : ""} and any other passkeys.
            </p>
            {remove.error ? <InlineError>{errorMessage(remove.error)}</InlineError> : null}
          </div>
        }
        confirmLabel="Remove passkey"
        isPending={remove.isPending}
        onConfirm={() => {
          if (removing && online) remove.mutate(removing);
        }}
      />
    </SettingsSection>
  );
}
