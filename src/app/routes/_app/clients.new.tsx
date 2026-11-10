import type { ClientDto, ClientListItemDto } from "@shared/api-types";
import { STAFF_ROLE_LABELS } from "@shared/roles";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, Check, UserPlus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Page, ShellAside } from "../../components/layout/app-shell";
import { Button, buttonClass, IconButton } from "../../components/ui/button";
import { Card } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { SelectField } from "../../components/ui/field";
import { ConfirmSheet } from "../../components/ui/overlay";
import { OfflineHint } from "../../features/clients/bits";
import {
  type ClientErrors,
  ClientFields,
  type ClientFormValues,
  type ClientPayload,
  emptyClientValues,
  focusFirstInvalid,
  toPayload,
  validateClient,
} from "../../features/clients/client-form";
import { normPhone } from "../../features/clients/client-utils";
import { ClientWorklist } from "../../features/clients/worklist";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { fullName, useFormat } from "../../lib/format";
import {
  useCan,
  useClients,
  useCoachChoices,
  useHasTeam,
  useIsCoach,
  useMe,
} from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";

export const Route = createFileRoute("/_app/clients/new")({
  component: NewClientPage,
});

/** An existing client with the same email, phone, or full name, so the coach can avoid twins. */
function findDuplicate(
  v: Pick<ClientFormValues, "email" | "phone" | "firstName" | "lastName">,
  list: ClientListItemDto[] | undefined,
): { client: ClientListItemDto; why: string } | null {
  if (!list) return null;
  const email = v.email.trim().toLowerCase();
  const phone = normPhone(v.phone);
  for (const c of list) {
    if (email && c.email?.toLowerCase() === email) return { client: c, why: "the same email" };
    if (phone.length >= 6 && normPhone(c.phone) === phone)
      return { client: c, why: "the same phone number" };
  }
  const name = `${v.firstName.trim()} ${v.lastName.trim()}`.toLowerCase();
  if (v.firstName.trim() && v.lastName.trim()) {
    const same = list.find((c) => fullName(c).toLowerCase() === name);
    if (same) return { client: same, why: "the same name" };
  }
  return null;
}

function NewClientPage() {
  const fmt = useFormat();
  const can = useCan();
  const online = useOnline();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clients = useClients({});
  const formRef = useRef<HTMLFormElement>(null);
  const saved = useRef(false);
  const [values, setValues] = useState<ClientFormValues>(emptyClientValues);
  const [errors, setErrors] = useState<ClientErrors>({});
  const hasTeam = useHasTeam();
  const isCoach = useIsCoach();
  const coaches = useCoachChoices();
  const me = useMe().data;
  // Whoever adds a student coaches them unless they pick someone else (or nobody yet); the front
  // desk doesn't coach, so their students start with no coach.
  const [coachSel, setCoachSel] = useState<string | null>(null);
  const you = isCoach ? me?.user.id : undefined;
  const primaryCoach = coachSel ?? you ?? "none";

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(emptyClientValues()),
    [values],
  );
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !saved.current,
    enableBeforeUnload: () => dirty && !saved.current,
    withResolver: true,
  });

  const { email, phone, firstName, lastName } = values;
  const duplicate = useMemo(
    () => findDuplicate({ email, phone, firstName, lastName }, clients.data),
    [email, phone, firstName, lastName, clients.data],
  );

  const create = useMutation({
    meta: { silent: true },
    mutationFn: (body: ClientPayload & { primaryCoachUserId?: string | null }) =>
      api.post<ClientDto>("/clients", body),
    onSuccess: (c, body) => {
      saved.current = true;
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: keys.today });
      if (body.groupIds.length) {
        void qc.invalidateQueries({ queryKey: keys.groups });
        void qc.invalidateQueries({ queryKey: ["group"] });
        void qc.invalidateQueries({ queryKey: ["lessons"] });
      }
      notify(
        can.money
          ? {
              tone: "success",
              title: `${c.firstName} added`,
              body: "Sell a package now, or any time from their profile.",
              duration: 8000,
              action: {
                label: "Sell a package",
                onAction: () =>
                  void navigate({
                    to: "/clients/$clientId",
                    params: { clientId: c.id },
                    search: { sell: "1" },
                  }),
              },
            }
          : { tone: "success", title: `${c.firstName} added` },
      );
      void navigate({ to: "/clients/$clientId", params: { clientId: c.id } });
    },
    onError: (err) => {
      const fields = fieldErrors(err) as ClientErrors;
      if (Object.keys(fields).length) {
        setErrors(fields);
        focusFirstInvalid(formRef.current);
      }
    },
  });

  const submit = () => {
    const found = validateClient(values, fmt.today());
    setErrors(found);
    if (Object.keys(found).length) return focusFirstInvalid(formRef.current);
    if (!online) return;
    create.mutate({
      ...toPayload(values),
      ...(hasTeam ? { primaryCoachUserId: primaryCoach === "none" ? null : primaryCoach } : {}),
    });
  };
  const general =
    create.error && !Object.keys(fieldErrors(create.error)).length
      ? errorMessage(create.error)
      : null;

  const actions = (
    <>
      <Link to="/clients" className={buttonClass("light")}>
        Cancel
      </Link>
      <Button
        variant="dark"
        type="submit"
        form="new-client"
        isDisabled={!online}
        isPending={create.isPending}
        icon={<UserPlus aria-hidden className="size-4.5" />}
      >
        Save client
      </Button>
    </>
  );

  return (
    <>
      <ShellAside>
        <ClientWorklist />
      </ShellAside>
      <Page className="flex flex-col gap-5 pb-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Link
              to="/clients"
              aria-label="Back to clients"
              className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-ink outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <ArrowLeft aria-hidden className="size-5" />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="text-[2rem] leading-[1.08] font-light tracking-[-0.02em] lg:text-[2.75rem]">
                New client
              </h1>
              <p className="mt-2 text-[0.9375rem] text-ink-2">
                A first name is enough to start. Everything else can wait.
              </p>
            </div>
            <IconButton
              label="Save client"
              variant="lime"
              size="lg"
              type="submit"
              form="new-client"
              isDisabled={!online || create.isPending}
              className="shrink-0 sm:hidden"
            >
              <Check aria-hidden className="size-5.5" strokeWidth={2.5} />
            </IconButton>
          </div>
          <div className="hidden flex-wrap gap-2 sm:flex">{actions}</div>
        </header>

        <form
          id="new-client"
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Card className="p-5 sm:p-8" as="div">
            {duplicate ? (
              <div
                role="status"
                className="mb-7 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[22px] bg-amber-soft px-4 py-3"
              >
                <p className="min-w-0 flex-1 text-[0.9375rem]">
                  <span className="font-medium">{fullName(duplicate.client)}</span> is already a
                  client with {duplicate.why}.
                </p>
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: duplicate.client.id }}
                  className={buttonClass("light", "sm")}
                >
                  Open profile
                  <ArrowUpRight aria-hidden className="size-4" />
                </Link>
              </div>
            ) : null}
            <ClientFields
              values={values}
              onChange={(patch) => {
                setValues((v) => ({ ...v, ...patch }));
                const touched = Object.keys(patch) as (keyof ClientFormValues)[];
                if (touched.some((k) => errors[k]))
                  setErrors((e) => {
                    const next = { ...e };
                    for (const k of touched) delete next[k];
                    return next;
                  });
              }}
              errors={errors}
              autoFocus
            />
            {hasTeam ? (
              <section
                aria-labelledby="new-client-coach"
                className="mt-8 border-t border-line pt-6"
              >
                <h2 id="new-client-coach" className="text-[1.125rem] font-medium">
                  Coach
                </h2>
                <SelectField
                  label="Primary coach"
                  className="mt-4 sm:max-w-[24rem]"
                  options={[
                    { id: "none", label: "No coach yet" },
                    ...coaches.map((c) => ({
                      id: c.userId,
                      label: c.userId === me?.user.id ? `${c.name} (you)` : c.name,
                      description: c.title ?? STAFF_ROLE_LABELS[c.role],
                    })),
                  ]}
                  value={primaryCoach}
                  onChange={setCoachSel}
                  description="Their main coach. Add assistant coaches from the profile later."
                />
              </section>
            ) : null}
            <div className="mt-8 flex flex-col gap-4 border-t border-line pt-6">
              {Object.keys(errors).length ? (
                <InlineError>Some fields need attention.</InlineError>
              ) : general ? (
                <InlineError>{general}</InlineError>
              ) : null}
              <OfflineHint>You're offline. Reconnect to add a client.</OfflineHint>
              <div className="flex flex-wrap justify-end gap-2">{actions}</div>
            </div>
          </Card>
        </form>
      </Page>

      <ConfirmSheet
        isOpen={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title="Discard this new client?"
        body="What you've typed so far won't be saved."
        confirmLabel="Discard"
        onConfirm={() => blocker.proceed?.()}
      />
    </>
  );
}
