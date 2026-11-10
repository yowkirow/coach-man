import type { AssessmentDto, CoachRefDto, GoalDto, NoteDto, ProgressDto } from "@shared/api-types";
import { localTime } from "@shared/time";
import { ArrowUpRight, ClipboardCheck, Flag, NotebookPen, Trophy } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { CoachAvatar } from "../../components/domain/coaches";
import { Button } from "../../components/ui/button";
import { Card, Pill } from "../../components/ui/display";
import { SelectField } from "../../components/ui/field";
import { type Format, plural, useFormat } from "../../lib/format";
import { useWritesCoaching } from "../../lib/hooks";
import { SectionHead } from "./bits";
import { DeleteNoteSheet, EditNoteSheet, NoteComposer, NoteItem } from "./notes";

type Entry =
  | { kind: "note"; id: string; key: string; author: string | null; note: NoteDto }
  | { kind: "assessment"; id: string; key: string; author: string | null; a: AssessmentDto }
  | {
      kind: "goal";
      id: string;
      key: string;
      author: string | null;
      g: GoalDto;
      reached: boolean;
    };

const at = (epoch: number, fmt: Format) => `${fmt.dayOf(epoch)} ${localTime(epoch, fmt.tz)}`;

function entriesOf(p: ProgressDto, fmt: Format): Entry[] {
  const out: Entry[] = [];
  for (const n of p.notes) {
    out.push({
      kind: "note",
      id: `n-${n.id}`,
      key: at(n.createdAt, fmt),
      author: n.createdBy,
      note: n,
    });
  }
  for (const a of p.assessments) {
    out.push({
      kind: "assessment",
      id: `a-${a.id}`,
      key: `${a.assessedOn} ${localTime(a.createdAt, fmt.tz)}`,
      author: a.createdBy,
      a,
    });
  }
  for (const g of p.goals) {
    out.push({
      kind: "goal",
      id: `g-${g.id}`,
      key: at(g.createdAt, fmt),
      author: g.createdBy,
      g,
      reached: false,
    });
    if (g.status === "achieved" && g.achievedOn) {
      out.push({
        kind: "goal",
        id: `r-${g.id}`,
        key: `${g.achievedOn} 23:59`,
        author: g.createdBy,
        g,
        reached: true,
      });
    }
  }
  return out.sort((x, y) => y.key.localeCompare(x.key));
}

function Byline({
  author,
  when,
  extra,
}: {
  author: CoachRefDto | null;
  when: string;
  extra?: ReactNode;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-ink-2">
      {author ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <CoachAvatar coach={author} size="xs" />
          {author.name}
        </span>
      ) : null}
      <span className="num">{when}</span>
      {extra}
    </span>
  );
}

const ICON = "flex size-9 shrink-0 items-center justify-center rounded-full bg-panel text-ink";

/**
 * Every coach's notes, assessments, and goals for this student on one timeline, newest first
 * (pinned notes on top), with who wrote each and a filter by coach. New notes start here. People
 * who don't coach see what the family sees, and write nothing.
 */
export function CoachingTimelineCard({
  clientId,
  firstName,
  progress,
  onOpenAssessment,
}: {
  clientId: string;
  firstName: string;
  progress: ProgressDto;
  onOpenAssessment: (a: AssessmentDto) => void;
}) {
  const fmt = useFormat();
  const writes = useWritesCoaching();
  const [coach, setCoach] = useState("all");
  const [limit, setLimit] = useState(12);
  const [editing, setEditing] = useState<NoteDto | null>(null);
  const [deleting, setDeleting] = useState<NoteDto | null>(null);
  const all = useMemo(() => entriesOf(progress, fmt), [progress, fmt]);

  const authors = useMemo(() => {
    const map = new Map<string, CoachRefDto>();
    for (const n of progress.notes) if (n.author) map.set(n.author.userId, n.author);
    for (const a of progress.assessments) if (a.author) map.set(a.author.userId, a.author);
    for (const g of progress.goals) if (g.author) map.set(g.author.userId, g.author);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [progress]);
  const byCoach = coach === "all" ? all : all.filter((e) => e.author === coach);
  const pinned = byCoach.filter((e) => e.kind === "note" && e.note.pinned);
  const rest = byCoach.filter((e) => !(e.kind === "note" && e.note.pinned));
  const shown = [...pinned, ...rest.slice(0, limit)];
  const hidden = byCoach.length - shown.length;
  const authorOf = (id: string | null) => authors.find((a) => a.userId === id) ?? null;

  return (
    <Card label="Coaching timeline">
      <SectionHead
        title="Coaching timeline"
        count={all.length || undefined}
        action={
          authors.length > 1 ? (
            <SelectField
              label="Coach"
              className="w-56"
              options={[
                { id: "all", label: "All coaches" },
                ...authors.map((a) => ({ id: a.userId, label: a.name })),
              ]}
              value={coach}
              onChange={(v) => {
                setCoach(v);
                setLimit(12);
              }}
            />
          ) : undefined
        }
      />
      <div className="px-5 pb-2">
        {writes ? <NoteComposer clientId={clientId} firstName={firstName} /> : null}
        {shown.length ? (
          <ol
            aria-label="Notes, assessments, and goals"
            className={`flex flex-col divide-y divide-line ${writes ? "mt-3 border-t border-line" : ""}`}
          >
            {shown.map((e) => {
              if (e.kind === "note") {
                return (
                  <NoteItem
                    key={e.id}
                    note={e.note}
                    clientId={clientId}
                    onEdit={writes ? setEditing : undefined}
                    onDelete={writes ? setDeleting : undefined}
                  />
                );
              }
              if (e.kind === "assessment") {
                const a = e.a;
                return (
                  <li key={e.id} className="py-2">
                    <button
                      type="button"
                      onClick={() => onOpenAssessment(a)}
                      className="flex w-full cursor-pointer items-start gap-3 rounded-2xl py-1.5 text-left outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
                    >
                      <span aria-hidden className={ICON}>
                        <ClipboardCheck className="size-4.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <Byline
                          author={authorOf(a.createdBy) ?? a.author}
                          when={fmt.date(a.assessedOn)}
                          extra={
                            a.sharedWithFamily ? (
                              <Pill tone="sky">Shared with family</Pill>
                            ) : (
                              <Pill tone="outline">Coaches only</Pill>
                            )
                          }
                        />
                        <span className="mt-1 block font-medium">Skills assessed</span>
                        <span className="num block text-[0.8125rem] text-ink-2">
                          {plural(a.scores.length, "skill")}
                          {a.overallLevel ? ` · overall level ${a.overallLevel}` : ""}
                        </span>
                      </span>
                      <ArrowUpRight aria-hidden className="mt-2 size-4 shrink-0 text-ink-3" />
                    </button>
                  </li>
                );
              }
              const g = e.g;
              return (
                <li key={e.id} className="flex items-start gap-3 py-3.5">
                  <span aria-hidden className={ICON}>
                    {e.reached ? <Trophy className="size-4.5" /> : <Flag className="size-4.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Byline
                      author={e.reached ? null : (authorOf(g.createdBy) ?? g.author)}
                      when={
                        e.reached && g.achievedOn
                          ? fmt.date(g.achievedOn)
                          : fmt.date(fmt.dayOf(g.createdAt))
                      }
                    />
                    <p className="mt-1 font-medium">
                      {e.reached ? "Reached a goal" : "Set a goal"}
                    </p>
                    <p className="text-[0.9375rem]">{g.title}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-4 mb-3 flex items-center gap-2 text-ink-2">
            <NotebookPen aria-hidden className="size-4.5 shrink-0" />
            {coach !== "all"
              ? "Nothing from this coach yet."
              : writes
                ? "Nothing yet. Notes, assessments, and goals from every coach land here."
                : "Nothing shared with the family yet."}
          </p>
        )}
        {hidden > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="mb-3"
            onPress={() => setLimit((n) => n + 20)}
          >
            Show {plural(hidden, "older entry", "older entries")}
          </Button>
        ) : null}
      </div>
      <EditNoteSheet
        note={editing}
        clientId={clientId}
        firstName={firstName}
        onClose={() => setEditing(null)}
      />
      <DeleteNoteSheet note={deleting} clientId={clientId} onClose={() => setDeleting(null)} />
    </Card>
  );
}
