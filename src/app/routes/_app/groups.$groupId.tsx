import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Page, ShellAside } from "../../components/layout/app-shell";
import { GroupDetail, type GroupTab } from "../../features/groups/group-detail";
import { GroupsPanel } from "../../features/groups/group-list";
import { useGroup } from "../../features/groups/queries";

export const Route = createFileRoute("/_app/groups/$groupId")({
  validateSearch: (s: Record<string, unknown>): { tab?: "schedule" | "details" } => ({
    tab: s.tab === "schedule" || s.tab === "details" ? s.tab : undefined,
  }),
  component: GroupPage,
});

function GroupPage() {
  const { groupId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const group = useGroup(groupId);
  return (
    <>
      <ShellAside>
        <GroupsPanel selectedId={groupId} current={group.data?.group} />
      </ShellAside>
      <Page className="pb-6">
        <GroupDetail
          groupId={groupId}
          tab={search.tab ?? "members"}
          onTab={(tab: GroupTab) =>
            void navigate({
              search: (prev) => ({ ...prev, tab: tab === "members" ? undefined : tab }),
              replace: true,
            })
          }
        />
      </Page>
    </>
  );
}
