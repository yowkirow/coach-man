import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Page, ShellAside } from "../../components/layout/app-shell";
import { EventDetail, type EventTab } from "../../features/events/event-detail";
import { EventsPanel } from "../../features/events/event-list";

export const Route = createFileRoute("/_app/events/$eventId")({
  validateSearch: (s: Record<string, unknown>): { tab?: "sessions" | "details" } => ({
    tab: s.tab === "sessions" || s.tab === "details" ? s.tab : undefined,
  }),
  component: EventPage,
});

function EventPage() {
  const { eventId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <>
      <ShellAside>
        <EventsPanel selectedId={eventId} />
      </ShellAside>
      <Page className="pb-6">
        <EventDetail
          eventId={eventId}
          tab={search.tab ?? "registrations"}
          onTab={(tab: EventTab) =>
            void navigate({
              search: (prev) => ({ ...prev, tab: tab === "registrations" ? undefined : tab }),
              replace: true,
            })
          }
        />
      </Page>
    </>
  );
}
