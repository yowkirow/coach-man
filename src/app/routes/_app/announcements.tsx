import { ANNOUNCEMENT_STATES, type AnnouncementState } from "@shared/announcements";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnnouncementsPage } from "../../features/announcements/list";

interface AnnouncementsSearch {
  tab?: AnnouncementState;
  new?: 1;
}

export const Route = createFileRoute("/_app/announcements")({
  validateSearch: (s: Record<string, unknown>): AnnouncementsSearch => ({
    tab:
      typeof s.tab === "string" && (ANNOUNCEMENT_STATES as readonly string[]).includes(s.tab)
        ? (s.tab as AnnouncementState)
        : undefined,
    new: s.new === 1 || s.new === "1" ? 1 : undefined,
  }),
  component: AnnouncementsRoute,
});

function AnnouncementsRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <AnnouncementsPage
      tab={search.tab ?? "live"}
      onTab={(tab) => void navigate({ search: (s) => ({ ...s, tab }), replace: true })}
      startNew={search.new === 1}
      onStarted={() => {
        if (search.new) void navigate({ search: (s) => ({ ...s, new: undefined }), replace: true });
      }}
    />
  );
}
