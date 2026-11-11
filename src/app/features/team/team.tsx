import type {
  StaffInviteCreatedDto,
  StaffInviteDto,
  TeamDto,
  TeamMemberDto,
} from "@shared/api-types";
import { inviteEmailNote } from "@shared/email";
import {
  isCoachingRole,
  STAFF_ROLE_DESCRIPTIONS,
  STAFF_ROLE_LABELS,
  STAFF_ROLE_NOUNS,
  STAFF_ROLES,
  type StaffRole,
} from "@shared/roles";
import { assignableRoles, checkRemoval, staffInviteMessage } from "@shared/team";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Ellipsis, Mail, MessageSquareText, Share2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Input, Label, TextField as RACTextField, Radio, RadioGroup } from "react-aria-components";
import { CoachAvatar } from "../../components/domain/coaches";
import { Button, IconButton } from "../../components/ui/button";
import { Card, KpiTile, Pill, type PillTone } from "../../components/ui/display";
import { EmptyState, InlineError } from "../../components/ui/feedback";
import { fieldClass, TextField } from "../../components/ui/field";
import { ActionMenu, ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { useCan, useMe } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { clearLocalData, useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { SectionHead } from "../clients/bits";
import { OfflineNote } from "../settings/offline";

const ROLE_TONES: Record<StaffRole, PillTone> = {
  owner: "lavender",
  admin: "sky",
  front_desk: "mint",
  coach: "panel",
};

/** The roles an invite can give: owners are made from inside the team. */
const INVITE_ROLES = ["coach", "front_desk", "admin"] as const satisfies readonly StaffRole[];

export function RolePill({ role }: { role: StaffRole }) {
  return <Pill tone={ROLE_TONES[role]}>{STAFF_ROLE_LABELS[role]}</Pill>;
}

/** After any team change: the team, the coach lists, the team page, and your own role. */
function useRefreshTeam() {
  const qc = useQueryClient();
  return (data?: TeamDto) => {
    if (data) qc.setQueryData(keys.team, data);
    void qc.invalidateQueries({ queryKey: keys.team });
    void qc.invalidateQueries({ queryKey: keys.coaches });
    void qc.invalidateQueries({ queryKey: keys.teamPage });
    void qc.invalidateQueries({ queryKey: keys.me });
  };
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify({
      tone: "success",
      title: `${what} copied`,
      body: "Paste it into Messenger, Viber, or a text.",
    });
  } catch {
    notify({
      tone: "danger",
      title: "Couldn't copy",
      body: "Select the text and copy it instead.",
    });
  }
}

/** Radio rows of roles, each with what it can do. */
function RoleOptions({
  label,
  roles,
  value,
  onChange,
}: {
  label: string;
  roles: readonly StaffRole[];
  value: StaffRole;
  onChange: (role: StaffRole) => void;
}) {
  return (
    <RadioGroup
      value={value}
      onChange={(v) => onChange(v as StaffRole)}
      className="flex flex-col gap-2"
    >
      <Label className="text-[0.8125rem] font-medium text-ink-2">{label}</Label>
      {roles.map((r) => (
        <Radio
          key={r}
          value={r}
          className="group flex cursor-pointer items-start gap-3 rounded-2xl bg-panel px-4 py-3 outline-none transition-colors data-[hovered]:bg-line data-[selected]:bg-card data-[selected]:ring-2 data-[selected]:ring-ink data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink"
        >
          <span
            aria-hidden
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink-2 group-data-[selected]:border-ink"
          >
            <span className="size-2.5 rounded-full bg-ink opacity-0 group-data-[selected]:opacity-100" />
          </span>
          <span className="min-w-0">
            <span className="block font-medium">{STAFF_ROLE_LABELS[r]}</span>
            <span className="block text-[0.8125rem] text-ink-2">{STAFF_ROLE_DESCRIPTIONS[r]}</span>
          </span>
        </Radio>
      ))}
    </RadioGroup>
  );
}

// ---------------------------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------------------------

export function MembersCard({
  team,
  onEditProfile,
}: {
  team: TeamDto;
  onEditProfile: (m: TeamMemberDto) => void;
}) {
  const fmt = useFormat();
  const me = useMe().data;
  const can = useCan();
  const online = useOnline();
  const [roleFor, setRoleFor] = useState<TeamMemberDto | null>(null);
  const [removing, setRemoving] = useState<TeamMemberDto | null>(null);
  const [transferTo, setTransferTo] = useState<TeamMemberDto | null>(null);
  const ownerCount = team.members.filter((m) => m.role === "owner").length;
  const myRole = me?.role ?? "coach";

  return (
    <Card label="Members">
      <SectionHead title="Members" count={team.members.length} />
      <ul className="flex flex-col divide-y divide-line px-5 pb-2">
        {team.members.map((m) => {
          const self = m.userId === me?.user.id;
          const roles = assignableRoles(myRole, m.role, ownerCount);
          const removable = checkRemoval({ actorRole: myRole, targetRole: m.role, ownerCount }).ok;
          const actions = [
            ...(self || can.team
              ? [
                  {
                    id: "profile",
                    label: isCoachingRole(m.role) ? "Edit coach profile" : "Edit profile",
                    onAction: () => onEditProfile(m),
                  },
                ]
              : []),
            ...(roles.length > 1
              ? [{ id: "role", label: "Change role", onAction: () => setRoleFor(m) }]
              : []),
            ...(can.ownership && !self
              ? [{ id: "transfer", label: "Transfer ownership", onAction: () => setTransferTo(m) }]
              : []),
            ...(removable
              ? [
                  {
                    id: "remove",
                    label: self ? "Leave this academy" : "Remove from team",
                    tone: "danger" as const,
                    onAction: () => setRemoving(m),
                  },
                ]
              : []),
          ].map((a) => ({ ...a, isDisabled: !online && a.id !== "profile" }));
          const meta = [m.title, can.team || self ? m.email : null].filter(Boolean).join(" · ");
          return (
            <li key={m.userId} className="flex items-center gap-3 py-3.5">
              <CoachAvatar coach={m} size="md" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium break-words">{m.name}</span>
                  {self ? <Pill tone="outline">You</Pill> : null}
                  <span className="sm:hidden">
                    <RolePill role={m.role} />
                  </span>
                </p>
                {meta ? <p className="truncate text-[0.8125rem] text-ink-2">{meta}</p> : null}
                <p className="num text-[0.8125rem] text-ink-2">
                  Joined {fmt.date(fmt.dayOf(m.joinedAt))}
                  {isCoachingRole(m.role) ? ` · ${plural(m.students, "student")}` : ""}
                </p>
              </div>
              <span className="hidden sm:inline-flex">
                <RolePill role={m.role} />
              </span>
              {actions.length ? (
                <ActionMenu
                  label={`Options for ${m.name}`}
                  trigger={
                    <IconButton label={`Options for ${m.name}`}>
                      <Ellipsis aria-hidden className="size-5" />
                    </IconButton>
                  }
                  actions={actions}
                />
              ) : (
                <span aria-hidden className="size-11 shrink-0" />
              )}
            </li>
          );
        })}
      </ul>
      <RoleSheet member={roleFor} ownerCount={ownerCount} onClose={() => setRoleFor(null)} />
      <RemoveSheet member={removing} onClose={() => setRemoving(null)} />
      <TransferSheet member={transferTo} onClose={() => setTransferTo(null)} />
    </Card>
  );
}

function RoleSheet({
  member,
  ownerCount,
  onClose,
}: {
  member: TeamMemberDto | null;
  ownerCount: number;
  onClose: () => void;
}) {
  const me = useMe().data;
  const online = useOnline();
  const refresh = useRefreshTeam();
  const [shown, setShown] = useState<TeamMemberDto | null>(member);
  const current = member ?? shown;
  const [role, setRole] = useState<StaffRole>("coach");
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (v: { userId: string; role: StaffRole }) =>
      api.patch<TeamDto>(`/team/members/${v.userId}`, { role: v.role }),
    onSuccess: (data, v) => {
      refresh(data);
      notify({
        tone: "success",
        title: `${current?.name ?? "Role"} is now ${STAFF_ROLE_NOUNS[v.role]}`,
      });
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed when another member opens.
  useEffect(() => {
    if (!member) return;
    setShown(member);
    setRole(member.role);
    save.reset();
  }, [member?.userId]);
  const roles = current ? assignableRoles(me?.role ?? "coach", current.role, ownerCount) : [];
  const lastOwner = current?.role === "owner" && ownerCount <= 1;
  const stopsCoaching = current ? isCoachingRole(current.role) && !isCoachingRole(role) : false;
  return (
    <Sheet
      isOpen={member !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Change role"
      description={current ? `${current.name} is ${STAFF_ROLE_NOUNS[current.role]}.` : undefined}
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!online || !current || role === current.role}
            isPending={save.isPending}
            onPress={() => current && save.mutate({ userId: current.userId, role })}
          >
            Save role
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RoleOptions label="Role" roles={roles} value={role} onChange={setRole} />
        {lastOwner ? (
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem]">
            Every academy needs an owner. Make someone else an owner first, or transfer ownership.
          </p>
        ) : null}
        {stopsCoaching ? (
          <p role="status" className="rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem]">
            {current?.name} stops coaching: their students and upcoming sessions lose them as coach.
          </p>
        ) : null}
        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <OfflineNote />
      </div>
    </Sheet>
  );
}

function RemoveSheet({ member, onClose }: { member: TeamMemberDto | null; onClose: () => void }) {
  const me = useMe().data;
  const online = useOnline();
  const refresh = useRefreshTeam();
  const [shown, setShown] = useState<TeamMemberDto | null>(member);
  const current = member ?? shown;
  const self = current?.userId === me?.user.id;
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (userId: string) => api.del(`/team/members/${userId}`),
    onSuccess: async () => {
      if (self) {
        // You're no longer on this academy's team: start over wherever you still belong.
        await clearLocalData();
        window.location.assign("/");
        return;
      }
      refresh();
      notify({ tone: "neutral", title: `${current?.name ?? "They"} removed from the team` });
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear old errors when another member opens.
  useEffect(() => {
    if (!member) return;
    setShown(member);
    remove.reset();
  }, [member?.userId]);
  return (
    <ConfirmSheet
      isOpen={member !== null}
      onOpenChange={(o) => !o && onClose()}
      title={
        self ? `Leave ${me?.workspace.name ?? "this academy"}?` : `Remove ${current?.name ?? ""}?`
      }
      confirmLabel={self ? "Leave academy" : "Remove from team"}
      isPending={remove.isPending}
      onConfirm={() => current && online && remove.mutate(current.userId)}
      body={
        <div className="flex flex-col gap-3">
          <p>
            {self
              ? "You lose access to this academy right away. Someone who manages the team can invite you back."
              : `${current?.name ?? "They"} lose access right away.`}{" "}
            Notes and past sessions keep their names. Students they coach lose them as coach, and
            sessions they lead lose their lead coach, so reminders go to owners, admins, and front
            desk staff until someone else takes over.
          </p>
          {remove.error ? <InlineError>{errorMessage(remove.error)}</InlineError> : null}
          <OfflineNote />
        </div>
      }
    />
  );
}

function TransferSheet({ member, onClose }: { member: TeamMemberDto | null; onClose: () => void }) {
  const me = useMe().data;
  const online = useOnline();
  const refresh = useRefreshTeam();
  const [shown, setShown] = useState<TeamMemberDto | null>(member);
  const current = member ?? shown;
  const transfer = useMutation({
    meta: { silent: true },
    mutationFn: (userId: string) => api.post<TeamDto>("/team/transfer-ownership", { userId }),
    onSuccess: (data) => {
      refresh(data);
      notify({ tone: "success", title: `${current?.name ?? "They"} now owns the academy` });
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear old errors when another member opens.
  useEffect(() => {
    if (!member) return;
    setShown(member);
    transfer.reset();
  }, [member?.userId]);
  return (
    <ConfirmSheet
      isOpen={member !== null}
      onOpenChange={(o) => !o && onClose()}
      tone="dark"
      title={`Make ${current?.name ?? "them"} the owner?`}
      confirmLabel="Transfer ownership"
      isPending={transfer.isPending}
      onConfirm={() => current && online && transfer.mutate(current.userId)}
      body={
        <div className="flex flex-col gap-3">
          <p>
            {current?.name ?? "They"} becomes the owner of {me?.workspace.name ?? "this academy"}.
            You become an admin: you keep running the academy, but only an owner can change owners
            or hand the academy on again.
          </p>
          {transfer.error ? <InlineError>{errorMessage(transfer.error)}</InlineError> : null}
          <OfflineNote />
        </div>
      }
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------------------------

export function InvitesCard({
  invites,
  onInvite,
}: {
  invites: StaffInviteDto[];
  onInvite: (again?: { email: string; role: StaffRole }) => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const refresh = useRefreshTeam();
  const withdraw = useMutation({
    meta: { silent: true },
    mutationFn: (invite: StaffInviteDto) => api.del(`/team/invites/${invite.id}`),
    onSuccess: (_d, invite) => {
      refresh();
      notify({
        tone: "neutral",
        title: "Invite withdrawn",
        body: `The link for ${invite.email} no longer works.`,
      });
    },
    onError: (err) =>
      notify({ tone: "danger", title: "Couldn't withdraw the invite", body: errorMessage(err) }),
  });
  return (
    <Card label="Invites">
      <SectionHead
        title="Invites"
        count={invites.length || undefined}
        action={
          invites.length ? (
            <Button
              variant="light"
              size="sm"
              icon={<UserPlus aria-hidden className="size-4" />}
              isDisabled={!online}
              onPress={() => onInvite()}
            >
              Invite someone
            </Button>
          ) : undefined
        }
      />
      {invites.length ? (
        <ul className="flex flex-col divide-y divide-line px-5 pb-2">
          {invites.map((inv) => {
            const expired = inv.status === "expired";
            const when = fmt.day(fmt.dayOf(inv.expiresAt));
            return (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3.5">
                <span
                  aria-hidden
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-panel text-ink"
                >
                  <Mail className="size-5" />
                </span>
                <div className="min-w-[12rem] flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-all">{inv.email}</span>
                    <RolePill role={inv.role} />
                    {expired ? <Pill tone="amber">Expired</Pill> : null}
                  </p>
                  <p className="num text-[0.8125rem] text-ink-2">
                    {expired ? `Expired ${when}` : `Waiting · link works until ${when}`}
                    {inv.invitedBy ? ` · from ${inv.invitedBy}` : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="light"
                    size="sm"
                    isDisabled={!online}
                    onPress={() => onInvite({ email: inv.email, role: inv.role })}
                  >
                    {expired ? "Send again" : "New link"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    isDisabled={!online}
                    isPending={withdraw.isPending && withdraw.variables?.id === inv.id}
                    onPress={() => withdraw.mutate(inv)}
                    aria-label={`Withdraw the invite for ${inv.email}`}
                  >
                    Withdraw
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-5 pb-3">
          <EmptyState
            icon={<UserPlus aria-hidden className="size-5" />}
            title="No invites waiting"
            body="Invite a coach, an admin, or front desk staff. We email them a link, and you can share it on Messenger, Viber, or by text. They sign in as the address you invite, with Google or a code we email them."
            action={
              <Button variant="dark" isDisabled={!online} onPress={() => onInvite()}>
                Invite someone
              </Button>
            }
          />
        </div>
      )}
    </Card>
  );
}

/**
 * Invite a coach, front desk staff, or an admin: an email and a role make a single-use link. The
 * server emails it to them; it's also shown once here (only its hash is stored), with Copy, Share,
 * and a message ready to paste.
 */
export function InviteSheet({
  isOpen,
  onOpenChange,
  initial,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: { email: string; role: StaffRole } | null;
}) {
  const fmt = useFormat();
  const me = useMe().data;
  const online = useOnline();
  const refresh = useRefreshTeam();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("coach");
  const [created, setCreated] = useState<StaffInviteCreatedDto | null>(null);
  const create = useMutation({
    meta: { silent: true },
    mutationFn: (body: { email: string; role: StaffRole }) =>
      api.post<StaffInviteCreatedDto>("/team/invites", body),
    onSuccess: (res) => {
      setCreated(res);
      refresh();
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: start fresh each time it opens.
  useEffect(() => {
    if (!isOpen) return;
    setEmail(initial?.email ?? "");
    setRole(INVITE_ROLES.find((r) => r === initial?.role) ?? "coach");
    setCreated(null);
    create.reset();
  }, [isOpen]);

  const submit = () => {
    if (!email.trim()) return;
    create.mutate({ email: email.trim().toLowerCase(), role });
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const message = created
    ? staffInviteMessage({
        academyName: me?.workspace.name ?? "our academy",
        role: created.invite.role,
        email: created.invite.email,
        link: created.link,
        expires: fmt.day(fmt.dayOf(created.invite.expiresAt)),
      })
    : "";

  if (created) {
    return (
      <Sheet
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Invite link ready"
        description={
          inviteEmailNote(created) ??
          `Send it to ${created.invite.email} on Messenger, Viber, or by text.`
        }
        footer={
          <>
            <Button variant="ghost" className="mr-auto" onPress={() => setCreated(null)}>
              Invite someone else
            </Button>
            <Button variant="dark" onPress={() => onOpenChange(false)}>
              Done
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <RACTextField value={created.link} isReadOnly className="flex flex-col gap-1.5">
            <Label className="text-[0.8125rem] font-medium text-ink-2">Invite link</Label>
            <Input className={`${fieldClass} text-[0.875rem]`} onFocus={(e) => e.target.select()} />
          </RACTextField>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="dark"
              icon={<Copy aria-hidden className="size-4.5" />}
              onPress={() => void copyText(created.link, "Link")}
            >
              Copy link
            </Button>
            {canShare ? (
              <Button
                variant="light"
                icon={<Share2 aria-hidden className="size-4.5" />}
                onPress={() =>
                  void navigator
                    .share({
                      title: `Join ${me?.workspace.name ?? "us"} on CoachMan`,
                      text: message,
                    })
                    .catch(() => undefined)
                }
              >
                Share
              </Button>
            ) : null}
          </div>
          <section aria-labelledby="invite-message" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 id="invite-message" className="text-[0.9375rem] font-medium">
                Message to send
              </h3>
              <Button
                variant="light"
                size="sm"
                icon={<MessageSquareText aria-hidden className="size-4" />}
                onPress={() => void copyText(message, "Message")}
              >
                Copy message
              </Button>
            </div>
            <p className="rounded-[22px] bg-panel px-4 py-3 text-[0.9375rem] break-words whitespace-pre-line">
              {message}
            </p>
          </section>
          <p className="text-[0.8125rem] text-ink-2">
            The link works once, for {created.invite.email}, until{" "}
            {fmt.day(fmt.dayOf(created.invite.expiresAt))}. It's shown only now. If it gets lost,
            make a new one: the old link stops working.
          </p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Invite someone"
      description="They sign in as this address, with Google or a code we email them. We email them the link, and you can share it too."
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!online || !email.trim()}
            isPending={create.isPending}
            onPress={submit}
          >
            Create invite link
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (online) submit();
        }}
      >
        <TextField
          label="Their email"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoFocus
          value={email}
          onChange={setEmail}
          placeholder="name@gmail.com"
          error={fieldErrors(create.error).email}
        />
        <RoleOptions label="Role" roles={INVITE_ROLES} value={role} onChange={setRole} />
        {create.error && !fieldErrors(create.error).email ? (
          <InlineError>{errorMessage(create.error)}</InlineError>
        ) : null}
        <OfflineNote />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Command panel
// ---------------------------------------------------------------------------------------------

export function TeamPanel({ team }: { team?: TeamDto }) {
  const me = useMe().data;
  const can = useCan();
  const dash = "–";
  const members = team?.members ?? [];
  const mine = members.find((m) => m.userId === me?.user.id);
  return (
    <div className="flex flex-col gap-5">
      <div className="px-1">
        <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">Team</h2>
        <p className="mt-1 truncate text-[0.875rem] text-night-ink-2">
          {me?.workspace.name ?? "Your academy"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <KpiTile
          label="Coaches"
          value={team ? members.filter((m) => m.role === "coach").length : dash}
          tint="lime"
        />
        <KpiTile
          label="Other staff"
          value={team ? members.filter((m) => m.role !== "coach").length : dash}
          tint="violet"
        />
        {can.team ? (
          <KpiTile
            label="Invites waiting"
            value={team ? team.invites.filter((i) => i.status === "valid").length : dash}
            tint="amber"
          />
        ) : null}
        {me && isCoachingRole(me.role) ? (
          <KpiTile label="Your students" value={mine ? mine.students : dash} tint="sky" />
        ) : null}
      </div>
      <section aria-labelledby="team-roles" className="flex flex-col gap-2.5">
        <h3 id="team-roles" className="px-1 pt-1 text-[1.125rem] font-light">
          What each role can do
        </h3>
        {STAFF_ROLES.map((r) => (
          <div key={r} className="rounded-[24px] bg-night-2 p-4">
            <p className="text-[1rem]">{STAFF_ROLE_LABELS[r]}</p>
            <p className="mt-1 text-[0.8125rem] text-night-ink-2">{STAFF_ROLE_DESCRIPTIONS[r]}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
