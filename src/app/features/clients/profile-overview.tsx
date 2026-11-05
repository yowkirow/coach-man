import type { AssessmentDto, ClientDetailDto, ProgressDto, StatementDto } from "@shared/api-types";
import { ATTENDANCE_LABELS, LESSON_KIND_LABELS } from "@shared/domain";
import { localTime } from "@shared/time";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  CircleDollarSign,
  ClipboardCheck,
  HeartPulse,
  NotebookPen,
  Pencil,
  Tent,
  Ticket,
  TrendingUp,
  Trophy,
  UserPlus,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button";
import { Card, KeyValue, Pill, Timeline, type TimelineEntry } from "../../components/ui/display";
import { type Format, plural, useFormat } from "../../lib/format";
import { SectionHead } from "./bits";
import {
  ATTENDANCE_PILL,
  ageText,
  HAND_LABELS,
  RATING_SOURCE_LABELS,
  shortDate,
} from "./client-utils";
import { CoachesCard } from "./coaches";
import { NoteItem } from "./notes";
import { UpcomingList } from "./profile-sessions";

interface Activity {
  id: string;
  /** Sort key: local "YYYY-MM-DD HH:MM". */
  key: string;
  day: string;
  icon: ReactNode;
  tone: TimelineEntry["tone"];
  title: ReactNode;
  detail?: ReactNode;
  pill?: ReactNode;
  to?: { lessonId: string };
  onPress?: () => void;
}

const ICON = "size-4.5";

function paidPill(amount: number, paid: number, voided: boolean, fmt: Format) {
  if (voided) return <Pill tone="outline">Voided</Pill>;
  if (paid >= amount) return <Pill tone="mint">Paid</Pill>;
  if (paid > 0)
    return (
      <Pill tone="amber">
        <span className="num">{fmt.moneyShort(amount - paid)} due</span>
      </Pill>
    );
  return <Pill tone="coral">Unpaid</Pill>;
}

function buildActivity(
  detail: ClientDetailDto,
  statement: StatementDto | undefined,
  progress: ProgressDto | undefined,
  fmt: Format,
  onAssessment: (a: AssessmentDto) => void,
): Activity[] {
  const at = (epoch: number) => `${fmt.dayOf(epoch)} ${localTime(epoch, fmt.tz)}`;
  const today = fmt.today();
  const out: Activity[] = [];

  for (const a of detail.recentAttendance) {
    const came = a.status === "present" || a.status === "late";
    const missed = a.status === "absent" || a.status === "no_show" || a.status === "late_cancel";
    out.push({
      id: `att-${a.lessonId}`,
      key: at(a.startsAt),
      day: fmt.dayOf(a.startsAt),
      icon: came ? (
        <CalendarCheck2 className={ICON} />
      ) : missed ? (
        <CalendarX2 className={ICON} />
      ) : (
        <CalendarClock className={ICON} />
      ),
      tone: came ? "sky" : a.status === "late_cancel" ? "amber" : missed ? "coral" : "sky",
      title: a.title,
      detail: [
        `${LESSON_KIND_LABELS[a.kind]} · ${fmt.time(a.startsAt)}`,
        a.packageName && came ? `1 credit from ${a.packageName}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      pill: (
        <Pill tone={ATTENDANCE_PILL[a.status]}>
          {a.status === "booked" ? "Not marked" : ATTENDANCE_LABELS[a.status]}
        </Pill>
      ),
      to: { lessonId: a.lessonId },
    });
  }

  for (const c of statement?.charges ?? []) {
    if (c.kind !== "package") continue;
    out.push({
      id: `chg-${c.id}`,
      key: `${c.occurredOn} 12:00`,
      day: c.occurredOn,
      icon: <Ticket className={ICON} />,
      tone: "lavender",
      title: `Bought ${c.description}`,
      detail: <span className="num">{fmt.money(c.amountMinor)}</span>,
      pill: paidPill(c.amountMinor, c.paidMinor, Boolean(c.voidedAt), fmt),
    });
  }

  for (const p of statement?.payments ?? []) {
    out.push({
      id: `pay-${p.id}`,
      key: `${p.paidOn} 12:01`,
      day: p.paidOn,
      icon: <CircleDollarSign className={ICON} />,
      tone: "lavender",
      title: <span className="num">Paid {fmt.money(p.amountMinor)}</span>,
      detail: [p.method, p.reference ? `Ref ${p.reference}` : null].filter(Boolean).join(" · "),
      pill: p.voidedAt ? <Pill tone="outline">Voided</Pill> : undefined,
    });
  }

  for (const n of progress?.notes ?? []) {
    out.push({
      id: `note-${n.id}`,
      key: at(n.createdAt),
      day: fmt.dayOf(n.createdAt),
      icon: <NotebookPen className={ICON} />,
      tone: "amber",
      title: <span className="line-clamp-2 font-normal whitespace-pre-line">{n.body}</span>,
      detail: [
        n.kind === "handoff" ? "Handoff note" : n.pinned ? "Pinned note" : "Note",
        n.author ? `by ${n.author.name}` : null,
        n.lessonId ? "from a session" : null,
        fmt.time(n.createdAt),
      ]
        .filter(Boolean)
        .join(" · "),
      pill: n.pending ? (
        <Pill tone="amber">Waiting to sync</Pill>
      ) : n.visibility === "shared" && n.kind !== "handoff" ? (
        <Pill tone="sky">Shared with family</Pill>
      ) : undefined,
    });
  }

  for (const g of progress?.goals ?? []) {
    if (g.status !== "achieved" || !g.achievedOn) continue;
    out.push({
      id: `goal-${g.id}`,
      key: `${g.achievedOn} 12:02`,
      day: g.achievedOn,
      icon: <Trophy className={ICON} />,
      tone: "lime",
      title: "Reached a goal",
      detail: g.title,
    });
  }

  for (const a of progress?.assessments ?? []) {
    out.push({
      id: `asm-${a.id}`,
      key: `${a.assessedOn} 12:03`,
      day: a.assessedOn,
      icon: <ClipboardCheck className={ICON} />,
      tone: "lime",
      title: "Skills assessed",
      detail: [
        plural(a.scores.length, "skill"),
        a.overallLevel ? `overall level ${a.overallLevel}` : null,
        a.author ? `by ${a.author.name}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      onPress: () => onAssessment(a),
    });
  }

  for (const r of progress?.ratings ?? []) {
    out.push({
      id: `rat-${r.id}`,
      key: `${r.recordedOn} 12:04`,
      day: r.recordedOn,
      icon: <TrendingUp className={ICON} />,
      tone: "lime",
      title: (
        <span className="num">
          {RATING_SOURCE_LABELS[r.source]} rating {r.value.toFixed(2)}
        </span>
      ),
    });
  }

  for (const r of detail.registrations) {
    if (r.startsOn > today) continue;
    out.push({
      id: `reg-${r.id}`,
      key: `${r.startsOn} 08:00`,
      day: r.startsOn,
      icon: <Tent className={ICON} />,
      tone: "amber",
      title: r.eventName,
      detail:
        r.status === "registered"
          ? "Registered"
          : r.status === "waitlisted"
            ? "On the waitlist"
            : "Registration cancelled",
    });
  }

  const joined = detail.client.joinedOn;
  if (joined) {
    out.push({
      id: "joined",
      key: `${joined} 00:00`,
      day: joined,
      icon: <UserPlus className={ICON} />,
      tone: "sky",
      title: `Joined as a client`,
      detail: detail.client.source ? `Found you through ${detail.client.source}` : undefined,
    });
  }

  return out.sort((a, b) => b.key.localeCompare(a.key));
}

function ActivityCard({ item }: { item: Activity }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{item.title}</span>
        {item.detail ? (
          <span className="mt-0.5 block text-[0.8125rem] text-ink-2">{item.detail}</span>
        ) : null}
      </span>
      {item.pill ? <span className="shrink-0">{item.pill}</span> : null}
      {item.to || item.onPress ? (
        <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ink-3" />
      ) : null}
    </>
  );
  const cls =
    "flex min-h-[4.25rem] w-full items-start gap-3 rounded-[22px] bg-card px-5 py-4 text-left";
  const interactive =
    "cursor-pointer outline-none transition-colors hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
  if (item.to)
    return (
      <Link
        to="/sessions/$lessonId"
        params={{ lessonId: item.to.lessonId }}
        className={`${cls} ${interactive}`}
      >
        {body}
      </Link>
    );
  if (item.onPress)
    return (
      <button type="button" onClick={item.onPress} className={`${cls} ${interactive}`}>
        {body}
      </button>
    );
  return <div className={cls}>{body}</div>;
}

/** The reference's activity history: dated nodes on the canvas, white cards beside them. */
function ActivityTimeline({
  detail,
  statement,
  progress,
  onAssessment,
}: {
  detail: ClientDetailDto;
  statement?: StatementDto;
  progress?: ProgressDto;
  onAssessment: (a: AssessmentDto) => void;
}) {
  const fmt = useFormat();
  const [limit, setLimit] = useState(8);
  const items = buildActivity(detail, statement, progress, fmt, onAssessment);
  const year = fmt.today().slice(0, 4);
  const entries: TimelineEntry[] = items.slice(0, limit).map((a) => ({
    id: a.id,
    date: a.day.startsWith(year) ? shortDate(a.day, fmt) : fmt.date(a.day),
    icon: a.icon,
    tone: a.tone,
    content: <ActivityCard item={a} />,
  }));
  return (
    <section aria-labelledby="activity-title" className="flex flex-col gap-2">
      <h2 id="activity-title" className="px-1 text-[1.125rem] font-medium">
        Activity
      </h2>
      {entries.length ? (
        <Timeline entries={entries} />
      ) : (
        <p className="px-1 text-ink-2">Check-ins, payments, notes, and goals show up here.</p>
      )}
      {items.length > limit ? (
        <Button
          variant="light"
          size="sm"
          className="ml-[68px] self-start"
          onPress={() => setLimit((n) => n + 12)}
        >
          Show earlier activity
        </Button>
      ) : null}
    </section>
  );
}

function tel(v: string) {
  return `tel:${v.replace(/[^\d+]/g, "")}`;
}

const linkCls =
  "rounded-sm font-medium underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink";

function DetailsCard({ detail, onEdit }: { detail: ClientDetailDto; onEdit: () => void }) {
  const fmt = useFormat();
  const c = detail.client;
  const age = ageText(c.birthDate, fmt.today());
  const items: { label: string; value: ReactNode; wide?: boolean }[] = [];
  if (c.phone)
    items.push({
      label: "Phone",
      value: (
        <a href={tel(c.phone)} className={linkCls}>
          {c.phone}
        </a>
      ),
    });
  if (c.email)
    items.push({
      label: "Email",
      value: (
        <a href={`mailto:${c.email}`} className={`${linkCls} break-all`}>
          {c.email}
        </a>
      ),
    });
  if (c.birthDate)
    items.push({
      label: "Birth date",
      value: (
        <span className="num">
          {fmt.date(c.birthDate)}
          {age ? ` · ${age}` : ""}
        </span>
      ),
    });
  if (c.isJunior || c.guardianName || c.guardianPhone || c.guardianEmail)
    items.push({
      label: "Guardian",
      value:
        c.guardianName || c.guardianPhone || c.guardianEmail ? (
          <span className="flex flex-col">
            {c.guardianName ? <span>{c.guardianName}</span> : null}
            {c.guardianPhone ? (
              <a href={tel(c.guardianPhone)} className={`${linkCls} self-start`}>
                {c.guardianPhone}
              </a>
            ) : null}
            {c.guardianEmail ? (
              <a href={`mailto:${c.guardianEmail}`} className={`${linkCls} self-start break-all`}>
                {c.guardianEmail}
              </a>
            ) : null}
          </span>
        ) : (
          <span className="text-ink-2">Not added yet</span>
        ),
    });
  if (c.emergencyName || c.emergencyPhone)
    items.push({
      label: "Emergency contact",
      value: (
        <span className="flex flex-col">
          {c.emergencyName ? <span>{c.emergencyName}</span> : null}
          {c.emergencyPhone ? (
            <a href={tel(c.emergencyPhone)} className={`${linkCls} self-start`}>
              {c.emergencyPhone}
            </a>
          ) : null}
        </span>
      ),
    });
  if (c.level) items.push({ label: "Level", value: <span className="num">{c.level}</span> });
  if (c.duprRating !== null || c.duprId)
    items.push({
      label: "DUPR",
      value: (
        <span className="num">
          {c.duprRating !== null ? c.duprRating.toFixed(2) : "No rating"}
          {c.duprId ? <span className="text-ink-2"> · ID {c.duprId}</span> : null}
        </span>
      ),
    });
  if (c.dominantHand)
    items.push({ label: "Plays", value: HAND_LABELS[c.dominantHand] ?? c.dominantHand });
  if (c.paddle) items.push({ label: "Paddle", value: c.paddle });
  if (c.joinedOn)
    items.push({
      label: "Client since",
      value: (
        <span className="num">
          {fmt.date(c.joinedOn)}
          {c.source ? <span className="text-ink-2"> · {c.source}</span> : null}
        </span>
      ),
    });
  if (c.goals)
    items.push({
      label: "Goals",
      value: <span className="whitespace-pre-line">{c.goals}</span>,
      wide: true,
    });
  if (c.notes)
    items.push({
      label: "Profile notes",
      value: <span className="whitespace-pre-line">{c.notes}</span>,
      wide: true,
    });

  return (
    <Card label="Details">
      <SectionHead
        title="Details"
        action={
          <Button
            variant="light"
            size="sm"
            icon={<Pencil aria-hidden className="size-4" />}
            onPress={onEdit}
          >
            Edit
          </Button>
        }
      />
      <div className="flex flex-col gap-5 px-5 pb-5">
        {c.medicalNotes ? (
          <div
            id="medical-notes"
            tabIndex={-1}
            className="flex scroll-mt-24 items-start gap-3 rounded-[20px] bg-coral-soft px-4 py-3.5 text-[#5c0e0e] outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            <HeartPulse aria-hidden className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-medium">Medical note</p>
              <p className="mt-0.5 whitespace-pre-line">{c.medicalNotes}</p>
            </div>
          </div>
        ) : null}
        {items.length ? (
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {items.map((it) => (
              <div key={it.label} className={it.wide ? "sm:col-span-2" : undefined}>
                <KeyValue label={it.label}>{it.value}</KeyValue>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-ink-2">
            Only a name so far. Add contact details, a level, and an emergency contact.
          </p>
        )}
      </div>
    </Card>
  );
}

function CoachNotesCard({
  detail,
  progress,
  onNote,
  onAll,
}: {
  detail: ClientDetailDto;
  progress?: ProgressDto;
  onNote: () => void;
  onAll: () => void;
}) {
  const notes = progress?.notes ?? [];
  const shown = notes.slice(0, 3);
  return (
    <Card label="Coach notes">
      <SectionHead
        title="Coach notes"
        count={notes.length || undefined}
        action={
          <Button
            variant="light"
            size="sm"
            icon={<NotebookPen aria-hidden className="size-4" />}
            onPress={onNote}
          >
            Add note
          </Button>
        }
      />
      <div className="px-5 pb-3">
        {shown.length ? (
          <ol className="flex flex-col divide-y divide-line">
            {shown.map((n) => (
              <NoteItem key={n.id} note={n} clientId={detail.client.id} />
            ))}
          </ol>
        ) : (
          <p className="pb-2 text-ink-2">
            {progress
              ? "No notes yet. Jot what clicked and what to work on; it saves even offline."
              : "Loading notes…"}
          </p>
        )}
        {notes.length > shown.length ? (
          <Button variant="ghost" size="sm" className="mb-2" onPress={onAll}>
            All {notes.length} notes
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export function OverviewTab({
  detail,
  statement,
  progress,
  onTab,
  onEdit,
  onNote,
  onAssessment,
}: {
  detail: ClientDetailDto;
  statement?: StatementDto;
  progress?: ProgressDto;
  onTab: (tab: "sessions" | "progress") => void;
  onEdit: () => void;
  onNote: () => void;
  onAssessment: (a: AssessmentDto) => void;
}) {
  const c = detail.client;
  return (
    <div className="flex flex-col gap-5">
      <Card label="Coming up">
        <SectionHead
          title="Coming up"
          count={detail.upcoming.length || undefined}
          action={
            detail.upcoming.length > 3 ? (
              <Button variant="light" size="sm" onPress={() => onTab("sessions")}>
                All sessions
              </Button>
            ) : undefined
          }
        />
        <div className="px-3 pb-3">
          <UpcomingList detail={detail} limit={3} firstName={c.firstName} />
        </div>
      </Card>
      <CoachesCard detail={detail} />
      <ActivityTimeline
        detail={detail}
        statement={statement}
        progress={progress}
        onAssessment={onAssessment}
      />
      <DetailsCard detail={detail} onEdit={onEdit} />
      <CoachNotesCard
        detail={detail}
        progress={progress}
        onNote={onNote}
        onAll={() => onTab("progress")}
      />
    </div>
  );
}
