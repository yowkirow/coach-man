import type { AssessmentDto, GoalDto } from "@shared/api-types";
import { WifiOff } from "lucide-react";
import { Card } from "../../components/ui/display";
import { EmptyState, ErrorState } from "../../components/ui/feedback";
import { errorMessage } from "../../lib/api";
import { useOnline } from "../../lib/offline";
import { AssessmentHistoryCard, SkillsCard } from "./assessment";
import { CardSkeleton } from "./bits";
import { GoalsCard } from "./goals";
import { NotesCard } from "./notes";
import { useProgress } from "./queries";
import { RatingsCard } from "./ratings";

export function ProgressTab({
  clientId,
  firstName,
  onNewAssessment,
  onOpenAssessment,
  onAddGoal,
  onEditGoal,
}: {
  clientId: string;
  firstName: string;
  onNewAssessment: () => void;
  onOpenAssessment: (a: AssessmentDto) => void;
  onAddGoal: () => void;
  onEditGoal: (g: GoalDto) => void;
}) {
  const online = useOnline();
  const q = useProgress(clientId);
  if (q.isPending && q.fetchStatus === "paused") {
    return (
      <Card className="px-6 py-2">
        <EmptyState
          icon={<WifiOff aria-hidden className="size-5" />}
          title="Progress needs a connection"
          body={`${firstName}'s progress hasn't been saved on this device yet. Open it once while online and it stays available offline.`}
        />
      </Card>
    );
  }
  if (q.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <CardSkeleton rows={5} />
        <CardSkeleton rows={2} />
      </div>
    );
  }
  if (!q.data) {
    return (
      <Card className="px-6 py-2">
        <ErrorState
          title="Couldn't load progress"
          message={errorMessage(q.error)}
          onRetry={() => void q.refetch()}
        />
      </Card>
    );
  }
  const p = q.data;
  return (
    <div className="flex flex-col gap-4">
      <SkillsCard progress={p} onNew={onNewAssessment} canWrite={online} />
      <AssessmentHistoryCard assessments={p.assessments} onOpen={onOpenAssessment} />
      <GoalsCard clientId={clientId} goals={p.goals} onAdd={onAddGoal} onEdit={onEditGoal} />
      <RatingsCard clientId={clientId} firstName={firstName} ratings={p.ratings} />
      <NotesCard clientId={clientId} firstName={firstName} notes={p.notes} />
    </div>
  );
}
