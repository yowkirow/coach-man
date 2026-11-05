import type {
  ClientDetailDto,
  FamilyAccessDto,
  FamilyInviteCreatedDto,
  FamilyInviteDto,
  FamilyLinkDto,
  FamilyRuleDto,
} from "@shared/api-types";
import { FAMILY_RELATION_LABELS, type FamilyRelation } from "@shared/domain";
import { endsTeenLogins, familyInviteMessage } from "@shared/family";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, UserPlus, Users } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { InviteLinkPanel } from "../../components/domain/invite-link";
import { Button } from "../../components/ui/button";
import { Avatar, Card, Pill } from "../../components/ui/display";
import { ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { api, errorMessage } from "../../lib/api";
import { useFormat } from "../../lib/format";
import { useMe } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineHint, SectionHead } from "./bits";

const RELATION_PILL: Record<FamilyRelation, "lavender" | "sky"> = {
  guardian: "lavender",
  self: "sky",
};

const INVITE_NAMES: Record<FamilyRelation, string> = {
  guardian: "Parent or guardian link",
  self: "Student's own login link",
};

function personOf(name: string) {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

function useFamilyAccess(clientId: string) {
  return useQuery({
    queryKey: keys.familyAccess(clientId),
    queryFn: () => api.get<FamilyAccessDto>(`/clients/${clientId}/family`),
  });
}

/**
 * Who follows this student in the family portal (owners and admins, `familyAccess`): linked
 * parents and the student's own login, waiting invite links, and the two invites, each explaining
 * why it isn't available when the age rules say no.
 */
export function FamilyAccessCard({ detail }: { detail: ClientDetailDto }) {
  const c = detail.client;
  const fmt = useFormat();
  const online = useOnline();
  const qc = useQueryClient();
  const access = useFamilyAccess(c.id);
  const [inviting, setInviting] = useState<FamilyRelation | null>(null);
  const [revoking, setRevoking] = useState<FamilyLinkDto | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.familyAccess(c.id) });

  const withdraw = useMutation({
    meta: { silent: true },
    mutationFn: (inv: FamilyInviteDto) => api.del(`/clients/${c.id}/family/invites/${inv.id}`),
    onSuccess: () => {
      refresh();
      notify({ tone: "neutral", title: "Invite withdrawn", body: "That link no longer works." });
    },
    onError: (err) =>
      notify({ tone: "danger", title: "Couldn't withdraw the invite", body: errorMessage(err) }),
  });
  const revoke = useMutation({
    meta: { silent: true },
    mutationFn: (link: FamilyLinkDto) => api.del(`/clients/${c.id}/family/access/${link.id}`),
    onSuccess: (_d, link) => {
      refresh();
      setRevoking(null);
      notify({
        tone: "neutral",
        title: "Access revoked",
        body: `${link.name} no longer sees ${c.firstName}'s training.`,
      });
    },
  });

  const data = access.data;
  const rules = data?.rules;
  const button = (relation: FamilyRelation, label: string, icon: ReactNode) => (
    <Button
      variant="light"
      size="sm"
      icon={icon}
      isDisabled={!online || !rules?.[relation].ok}
      onPress={() => setInviting(relation)}
    >
      {label}
    </Button>
  );
  const reasons = (["guardian", "self"] as const)
    .map((r) => ({ relation: r, rule: rules?.[r] }))
    .filter((x): x is { relation: FamilyRelation; rule: Extract<FamilyRuleDto, { ok: false }> } =>
      Boolean(x.rule && !x.rule.ok),
    );

  const guardians = data?.links.filter((l) => l.relation === "guardian") ?? [];
  const teenLogins = data?.links.filter((l) => l.relation === "self") ?? [];
  const endsTeen =
    revoking?.relation === "guardian" &&
    teenLogins.length > 0 &&
    endsTeenLogins({
      birthDate: c.birthDate,
      isJunior: c.isJunior,
      today: fmt.today(),
      guardiansLeft: guardians.filter((g) => g.id !== revoking.id).length,
    });

  return (
    <Card label="Family access">
      <SectionHead
        title="Family access"
        action={
          <>
            {button(
              "guardian",
              "Invite parent / guardian",
              <UserPlus aria-hidden className="size-4" />,
            )}
            {button(
              "self",
              "Invite student (own login)",
              <KeyRound aria-hidden className="size-4" />,
            )}
          </>
        }
      />
      <div className="flex flex-col gap-3 px-5 pb-4">
        {reasons.length ? (
          <ul className="flex flex-col gap-1 text-[0.8125rem] text-ink-2">
            {reasons.map(({ relation, rule }) => (
              <li key={relation}>
                <span className="font-medium text-ink">
                  {relation === "guardian" ? "Parent invite" : "Student login"}:
                </span>{" "}
                {rule.message}
              </li>
            ))}
          </ul>
        ) : null}
        {access.isPending ? (
          <RowsSkeleton rows={1} />
        ) : access.isError ? (
          <ErrorState
            title="Couldn't load family access"
            message={errorMessage(access.error)}
            onRetry={() => void access.refetch()}
          />
        ) : data && (data.links.length || data.invites.length) ? (
          <>
            {data.links.length ? (
              <ul className="flex flex-col divide-y divide-line" aria-label="Linked accounts">
                {data.links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                    <Avatar person={personOf(l.name)} size="md" src={null} />
                    <div className="min-w-[12rem] flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{l.name}</span>
                        <Pill tone={RELATION_PILL[l.relation]}>
                          {l.relation === "self" ? "Student" : FAMILY_RELATION_LABELS.guardian}
                        </Pill>
                      </p>
                      <p className="num text-[0.8125rem] break-all text-ink-2">
                        Since {fmt.date(fmt.dayOf(l.since))}
                        {" · "}
                        {l.signIn === "passkey" ? "Passkey only" : (l.email ?? "Google")}
                        {l.grantedBy ? ` · invited by ${l.grantedBy}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      isDisabled={!online}
                      aria-label={`Revoke access for ${l.name}`}
                      onPress={() => {
                        revoke.reset();
                        setRevoking(l);
                      }}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {data.invites.length ? (
              <ul
                className={`flex flex-col divide-y divide-line ${data.links.length ? "border-t border-line" : ""}`}
                aria-label="Waiting invites"
              >
                {data.invites.map((inv) => {
                  const expired = inv.status === "expired";
                  const when = fmt.day(fmt.dayOf(inv.expiresAt));
                  return (
                    <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span
                        aria-hidden
                        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-panel text-ink"
                      >
                        <Link2 className="size-5" />
                      </span>
                      <div className="min-w-[12rem] flex-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{INVITE_NAMES[inv.relation]}</span>
                          {expired ? <Pill tone="amber">Expired</Pill> : null}
                        </p>
                        <p className="num text-[0.8125rem] text-ink-2">
                          {expired ? `Expired ${when}` : `Waiting · works until ${when}`}
                          {inv.invitedBy ? ` · from ${inv.invitedBy}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="light"
                          size="sm"
                          isDisabled={!online || !rules?.[inv.relation].ok}
                          onPress={() => setInviting(inv.relation)}
                        >
                          New link
                        </Button>
                        {expired ? null : (
                          <Button
                            variant="ghost"
                            size="sm"
                            isDisabled={!online}
                            isPending={withdraw.isPending && withdraw.variables?.id === inv.id}
                            aria-label={`Withdraw the ${INVITE_NAMES[inv.relation].toLowerCase()}`}
                            onPress={() => withdraw.mutate(inv)}
                          >
                            Withdraw
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="flex items-start gap-3 rounded-[22px] bg-panel px-4 py-3.5 text-[0.9375rem] text-ink-2">
            <Users aria-hidden className="mt-0.5 size-4.5 shrink-0 text-ink" />
            <span>
              Nobody follows {c.firstName}'s training yet. Invite a parent
              {c.isJunior ? "" : " or the student"}: they see sessions, progress, comments you
              share, and payments in the family portal.
            </span>
          </p>
        )}
        <OfflineHint>You're offline. Reconnect to invite people or change access.</OfflineHint>
      </div>

      <FamilyInviteSheet
        relation={inviting}
        onClose={() => setInviting(null)}
        clientId={c.id}
        firstName={c.firstName}
        onCreated={refresh}
      />
      <ConfirmSheet
        isOpen={revoking !== null}
        onOpenChange={(o) => {
          if (!o) setRevoking(null);
        }}
        title={`Revoke ${revoking?.name ?? "their"} access?`}
        body={
          <div className="flex flex-col gap-3">
            <p>
              {revoking?.name} stops seeing {c.firstName}'s training right away. You can invite them
              again later.
            </p>
            {endsTeen ? (
              <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem] text-ink">
                {c.firstName}'s own login stops too: a teen's login needs a parent linked.
              </p>
            ) : null}
            {revoke.error ? <InlineError>{errorMessage(revoke.error)}</InlineError> : null}
          </div>
        }
        confirmLabel="Revoke access"
        isPending={revoke.isPending}
        onConfirm={() => {
          if (revoking && online) revoke.mutate(revoking);
        }}
      />
    </Card>
  );
}

/**
 * Makes a family invite link: single use, seven days, shown once (only its hash is stored), with
 * Copy, Share, and a message ready to paste. No email is sent.
 */
function FamilyInviteSheet({
  relation,
  onClose,
  clientId,
  firstName,
  onCreated,
}: {
  relation: FamilyRelation | null;
  onClose: () => void;
  clientId: string;
  firstName: string;
  onCreated: () => void;
}) {
  const fmt = useFormat();
  const me = useMe().data;
  const online = useOnline();
  const [shown, setShown] = useState<FamilyRelation>("guardian");
  const [created, setCreated] = useState<FamilyInviteCreatedDto | null>(null);
  const create = useMutation({
    meta: { silent: true },
    mutationFn: (r: FamilyRelation) =>
      api.post<FamilyInviteCreatedDto>(`/clients/${clientId}/family/invites`, { relation: r }),
    onSuccess: (res) => {
      setCreated(res);
      onCreated();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: start fresh each time it opens.
  useEffect(() => {
    if (!relation) return;
    setShown(relation);
    setCreated(null);
    create.reset();
  }, [relation]);

  const isOpen = relation !== null;
  const guardian = shown === "guardian";
  const expires = created ? fmt.day(fmt.dayOf(created.invite.expiresAt)) : "";
  const message = created
    ? familyInviteMessage({
        academyName: me?.workspace.name ?? "Your academy",
        firstName,
        relation: created.invite.relation,
        link: created.link,
        expires,
      })
    : "";

  if (created) {
    return (
      <Sheet
        isOpen={isOpen}
        onOpenChange={(o) => !o && onClose()}
        title="Invite link ready"
        description={
          guardian
            ? `Send it to ${firstName}'s parent or guardian on Messenger, Viber, or by text.`
            : `Send it to ${firstName} on Messenger, Viber, or by text.`
        }
        footer={
          <Button variant="dark" onPress={onClose}>
            Done
          </Button>
        }
      >
        <InviteLinkPanel
          link={created.link}
          message={message}
          shareTitle={`${me?.workspace.name ?? "Your academy"} on CoachMan`}
          footnote={`The link works once, until ${expires}, for whoever opens it first. It's shown only now: if it gets lost, make a new one and withdraw this one.`}
        />
      </Sheet>
    );
  }

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      title={guardian ? "Invite a parent or guardian" : `Invite ${firstName} to their own login`}
      description="You get a link to send on Messenger, Viber, or by text. It works once, for seven days."
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!online}
            isPending={create.isPending}
            onPress={() => create.mutate(shown)}
          >
            Create invite link
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-ink-2">
          {guardian
            ? `They sign in with Google or a passkey and follow ${firstName}'s sessions, progress, the comments coaches share, and payments.`
            : `${firstName} signs in with Google or a passkey and sees their own sessions, progress, the comments coaches share, and payments.`}
        </p>
        {create.error ? <InlineError>{errorMessage(create.error)}</InlineError> : null}
        <OfflineHint>You're offline. Reconnect to make an invite link.</OfflineHint>
      </div>
    </Sheet>
  );
}
