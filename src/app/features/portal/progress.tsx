import type { PortalAssessmentDto, PortalGoalDto, PortalProgressDto } from "@shared/api-types";
import { SCORE_MAX } from "@shared/domain";
import { CheckCircle2, ClipboardCheck, Goal, MessageSquareText, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Pill, Timeline, type TimelineEntry } from "../../components/ui/display";
import type { Format } from "../../lib/format";
import { SkillBar } from "../clients/assessment";
import {
  average,
  RATING_SOURCE_LABELS,
  SCORE_LABELS,
  shortDate,
  skillsByCategory,
} from "../clients/client-utils";
import { RatingChartView } from "../clients/ratings";
import { CoachLine, PortalCard, QueryGate } from "./bits";
import { useAcademyFormat, usePortalProgress } from "./queries";
import { PortalPage, useCurrentStudent } from "./shell";

interface SkillRow {
  score: number;
  previous: number | null;
  note: string | null;
}

/** Each skill's latest shared score, with the one before it ghosted (never rescaled). */
function latestPerSkill(assessments: PortalAssessmentDto[]) {
  const out = new Map<string, SkillRow>();
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

function Skills({ p, fmt, who }: { p: PortalProgressDto; fmt: Format; who: string }) {
  const latest = p.assessments.at(-1);
  const rows = useMemo(() => latestPerSkill(p.assessments), [p.assessments]);
  const levels = p.assessments.filter((a) => a.overallLevel);
  const level = levels.at(-1)?.overallLevel;
  const levelBefore = levels.at(-2)?.overallLevel;
  if (!latest) {
    return (
      <PortalCard title="Skills">
        <p className="flex items-start gap-3 text-[0.9375rem] text-ink-2">
          <ClipboardCheck aria-hidden className="mt-0.5 size-4.5 shrink-0" />
          <span>
            When a coach assesses {who} skills and shares it, each skill shows here on a 1 to 5
            scale, with the change since the time before.
          </span>
        </p>
      </PortalCard>
    );
  }
  const used = p.skills.filter((s) => rows.has(s.id));
  return (
    <PortalCard title="Skills">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1 text-[0.8125rem] text-ink-2">
            <span className="num">
              Assessed {fmt.date(latest.assessedOn)}
              {latest.author ? ` by ${latest.author.name}` : ""}
            </span>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-5 rounded-full bg-ink" />
                Latest score
              </span>
              {p.assessments.length > 1 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-3.5 rounded-full border-2 border-ink-3 bg-card"
                  />
                  The time before
                </span>
              ) : null}
              <span>Scale 1–5</span>
            </span>
          </div>
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
        {skillsByCategory(used).map(({ category, items }) => {
          const avg = average(items.map((s) => rows.get(s.id)?.score ?? 0).filter(Boolean));
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
                  if (!row) return null;
                  return (
                    <li key={s.id} className="py-1.5">
                      <div className="grid grid-cols-[minmax(6.5rem,9rem)_minmax(0,1fr)_1.5rem] items-center gap-3">
                        <span className="truncate text-[0.875rem]">{s.name}</span>
                        <SkillBar score={row.score} previous={row.previous} />
                        <span className="num text-right text-[0.9375rem] font-medium">
                          {row.score}
                        </span>
                      </div>
                      <span className="sr-only">
                        {`${s.name}: ${row.score} of ${SCORE_MAX}, ${SCORE_LABELS[row.score] ?? ""}`}
                        {row.previous ? `. Previously ${row.previous}.` : ""}
                      </span>
                      {row.note ? (
                        <p className="mt-1 text-[0.8125rem] text-ink-2">{row.note}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {latest.notes ? (
          <p className="max-w-[65ch] rounded-[22px] bg-panel px-4 py-3 text-[0.9375rem] whitespace-pre-line">
            {latest.notes}
          </p>
        ) : null}
        {p.assessments.length > 1 ? (
          <div className="border-t border-line pt-3">
            <h3 className="text-[0.9375rem] font-medium">Earlier assessments</h3>
            <ul className="mt-1 flex flex-col divide-y divide-line">
              {[...p.assessments]
                .reverse()
                .slice(1)
                .map((a) => (
                  <li
                    key={a.id}
                    className="num flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[0.875rem]"
                  >
                    <span className="font-medium">{fmt.date(a.assessedOn)}</span>
                    {a.overallLevel ? <Pill tone="panel">Level {a.overallLevel}</Pill> : null}
                    {a.author ? <span className="text-ink-2">{a.author.name}</span> : null}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </div>
    </PortalCard>
  );
}

const GOAL_PILL = {
  active: { tone: "violet", label: "Working on it" },
  achieved: { tone: "mint", label: "Reached" },
  dropped: { tone: "outline", label: "Set aside" },
} as const;

function Goals({ goals, fmt, who }: { goals: PortalGoalDto[]; fmt: Format; who: string }) {
  return (
    <PortalCard title="Goals">
      {goals.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {goals.map((g) => {
            const pill = GOAL_PILL[g.status];
            return (
              <li key={g.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  aria-hidden
                  className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${g.status === "achieved" ? "bg-mint" : "bg-panel"} text-ink`}
                >
                  {g.status === "achieved" ? (
                    <CheckCircle2 className="size-4.5" />
                  ) : (
                    <Goal className="size-4.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className={`font-medium ${g.status === "dropped" ? "text-ink-2" : ""}`}>
                      {g.title}
                    </span>
                    <Pill tone={pill.tone}>{pill.label}</Pill>
                  </p>
                  {g.detail ? (
                    <p className="mt-0.5 text-[0.875rem] text-ink-2">{g.detail}</p>
                  ) : null}
                  <p className="num mt-0.5 text-[0.8125rem] text-ink-2">
                    {[
                      g.status === "achieved" && g.achievedOn
                        ? `Reached ${fmt.date(g.achievedOn)}`
                        : g.targetDate
                          ? `Aiming for ${fmt.date(g.targetDate)}`
                          : null,
                      g.author ? `set by ${g.author.name}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[0.9375rem] text-ink-2">
          Goals {who === "your" ? "you and your coach" : "the coach"} set show here, with their
          target dates.
        </p>
      )}
    </PortalCard>
  );
}

function Ratings({ p, fmt }: { p: PortalProgressDto; fmt: Format }) {
  // A self-rating (given when enrolling) is the player's own estimate: it never stands in for
  // the coach's or DUPR's number when there is one, and says what it is when it's all there is.
  const measured = p.ratings.filter((r) => r.source !== "self");
  const latest = measured.at(-1) ?? p.ratings.at(-1);
  const self = p.ratings.filter((r) => r.source === "self").at(-1);
  return (
    <PortalCard title="Rating">
      {latest ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-baseline gap-2">
            <span className="num text-[2rem] leading-none font-light">
              {latest.value.toFixed(2)}
            </span>
            <span className="num text-[0.8125rem] text-ink-2">
              {RATING_SOURCE_LABELS[latest.source]} · {fmt.date(latest.recordedOn)}
            </span>
          </p>
          {self && self !== latest ? (
            <p className="num text-[0.8125rem] text-ink-2">
              Self-rating {self.value.toFixed(2)} · {fmt.date(self.recordedOn)}
            </p>
          ) : null}
          {latest.source === "self" ? (
            <p className="text-[0.8125rem] text-ink-2">
              The level given when enrolling. Coach and DUPR ratings show here as they're recorded.
            </p>
          ) : null}
          {p.ratings.length > 1 ? <RatingChartView ratings={p.ratings} fmt={fmt} /> : null}
        </div>
      ) : (
        <p className="flex items-start gap-3 text-[0.9375rem] text-ink-2">
          <TrendingUp aria-hidden className="mt-0.5 size-4.5 shrink-0" />
          <span>
            DUPR and coach ratings show here as they're recorded, on a fixed 2.0–8.0 scale.
          </span>
        </p>
      )}
    </PortalCard>
  );
}

function Comments({ p, fmt, who }: { p: PortalProgressDto; fmt: Format; who: string }) {
  const [limit, setLimit] = useState(10);
  const year = fmt.today().slice(0, 4);
  const entries: TimelineEntry[] = p.comments.slice(0, limit).map((c) => {
    const day = fmt.dayOf(c.createdAt);
    return {
      id: c.id,
      date: day.startsWith(year) ? shortDate(day, fmt) : fmt.date(day),
      icon: <MessageSquareText className="size-4.5" />,
      tone: "amber",
      content: (
        <article className="rounded-[22px] bg-card px-5 py-4">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.875rem]">
            {c.author ? (
              <CoachLine coach={c.author} />
            ) : (
              <span className="font-medium">A coach</span>
            )}
            {c.session ? <span className="text-ink-2">· {c.session.title}</span> : null}
            {c.editedAt ? <span className="text-ink-2">· edited</span> : null}
          </p>
          <p className="mt-1.5 max-w-[65ch] text-[0.9375rem] whitespace-pre-line">{c.body}</p>
        </article>
      ),
    };
  });
  return (
    <section aria-labelledby="portal-comments" className="flex flex-col gap-2">
      <h2 id="portal-comments" className="px-1 text-[1.125rem] font-medium">
        Coaches' comments
      </h2>
      {entries.length ? (
        <Timeline entries={entries} />
      ) : (
        <p className="px-1 text-[0.9375rem] text-ink-2">
          Comments coaches share about {who} training show here, newest first, with who wrote them.
        </p>
      )}
      {p.comments.length > limit ? (
        <Button
          variant="light"
          size="sm"
          className="ml-[68px] self-start"
          onPress={() => setLimit((n) => n + 20)}
        >
          Show earlier comments
        </Button>
      ) : null}
    </section>
  );
}

/** Progress: shared skills assessments, goals, ratings, and the coaches' shared comments. */
export function PortalProgress({ clientId }: { clientId: string }) {
  const progress = usePortalProgress(clientId);
  const { current } = useCurrentStudent();
  const fmt = useAcademyFormat(progress.data?.academy);
  const self = current?.relation === "self";
  const who = self ? "your" : `${current?.firstName ?? "their"}'s`;
  return (
    <PortalPage
      title="Progress"
      subtitle={current ? `${current.firstName} ${current.lastName}`.trim() : undefined}
      students
    >
      <QueryGate query={progress}>
        {(p) => (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
            <div className="flex flex-col gap-5">
              <Skills p={p} fmt={fmt} who={who} />
              <Comments p={p} fmt={fmt} who={who} />
            </div>
            <div className="flex flex-col gap-5">
              <Goals goals={p.goals} fmt={fmt} who={self ? "your" : who} />
              <Ratings p={p} fmt={fmt} />
            </div>
          </div>
        )}
      </QueryGate>
    </PortalPage>
  );
}
