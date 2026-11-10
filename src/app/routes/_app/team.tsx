import type { TeamMemberDto } from "@shared/api-types";
import { isCoachingRole, type StaffRole } from "@shared/roles";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { UserPlus, UserRound } from "lucide-react";
import { useState } from "react";
import { Page, ShellAside } from "../../components/layout/app-shell";
import { Button } from "../../components/ui/button";
import { Card, PageHeader } from "../../components/ui/display";
import { ErrorState, RowsSkeleton } from "../../components/ui/feedback";
import { CoachProfileSheet } from "../../features/coaches/profile";
import { ConnectionPill } from "../../features/settings/offline";
import { InviteSheet, InvitesCard, MembersCard, TeamPanel } from "../../features/team/team";
import { TeamPageCard } from "../../features/team/team-page";
import { errorMessage } from "../../lib/api";
import { plural } from "../../lib/format";
import { useCan, useMe, useTeam } from "../../lib/hooks";
import { useOnline } from "../../lib/offline";

export const Route = createFileRoute("/_app/team")({
  validateSearch: (s: Record<string, unknown>): { invite?: "1" } => ({
    invite: s.invite === "1" || s.invite === 1 ? "1" : undefined,
  }),
  component: TeamPage,
});

/** Whose profile the sheet edits (their role words it: the front desk's isn't a coach profile). */
type ProfileTarget = Pick<TeamMemberDto, "userId" | "name" | "role">;

/**
 * The academy's team: who is on it, their roles and coach profiles, and (for owners and admins)
 * invite links, role changes, and removal. Coaches and the front desk see the team and edit their
 * own profile.
 */
function TeamPage() {
  const me = useMe().data;
  const can = useCan();
  const online = useOnline();
  const team = useTeam();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [again, setAgain] = useState<{ email: string; role: StaffRole } | null>(null);
  const [profileOf, setProfileOf] = useState<ProfileTarget | null>(null);

  const setInvite = (open: boolean) =>
    void navigate({ search: open ? { invite: "1" } : {}, replace: !open });
  const invite = (initial?: { email: string; role: StaffRole }) => {
    setAgain(initial ?? null);
    setInvite(true);
  };
  const editProfile = (m: ProfileTarget) =>
    setProfileOf({ userId: m.userId, name: m.name, role: m.role });
  const members = team.data?.members ?? [];
  const self = members.find((m) => m.userId === me?.user.id);

  return (
    <>
      <ShellAside>
        <TeamPanel team={team.data} />
      </ShellAside>
      <Page className="flex flex-col gap-5 pb-8">
        <PageHeader
          title="Team"
          subtitle={
            team.data ? (
              <span className="num">
                {me?.workspace.name ? `${me.workspace.name} · ` : ""}
                {plural(members.length, "person", "people")}
              </span>
            ) : (
              me?.workspace.name
            )
          }
          actions={
            <>
              <ConnectionPill />
              <Button
                variant="light"
                icon={<UserRound aria-hidden className="size-4.5" />}
                isDisabled={!me}
                onPress={() =>
                  me &&
                  editProfile(self ?? { userId: me.user.id, name: me.user.name, role: me.role })
                }
              >
                {me && !isCoachingRole(me.role) ? "My profile" : "My coach profile"}
              </Button>
              {can.team ? (
                <Button
                  variant="dark"
                  icon={<UserPlus aria-hidden className="size-4.5" />}
                  isDisabled={!online}
                  onPress={() => invite()}
                >
                  Invite someone
                </Button>
              ) : null}
            </>
          }
        />
        {team.isPending ? (
          <Card className="px-5 py-2">
            <RowsSkeleton rows={4} />
          </Card>
        ) : !team.data ? (
          <Card className="px-6 py-2">
            <ErrorState
              title="Couldn't load the team"
              message={errorMessage(team.error)}
              onRetry={() => void team.refetch()}
            />
          </Card>
        ) : (
          <>
            <MembersCard team={team.data} onEditProfile={editProfile} />
            {can.team ? <InvitesCard invites={team.data.invites} onInvite={invite} /> : null}
            {can.team ? <TeamPageCard onEditStaff={editProfile} /> : null}
            {members.length === 1 && can.team ? (
              <p className="px-1 text-[0.875rem] text-ink-2">
                Coaching on your own? You don't need anyone else here. Invite coaches when your
                academy grows.
              </p>
            ) : null}
          </>
        )}
      </Page>
      {can.team ? (
        <InviteSheet
          isOpen={search.invite === "1"}
          onOpenChange={(open) => setInvite(open)}
          initial={again}
        />
      ) : null}
      <CoachProfileSheet
        userId={profileOf?.userId ?? null}
        name={profileOf?.name ?? ""}
        role={profileOf?.role}
        onClose={() => setProfileOf(null)}
      />
    </>
  );
}
