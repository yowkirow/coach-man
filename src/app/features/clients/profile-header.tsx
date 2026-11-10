import type { ClientDetailDto, ClientDto } from "@shared/api-types";
import type { ClientStatus } from "@shared/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Camera,
  CircleDollarSign,
  ClipboardCheck,
  Ellipsis,
  HeartPulse,
  NotebookPen,
  Ticket,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CoachAvatar } from "../../components/domain/coaches";
import { SyncStatus, useIsDesktop } from "../../components/layout/app-shell";
import { Button, IconButton } from "../../components/ui/button";
import { Avatar, Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { ActionMenu, ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { ApiRequestError, api, errorMessage, fieldErrors } from "../../lib/api";
import { fullName, useFormat } from "../../lib/format";
import { useCan, useWritesCoaching } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { FigureButton, OfflineHint } from "./bits";
import {
  type ClientErrors,
  ClientFields,
  type ClientFormValues,
  changedFields,
  clientToValues,
  focusFirstInvalid,
  toPayload,
  validateClient,
} from "./client-form";
import {
  ageText,
  creditState,
  isSample,
  SAMPLE_TAG,
  STATUS_LABELS,
  STATUS_TONES,
} from "./client-utils";
import { useRefreshClient, useStoreClient } from "./queries";

function useSetStatus(client: ClientDto) {
  const store = useStoreClient();
  const refresh = useRefreshClient();
  const m = useMutation({
    meta: { silent: true },
    mutationFn: (status: ClientStatus) => api.patch<ClientDto>(`/clients/${client.id}`, { status }),
    onSuccess: (dto) => {
      store(dto);
      refresh(dto.id, { skip: "progress" });
    },
  });
  return (status: ClientStatus, title: string, body?: string) => {
    const previous = client.status;
    m.mutate(status, {
      onSuccess: () =>
        notify({
          tone: "success",
          title,
          body,
          action: { label: "Undo", onAction: () => m.mutate(previous) },
        }),
      onError: (err) =>
        notify({ tone: "danger", title: "Couldn't change the status", body: errorMessage(err) }),
    });
  };
}

function tel(v: string) {
  return `tel:${v.replace(/[^\d+]/g, "")}`;
}

const metaLink =
  "rounded-sm underline decoration-line-strong underline-offset-4 outline-none hover:text-ink hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink";

export function ProfileHeader({
  detail,
  onPhoto,
  onSell,
  onPay,
  onNote,
  onAssess,
  onEdit,
  onDelete,
  onLedger,
  onMoney,
  onMedical,
}: {
  detail: ClientDetailDto;
  onPhoto: () => void;
  onSell: () => void;
  onPay: () => void;
  onNote: () => void;
  onAssess: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLedger: () => void;
  onMoney: () => void;
  onMedical: () => void;
}) {
  const fmt = useFormat();
  const can = useCan();
  const writes = useWritesCoaching();
  const online = useOnline();
  const desktop = useIsDesktop();
  const c = detail.client;
  const setStatus = useSetStatus(c);
  const credit = creditState(c);
  const age = ageText(c.birthDate, fmt.today());

  const meta: { key: string; node: ReactNode }[] = [];
  if (c.level) meta.push({ key: "level", node: `Level ${c.level}` });
  if (c.duprRating !== null) meta.push({ key: "dupr", node: `DUPR ${c.duprRating.toFixed(2)}` });
  if (c.isJunior)
    meta.push({ key: "junior", node: age ? `Junior, ${age.toLowerCase()}` : "Junior" });
  else if (age) meta.push({ key: "age", node: age });
  const primary = detail.coaches?.primary?.coach;
  if (primary) {
    meta.push({
      key: "coach",
      node: (
        <span className="inline-flex items-center gap-1.5">
          <CoachAvatar coach={primary} size="xs" />
          Coach {primary.name}
        </span>
      ),
    });
  }
  const contacts: { key: string; node: ReactNode }[] = [];
  if (c.phone)
    contacts.push({
      key: "phone",
      node: (
        <a href={tel(c.phone)} className={metaLink}>
          {c.phone}
        </a>
      ),
    });
  if (c.email)
    contacts.push({
      key: "email",
      node: (
        <a href={`mailto:${c.email}`} className={`${metaLink} break-all`}>
          {c.email}
        </a>
      ),
    });

  const statusActions =
    c.status === "archived"
      ? [
          {
            id: "restore",
            label: "Restore from archive",
            onAction: () => setStatus("active", `${c.firstName} restored`),
          },
        ]
      : [
          c.status === "paused"
            ? {
                id: "activate",
                label: "Activate",
                onAction: () => setStatus("active", `${c.firstName} is active again`),
              }
            : c.status === "lead"
              ? {
                  id: "activate",
                  label: "Mark as active client",
                  onAction: () => setStatus("active", `${c.firstName} is now a client`),
                }
              : {
                  id: "pause",
                  label: "Pause",
                  onAction: () =>
                    setStatus(
                      "paused",
                      `${c.firstName} paused`,
                      "Stays on rosters and packages; marked as on a break.",
                    ),
                },
          {
            id: "archive",
            label: "Archive",
            onAction: () =>
              setStatus(
                "archived",
                `${c.firstName} archived`,
                "Hidden from lists and pickers. History stays.",
              ),
          },
        ];

  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between lg:gap-x-8">
      <div className="flex min-w-0 items-center gap-4 lg:flex-1 lg:basis-[26rem] lg:gap-6">
        <button
          type="button"
          onClick={onPhoto}
          aria-label={c.photoKey ? "Change photo" : "Add a photo"}
          className="group relative shrink-0 cursor-pointer rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <Avatar person={c} size={desktop ? "xl" : "lg"} />
          <span
            aria-hidden
            className="absolute -right-1.5 -bottom-1 flex size-7 items-center justify-center rounded-full bg-card text-ink ring-[3px] ring-canvas transition-colors group-hover:bg-lime lg:right-0.5 lg:bottom-0.5 lg:size-10 lg:ring-4"
          >
            <Camera className="size-3.5 lg:size-4.5" />
          </span>
        </button>
        <div className="min-w-0">
          <h1 className="text-[2rem] leading-[1.05] font-light tracking-[-0.02em] break-words lg:text-[2.75rem]">
            {fullName(c)}
          </h1>
          {meta.length ? (
            <p className="num mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.9375rem] text-ink-2">
              {meta.map((m, i) => (
                // The coach (with an avatar) takes its own line on phones, so no line starts with "·".
                <span
                  key={m.key}
                  className={`inline-flex items-center gap-2 ${m.key === "coach" && i ? "max-lg:basis-full" : ""}`}
                >
                  {i ? (
                    <span aria-hidden className={m.key === "coach" ? "max-lg:hidden" : ""}>
                      ·
                    </span>
                  ) : null}
                  {m.node}
                </span>
              ))}
            </p>
          ) : null}
          {contacts.length ? (
            <p className="num mt-1 flex flex-wrap items-center gap-x-5 gap-y-0.5 text-[0.9375rem] text-ink-2">
              {contacts.map((m) => (
                <span key={m.key} className="min-w-0">
                  {m.node}
                </span>
              ))}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Pill tone={STATUS_TONES[c.status]}>{STATUS_LABELS[c.status]}</Pill>
            {detail.groups.map((g) => (
              <Pill key={g.id} tone="violet">
                {g.name}
              </Pill>
            ))}
            {c.tags.map((t) => (
              <Pill key={t} tone="outline">
                {t === SAMPLE_TAG ? "Sample" : t}
              </Pill>
            ))}
            {c.medicalNotes ? (
              <button
                type="button"
                onClick={onMedical}
                className="relative inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-coral-soft px-2.5 text-[0.75rem] font-medium text-[#7a1212] outline-none before:absolute before:-inset-y-2.5 before:inset-x-0 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <HeartPulse aria-hidden className="size-3.5" />
                Medical note
              </button>
            ) : null}
          </div>
          {isSample(c) ? (
            <p className="mt-2 text-[0.8125rem] text-ink-2">Sample client: synthetic demo data.</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:items-end">
        <div className="flex flex-wrap items-center gap-2">
          <SyncStatus />
          <FigureButton
            tone={
              credit.tone === "none"
                ? "white"
                : credit.tone === "ok"
                  ? "sky"
                  : credit.tone === "low"
                    ? "amber"
                    : "coral"
            }
            onPress={onLedger}
            label={`${credit.label}. Open credit history`}
          >
            <Ticket aria-hidden className="size-4.5" />
            {credit.tone === "none" ? "No package" : credit.label}
          </FigureButton>
          {can.money && c.balanceMinor !== 0 ? (
            <FigureButton
              tone={c.balanceMinor > 0 ? "coral" : "mint"}
              onPress={onMoney}
              label={
                c.balanceMinor > 0
                  ? `Owes ${fmt.money(c.balanceMinor)}. Open statement`
                  : `${fmt.money(-c.balanceMinor)} in credit. Open statement`
              }
            >
              <CircleDollarSign aria-hidden className="size-4.5" />
              {c.balanceMinor > 0
                ? `Owes ${fmt.moneyShort(c.balanceMinor)}`
                : `${fmt.moneyShort(-c.balanceMinor)} in credit`}
            </FigureButton>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can.money ? (
            <>
              <IconButton
                label="Sell a package"
                variant="lime"
                size="lg"
                isDisabled={!online}
                onPress={onSell}
              >
                <Ticket aria-hidden className="size-5" />
              </IconButton>
              <IconButton
                label="Record a payment"
                variant="lime"
                size="lg"
                isDisabled={!online}
                onPress={onPay}
              >
                <CircleDollarSign aria-hidden className="size-5" />
              </IconButton>
            </>
          ) : null}
          {writes ? (
            <>
              <IconButton label="Add a note" variant="lime" size="lg" onPress={onNote}>
                <NotebookPen aria-hidden className="size-5" />
              </IconButton>
              <IconButton
                label="New assessment"
                variant="lime"
                size="lg"
                isDisabled={!online}
                onPress={onAssess}
              >
                <ClipboardCheck aria-hidden className="size-5" />
              </IconButton>
            </>
          ) : null}
          <ActionMenu
            label="More client actions"
            trigger={
              <IconButton label="More client actions" variant="white" size="lg">
                <Ellipsis aria-hidden className="size-5" />
              </IconButton>
            }
            actions={[
              { id: "edit", label: "Edit profile", onAction: onEdit, isDisabled: !online },
              ...statusActions.map((a) => ({ ...a, isDisabled: !online })),
              // Deleting a client is a data decision for owners and admins; coaches archive.
              ...(can.data
                ? [
                    {
                      id: "delete",
                      label: "Delete client",
                      tone: "danger" as const,
                      onAction: onDelete,
                      isDisabled: !online,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>
    </header>
  );
}

/** Edit every field in a sheet; only the fields that changed are sent. */
export function EditClientSheet({
  isOpen,
  onOpenChange,
  client,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientDto;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const store = useStoreClient();
  const refresh = useRefreshClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<ClientFormValues>(() => clientToValues(client));
  const [errors, setErrors] = useState<ClientErrors>({});
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: Partial<ReturnType<typeof toPayload>>) =>
      api.patch<ClientDto>(`/clients/${client.id}`, body),
    onSuccess: (dto, body) => {
      store(dto);
      refresh(dto.id, { skip: "progress", groups: "groupIds" in body });
      notify({ tone: "success", title: "Profile saved" });
      onOpenChange(false);
    },
    onError: (err) => {
      setErrors(fieldErrors(err) as ClientErrors);
      focusFirstInvalid(formRef.current);
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed from the latest profile on open.
  useEffect(() => {
    if (!isOpen) return;
    setValues(clientToValues(client));
    setErrors({});
    save.reset();
  }, [isOpen]);

  const submit = () => {
    const found = validateClient(values, fmt.today());
    setErrors(found);
    if (Object.keys(found).length) return focusFirstInvalid(formRef.current);
    const diff = changedFields(toPayload(clientToValues(client)), toPayload(values));
    if (!Object.keys(diff).length) return onOpenChange(false);
    save.mutate(diff);
  };
  const general =
    save.error && !Object.keys(fieldErrors(save.error)).length ? errorMessage(save.error) : null;

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title="Edit profile"
      description={fullName(client)}
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dark" isDisabled={!online} isPending={save.isPending} onPress={submit}>
            Save changes
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ClientFields
          values={values}
          onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
          errors={errors}
          layout="sheet"
          editing
        />
        {Object.keys(errors).length ? (
          <InlineError>Some fields need attention.</InlineError>
        ) : general ? (
          <InlineError>{general}</InlineError>
        ) : null}
        <OfflineHint>You're offline. Reconnect to save profile changes.</OfflineHint>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/** Delete for good, with the server's refusal shown and archiving offered instead. */
export function DeleteClientSheet({
  isOpen,
  onOpenChange,
  client,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientDto;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();
  const setStatus = useSetStatus(client);
  const del = useMutation({
    meta: { silent: true },
    mutationFn: () => api.del(`/clients/${client.id}`),
    onSuccess: () => {
      onOpenChange(false);
      void navigate({ to: "/clients" }).then(() => {
        qc.removeQueries({ queryKey: keys.client(client.id) });
        qc.removeQueries({ queryKey: keys.progress(client.id) });
        qc.removeQueries({ queryKey: keys.statement(client.id) });
        qc.removeQueries({ queryKey: keys.ledger(client.id) });
      });
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: keys.today });
      void qc.invalidateQueries({ queryKey: keys.groups });
      void qc.invalidateQueries({ queryKey: ["lesson"] });
      notify({ tone: "neutral", title: `${fullName(client)} deleted` });
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear the last refusal when reopened.
  useEffect(() => {
    if (isOpen) del.reset();
  }, [isOpen]);
  const refused = del.error instanceof ApiRequestError && del.error.status === 409;
  return (
    <ConfirmSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Delete ${client.firstName}?`}
      confirmLabel="Delete client"
      isPending={del.isPending}
      onConfirm={() => online && del.mutate()}
      body={
        <div className="flex flex-col gap-3">
          <p>
            {fullName(client)} and their notes, goals, and assessments are removed for good.
            {refused
              ? ""
              : " Clients with payments, packages, or attendance on record can't be deleted; archive them instead to keep that history."}
          </p>
          {del.error ? <InlineError>{errorMessage(del.error)}</InlineError> : null}
          {refused && client.status !== "archived" ? (
            <Button
              variant="dark"
              className="self-start"
              onPress={() => {
                onOpenChange(false);
                setStatus(
                  "archived",
                  `${client.firstName} archived`,
                  "Hidden from lists and pickers. History stays.",
                );
              }}
            >
              Archive instead
            </Button>
          ) : null}
          <OfflineHint>You're offline. Reconnect to delete a client.</OfflineHint>
        </div>
      }
    />
  );
}
