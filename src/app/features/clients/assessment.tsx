import type { AssessmentDto, ProgressDto, SkillDto } from "@shared/api-types";
import { SCORE_MAX, SCORE_MIN } from "@shared/domain";
import { useMutation } from "@tanstack/react-query";
import { ChevronRight, ClipboardCheck, Copy, NotebookPen, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Radio, RadioGroup } from "react-aria-components";
import { CoachAvatar } from "../../components/domain/coaches";
import { Button, IconButton } from "../../components/ui/button";
import { Card, Pill } from "../../components/ui/display";
import { EmptyState, InlineError } from "../../components/ui/feedback";
import { Switch, TextAreaField, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { useSkills } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { OfflineHint, SectionHead } from "./bits";
import { LevelField } from "./client-form";
import { average, SCORE_LABELS, skillsByCategory } from "./client-utils";
import { useRefreshClient, useStoreProgress } from "./queries";

const STEPS = Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, i) => SCORE_MIN + i);
const pct = (score: number) => (score / SCORE_MAX) * 100;

/**
 * Fixed 1–5 scale: five segments, filled to the score. A ringed marker shows where the skill
 * stood at the previous assessment, so progress reads at a glance and never rescales.
 */
export function SkillBar({ score, previous }: { score: number | null; previous?: number | null }) {
  return (
    <span aria-hidden className="relative block h-2.5 w-full">
      <span className="absolute inset-0 overflow-hidden rounded-full bg-ink/8">
        {score !== null ? (
          <span
            className="absolute inset-y-0 left-0 bg-ink transition-[width] duration-300 ease-out"
            style={{ width: `${pct(score)}%` }}
          />
        ) : null}
        {STEPS.slice(0, -1).map((s) => (
          <span
            key={s}
            className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-card"
            style={{ left: `${pct(s)}%` }}
          />
        ))}
      </span>
      {previous ? (
        <span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-3 bg-card"
          style={{ left: previous === SCORE_MAX ? "calc(100% - 7px)" : `${pct(previous)}%` }}
        />
      ) : null}
    </span>
  );
}

function Delta({ now, before }: { now: number | null; before: number | null | undefined }) {
  if (now === null || !before || now === before) return <span className="w-8" />;
  const up = now > before;
  return (
    <span
      className={`num w-8 text-right text-[0.8125rem] font-medium ${up ? "text-ink" : "text-[#b42318]"}`}
    >
      {up ? "+" : "−"}
      {Math.abs(now - before)}
    </span>
  );
}

interface ScoreRow {
  score: number | null;
  previous: number | null;
  note?: string | null;
}

/** One assessment, each skill compared with its most recent score before it. */
function compareWithEarlier(current: AssessmentDto, earlier: AssessmentDto[]) {
  const before = latestPerSkill(earlier);
  const out = new Map<string, ScoreRow>();
  for (const s of current.scores) {
    out.set(s.skillId, {
      score: s.score,
      previous: before.get(s.skillId)?.score ?? null,
      note: s.note,
    });
  }
  return out;
}

/** Each skill's most recent score and the one before it, so partial assessments still read. */
function latestPerSkill(assessments: AssessmentDto[]) {
  const out = new Map<string, ScoreRow>();
  for (const a of assessments) {
    for (const s of a.scores) {
      out.set(s.skillId, {
        score: s.score,
        previous: out.get(s.skillId)?.score ?? null,
        note: s.note,
      });
    }
  }
  return out;
}

/** Scores grouped by category on the fixed scale, each with its earlier score ghosted. */
function ScoreTable({
  skills,
  rows,
  showNotes = false,
}: {
  skills: SkillDto[];
  rows: Map<string, ScoreRow>;
  showNotes?: boolean;
}) {
  const used = skills.filter((s) => rows.has(s.id));
  return (
    <div className="flex flex-col gap-5">
      {skillsByCategory(used).map(({ category, items }) => {
        const avg = average(
          items.map((s) => rows.get(s.id)?.score).filter((v): v is number => !!v),
        );
        return (
          <section key={category} aria-label={category}>
            <h3 className="mb-1.5 flex items-baseline justify-between gap-3 text-[0.9375rem] font-medium">
              {category}
              {avg !== null ? (
                <span className="num text-[0.8125rem] font-normal text-ink-2">
                  {avg.toFixed(1)} average
                </span>
              ) : null}
            </h3>
            <ul className="flex flex-col">
              {items.map((s) => {
                const row = rows.get(s.id);
                const score = row?.score ?? null;
                const prev = row?.previous ?? null;
                return (
                  <li key={s.id} className="py-1.5">
                    <div className="grid grid-cols-[minmax(6.5rem,9rem)_minmax(0,1fr)_1.5rem_2rem] items-center gap-3">
                      <span className="truncate text-[0.875rem]">{s.name}</span>
                      <SkillBar score={score} previous={prev} />
                      <span className="num text-right text-[0.9375rem] font-medium">
                        {score ?? "–"}
                      </span>
                      <Delta now={score} before={prev} />
                    </div>
                    <span className="sr-only">
                      {score
                        ? `${s.name}: ${score} of ${SCORE_MAX}, ${SCORE_LABELS[score]}`
                        : `${s.name}: not scored`}
                      {prev ? `. Previously ${prev}.` : ""}
                    </span>
                    {showNotes && row?.note ? (
                      <p className="mt-1 text-[0.8125rem] text-ink-2">{row.note}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Legend({ latest, previous }: { latest: string; previous?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-ink-2">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-5 rounded-full bg-ink" />
        {latest}
      </span>
      {previous ? (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3.5 rounded-full border-2 border-ink-3 bg-card" />
          {previous}
        </span>
      ) : null}
      <span>Scale 1–5</span>
    </p>
  );
}

/** Each skill's latest score on the fixed scale, with its score the time before ghosted. */
export function SkillsCard({
  progress,
  onNew,
  canWrite,
}: {
  progress: ProgressDto;
  onNew: () => void;
  canWrite: boolean;
}) {
  const fmt = useFormat();
  const latest = progress.assessments.at(-1);
  const rows = useMemo(() => latestPerSkill(progress.assessments), [progress.assessments]);
  const levels = progress.assessments.filter((a) => a.overallLevel);
  const level = levels.at(-1)?.overallLevel;
  const levelBefore = levels.at(-2)?.overallLevel;
  const action = (
    <Button
      variant="light"
      size="sm"
      isDisabled={!canWrite}
      icon={<ClipboardCheck aria-hidden className="size-4" />}
      onPress={onNew}
    >
      New assessment
    </Button>
  );
  if (!latest) {
    return (
      <Card label="Skills">
        <SectionHead title="Skills" />
        <div className="px-5 pb-3">
          <EmptyState
            icon={<ClipboardCheck aria-hidden className="size-5" />}
            title="No assessments yet"
            body="Score each skill from 1 to 5 to set a baseline. Later assessments show the change against it, on the same scale."
            action={
              <Button variant="dark" isDisabled={!canWrite} onPress={onNew}>
                Start a baseline
              </Button>
            }
          />
        </div>
      </Card>
    );
  }
  return (
    <Card label="Skills">
      <SectionHead title="Skills" action={action} />
      <div className="flex flex-col gap-5 px-5 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Legend
            latest={`Latest score · assessed ${fmt.date(latest.assessedOn)}`}
            previous={progress.assessments.length > 1 ? "The time before" : undefined}
          />
          {level ? (
            <p className="flex items-baseline gap-2">
              <span className="text-[0.8125rem] text-ink-2">Overall level</span>
              <span className="num text-[2rem] leading-none font-light">{level}</span>
              {levelBefore && levelBefore !== level ? (
                <span className="num text-[0.8125rem] text-ink-2">from {levelBefore}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        <ScoreTable skills={progress.skills} rows={rows} />
        {latest.notes ? (
          <p className="max-w-[65ch] rounded-2xl bg-panel px-4 py-3 text-[0.9375rem]">
            {latest.notes}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** Every assessment, newest first; each opens a read-only detail. */
export function AssessmentHistoryCard({
  assessments,
  onOpen,
}: {
  assessments: AssessmentDto[];
  onOpen: (a: AssessmentDto) => void;
}) {
  const fmt = useFormat();
  if (assessments.length < 2) return null;
  const rows = [...assessments].reverse();
  return (
    <Card label="Assessment history">
      <SectionHead title="Assessment history" count={assessments.length} />
      <ul className="flex flex-col px-3 pb-3">
        {rows.map((a) => {
          const avg = average(a.scores.map((s) => s.score));
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onOpen(a)}
                className="flex w-full cursor-pointer items-center gap-4 rounded-2xl px-2 py-3 text-left outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
              >
                <span className="num w-[6.5rem] shrink-0 font-medium">
                  {fmt.date(a.assessedOn)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="num block text-[0.875rem]">
                    {plural(a.scores.length, "skill")}
                    {avg !== null ? ` · ${avg.toFixed(1)} average` : ""}
                  </span>
                  {a.notes ? (
                    <span className="block truncate text-[0.8125rem] text-ink-2">{a.notes}</span>
                  ) : null}
                </span>
                {a.overallLevel ? (
                  <Pill tone="lavender">
                    <span className="num">{a.overallLevel}</span>
                  </Pill>
                ) : null}
                <ChevronRight aria-hidden className="size-4.5 shrink-0 text-ink-3" />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Assessments are shared with the family by default (progress is the point); a coach can hold one back. */
function SharedWithFamilySwitch({
  isSelected,
  onChange,
  firstName,
  isDisabled,
}: {
  isSelected: boolean;
  onChange: (v: boolean) => void;
  firstName: string;
  isDisabled?: boolean;
}) {
  return (
    <div className="rounded-[22px] bg-panel px-4 py-1.5">
      <Switch
        isSelected={isSelected}
        onChange={onChange}
        isDisabled={isDisabled}
        description={
          isSelected
            ? `${firstName} and their parents can see these scores in the family portal.`
            : "Only coaches see this assessment."
        }
      >
        Visible to student & parents
      </Switch>
    </div>
  );
}

/** Read-only view of one assessment, compared with the one before it. */
export function AssessmentDetailSheet({
  assessment,
  progress,
  clientId,
  firstName,
  onClose,
}: {
  assessment: AssessmentDto | null;
  progress: ProgressDto;
  clientId: string;
  firstName: string;
  onClose: () => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const storeProgress = useStoreProgress();
  const refresh = useRefreshClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (id: string) => api.del<ProgressDto>(`/assessments/${id}`),
    onSuccess: (p) => {
      storeProgress(clientId, p);
      refresh(clientId, { skip: "progress" });
      notify({ tone: "neutral", title: "Assessment deleted" });
      onClose();
    },
  });
  const share = useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; sharedWithFamily: boolean }) =>
      api.patch<ProgressDto>(`/assessments/${v.id}`, { sharedWithFamily: v.sharedWithFamily }),
    onSuccess: (p, v) => {
      storeProgress(clientId, p);
      notify({
        tone: "success",
        title: v.sharedWithFamily ? "Shared with the family" : "Now for coaches only",
      });
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another assessment opens.
  useEffect(() => {
    setConfirming(false);
    remove.reset();
    share.reset();
  }, [assessment?.id]);
  // The cached progress updates after a change; show this assessment's current state.
  const current = assessment
    ? (progress.assessments.find((a) => a.id === assessment.id) ?? assessment)
    : null;
  const index = assessment ? progress.assessments.findIndex((a) => a.id === assessment.id) : -1;
  const earlier = index > 0 ? progress.assessments.slice(0, index) : [];
  return (
    <Sheet
      isOpen={assessment !== null}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={assessment ? `Assessment, ${fmt.date(assessment.assessedOn)}` : "Assessment"}
      description={
        assessment
          ? [
              assessment.overallLevel ? `Overall level ${assessment.overallLevel}` : null,
              plural(assessment.scores.length, "skill"),
              earlier.length ? "compared with each skill's score before" : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined
      }
      footer={
        confirming ? (
          <>
            <span className="mr-auto text-[0.875rem] text-ink-2">Delete it for good?</span>
            <Button variant="light" onPress={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              isDisabled={!online}
              isPending={remove.isPending}
              onPress={() => assessment && remove.mutate(assessment.id)}
            >
              Delete assessment
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              className="mr-auto text-[#b42318]"
              isDisabled={!online}
              onPress={() => setConfirming(true)}
            >
              Delete
            </Button>
            <Button variant="dark" onPress={onClose}>
              Done
            </Button>
          </>
        )
      }
    >
      {assessment ? (
        <div className="flex flex-col gap-5">
          {current?.author ? (
            <p className="flex items-center gap-2 text-[0.875rem] text-ink-2">
              <CoachAvatar coach={current.author} size="xs" />
              Assessed by <span className="font-medium text-ink">{current.author.name}</span>
            </p>
          ) : null}
          <Legend
            latest={fmt.date(assessment.assessedOn)}
            previous={earlier.length ? "Score before" : undefined}
          />
          <ScoreTable
            skills={progress.skills}
            rows={compareWithEarlier(assessment, earlier)}
            showNotes
          />
          {assessment.notes ? (
            <p className="rounded-2xl bg-panel px-4 py-3">{assessment.notes}</p>
          ) : null}
          <SharedWithFamilySwitch
            isSelected={current?.sharedWithFamily ?? true}
            isDisabled={!online || share.isPending}
            firstName={firstName}
            onChange={(v) => current && share.mutate({ id: current.id, sharedWithFamily: v })}
          />
          {share.error ? <InlineError>{errorMessage(share.error)}</InlineError> : null}
          {remove.error ? <InlineError>{errorMessage(remove.error)}</InlineError> : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/** Five 44px dots on a radio group; dots up to the score fill in. The last score is ringed. */
function ScoreDots({
  skill,
  value,
  previous,
  onChange,
}: {
  skill: string;
  value: number | undefined;
  previous: number | undefined;
  onChange: (v: number) => void;
}) {
  return (
    <RadioGroup
      aria-label={`${skill} score`}
      orientation="horizontal"
      value={value ? String(value) : null}
      onChange={(v) => onChange(Number(v))}
      className="-mx-1.5 flex items-center"
    >
      {STEPS.map((n) => {
        const filled = value !== undefined && n <= value;
        return (
          <Radio
            key={n}
            value={String(n)}
            aria-label={`${n} of ${SCORE_MAX}, ${SCORE_LABELS[n]}${previous === n ? ", last score" : ""}`}
            className="group relative flex size-11 cursor-pointer items-center justify-center outline-none"
          >
            <span
              className={`size-6 rounded-full transition-[background-color,transform] duration-150 ease-out group-data-[pressed]:scale-90 group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-ink ${
                filled ? "bg-ink" : "bg-panel ring-1 ring-line-strong group-hover:bg-line"
              } ${previous === n ? "shadow-[0_0_0_3px_var(--color-card),0_0_0_5px_var(--color-ink-3)]" : ""}`}
            />
          </Radio>
        );
      })}
    </RadioGroup>
  );
}

/** Score active skills 1–5 (skip any you didn't see), add notes, and set the overall level. */
export function NewAssessmentSheet({
  isOpen,
  onOpenChange,
  clientId,
  firstName,
  currentLevel,
  history,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  firstName: string;
  currentLevel: string | null;
  /** Earlier assessments, oldest first; each skill's latest score is ringed. */
  history: AssessmentDto[];
}) {
  const fmt = useFormat();
  const online = useOnline();
  const skills = useSkills();
  const storeProgress = useStoreProgress();
  const refresh = useRefreshClient();
  const active = useMemo(() => (skills.data ?? []).filter((s) => s.active), [skills.data]);
  const lastScores = useMemo(() => latestPerSkill(history), [history]);
  const hasHistory = history.length > 0;
  const [assessedOn, setAssessedOn] = useState(fmt.today());
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState("");
  const [summary, setSummary] = useState("");
  const [shared, setShared] = useState(true);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api.post<ProgressDto>(`/clients/${clientId}/assessments`, {
        assessedOn,
        overallLevel: level.trim() || null,
        notes: summary.trim() || null,
        sharedWithFamily: shared,
        scores: Object.entries(scores).map(([skillId, score]) => ({
          skillId,
          score,
          note: notes[skillId]?.trim() || null,
        })),
      }),
    onSuccess: (p) => {
      storeProgress(clientId, p);
      refresh(clientId, { skip: "progress" });
      notify({
        tone: "success",
        title: "Assessment saved",
        body: `${plural(Object.keys(scores).length, "skill")} scored for ${firstName}.`,
      });
      onOpenChange(false);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: start fresh each time it opens.
  useEffect(() => {
    if (!isOpen) return;
    setAssessedOn(fmt.today());
    setScores({});
    setNotes({});
    setOpenNotes(new Set());
    setLevel(currentLevel ?? "");
    setSummary("");
    setShared(true);
    save.reset();
  }, [isOpen]);

  const scored = Object.keys(scores).length;
  const copyLast = () => {
    const next: Record<string, number> = {};
    for (const s of active) {
      const prev = lastScores.get(s.id)?.score;
      if (prev) next[s.id] = prev;
    }
    setScores(next);
  };

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title="New assessment"
      description={
        hasHistory
          ? "Score what you saw from 1 to 5 and skip the rest. Ringed dots show each skill's last score."
          : "Score what you saw from 1 to 5 and skip the rest."
      }
      footer={
        <>
          <span className="num mr-auto text-[0.875rem] text-ink-2">
            {scored} of {active.length} scored
          </span>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!scored || !online || !assessedOn}
            isPending={save.isPending}
            onPress={() => save.mutate()}
          >
            Save assessment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label="Date"
            type="date"
            max={fmt.today()}
            value={assessedOn}
            onChange={setAssessedOn}
            className="w-44"
          />
          {hasHistory ? (
            <Button
              variant="ghost"
              size="md"
              icon={<Copy aria-hidden className="size-4" />}
              onPress={copyLast}
            >
              Start from last scores
            </Button>
          ) : null}
        </div>
        {skills.isPending ? (
          <p className="text-ink-2">Loading skills…</p>
        ) : active.length === 0 ? (
          <p className="text-ink-2">
            No active skills. Turn skills on in Settings to assess against them.
          </p>
        ) : (
          skillsByCategory(active).map(({ category, items }) => (
            <section key={category} aria-label={category} className="flex flex-col">
              <h3 className="mb-1 text-[1rem] font-medium">{category}</h3>
              <ul className="flex flex-col divide-y divide-line">
                {items.map((s) => {
                  const value = scores[s.id];
                  const noteOpen = openNotes.has(s.id);
                  return (
                    <li key={s.id} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                        <div className="min-w-[13rem] flex-1">
                          <p className="font-medium">
                            {s.name}
                            {value ? (
                              <span aria-hidden className="font-normal text-ink-2">
                                {" "}
                                · {SCORE_LABELS[value]}
                              </span>
                            ) : null}
                          </p>
                          {s.description ? (
                            <p className="text-[0.8125rem] text-ink-2">{s.description}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center">
                          <ScoreDots
                            skill={s.name}
                            value={value}
                            previous={lastScores.get(s.id)?.score ?? undefined}
                            onChange={(v) => setScores((prev) => ({ ...prev, [s.id]: v }))}
                          />
                          {value ? (
                            <IconButton
                              label={`Clear ${s.name} score`}
                              className="ml-1"
                              onPress={() => setScores(({ [s.id]: _drop, ...rest }) => rest)}
                            >
                              <X aria-hidden className="size-4.5" />
                            </IconButton>
                          ) : (
                            <span aria-hidden className="ml-1 size-11" />
                          )}
                          <IconButton
                            label={
                              noteOpen ? `Hide note for ${s.name}` : `Add a note for ${s.name}`
                            }
                            variant={notes[s.id]?.trim() ? "soft" : "ghost"}
                            onPress={() =>
                              setOpenNotes((prev) => {
                                const next = new Set(prev);
                                if (next.has(s.id)) next.delete(s.id);
                                else next.add(s.id);
                                return next;
                              })
                            }
                          >
                            <NotebookPen aria-hidden className="size-4.5" />
                          </IconButton>
                        </div>
                      </div>
                      {noteOpen ? (
                        <TextField
                          label={`Note on ${s.name}`}
                          className="mt-2"
                          autoFocus
                          value={notes[s.id] ?? ""}
                          onChange={(v) => setNotes((prev) => ({ ...prev, [s.id]: v }))}
                          placeholder="What to keep, what to fix"
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
        <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <LevelField
            label="Overall level"
            value={level}
            onChange={setLevel}
            description="Updates the level on their profile."
          />
          <TextAreaField
            label="Summary (optional)"
            rows={3}
            value={summary}
            onChange={setSummary}
            placeholder="Big picture: what improved, what's next"
          />
        </div>
        <SharedWithFamilySwitch isSelected={shared} onChange={setShared} firstName={firstName} />
        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <OfflineHint>You're offline. Reconnect to save the assessment.</OfflineHint>
      </div>
    </Sheet>
  );
}
