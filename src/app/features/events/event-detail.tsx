import type {
  ClientListItemDto,
  EventDetailDto,
  EventDto,
  LessonSummaryDto,
} from "@shared/api-types";
import { EVENT_KIND_LABELS, type EventStatus, type RegistrationStatus } from "@shared/domain";
import { daysBetween } from "@shared/time";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarPlus,
  Ellipsis,
  MoreHorizontal,
  Pencil,
  Ticket,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { LessonRow } from "../../components/domain/lesson";
import { Button, buttonClass, IconButton } from "../../components/ui/button";
import {
  Avatar,
  Bento,
  Card,
  CardHeader,
  CheckItem,
  KeyValue,
  Meter,
  Pill,
  PillTabs,
} from "../../components/ui/display";
import {
  EmptyState,
  ErrorState,
  InlineError,
  RowsSkeleton,
  Skeleton,
} from "../../components/ui/feedback";
import { Checkbox } from "../../components/ui/field";
import { ActionMenu, ConfirmSheet, type MenuAction } from "../../components/ui/overlay";
import { ApiRequestError, api, errorMessage } from "../../lib/api";
import { type Format, fullName, plural, useFormat } from "../../lib/format";
import { useClients, useNow, useVenues } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import {
  RecordPaymentSheet,
  type SelectedClient,
  useInvalidateMoney,
} from "../money/record-payment-sheet";
import { OfflineNote } from "../schedule/choice";
import { NewSessionSheet } from "../schedule/new-session-sheet";
import {
  agesLabel,
  currentPrice,
  EVENT_KIND_TONE,
  EVENT_STATUS_LABEL,
  EVENT_STATUS_TONE,
  eventDates,
  eventTiming,
  REG_STATUS_LABEL,
  REG_STATUS_TONE,
  registrationsLocked,
} from "./event-meta";
import { EventSheet } from "./event-sheet";
import { useEvent, useInvalidateEvents } from "./queries";
import { RegisterClientSheet } from "./register-sheet";

export type EventTab = "registrations" | "sessions" | "details";
type Registration = EventDetailDto["registrations"][number];
type SheetName = "register" | "sessions" | "edit" | "cancel";
type RegConfirm = { kind: "cancel" | "promote"; reg: Registration };

const STATUS_DONE: Record<EventStatus, string> = {
  draft: "Moved back to draft",
  open: "Registration is open",
  closed: "Registration closed",
  completed: "Event marked completed",
  cancelled: "Event cancelled",
};

const owed = (r: Registration) =>
  r.status === "registered" ? Math.max(0, r.priceMinor - r.paidMinor) : 0;

/**
 * The event workspace: header with action circles and status menu, registrations/sessions/details
 * tabs, and the lavender "Money" and lime "Capacity" cards.
 */
export function EventDetail({
  eventId,
  tab,
  onTab,
}: {
  eventId: string;
  tab: EventTab;
  onTab: (tab: EventTab) => void;
}) {
  const now = useNow();
  const q = useEvent(eventId);
  const clients = useClients({});
  const invalidateEvents = useInvalidateEvents();
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [confirm, setConfirm] = useState<RegConfirm | null>(null);
  const [paying, setPaying] = useState<SelectedClient | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close sheets when the event changes.
  useEffect(() => {
    setSheet(null);
    setConfirm(null);
    setPaying(null);
  }, [eventId]);

  if (q.isPending) return <EventSkeleton />;
  if (!q.data) {
    const missing = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <div className="flex flex-col gap-2">
        <ErrorState
          title={missing ? "Event not found" : "Couldn't load this event"}
          message={
            missing
              ? "It may have been removed, or the link is from another workspace."
              : errorMessage(q.error)
          }
          onRetry={missing ? undefined : () => void q.refetch()}
        />
        <Link to="/events" className={buttonClass("light", "md", "self-start")}>
          All events
        </Link>
      </div>
    );
  }

  const detail = q.data;
  const e = detail.event;
  const clientById = new Map((clients.data ?? []).map((c) => [c.id, c]));
  const sessions = [...detail.sessions].sort((a, b) => a.startsAt - b.startsAt);
  const takenIds = detail.registrations
    .filter((r) => r.status !== "cancelled")
    .map((r) => r.clientId);

  return (
    <div className="flex flex-col gap-6">
      <EventHeader event={e} onSheet={setSheet} />

      <PillTabs
        label="Event sections"
        fill
        selected={tab}
        onChange={(t) => onTab(t as EventTab)}
        tabs={[
          {
            id: "registrations",
            label: `Registrations · ${e.registeredCount}`,
            content: (
              <RegistrationsCard
                detail={detail}
                clientById={clientById}
                onRegister={() => setSheet("register")}
                onConfirm={setConfirm}
                onPay={setPaying}
              />
            ),
          },
          {
            id: "sessions",
            label: `Sessions · ${sessions.length}`,
            content: (
              <SessionsCard
                event={e}
                sessions={sessions}
                now={now}
                onAdd={() => setSheet("sessions")}
              />
            ),
          },
          { id: "details", label: "Details", content: <DetailsCard event={e} /> },
        ]}
        aside={
          <>
            <MoneyBento detail={detail} />
            <CapacityBento event={e} onRegister={() => setSheet("register")} />
          </>
        }
      />

      <RegisterClientSheet
        isOpen={sheet === "register"}
        onOpenChange={(o) => setSheet(o ? "register" : null)}
        event={e}
        takenIds={takenIds}
      />
      <NewSessionSheet
        isOpen={sheet === "sessions"}
        onOpenChange={(o) => setSheet(o ? "sessions" : null)}
        initial={{ kind: "event", eventId: e.id }}
        onCreated={() => {
          setSheet(null);
          onTab("sessions");
        }}
      />
      <EventSheet
        isOpen={sheet === "edit"}
        onOpenChange={(o) => setSheet(o ? "edit" : null)}
        event={e}
      />
      <CancelEventSheet
        isOpen={sheet === "cancel"}
        onOpenChange={(o) => setSheet(o ? "cancel" : null)}
        event={e}
        sessions={sessions}
      />
      <RegistrationConfirm confirm={confirm} event={e} onClose={() => setConfirm(null)} />
      <RecordPaymentSheet
        isOpen={paying !== null}
        onOpenChange={(o) => {
          if (o) return;
          setPaying(null);
          // Payments are allocated to the oldest charges, which can include this event's fees.
          invalidateEvents(e.id);
        }}
        client={paying}
        lockClient
      />
    </div>
  );
}

function EventSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading event…</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-11 w-2/3 max-w-md" />
        <Skeleton className="h-4 w-1/3 max-w-xs" />
      </div>
      <Card className="p-5">
        <RowsSkeleton rows={4} />
      </Card>
    </div>
  );
}

function useStatusChange(event: EventDto) {
  const invalidate = useInvalidateEvents();
  return useMutation({
    meta: { silent: true },
    mutationFn: (status: EventStatus) => api.patch<EventDto>(`/events/${event.id}`, { status }),
    onSuccess: (_saved, status) => {
      invalidate(event.id);
      notify({ tone: "success", title: STATUS_DONE[status] });
    },
    onError: (err) =>
      notify({ tone: "danger", title: "Couldn't change the status", body: errorMessage(err) }),
  });
}

function EventHeader({ event: e, onSheet }: { event: EventDto; onSheet: (s: SheetName) => void }) {
  const fmt = useFormat();
  const online = useOnline();
  const venues = useVenues();
  const setStatus = useStatusChange(e);
  const today = fmt.today();
  const cancelled = e.status === "cancelled";
  const live = eventTiming(e, today) === "on" && (e.status === "open" || e.status === "closed");
  const days = daysBetween(e.startsOn, e.endsOn) + 1;
  const venue = venues.data?.find((v) => v.id === e.venueId)?.name;
  const ages = agesLabel(e);
  const meta = [
    eventDates(e, fmt, { weekday: true }),
    days > 1 ? `${days} days` : null,
    venue ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  const status = (id: string, label: string, to: EventStatus): MenuAction => ({
    id,
    label,
    onAction: () => setStatus.mutate(to),
    isDisabled: !online || setStatus.isPending,
  });
  const actions: MenuAction[] = [
    { id: "edit", label: "Edit details", onAction: () => onSheet("edit"), isDisabled: !online },
    ...(e.status === "draft" ? [status("open", "Open registration", "open")] : []),
    ...(e.status === "open" ? [status("close", "Close registration", "closed")] : []),
    ...(e.status === "closed" ? [status("reopen", "Reopen registration", "open")] : []),
    ...(e.status === "draft" || e.status === "open" || e.status === "closed"
      ? [status("complete", "Mark completed", "completed")]
      : []),
    ...(e.status === "completed" ? [status("undo", "Reopen event", "closed")] : []),
    ...(cancelled ? [status("restore", "Restore event", "open")] : []),
    ...(!cancelled
      ? [
          {
            id: "cancel",
            label: "Cancel event",
            tone: "danger" as const,
            onAction: () => onSheet("cancel"),
            isDisabled: !online,
          },
        ]
      : []),
  ];

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-1 basis-[26rem] items-start gap-3">
        <Link
          to="/events"
          aria-label="All events"
          className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-ink outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:hidden"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1
            className={`text-[2rem] leading-[1.08] font-light tracking-[-0.02em] break-words lg:text-[2.75rem] ${cancelled ? "text-ink-2 line-through decoration-2" : ""}`}
          >
            {e.name}
          </h1>
          <p className="num mt-2 text-[0.9375rem] text-ink-2">{meta}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {live ? <Pill tone="lime">On now</Pill> : null}
            <Pill tone={EVENT_KIND_TONE[e.kind]}>{EVENT_KIND_LABELS[e.kind]}</Pill>
            <Pill tone={EVENT_STATUS_TONE[e.status]}>{EVENT_STATUS_LABEL[e.status]}</Pill>
            {e.level ? <Pill tone="outline">{e.level}</Pill> : null}
            {ages && ages !== e.level ? <Pill tone="outline">{ages}</Pill> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <IconButton
            label="Register client"
            variant="lime"
            size="lg"
            isDisabled={registrationsLocked(e) || !online}
            onPress={() => onSheet("register")}
          >
            <UserPlus aria-hidden className="size-5" />
          </IconButton>
          <IconButton
            label="Add sessions"
            variant="lime"
            size="lg"
            isDisabled={cancelled || !online}
            onPress={() => onSheet("sessions")}
          >
            <CalendarPlus aria-hidden className="size-5" />
          </IconButton>
          <IconButton
            label="Edit event"
            variant="lime"
            size="lg"
            isDisabled={!online}
            onPress={() => onSheet("edit")}
          >
            <Pencil aria-hidden className="size-5" />
          </IconButton>
          <ActionMenu
            label="Event status and more"
            trigger={
              <IconButton label="Event status and more" variant="white" size="lg">
                <Ellipsis aria-hidden className="size-5" />
              </IconButton>
            }
            actions={actions}
          />
        </div>
        {!online ? <OfflineNote /> : null}
      </div>
    </header>
  );
}

/** Money line for a registration; null when the coral "owes" pill already says it all. */
function paidLine(r: Registration, fmt: Format): string | null {
  if (r.status === "waitlisted") {
    const since = `waiting since ${fmt.day(fmt.dayOf(r.registeredAt))}`;
    return r.priceMinor > 0
      ? `${fmt.moneyShort(r.priceMinor)} once a spot opens · ${since}`
      : `Free · ${since}`;
  }
  if (r.status === "cancelled") return r.priceMinor > 0 ? "Charge voided" : null;
  if (r.priceMinor === 0) return "Free";
  if (r.paidMinor >= r.priceMinor) return `Paid ${fmt.moneyShort(r.priceMinor)}`;
  if (r.paidMinor === 0) return null;
  return `${fmt.moneyShort(r.paidMinor)} of ${fmt.moneyShort(r.priceMinor)} paid`;
}

function RegistrationRow({
  reg: r,
  position,
  event,
  client,
  onConfirm,
  onPay,
}: {
  reg: Registration;
  position: number | null;
  event: EventDto;
  client?: ClientListItemDto;
  onConfirm: (c: RegConfirm) => void;
  onPay: (c: SelectedClient) => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const invalidateEvents = useInvalidateEvents();
  const invalidateMoney = useInvalidateMoney();
  const name = fullName(r);
  const due = owed(r);
  const line = paidLine(r, fmt);
  const full = event.capacity !== null && event.registeredCount >= event.capacity;

  const promote = useMutation({
    meta: { silent: true },
    mutationFn: () => api.patch<EventDto>(`/registrations/${r.id}`, { status: "registered" }),
    onSuccess: () => {
      invalidateEvents(event.id);
      invalidateMoney(r.clientId);
      notify({
        tone: "success",
        title: `${r.firstName} moved off the waitlist`,
        body:
          r.priceMinor > 0
            ? `${fmt.money(r.priceMinor)} added to their balance.`
            : "Booked into upcoming sessions.",
      });
    },
    onError: (err) =>
      notify({ tone: "danger", title: "Couldn't promote", body: errorMessage(err) }),
  });
  const again = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api.post<{ status: RegistrationStatus; event: EventDto }>(
        `/events/${event.id}/registrations`,
        { clientId: r.clientId },
      ),
    onSuccess: (res) => {
      invalidateEvents(event.id);
      invalidateMoney(r.clientId);
      notify({
        tone: "success",
        title:
          res.status === "waitlisted"
            ? `${r.firstName} is back on the waitlist`
            : `${r.firstName} registered again`,
        body:
          res.status === "waitlisted"
            ? `The event is full. Number ${res.event.waitlistCount} in line.`
            : undefined,
      });
    },
    onError: (err) =>
      notify({ tone: "danger", title: "Couldn't register again", body: errorMessage(err) }),
  });

  const busy = promote.isPending || again.isPending;
  const actions: MenuAction[] =
    r.status === "registered"
      ? [
          {
            id: "pay",
            label: "Record payment",
            onAction: () =>
              onPay({
                id: r.clientId,
                firstName: r.firstName,
                lastName: r.lastName,
                photoKey: client?.photoKey,
                balanceMinor: client?.balanceMinor ?? due,
              }),
            isDisabled: !online,
          },
          {
            id: "cancel",
            label: "Cancel registration",
            tone: "danger",
            onAction: () => onConfirm({ kind: "cancel", reg: r }),
            isDisabled: !online,
          },
        ]
      : r.status === "waitlisted"
        ? [
            {
              id: "promote",
              label: full ? "Promote over capacity" : "Promote to registered",
              onAction: () => (full ? onConfirm({ kind: "promote", reg: r }) : promote.mutate()),
              isDisabled: !online || busy,
            },
            {
              id: "cancel",
              label: "Take off the waitlist",
              tone: "danger",
              onAction: () => onConfirm({ kind: "cancel", reg: r }),
              isDisabled: !online,
            },
          ]
        : [
            {
              id: "again",
              label: "Register again",
              onAction: () => again.mutate(),
              isDisabled: !online || busy || registrationsLocked(event),
            },
          ];

  return (
    <li className={`flex items-center gap-3 py-3 ${r.status === "cancelled" ? "opacity-75" : ""}`}>
      <Avatar person={{ ...r, photoKey: client?.photoKey }} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to="/clients/$clientId"
            params={{ clientId: r.clientId }}
            className="rounded-md font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
          >
            {name}
          </Link>
          {r.isJunior ? <Pill tone="sky">Junior</Pill> : null}
          <Pill tone={REG_STATUS_TONE[r.status]}>
            {position ? `Waitlist #${position}` : REG_STATUS_LABEL[r.status]}
          </Pill>
        </div>
        {line || due > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-ink-2">
            {line ? <span className="num">{line}</span> : null}
            {due > 0 ? (
              <Link
                to="/clients/$clientId"
                params={{ clientId: r.clientId }}
                search={{ tab: "money" }}
                aria-label={`${name} owes ${fmt.money(due)}. Open their money.`}
                className="inline-flex h-6 items-center rounded-full bg-coral px-2.5 text-[0.75rem] font-medium text-ink outline-none hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <span className="num">Owes {fmt.moneyShort(due)}</span>
              </Link>
            ) : null}
          </div>
        ) : null}
        {r.note ? <p className="mt-0.5 truncate text-[0.8125rem] text-ink-2">{r.note}</p> : null}
      </div>
      <ActionMenu
        label={`Actions for ${name}`}
        trigger={
          <IconButton label={`Actions for ${name}`} isDisabled={busy}>
            <MoreHorizontal aria-hidden className="size-5" />
          </IconButton>
        }
        actions={actions}
      />
    </li>
  );
}

function RegistrationsCard({
  detail,
  clientById,
  onRegister,
  onConfirm,
  onPay,
}: {
  detail: EventDetailDto;
  clientById: Map<string, ClientListItemDto>;
  onRegister: () => void;
  onConfirm: (c: RegConfirm) => void;
  onPay: (c: SelectedClient) => void;
}) {
  const online = useOnline();
  const e = detail.event;
  const byStatus = (s: RegistrationStatus) =>
    detail.registrations
      .filter((r) => r.status === s)
      .sort((a, b) => a.registeredAt - b.registeredAt);
  const groups: { status: RegistrationStatus; title: string; list: Registration[] }[] = [
    { status: "registered", title: "Registered", list: byStatus("registered") },
    { status: "waitlisted", title: "Waitlist", list: byStatus("waitlisted") },
    { status: "cancelled", title: "Cancelled", list: byStatus("cancelled") },
  ];
  const locked = registrationsLocked(e);

  return (
    <Card label="Registrations">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-1">
        <h2 className="text-[1.125rem] font-medium">
          Registrations{" "}
          <span className="num font-normal text-ink-2">
            {e.registeredCount}
            {e.capacity ? `/${e.capacity}` : ""}
          </span>
        </h2>
        <Button
          variant="light"
          size="sm"
          icon={<UserPlus aria-hidden className="size-4" />}
          isDisabled={locked || !online}
          onPress={onRegister}
        >
          Register client
        </Button>
      </div>
      {detail.registrations.length ? (
        <div className="flex flex-col pb-2">
          {groups
            .filter((g) => g.list.length)
            .map((g) => (
              <section
                key={g.status}
                aria-labelledby={`reg-${g.status}`}
                className="border-line not-first:mt-1 not-first:border-t"
              >
                <h3
                  id={`reg-${g.status}`}
                  className="flex items-center gap-2 px-5 pt-4 text-[0.875rem] font-medium text-ink-2"
                >
                  {g.title}
                  <span className="num">{g.list.length}</span>
                </h3>
                <ul className="flex flex-col divide-y divide-line px-5">
                  {g.list.map((r, i) => (
                    <RegistrationRow
                      key={r.id}
                      reg={r}
                      position={g.status === "waitlisted" ? i + 1 : null}
                      event={e}
                      client={clientById.get(r.clientId)}
                      onConfirm={onConfirm}
                      onPay={onPay}
                    />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      ) : (
        <div className="px-5 pb-5">
          <EmptyState
            icon={<UserPlus aria-hidden className="size-5" />}
            title="No registrations yet"
            body={
              locked
                ? "This event is closed to new registrations."
                : "Register players as they sign up. Each registration adds the event price to their balance, and once it's full, new sign-ups join the waitlist."
            }
            action={
              locked ? undefined : (
                <Button variant="dark" isDisabled={!online} onPress={onRegister}>
                  Register client
                </Button>
              )
            }
          />
        </div>
      )}
    </Card>
  );
}

function SessionsCard({
  event: e,
  sessions,
  now,
  onAdd,
}: {
  event: EventDto;
  sessions: LessonSummaryDto[];
  now: number;
  onAdd: () => void;
}) {
  const online = useOnline();
  const cancelled = e.status === "cancelled";
  const upcoming = sessions.filter((l) => l.status === "scheduled" && l.endsAt > now).length;
  return (
    <Card label="Sessions">
      <CardHeader
        title={
          <>
            Sessions{" "}
            <span className="num font-normal text-ink-2">
              {upcoming && upcoming !== sessions.length
                ? `${upcoming} of ${sessions.length} to go`
                : sessions.length}
            </span>
          </>
        }
        action={
          <Button
            variant="light"
            size="sm"
            icon={<CalendarPlus aria-hidden className="size-4" />}
            isDisabled={cancelled || !online}
            onPress={onAdd}
          >
            Add sessions
          </Button>
        }
      />
      {sessions.length ? (
        <div className="flex flex-col px-3 pb-3">
          {sessions.map((l) => (
            <LessonRow key={l.id} lesson={l} now={now} showDate />
          ))}
        </div>
      ) : (
        <div className="px-5 pb-5">
          <EmptyState
            icon={<CalendarPlus aria-hidden className="size-5" />}
            title="No sessions yet"
            body="Add the days and times it runs. Registered players are booked into every session, and check-ins don't use package credits: the registration covers them."
            action={
              <Button variant="dark" isDisabled={cancelled || !online} onPress={onAdd}>
                Add sessions
              </Button>
            }
          />
        </div>
      )}
    </Card>
  );
}

function DetailsCard({ event: e }: { event: EventDto }) {
  const fmt = useFormat();
  const venues = useVenues();
  const venue = venues.data?.find((v) => v.id === e.venueId)?.name;
  const days = daysBetween(e.startsOn, e.endsOn) + 1;
  return (
    <Card className="p-5" label="Event details">
      <dl className="grid gap-5 sm:grid-cols-2">
        <KeyValue label="Dates">
          <span className="num">
            {eventDates(e, fmt, { weekday: true })} · {plural(days, "day")}
          </span>
        </KeyValue>
        <KeyValue label="Venue">{venue ?? "No venue set"}</KeyValue>
        <KeyValue label="Price">
          <span className="num">{e.priceMinor ? fmt.money(e.priceMinor) : "Free"}</span>
        </KeyValue>
        <KeyValue label="Early-bird price">
          {e.earlyBirdPriceMinor !== null && e.earlyBirdUntil ? (
            <span className="num">
              {fmt.money(e.earlyBirdPriceMinor)} until {fmt.day(e.earlyBirdUntil)}
            </span>
          ) : (
            "None"
          )}
        </KeyValue>
        <KeyValue label="Capacity">
          {e.capacity ? <span className="num">{plural(e.capacity, "player")}</span> : "No limit"}
        </KeyValue>
        <KeyValue label="Status">{EVENT_STATUS_LABEL[e.status]}</KeyValue>
        <KeyValue label="Level">{e.level ?? "Any level"}</KeyValue>
        <KeyValue label="Ages">{agesLabel(e) ?? "Any age"}</KeyValue>
        <div className="sm:col-span-2">
          <KeyValue label="Description">
            {e.description ? (
              <span className="whitespace-pre-line">{e.description}</span>
            ) : (
              <span className="text-ink-2">No description yet.</span>
            )}
          </KeyValue>
        </div>
      </dl>
    </Card>
  );
}

function MoneyBento({ detail }: { detail: EventDetailDto }) {
  const fmt = useFormat();
  const e = detail.event;
  const today = fmt.today();
  const registered = detail.registrations
    .filter((r) => r.status === "registered" && r.priceMinor > 0)
    .sort((a, b) => owed(b) - owed(a));
  const early = currentPrice(e, today).earlyBird;
  return (
    <Bento
      tone="lavender"
      title="Money"
      subtitle={`From ${plural(e.registeredCount, "registration")}`}
    >
      <p className="num text-[2rem] leading-none font-light">{fmt.moneyShort(e.paidMinor)}</p>
      <p className="mt-1 text-[0.8125rem] text-ink/75">collected</p>
      <ul className="mt-3 flex flex-col">
        <CheckItem ok={e.dueMinor === 0}>
          {e.dueMinor ? (
            <span className="num">{fmt.moneyShort(e.dueMinor)} still due</span>
          ) : (
            "Nothing due"
          )}
        </CheckItem>
        {e.earlyBirdPriceMinor !== null && e.earlyBirdUntil ? (
          <CheckItem ok={early}>
            <span className="num">
              Early-bird {fmt.moneyShort(e.earlyBirdPriceMinor)} {early ? "until" : "ended"}{" "}
              {fmt.day(e.earlyBirdUntil)}
            </span>
          </CheckItem>
        ) : null}
        {registered.slice(0, 4).map((r) => (
          <CheckItem key={r.id} ok={owed(r) === 0}>
            {r.firstName} {r.lastName.slice(0, 1)}.{" "}
            <span className="num text-ink/70">
              · {owed(r) ? `owes ${fmt.moneyShort(owed(r))}` : "paid"}
            </span>
          </CheckItem>
        ))}
      </ul>
      {registered.length > 4 ? (
        <p className="mt-1 text-[0.8125rem] text-ink/75">and {registered.length - 4} more</p>
      ) : null}
    </Bento>
  );
}

function CapacityBento({ event: e, onRegister }: { event: EventDto; onRegister: () => void }) {
  const online = useOnline();
  const full = e.capacity !== null && e.registeredCount >= e.capacity;
  return (
    <Bento
      tone="lime"
      title="Capacity"
      subtitle={
        e.capacity
          ? full
            ? "Full: new sign-ups join the waitlist"
            : `${plural(e.capacity - e.registeredCount, "spot")} left`
          : "No limit on registrations"
      }
    >
      <p className="num text-[2rem] leading-none font-light">
        {e.registeredCount}
        {e.capacity ? <span className="text-ink/60">/{e.capacity}</span> : null}
      </p>
      <p className="mt-1 text-[0.8125rem] text-ink/75">registered</p>
      {e.capacity ? (
        <div className="mt-3">
          <Meter value={e.registeredCount} max={e.capacity} />
        </div>
      ) : null}
      <p className="mt-3 flex items-center gap-2 text-[0.875rem]">
        <Ticket aria-hidden className="size-4 shrink-0" />
        <span className="num">
          {e.waitlistCount ? `${plural(e.waitlistCount, "player")} on the waitlist` : "No waitlist"}
        </span>
      </p>
      <Button
        variant="dark"
        size="sm"
        className="mt-4"
        icon={<UserPlus aria-hidden className="size-4" />}
        isDisabled={registrationsLocked(e) || !online}
        onPress={onRegister}
      >
        Register client
      </Button>
    </Bento>
  );
}

/** Confirms cancelling a registration, or promoting from the waitlist past capacity. */
function RegistrationConfirm({
  confirm,
  event,
  onClose,
}: {
  confirm: RegConfirm | null;
  event: EventDto;
  onClose: () => void;
}) {
  const fmt = useFormat();
  const invalidateEvents = useInvalidateEvents();
  const invalidateMoney = useInvalidateMoney();
  const [shown, setShown] = useState<RegConfirm | null>(confirm);
  useEffect(() => {
    if (confirm) setShown(confirm);
  }, [confirm]);

  const change = useMutation({
    meta: { silent: true },
    mutationFn: (c: RegConfirm) =>
      api.patch<EventDto>(`/registrations/${c.reg.id}`, {
        status: c.kind === "promote" ? "registered" : "cancelled",
      }),
    onSuccess: (after, c) => {
      invalidateEvents(event.id);
      invalidateMoney(c.reg.clientId);
      if (c.kind === "promote") {
        notify({
          tone: "success",
          title: `${c.reg.firstName} moved off the waitlist`,
          body: `Now ${after.registeredCount} registered for ${after.capacity ?? "no"} places.`,
        });
      } else {
        const wasRegistered = c.reg.status === "registered";
        const filled = wasRegistered && after.registeredCount >= event.registeredCount;
        notify({
          tone: "neutral",
          title: wasRegistered
            ? `${c.reg.firstName}'s registration cancelled`
            : `${c.reg.firstName} taken off the waitlist`,
          body: wasRegistered
            ? [
                c.reg.priceMinor > 0 ? "The charge was voided." : null,
                filled ? "The next player on the waitlist got the spot." : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            : undefined,
        });
      }
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset for each confirmation.
  useEffect(() => {
    if (confirm) change.reset();
  }, [confirm]);

  const r = shown?.reg;
  const name = r ? fullName(r) : "";
  const promoting = shown?.kind === "promote";
  const paid = r?.paidMinor ?? 0;
  return (
    <ConfirmSheet
      isOpen={confirm !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={
        promoting
          ? `Promote ${r?.firstName ?? "player"}?`
          : r?.status === "waitlisted"
            ? `Take ${r?.firstName ?? "player"} off the waitlist?`
            : `Cancel ${r?.firstName ?? "player"}'s registration?`
      }
      confirmLabel={
        promoting
          ? "Promote anyway"
          : r?.status === "waitlisted"
            ? "Take off"
            : "Cancel registration"
      }
      tone={promoting ? "dark" : "danger"}
      isPending={change.isPending}
      onConfirm={() => confirm && change.mutate(confirm)}
      body={
        <div className="flex flex-col gap-4">
          {promoting ? (
            <p>
              {event.name} is full at <span className="num">{event.capacity}</span>. {name} is
              registered anyway, booked into the upcoming sessions, and charged{" "}
              <span className="num">{fmt.money(r?.priceMinor ?? 0)}</span>.
            </p>
          ) : r?.status === "waitlisted" ? (
            <p>{name} comes off the waitlist. Nothing was charged, so there's nothing to undo.</p>
          ) : (
            <p>
              {name} comes off the list and the upcoming sessions.{" "}
              {r && r.priceMinor > 0 ? (
                <>
                  The <span className="num">{fmt.money(r.priceMinor)}</span> charge is voided
                  {paid > 0 ? (
                    <>
                      ; the <span className="num">{fmt.money(paid)}</span> already paid stays on
                      their account as credit
                    </>
                  ) : null}
                  .{" "}
                </>
              ) : null}
              {event.waitlistCount ? "The first player on the waitlist gets the spot." : ""}
            </p>
          )}
          {change.error ? <InlineError>{errorMessage(change.error)}</InlineError> : null}
        </div>
      }
    />
  );
}

/** Cancels the event and, optionally, its upcoming sessions. Money stays for the coach to settle. */
function CancelEventSheet({
  isOpen,
  onOpenChange,
  event,
  sessions,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventDto;
  sessions: LessonSummaryDto[];
}) {
  const invalidate = useInvalidateEvents();
  const [clear, setClear] = useState(true);
  const upcoming = sessions.filter((l) => l.status === "scheduled" && l.startsAt > Date.now());

  const cancel = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      if (clear) {
        for (const l of upcoming) {
          await api.post(`/lessons/${l.id}/cancel`, { reason: "Event cancelled", scope: "this" });
        }
      }
      return api.patch<EventDto>(`/events/${event.id}`, { status: "cancelled" });
    },
    onSuccess: () => {
      invalidate(event.id);
      notify({
        tone: "neutral",
        title: `${event.name} cancelled`,
        body:
          clear && upcoming.length
            ? `${plural(upcoming.length, "session")} taken off the schedule.`
            : undefined,
      });
      onOpenChange(false);
    },
    onError: () => invalidate(event.id),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setClear(true);
    cancel.reset();
  }, [isOpen]);

  return (
    <ConfirmSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Cancel ${event.name}?`}
      confirmLabel="Cancel event"
      isPending={cancel.isPending}
      onConfirm={() => cancel.mutate()}
      body={
        <div className="flex flex-col gap-4">
          <p>
            It stops taking registrations. Registrations, charges, and payments stay as they are, so
            you can refund or void fees from Money. You can restore the event later.
          </p>
          {upcoming.length ? (
            <Checkbox isSelected={clear} onChange={setClear}>
              <span className="text-ink">
                Also cancel its{" "}
                <span className="num font-medium">
                  {plural(upcoming.length, "upcoming session")}
                </span>
              </span>
            </Checkbox>
          ) : null}
          {cancel.error ? <InlineError>{errorMessage(cancel.error)}</InlineError> : null}
        </div>
      }
    />
  );
}
