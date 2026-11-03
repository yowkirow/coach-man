import type { EventDto } from "@shared/api-types";
import { compareDates, todayIn } from "@shared/time";
import { createFileRoute, isRedirect, redirect, useNavigate } from "@tanstack/react-router";
import { CalendarRange, Plus } from "lucide-react";
import { useRef } from "react";
import {
  isDesktopViewport,
  Page,
  ShellAside,
  SyncStatus,
  useIsDesktop,
} from "../../components/layout/app-shell";
import { Button } from "../../components/ui/button";
import { Card, PageHeader } from "../../components/ui/display";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/feedback";
import { Segmented } from "../../components/ui/field";
import {
  EventCard,
  EventKpis,
  EventsPanel,
  useEventsOverview,
} from "../../features/events/event-list";
import { EventSheet } from "../../features/events/event-sheet";
import { OfflineNote } from "../../features/schedule/choice";
import { api, errorMessage } from "../../lib/api";
import { plural } from "../../lib/format";
import { meQuery, useCan } from "../../lib/hooks";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";

type Scope = "upcoming" | "past" | "all";

export const Route = createFileRoute("/_app/events/")({
  validateSearch: (s: Record<string, unknown>): { new?: "1"; scope?: "past" | "all" } => ({
    new: s.new === "1" || s.new === 1 ? "1" : undefined,
    scope: s.scope === "past" || s.scope === "all" ? s.scope : undefined,
  }),
  // Desktop is master–detail: open the current or next event beside the panel's list.
  beforeLoad: async ({ context, search }) => {
    if (search.new || search.scope || !isDesktopViewport()) return;
    try {
      const [me, events] = await Promise.all([
        context.queryClient.ensureQueryData(meQuery),
        context.queryClient.ensureQueryData({
          queryKey: keys.events("all"),
          queryFn: () => api.get<EventDto[]>("/events?scope=all"),
        }),
      ]);
      const today = todayIn(me.settings.timezone);
      const next = events
        .filter((e) => e.status !== "cancelled" && compareDates(e.endsOn, today) >= 0)
        .sort((a, b) => compareDates(a.startsOn, b.startsOn))[0];
      if (next) {
        throw redirect({ to: "/events/$eventId", params: { eventId: next.id }, replace: true });
      }
    } catch (err) {
      if (isRedirect(err)) throw err;
    }
  },
  component: EventsPage,
});

const EMPTY: Record<Scope, { title: string; body: string }> = {
  upcoming: {
    title: "Nothing coming up",
    body: "Plan a summer camp, an academy term, a clinic, a tournament, or a social. Players register, the event fills to capacity, and late sign-ups join a waitlist.",
  },
  past: {
    title: "No past events yet",
    body: "Finished events land here with their registrations and money, so every fee stays explainable.",
  },
  all: {
    title: "No events yet",
    body: "Plan a summer camp, an academy term, a clinic, a tournament, or a social, then register players and add its sessions.",
  },
};

function EventsPage() {
  // Creating an event sets its price, so it's for owners and admins (the catalog capability).
  const can = useCan();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const desktop = useIsDesktop();
  const online = useOnline();
  const { all, upcoming, past, stats } = useEventsOverview();
  const scope: Scope = search.scope ?? "upcoming";
  const createdId = useRef<string | null>(null);
  const list = scope === "past" ? past : scope === "all" ? (all.data ?? []) : upcoming;

  const subtitle = stats
    ? [
        `${upcoming.length} upcoming`,
        `${plural(stats.registered, "player")} registered`,
        stats.waitlisted ? `${stats.waitlisted} waitlisted` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Loading…";

  const openNew = () => void navigate({ search: (prev) => ({ ...prev, new: "1" }) });
  const scopePicker = (
    <Segmented
      label="Show"
      hideLabel
      className="w-full sm:w-[20rem]"
      value={scope}
      onChange={(v) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            scope: v === "past" || v === "all" ? v : undefined,
          }),
          replace: true,
        })
      }
      options={[
        { id: "upcoming", label: "Upcoming" },
        { id: "past", label: "Past" },
        { id: "all", label: "All" },
      ]}
    />
  );

  const body = all.isPending ? (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-busy="true">
      <span className="sr-only">Loading events…</span>
      {[0, 1].map((i) => (
        <Card key={i} as="div" className="flex flex-col gap-4 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-6 w-1/2 rounded-full" />
          <Skeleton className="h-1.5 w-full rounded-full" />
          <Skeleton className="h-11 w-full rounded-full" />
        </Card>
      ))}
    </div>
  ) : !all.data ? (
    <Card className="px-6 py-2">
      <ErrorState message={errorMessage(all.error)} onRetry={() => void all.refetch()} />
    </Card>
  ) : list.length ? (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label="Events">
      {list.map((e) => (
        <li key={e.id} className="flex min-w-0 flex-col [&>article]:flex-1">
          <EventCard event={e} />
        </li>
      ))}
    </ul>
  ) : (
    <Card className="px-6 py-4">
      <EmptyState
        icon={<CalendarRange aria-hidden className="size-5" />}
        title={EMPTY[scope].title}
        body={EMPTY[scope].body}
        action={
          scope === "past" || !can.catalog ? undefined : (
            <Button variant="dark" isDisabled={!online} onPress={openNew}>
              New event
            </Button>
          )
        }
      />
    </Card>
  );

  return (
    <>
      <ShellAside>
        <EventsPanel />
      </ShellAside>

      {desktop ? (
        <Page className="flex flex-col gap-6 pb-6">
          <PageHeader
            title="Events"
            subtitle={<span className="num">{subtitle}</span>}
            actions={
              <>
                {scopePicker}
                {can.catalog ? (
                  <Button
                    variant="dark"
                    icon={<Plus aria-hidden className="size-4.5" />}
                    isDisabled={!online}
                    onPress={openNew}
                  >
                    New event
                  </Button>
                ) : null}
              </>
            }
          />
          {!online ? <OfflineNote className="-mt-3" /> : null}
          {body}
        </Page>
      ) : (
        <div className="flex flex-col">
          <section className="dark-zone rounded-b-[32px] bg-night px-4 pt-[calc(env(safe-area-inset-top)+20px)] pb-5 text-night-ink">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[2rem] leading-tight font-light tracking-[-0.02em]">Events</h1>
                <p className="num mt-1 text-[0.9375rem] text-night-ink-2">{subtitle}</p>
              </div>
              <SyncStatus dark />
            </div>
            <div className="mt-5">
              <EventKpis stats={stats} />
            </div>
            {can.catalog ? (
              <Button
                variant="lime"
                className="mt-4 w-full"
                icon={<Plus aria-hidden className="size-4.5" />}
                isDisabled={!online}
                onPress={openNew}
              >
                New event
              </Button>
            ) : null}
            {!online ? <OfflineNote dark className="mt-3" /> : null}
          </section>
          <Page className="flex flex-col gap-4 pt-4">
            {scopePicker}
            {body}
          </Page>
        </div>
      )}

      <EventSheet
        isOpen={search.new === "1" && can.catalog}
        onSaved={(e, created) => {
          if (created) createdId.current = e.id;
        }}
        onOpenChange={(open) => {
          if (open) return openNew();
          const id = createdId.current;
          createdId.current = null;
          if (id) void navigate({ to: "/events/$eventId", params: { eventId: id }, replace: true });
          else void navigate({ search: (prev) => ({ ...prev, new: undefined }), replace: true });
        }}
      />
    </>
  );
}
