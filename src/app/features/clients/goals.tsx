import type { GoalDto, ProgressDto } from "@shared/api-types";
import type { GoalStatus } from "@shared/domain";
import { daysBetween } from "@shared/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Plus, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { Checkbox as RACCheckbox } from "react-aria-components";
import { Button, IconButton } from "../../components/ui/button";
import { Bento, Card, Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { TextAreaField, TextField } from "../../components/ui/field";
import { ActionMenu, ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { useFormat } from "../../lib/format";
import { useWritesCoaching } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineHint, SectionHead } from "./bits";
import { useRefreshClient, useStoreProgress } from "./queries";

export function useGoalWrites(clientId: string) {
  const storeProgress = useStoreProgress();
  const refresh = useRefreshClient();
  const done = (p: ProgressDto) => {
    storeProgress(clientId, p);
    refresh(clientId, { skip: "progress" });
  };
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (v: {
      id?: string;
      title: string;
      detail: string | null;
      targetDate: string | null;
    }) =>
      v.id
        ? api.patch<ProgressDto>(`/goals/${v.id}`, {
            title: v.title,
            detail: v.detail,
            targetDate: v.targetDate,
          })
        : api.post<ProgressDto>(`/clients/${clientId}/goals`, v),
    onSuccess: done,
  });
  const setStatus = useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; status: GoalStatus }) =>
      api.patch<ProgressDto>(`/goals/${v.id}`, { status: v.status }),
    onSuccess: done,
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (id: string) => api.del<ProgressDto>(`/goals/${id}`),
    onSuccess: done,
  });
  return { save, setStatus, remove };
}

/** Marks a goal achieved (or back to active) at once, with an Undo instead of a confirm step. */
function useToggleGoal(clientId: string) {
  const qc = useQueryClient();
  const fmt = useFormat();
  const { setStatus } = useGoalWrites(clientId);
  const show = (goalId: string, status: GoalStatus) =>
    qc.setQueryData<ProgressDto>(keys.progress(clientId), (old) =>
      old
        ? {
            ...old,
            goals: old.goals.map((g) =>
              g.id === goalId
                ? {
                    ...g,
                    status,
                    achievedOn: status === "achieved" ? (g.achievedOn ?? fmt.today()) : null,
                  }
                : g,
            ),
          }
        : old,
    );
  return (goal: GoalDto, status: GoalStatus) => {
    const previous = goal.status;
    show(goal.id, status);
    setStatus.mutate(
      { id: goal.id, status },
      {
        onSuccess: () => {
          notify({
            tone: status === "achieved" ? "success" : "neutral",
            title:
              status === "achieved"
                ? "Goal reached"
                : status === "dropped"
                  ? "Goal dropped"
                  : "Goal back on the list",
            body: goal.title,
            action: {
              label: "Undo",
              onAction: () => {
                show(goal.id, previous);
                setStatus.mutate({ id: goal.id, status: previous });
              },
            },
          });
        },
        onError: (err) => {
          show(goal.id, previous);
          notify({ tone: "danger", title: "Couldn't update the goal", body: errorMessage(err) });
        },
      },
    );
  };
}

/** A goal with its tick; `readOnly` for people who don't coach (they see it, not change it). */
function GoalCheck({
  goal,
  onToggle,
  isDisabled,
  readOnly = false,
  onBento = false,
  showDetail = false,
}: {
  goal: GoalDto;
  onToggle: (achieved: boolean) => void;
  isDisabled?: boolean;
  readOnly?: boolean;
  onBento?: boolean;
  showDetail?: boolean;
}) {
  const fmt = useFormat();
  const achieved = goal.status === "achieved";
  return (
    <RACCheckbox
      isSelected={achieved}
      onChange={onToggle}
      isDisabled={isDisabled || goal.status === "dropped"}
      isReadOnly={readOnly}
      aria-label={
        readOnly
          ? `${goal.title}: ${achieved ? "reached" : "not reached yet"}`
          : achieved
            ? `${goal.title}: reached. Mark not reached`
            : `Mark reached: ${goal.title}`
      }
      className="group flex min-h-11 flex-1 cursor-pointer items-start gap-3 py-1.5 outline-none data-[disabled]:cursor-default data-[readonly]:cursor-default"
    >
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors group-data-[selected]:border-ink group-data-[selected]:bg-ink group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-ink ${
          onBento ? "border-ink/30 bg-white/55" : "border-line-strong bg-card"
        }`}
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="size-3.5 text-white opacity-0 group-data-[selected]:opacity-100"
        >
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="min-w-0">
        <span
          className={`block text-[0.9375rem] ${achieved ? "text-ink/60 line-through decoration-1" : ""}`}
        >
          {goal.title}
        </span>
        {showDetail && goal.detail ? (
          <span className="mt-0.5 line-clamp-2 block text-[0.8125rem] text-ink-2">
            {goal.detail}
          </span>
        ) : null}
        {goal.targetDate || goal.achievedOn ? (
          <span className={`num block text-[0.8125rem] ${onBento ? "text-ink/70" : "text-ink-2"}`}>
            {achieved && goal.achievedOn
              ? `Reached ${fmt.date(goal.achievedOn)}`
              : goal.targetDate
                ? `By ${fmt.date(goal.targetDate)}`
                : null}
          </span>
        ) : null}
      </span>
    </RACCheckbox>
  );
}

/** Reached goals stay on the bento this many days, so the win (and its Undo) is visible. */
const RECENT_DAYS = 14;

/**
 * Lime bento in the right column: the active goals, tick one off when it's reached (people who
 * coach; anyone else sees them).
 */
export function GoalsBento({
  clientId,
  goals,
  onAdd,
  onAll,
}: {
  clientId: string;
  goals: GoalDto[] | undefined;
  onAdd: () => void;
  onAll: () => void;
}) {
  const online = useOnline();
  const fmt = useFormat();
  const writes = useWritesCoaching();
  const toggle = useToggleGoal(clientId);
  const today = fmt.today();
  const active = (goals ?? []).filter((g) => g.status === "active");
  const reached = (goals ?? []).filter((g) => g.status === "achieved").length;
  // Recently reached goals stay (struck through) in a stable order, so a tick can be undone in place.
  const shown = (goals ?? [])
    .filter(
      (g) =>
        g.status === "active" ||
        (g.status === "achieved" &&
          g.achievedOn &&
          daysBetween(g.achievedOn, today) <= RECENT_DAYS),
    )
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  return (
    <Bento
      tone="lime"
      title="Goals"
      subtitle={
        goals === undefined
          ? "Loading…"
          : active.length || reached
            ? `${active.length} in progress · ${reached} reached`
            : "What they're working toward"
      }
    >
      {shown.length ? (
        <ul className="flex flex-col">
          {shown.slice(0, 5).map((g) => (
            <li key={g.id}>
              <GoalCheck
                goal={g}
                onBento
                isDisabled={!online}
                readOnly={!writes}
                onToggle={(on) => toggle(g, on ? "achieved" : "active")}
              />
            </li>
          ))}
        </ul>
      ) : goals !== undefined ? (
        <p className="text-[0.9375rem] text-ink/75">
          {!writes
            ? reached
              ? "Every goal is reached."
              : "No goals yet."
            : reached
              ? "Every goal is reached. Set the next one to keep lessons focused."
              : "No goals yet. A clear target, like a rating or a shot to master, keeps lessons focused."}
        </p>
      ) : null}
      {shown.length > 5 ? (
        <p className="mt-1 text-[0.8125rem] text-ink/75">and {shown.length - 5} more</p>
      ) : null}
      {writes || goals?.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {writes ? (
            <Button
              variant="dark"
              size="sm"
              isDisabled={!online}
              icon={<Plus aria-hidden className="size-4" />}
              onPress={onAdd}
            >
              Add goal
            </Button>
          ) : null}
          {goals?.length ? (
            <Button variant="light" size="sm" onPress={onAll}>
              All goals
            </Button>
          ) : null}
        </div>
      ) : null}
    </Bento>
  );
}

const SECTIONS: { status: GoalStatus; title: string }[] = [
  { status: "active", title: "In progress" },
  { status: "achieved", title: "Reached" },
  { status: "dropped", title: "Dropped" },
];

/**
 * Progress tab: every goal by status, with add, edit, reached, drop, and delete for people who
 * coach (anyone else sees the goals, as the family does).
 */
export function GoalsCard({
  clientId,
  goals,
  onAdd,
  onEdit,
}: {
  clientId: string;
  goals: GoalDto[];
  onAdd: () => void;
  onEdit: (g: GoalDto) => void;
}) {
  const online = useOnline();
  const writes = useWritesCoaching();
  const toggle = useToggleGoal(clientId);
  const [deleting, setDeleting] = useState<GoalDto | null>(null);
  return (
    <Card label="Goals">
      <SectionHead
        title="Goals"
        count={goals.length || undefined}
        action={
          writes ? (
            <Button
              variant="light"
              size="sm"
              isDisabled={!online}
              icon={<Plus aria-hidden className="size-4" />}
              onPress={onAdd}
            >
              Add goal
            </Button>
          ) : undefined
        }
      />
      {goals.length ? (
        <div className="flex flex-col gap-4 px-5 pb-5">
          {SECTIONS.map((s) => {
            const list = goals.filter((g) => g.status === s.status);
            if (!list.length) return null;
            return (
              <section key={s.status} aria-label={s.title}>
                <h3 className="mb-1 text-[0.8125rem] font-medium text-ink-2">
                  {s.title} <span className="num">· {list.length}</span>
                </h3>
                <ul className="flex flex-col divide-y divide-line">
                  {list.map((g) => (
                    <li key={g.id} className="flex items-start gap-2 py-1.5">
                      <GoalCheck
                        goal={g}
                        showDetail
                        isDisabled={!online}
                        readOnly={!writes}
                        onToggle={(on) => toggle(g, on ? "achieved" : "active")}
                      />
                      {g.status === "dropped" ? (
                        <Pill tone="outline" className="mt-2.5">
                          Dropped
                        </Pill>
                      ) : null}
                      {writes ? (
                        <ActionMenu
                          label={`Actions for goal: ${g.title}`}
                          trigger={
                            <IconButton
                              label={`Actions for goal: ${g.title}`}
                              isDisabled={!online}
                              className="shrink-0"
                            >
                              <Ellipsis aria-hidden className="size-5" />
                            </IconButton>
                          }
                          actions={[
                            { id: "edit", label: "Edit", onAction: () => onEdit(g) },
                            g.status === "active"
                              ? {
                                  id: "drop",
                                  label: "Drop goal",
                                  onAction: () => toggle(g, "dropped"),
                                }
                              : {
                                  id: "reactivate",
                                  label: "Back to in progress",
                                  onAction: () => toggle(g, "active"),
                                },
                            {
                              id: "delete",
                              label: "Delete",
                              tone: "danger",
                              onAction: () => setDeleting(g),
                            },
                          ]}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="flex items-start gap-3 px-5 pb-5 text-ink-2">
          <Target aria-hidden className="mt-0.5 size-4.5 shrink-0" />
          <p>
            {writes ? "No goals yet. Add one so every lesson has a direction." : "No goals yet."}
          </p>
        </div>
      )}
      <DeleteGoalSheet goal={deleting} clientId={clientId} onClose={() => setDeleting(null)} />
    </Card>
  );
}

function DeleteGoalSheet({
  goal,
  clientId,
  onClose,
}: {
  goal: GoalDto | null;
  clientId: string;
  onClose: () => void;
}) {
  const { remove } = useGoalWrites(clientId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear old errors when a goal opens.
  useEffect(() => {
    if (goal) remove.reset();
  }, [goal?.id]);
  return (
    <ConfirmSheet
      isOpen={goal !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Delete this goal?"
      confirmLabel="Delete goal"
      isPending={remove.isPending}
      onConfirm={() =>
        goal &&
        remove.mutate(goal.id, {
          onSuccess: () => {
            notify({ tone: "neutral", title: "Goal deleted" });
            onClose();
          },
        })
      }
      body={
        <div className="flex flex-col gap-3">
          <p>
            <span className="font-medium text-ink">{goal?.title}</span> is removed for good. To keep
            it on record, drop it instead.
          </p>
          {remove.error ? <InlineError>{errorMessage(remove.error)}</InlineError> : null}
        </div>
      }
    />
  );
}

/** Add a goal, or edit one (title, detail, target date). */
export function GoalSheet({
  isOpen,
  onOpenChange,
  clientId,
  goal,
  firstName,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  goal: GoalDto | null;
  firstName: string;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const { save } = useGoalWrites(clientId);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [targetDate, setTargetDate] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed each time the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setTitle(goal?.title ?? "");
    setDetail(goal?.detail ?? "");
    setTargetDate(goal?.targetDate ?? "");
    save.reset();
  }, [isOpen]);
  const submit = () => {
    if (!title.trim() || !online) return;
    save.mutate(
      {
        id: goal?.id,
        title: title.trim(),
        detail: detail.trim() || null,
        targetDate: targetDate || null,
      },
      {
        onSuccess: () => {
          notify({
            tone: "success",
            title: goal ? "Goal updated" : "Goal added",
            body: title.trim(),
          });
          onOpenChange(false);
        },
      },
    );
  };
  const errs = fieldErrors(save.error);
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={goal ? "Edit goal" : "Add a goal"}
      description={
        goal ? undefined : `Something ${firstName} can reach, like a rating or a shot to master.`
      }
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!title.trim() || !online}
            isPending={save.isPending}
            onPress={submit}
          >
            {goal ? "Save goal" : "Add goal"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label="Goal"
          isRequired
          autoFocus
          value={title}
          onChange={setTitle}
          placeholder="Land 7 of 10 third-shot drops in the kitchen"
          error={errs.title}
        />
        <TextAreaField
          label="Details (optional)"
          rows={3}
          value={detail}
          onChange={setDetail}
          placeholder="How you'll measure it, drills that help"
          error={errs.detail}
        />
        <TextField
          label="Target date (optional)"
          type="date"
          min={goal ? undefined : fmt.today()}
          value={targetDate}
          onChange={setTargetDate}
          error={errs.targetDate}
        />
        {save.error && !Object.keys(errs).length ? (
          <InlineError>{errorMessage(save.error)}</InlineError>
        ) : null}
        <OfflineHint>You're offline. Reconnect to save goals.</OfflineHint>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
