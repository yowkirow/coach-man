import type { GroupDto } from "@shared/api-types";
import { createFileRoute, isRedirect, redirect, useNavigate } from "@tanstack/react-router";
import { Archive, Plus, UsersRound } from "lucide-react";
import { useRef } from "react";
import { ToggleButton } from "react-aria-components";
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
import {
  GroupCard,
  GroupKpis,
  GroupsPanel,
  useGroupsOverview,
} from "../../features/groups/group-list";
import { GroupSheet } from "../../features/groups/group-sheet";
import { OfflineNote } from "../../features/schedule/choice";
import { api, errorMessage } from "../../lib/api";
import { plural } from "../../lib/format";
import { useCan } from "../../lib/hooks";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";

export const Route = createFileRoute("/_app/groups/")({
  validateSearch: (s: Record<string, unknown>): { new?: "1"; archived?: "1" } => ({
    new: s.new === "1" || s.new === 1 ? "1" : undefined,
    archived: s.archived === "1" || s.archived === 1 ? "1" : undefined,
  }),
  // Desktop is master–detail: the black panel lists groups, so open the first one beside it.
  beforeLoad: async ({ context, search }) => {
    if (search.new || search.archived || !isDesktopViewport()) return;
    try {
      const groups = await context.queryClient.ensureQueryData({
        queryKey: keys.groups,
        queryFn: () => api.get<GroupDto[]>("/groups"),
      });
      const first = groups.find((g) => !g.archivedAt);
      if (first) {
        throw redirect({ to: "/groups/$groupId", params: { groupId: first.id }, replace: true });
      }
    } catch (err) {
      if (isRedirect(err)) throw err;
    }
  },
  component: GroupsPage,
});

function GroupsPage() {
  // Groups are the academy's programs (the catalog capability): coaches use them, not create them.
  const can = useCan();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const desktop = useIsDesktop();
  const online = useOnline();
  const showArchived = search.archived === "1";
  const { groups, members, schedule, stats } = useGroupsOverview(showArchived);
  const createdId = useRef<string | null>(null);

  const all = groups.data ?? [];
  const list = [...all.filter((g) => !g.archivedAt), ...all.filter((g) => g.archivedAt)];
  const archivedCount = all.filter((g) => g.archivedAt).length;
  const subtitle = stats
    ? [
        plural(stats.groups, "group"),
        plural(stats.members, "member"),
        showArchived ? `${archivedCount} archived` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Loading…";

  const openNew = () => void navigate({ search: (prev) => ({ ...prev, new: "1" }) });
  const setArchived = (on: boolean) =>
    void navigate({
      search: (prev) => ({ ...prev, archived: on ? "1" : undefined }),
      replace: true,
    });

  const archivedToggle = (
    <ToggleButton
      isSelected={showArchived}
      onChange={setArchived}
      className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-card px-4 text-[0.9375rem] font-medium text-ink outline-none transition-colors hover:bg-panel data-[selected]:bg-ink data-[selected]:text-white data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink"
    >
      <Archive aria-hidden className="size-4" />
      Show archived
    </ToggleButton>
  );

  const body = groups.isPending ? (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-busy="true">
      <span className="sr-only">Loading groups…</span>
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} as="div" className="flex flex-col gap-4 p-5">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-9 w-2/3 rounded-full" />
          <Skeleton className="h-11 w-full rounded-full" />
        </Card>
      ))}
    </div>
  ) : !groups.data ? (
    <Card className="px-6 py-2">
      <ErrorState message={errorMessage(groups.error)} onRetry={() => void groups.refetch()} />
    </Card>
  ) : list.length ? (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label="Groups">
      {list.map((g) => (
        <li key={g.id} className="flex min-w-0 flex-col [&>article]:flex-1">
          <GroupCard group={g} members={members.get(g.id) ?? []} info={schedule.get(g.id)} />
        </li>
      ))}
    </ul>
  ) : (
    <Card className="px-6 py-4">
      <EmptyState
        icon={<UsersRound aria-hidden className="size-5" />}
        title="No groups yet"
        body="A group keeps a class's players together: add members once, give it a weekly time, and everyone is booked into every session. Credits come off their packages at check-in."
        action={
          can.catalog ? (
            <Button variant="dark" isDisabled={!online} onPress={openNew}>
              New group
            </Button>
          ) : undefined
        }
      />
    </Card>
  );

  return (
    <>
      <ShellAside>
        <GroupsPanel />
      </ShellAside>

      {desktop ? (
        <Page className="flex flex-col gap-6 pb-6">
          <PageHeader
            title="Groups"
            subtitle={<span className="num">{subtitle}</span>}
            actions={
              <>
                {archivedToggle}
                {can.catalog ? (
                  <Button
                    variant="dark"
                    icon={<Plus aria-hidden className="size-4.5" />}
                    isDisabled={!online}
                    onPress={openNew}
                  >
                    New group
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
                <h1 className="text-[2rem] leading-tight font-light tracking-[-0.02em]">Groups</h1>
                <p className="num mt-1 text-[0.9375rem] text-night-ink-2">{subtitle}</p>
              </div>
              <SyncStatus dark />
            </div>
            <div className="mt-5">
              <GroupKpis stats={stats} />
            </div>
            {can.catalog ? (
              <Button
                variant="lime"
                className="mt-4 w-full"
                icon={<Plus aria-hidden className="size-4.5" />}
                isDisabled={!online}
                onPress={openNew}
              >
                New group
              </Button>
            ) : null}
            {!online ? <OfflineNote dark className="mt-3" /> : null}
          </section>
          <Page className="flex flex-col gap-4 pt-4">
            {body}
            <div className="flex justify-center">{archivedToggle}</div>
          </Page>
        </div>
      )}

      <GroupSheet
        isOpen={search.new === "1" && can.catalog}
        onSaved={(g, created) => {
          if (created) createdId.current = g.id;
        }}
        onOpenChange={(open) => {
          if (open) return openNew();
          const id = createdId.current;
          createdId.current = null;
          if (id) void navigate({ to: "/groups/$groupId", params: { groupId: id }, replace: true });
          else void navigate({ search: (prev) => ({ ...prev, new: undefined }), replace: true });
        }}
      />
    </>
  );
}
