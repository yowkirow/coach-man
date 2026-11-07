import type { AssessmentDto, ClientDetailDto, GoalDto } from "@shared/api-types";
import { useEffect, useState } from "react";
import { LedgerSheet } from "../../components/domain/roster";
import { PillTabs } from "../../components/ui/display";
import { Skeleton } from "../../components/ui/feedback";
import { fullName } from "../../lib/format";
import { useCan } from "../../lib/hooks";
import { AssessmentDetailSheet, NewAssessmentSheet } from "./assessment";
import { CardSkeleton } from "./bits";
import type { ProfileTab } from "./client-utils";
import { GoalSheet, GoalsBento } from "./goals";
import { NoteSheet } from "./notes";
import { PackagesBento } from "./packages-bento";
import { PhotoSheet } from "./photo-sheet";
import { DeleteClientSheet, EditClientSheet, ProfileHeader } from "./profile-header";
import { MoneyTab } from "./profile-money";
import { OverviewTab } from "./profile-overview";
import { ProgressTab } from "./profile-progress";
import { SessionsTab } from "./profile-sessions";
import { useProgress, useStatement } from "./queries";

type ProfileSheet = null | "photo" | "edit" | "note" | "assess" | "delete" | "ledger" | "goal";

/** Scrolls to the flagged medical note on the Overview tab once it has rendered. */
function revealMedical() {
  let tries = 0;
  const tick = () => {
    const el = document.getElementById("medical-notes");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    } else if (tries++ < 10) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * The client workspace: header with action circles, Overview/Progress/Sessions/Money tabs, and the
 * lavender Packages and lime Goals bentos in the right column.
 */
export function ClientProfile({
  detail,
  tab,
  onTab,
  onSell,
  onPay,
}: {
  detail: ClientDetailDto;
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
  onSell: () => void;
  onPay: () => void;
}) {
  const c = detail.client;
  const can = useCan();
  const progress = useProgress(c.id);
  const statement = useStatement(c.id, { enabled: can.money });
  // Coaches have no Money tab; an old ?tab=money link opens the overview instead.
  const shownTab: ProfileTab = tab === "money" && !can.money ? "overview" : tab;
  const [sheet, setSheet] = useState<ProfileSheet>(null);
  const [goal, setGoal] = useState<GoalDto | null>(null);
  const [assessment, setAssessment] = useState<AssessmentDto | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close everything when the client changes.
  useEffect(() => {
    setSheet(null);
    setGoal(null);
    setAssessment(null);
  }, [c.id]);

  const close = (open: boolean) => {
    if (!open) setSheet(null);
  };
  const addGoal = () => {
    setGoal(null);
    setSheet("goal");
  };

  return (
    <div className="flex flex-col gap-6">
      <ProfileHeader
        detail={detail}
        onPhoto={() => setSheet("photo")}
        onSell={onSell}
        onPay={onPay}
        onNote={() => setSheet("note")}
        onAssess={() => setSheet("assess")}
        onEdit={() => setSheet("edit")}
        onDelete={() => setSheet("delete")}
        onLedger={() => setSheet("ledger")}
        onMoney={() => onTab("money")}
        onMedical={() => {
          onTab("overview");
          revealMedical();
        }}
      />

      <PillTabs
        label="Client sections"
        fill
        selected={shownTab}
        onChange={(id) => onTab(id as ProfileTab)}
        tabs={[
          {
            id: "overview",
            label: "Overview",
            content: (
              <OverviewTab
                detail={detail}
                statement={statement.data}
                progress={progress.data}
                onTab={onTab}
                onEdit={() => setSheet("edit")}
                onNote={() => setSheet("note")}
                onAssessment={setAssessment}
              />
            ),
          },
          {
            id: "progress",
            label: "Progress",
            content: (
              <ProgressTab
                clientId={c.id}
                firstName={c.firstName}
                onNewAssessment={() => setSheet("assess")}
                onOpenAssessment={setAssessment}
                onAddGoal={addGoal}
                onEditGoal={(g) => {
                  setGoal(g);
                  setSheet("goal");
                }}
              />
            ),
          },
          {
            id: "sessions",
            label: "Sessions",
            content: <SessionsTab detail={detail} />,
          },
          ...(can.money
            ? [
                {
                  id: "money",
                  label: "Money",
                  content: (
                    <MoneyTab
                      clientId={c.id}
                      firstName={c.firstName}
                      onPay={onPay}
                      onSell={onSell}
                    />
                  ),
                },
              ]
            : []),
        ]}
        aside={
          <>
            <PackagesBento detail={detail} onSell={onSell} onLedger={() => setSheet("ledger")} />
            <GoalsBento
              clientId={c.id}
              goals={progress.data?.goals}
              onAdd={addGoal}
              onAll={() => onTab("progress")}
            />
          </>
        }
      />

      <PhotoSheet isOpen={sheet === "photo"} onOpenChange={close} client={c} />
      <EditClientSheet isOpen={sheet === "edit"} onOpenChange={close} client={c} />
      <DeleteClientSheet isOpen={sheet === "delete"} onOpenChange={close} client={c} />
      <NoteSheet
        isOpen={sheet === "note"}
        onOpenChange={close}
        clientId={c.id}
        firstName={c.firstName}
      />
      <NewAssessmentSheet
        isOpen={sheet === "assess"}
        onOpenChange={close}
        clientId={c.id}
        firstName={c.firstName}
        currentLevel={c.level}
        history={progress.data?.assessments ?? []}
      />
      <GoalSheet
        isOpen={sheet === "goal"}
        onOpenChange={close}
        clientId={c.id}
        goal={goal}
        firstName={c.firstName}
      />
      {progress.data ? (
        <AssessmentDetailSheet
          assessment={assessment}
          progress={progress.data}
          clientId={c.id}
          firstName={c.firstName}
          onClose={() => setAssessment(null)}
        />
      ) : null}
      <LedgerSheet
        isOpen={sheet === "ledger"}
        onOpenChange={close}
        clientId={c.id}
        name={fullName(c)}
        balanceMinor={c.balanceMinor}
      />
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading client…</span>
      <div className="flex items-center gap-5">
        <Skeleton className="size-16 shrink-0 rounded-full lg:size-28" />
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-10 w-2/3 max-w-sm" />
          <Skeleton className="h-4 w-1/2 max-w-xs" />
          <Skeleton className="h-6 w-1/3 max-w-[12rem] rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-11 w-80 max-w-full rounded-full" />
          <CardSkeleton rows={3} />
          <CardSkeleton rows={4} />
        </div>
        <div className="flex flex-col gap-4 xl:pt-15">
          <Skeleton className="h-56 rounded-[28px]" />
          <Skeleton className="h-44 rounded-[28px]" />
        </div>
      </div>
    </div>
  );
}
