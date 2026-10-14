import type { LessonDetailDto, NoteDto, RosterEntryDto } from "@shared/api-types";
import { LESSON_KIND_LABELS } from "@shared/domain";
import { uuidv7 } from "@shared/ids";
import { localTime } from "@shared/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, CheckCheck, Ellipsis, NotebookPen, RotateCcw, UserPlus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ClientPicker, type SessionPhase, sessionPhase } from "../../components/domain/lesson";
import { RosterRow, useAttendance } from "../../components/domain/roster";
import { Button, IconButton } from "../../components/ui/button";
import {
  Bento,
  Card,
  CheckItem,
  KeyValue,
  Pill,
  PillTabs,
  type PillTone,
} from "../../components/ui/display";
import {
  EmptyState,
  ErrorState,
  InlineError,
  RowsSkeleton,
  Skeleton,
} from "../../components/ui/feedback";
import {
  MoneyField,
  Segmented,
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/ui/field";
import { ActionMenu, ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { ApiRequestError, api, errorMessage } from "../../lib/api";
import { type Format, fullName, plural, useFormat } from "../../lib/format";
import { useLesson, useVenues } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { type CompleteVars, keys, type NoteVars, storeLesson } from "../../lib/query";

type Lesson = LessonDetailDto["lesson"];

const PHASE_TONE: Record<SessionPhase, PillTone> = {
  live: "lime",
  upcoming: "violet",
  done: "sky",
  cancelled: "coral",
};

export function phaseLabel(
  lesson: Pick<Lesson, "startsAt" | "endsAt" | "status">,
  now: number,
  fmt: Format,
): string {
  switch (sessionPhase(lesson, now)) {
    case "live":
      return now < lesson.startsAt
        ? `Starts ${fmt.relative(lesson.startsAt, now)}`
        : "On court now";
    case "upcoming":
      return `Starts ${fmt.relative(lesson.startsAt, now)}`;
    case "done":
      return lesson.status === "completed" ? "Completed" : "Not marked complete";
    default:
      return "Cancelled";
  }
}

export function whereOf(l: { venueName: string | null; court: string | null }) {
  return [l.court ? `Court ${l.court}` : null, l.venueName].filter(Boolean).join(" · ");
}

function useLessonCacheSync() {
  const qc = useQueryClient();
  return (detail?: LessonDetailDto | null) => {
    if (detail) storeLesson(detail);
    void qc.invalidateQueries({ queryKey: ["lessons"] });
    void qc.invalidateQueries({ queryKey: keys.today });
  };
}

/**
 * The session workspace: title, action circles, roster/notes/details tabs, and the
 * lavender credits + lime plan cards. Shared by Today (desktop) and the session page.
 */
export function SessionDetail({
  lessonId,
  now,
  back,
  extraAside,
}: {
  lessonId: string;
  now: number;
  /** Show a back circle (session page). */
  back?: boolean;
  extraAside?: ReactNode;
}) {
  const q = useLesson(lessonId);
  const [tab, setTab] = useState("roster");
  const [noteFocus, setNoteFocus] = useState(false);
  const [sheet, setSheet] = useState<null | "add" | "edit" | "plan" | "cancel" | "delete">(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset tabs and sheets when the session changes.
  useEffect(() => {
    setTab("roster");
    setSheet(null);
  }, [lessonId]);

  if (q.isPending) return <SessionSkeleton />;
  if (q.isError || !q.data) {
    return (
      <ErrorState
        message={q.error ? errorMessage(q.error) : "This session isn't available offline yet."}
        onRetry={() => void q.refetch()}
      />
    );
  }
  const detail = q.data;
  const l = detail.lesson;
  const cancelled = l.status === "cancelled";

  return (
    <div className="flex flex-col gap-6">
      <SessionHeader
        detail={detail}
        now={now}
        back={back}
        onAdd={() => setSheet("add")}
        onNote={() => {
          setTab("notes");
          setNoteFocus(true);
        }}
        onEdit={() => setSheet("edit")}
        onCancel={() => setSheet("cancel")}
        onDelete={() => setSheet("delete")}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PillTabs
          label="Session sections"
          selected={tab}
          onChange={setTab}
          tabs={[
            {
              id: "roster",
              label: `Roster · ${l.checkedInCount}/${l.bookedCount}`,
              content: <RosterPanel detail={detail} onAdd={() => setSheet("add")} />,
            },
            {
              id: "notes",
              label: detail.notes.length ? `Notes · ${detail.notes.length}` : "Notes",
              content: <NotesPanel detail={detail} autoFocus={noteFocus} />,
            },
            { id: "details", label: "Details", content: <DetailsPanel detail={detail} /> },
          ]}
        />
        <div className="flex flex-col gap-4 xl:pt-15">
          <div className="hidden xl:block">
            <CreditsBento detail={detail} />
          </div>
          <PlanBento detail={detail} cancelled={cancelled} onEditPlan={() => setSheet("plan")} />
          {extraAside}
        </div>
      </div>

      <AddPlayerSheet
        isOpen={sheet === "add"}
        onOpenChange={(o) => setSheet(o ? "add" : null)}
        detail={detail}
      />
      <EditSessionSheet
        isOpen={sheet === "edit" || sheet === "plan"}
        focusPlan={sheet === "plan"}
        onOpenChange={(o) => setSheet(o ? sheet : null)}
        detail={detail}
      />
      <CancelSessionSheet
        isOpen={sheet === "cancel"}
        onOpenChange={(o) => setSheet(o ? "cancel" : null)}
        detail={detail}
      />
      <DeleteSessionSheet
        isOpen={sheet === "delete"}
        onOpenChange={(o) => setSheet(o ? "delete" : null)}
        detail={detail}
      />
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading session…</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-11 w-2/3 max-w-md" />
        <Skeleton className="h-4 w-1/3 max-w-xs" />
      </div>
      <Card className="p-5">
        <RowsSkeleton rows={4} />
      </Card>
    </div>
  );
}

function SessionHeader({
  detail,
  now,
  back,
  onAdd,
  onNote,
  onEdit,
  onCancel,
  onDelete,
}: {
  detail: LessonDetailDto;
  now: number;
  back?: boolean;
  onAdd: () => void;
  onNote: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const fmt = useFormat();
  const router = useRouter();
  const sync = useLessonCacheSync();
  const l = detail.lesson;
  const cancelled = l.status === "cancelled";
  const completed = l.status === "completed";
  const funded = detail.roster.some((r) => r.consumedPackageId || r.chargeId);
  const complete = useMutation<unknown, Error, CompleteVars>({
    mutationKey: ["lessons", "complete"],
  });
  const simple = useMutation({
    mutationFn: (action: "reopen" | "restore") =>
      api.post<LessonDetailDto>(`/lessons/${l.id}/${action}`),
    onSuccess: (d, action) => {
      sync(d);
      notify({
        tone: "success",
        title: action === "reopen" ? "Session reopened" : "Session restored",
      });
    },
    onError: (err) =>
      notify({ tone: "danger", title: "Couldn't update the session", body: errorMessage(err) }),
  });
  const where = whereOf(l);
  const phase = sessionPhase(l, now);

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-1 basis-[26rem] items-start gap-3">
        {back ? (
          <IconButton
            label="Back"
            variant="white"
            size="md"
            className="mt-1 shrink-0"
            onPress={() => router.history.back()}
          >
            <ArrowLeft aria-hidden className="size-5" />
          </IconButton>
        ) : null}
        <div className="min-w-0">
          <h1
            className={`text-[2rem] leading-[1.08] font-light tracking-[-0.02em] lg:text-[2.75rem] ${cancelled ? "text-ink-2 line-through decoration-2" : ""}`}
          >
            {l.title}
          </h1>
          <p className="num mt-2 text-[0.9375rem] text-ink-2">
            {fmt.longDay(fmt.dayOf(l.startsAt))} · {fmt.timeRange(l.startsAt, l.endsAt)}
            {where ? ` · ${where}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill tone={PHASE_TONE[phase]}>{phaseLabel(l, now, fmt)}</Pill>
            <Pill tone="white">{LESSON_KIND_LABELS[l.kind]}</Pill>
            {l.groupName ? <Pill tone="violet">{l.groupName}</Pill> : null}
            {l.eventName ? <Pill tone="amber">{l.eventName}</Pill> : null}
            {l.seriesId ? <Pill tone="outline">Repeats weekly</Pill> : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <IconButton
          label="Add player"
          variant="lime"
          size="lg"
          isDisabled={cancelled}
          onPress={onAdd}
        >
          <UserPlus aria-hidden className="size-5" />
        </IconButton>
        <IconButton label="Add a note" variant="lime" size="lg" onPress={onNote}>
          <NotebookPen aria-hidden className="size-5" />
        </IconButton>
        {completed ? (
          <IconButton
            label="Reopen session"
            variant="lime"
            size="lg"
            isDisabled={simple.isPending}
            onPress={() => simple.mutate("reopen")}
          >
            <RotateCcw aria-hidden className="size-5" />
          </IconButton>
        ) : (
          <IconButton
            label="Mark session complete"
            variant="lime"
            size="lg"
            isDisabled={cancelled}
            onPress={() => {
              complete.mutate({ lessonId: l.id, mutationId: uuidv7() });
              notify({
                tone: "success",
                title: "Session completed",
                body: `${plural(l.checkedInCount, "player")} checked in.`,
              });
            }}
          >
            <CheckCheck aria-hidden className="size-5" />
          </IconButton>
        )}
        <ActionMenu
          label="More session actions"
          trigger={
            <IconButton label="More session actions" variant="white" size="lg">
              <Ellipsis aria-hidden className="size-5" />
            </IconButton>
          }
          actions={[
            { id: "edit", label: "Edit session", onAction: onEdit, isDisabled: cancelled },
            cancelled
              ? {
                  id: "restore",
                  label: "Restore session",
                  onAction: () => simple.mutate("restore"),
                }
              : { id: "cancel", label: "Cancel session", onAction: onCancel },
            {
              id: "delete",
              label: funded ? "Delete (undo check-ins first)" : "Delete session",
              tone: "danger",
              onAction: onDelete,
              isDisabled: funded,
            },
          ]}
        />
      </div>
    </header>
  );
}

function RosterPanel({ detail, onAdd }: { detail: LessonDetailDto; onAdd: () => void }) {
  const l = detail.lesson;
  const qc = useQueryClient();
  const sync = useLessonCacheSync();
  const attendance = useAttendance();
  const cancelled = l.status === "cancelled";
  const waiting = detail.roster.filter((r) => r.status === "booked");

  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (clientId: string) =>
      api.del<LessonDetailDto>(`/lessons/${l.id}/participants/${clientId}`),
    onSuccess: (d) => {
      sync(d);
      notify({ tone: "neutral", title: "Removed from this session" });
    },
    onError: (err) =>
      notify({ tone: "danger", title: "Couldn't remove player", body: errorMessage(err) }),
  });

  const checkInAll = async () => {
    const run = (r: RosterEntryDto, status: "present" | "booked") =>
      attendance.mutateAsync({
        lessonId: l.id,
        attendanceId: r.attendanceId,
        status,
        mutationId: uuidv7(),
      });
    const targets = waiting;
    notify({
      tone: "success",
      title: `${plural(targets.length, "player")} checked in`,
      action: {
        label: "Undo",
        onAction: () =>
          void Promise.allSettled(targets.map((r) => run(r, "booked"))).then(() =>
            qc.invalidateQueries({ queryKey: keys.lesson(l.id) }),
          ),
      },
    });
    await Promise.allSettled(targets.map((r) => run(r, "present")));
    // Responses can land out of order; settle on the server's final roster.
    void qc.invalidateQueries({ queryKey: keys.lesson(l.id) });
    void qc.invalidateQueries({ queryKey: keys.today });
  };

  return (
    <Card label="Roster">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-1">
        <h2 className="text-[1.125rem] font-medium">
          Check-in{" "}
          <span className="num font-normal text-ink-2">
            {l.checkedInCount}/{l.bookedCount}
          </span>
        </h2>
        <div className="flex gap-2">
          {waiting.length > 1 && !cancelled ? (
            <Button variant="light" size="sm" onPress={() => void checkInAll()}>
              Check in all
            </Button>
          ) : null}
          <Button
            variant="light"
            size="sm"
            icon={<UserPlus aria-hidden className="size-4" />}
            isDisabled={cancelled}
            onPress={onAdd}
          >
            Add player
          </Button>
        </div>
      </div>
      {detail.roster.length ? (
        <div className="flex flex-col divide-y divide-line px-5 pb-2">
          {detail.roster.map((entry) => (
            <RosterRow
              key={entry.attendanceId}
              entry={entry}
              lessonId={l.id}
              lessonKind={l.kind}
              lessonCancelled={cancelled}
              onRemove={(clientId) => remove.mutate(clientId)}
            />
          ))}
        </div>
      ) : (
        <div className="px-5 pb-5">
          <EmptyState
            icon={<UserPlus aria-hidden className="size-5" />}
            title="No players yet"
            body="Add the players you expect. Walk-ins can be added on court, even offline."
            action={
              <Button variant="dark" isDisabled={cancelled} onPress={onAdd}>
                Add player
              </Button>
            }
          />
        </div>
      )}
    </Card>
  );
}

function NotesPanel({ detail, autoFocus }: { detail: LessonDetailDto; autoFocus: boolean }) {
  const fmt = useFormat();
  const [body, setBody] = useState("");
  const create = useMutation<unknown, Error, NoteVars>({ mutationKey: ["notes", "create"] });
  const names = new Map(detail.roster.map((r) => [r.clientId, fullName(r)]));
  const notes: NoteDto[] = [...detail.notes].sort((a, b) => b.createdAt - a.createdAt);
  const sameDay = (t: number) => fmt.dayOf(t) === fmt.dayOf(detail.lesson.startsAt);

  return (
    <Card className="p-5" label="Session notes">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          create.mutate({ id: uuidv7(), lessonId: detail.lesson.id, body: body.trim() });
          setBody("");
        }}
      >
        <TextAreaField
          label="Add a note"
          value={body}
          onChange={setBody}
          autoFocus={autoFocus}
          placeholder="Drills, what clicked, what to fix next time…"
        />
        <Button
          type="submit"
          variant="dark"
          size="sm"
          className="self-end"
          isDisabled={!body.trim()}
        >
          Save note
        </Button>
      </form>
      {notes.length ? (
        <ol className="mt-4 flex flex-col divide-y divide-line">
          {notes.map((n) => (
            <li key={n.id} className="py-3.5">
              <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-2">
                <span className="num">
                  {sameDay(n.createdAt) ? fmt.time(n.createdAt) : fmt.day(fmt.dayOf(n.createdAt))}
                </span>
                {n.clientId ? (
                  <Pill tone="sky">{names.get(n.clientId) ?? "Player"}</Pill>
                ) : (
                  <Pill tone="panel">Whole session</Pill>
                )}
                {n.pending ? <Pill tone="amber">Waiting to sync</Pill> : null}
              </div>
              <p className="mt-1.5 whitespace-pre-line">{n.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-ink-2">
          No notes yet. Notes about a player also appear on their profile.
        </p>
      )}
    </Card>
  );
}

function DetailsPanel({ detail }: { detail: LessonDetailDto }) {
  const fmt = useFormat();
  const l = detail.lesson;
  return (
    <Card className="p-5" label="Session details">
      <dl className="grid gap-5 sm:grid-cols-2">
        <KeyValue label="When">
          <span className="num">
            {fmt.longDay(fmt.dayOf(l.startsAt))} · {fmt.timeRange(l.startsAt, l.endsAt)}
          </span>
        </KeyValue>
        <KeyValue label="Where">{whereOf(l) || "No venue set"}</KeyValue>
        <KeyValue label="Type">{LESSON_KIND_LABELS[l.kind]}</KeyValue>
        <KeyValue label="Price per player">
          <span className="num">{fmt.money(l.effectivePriceMinor)}</span>
          {l.priceMinor === null ? (
            <span className="text-ink-2"> · from your rate card</span>
          ) : null}
        </KeyValue>
        <KeyValue label="Capacity">
          {l.capacity ? `${l.bookedCount} of ${l.capacity} spots taken` : "No limit"}
        </KeyValue>
        <KeyValue label="Repeats">
          {l.seriesId ? "Part of a weekly series" : "One-off session"}
        </KeyValue>
        {l.groupId && l.groupName ? (
          <KeyValue label="Group">
            <Link
              to="/groups/$groupId"
              params={{ groupId: l.groupId }}
              className="font-medium underline underline-offset-4"
            >
              {l.groupName}
            </Link>
          </KeyValue>
        ) : null}
        {l.eventId && l.eventName ? (
          <KeyValue label="Event">
            <Link
              to="/events/$eventId"
              params={{ eventId: l.eventId }}
              className="font-medium underline underline-offset-4"
            >
              {l.eventName}
            </Link>
          </KeyValue>
        ) : null}
        {l.cancelReason ? <KeyValue label="Cancelled because">{l.cancelReason}</KeyValue> : null}
      </dl>
    </Card>
  );
}

function shortCredit(r: RosterEntryDto, fmt: Format) {
  if (r.complimentary) return "complimentary";
  if (r.packageRemaining !== null) return `${r.packageRemaining} left`;
  if (r.chargeMinor !== null) return `pays ${fmt.moneyShort(r.chargeMinor)}`;
  return "pays per session";
}

export function CreditsBento({ detail }: { detail: LessonDetailDto }) {
  const fmt = useFormat();
  const isEvent = detail.lesson.kind === "event";
  const rows = detail.roster.map((r) => ({
    r,
    ok: isEvent || r.complimentary || Boolean(r.consumedPackageId) || (r.packageRemaining ?? 0) > 0,
  }));
  const covered = rows.filter((x) => x.ok).length;
  return (
    <Bento
      tone="lavender"
      title="Credits"
      subtitle={
        isEvent
          ? "Covered by event registrations"
          : rows.length
            ? `${covered} of ${rows.length} covered by a package`
            : "Add players to see their credits"
      }
    >
      {rows.length ? (
        <ul className="flex flex-col">
          {rows.slice(0, 6).map(({ r, ok }) => (
            <CheckItem key={r.attendanceId} ok={ok}>
              {r.firstName} {r.lastName.slice(0, 1)}.{" "}
              <span className="text-ink/70">· {isEvent ? "registered" : shortCredit(r, fmt)}</span>
            </CheckItem>
          ))}
        </ul>
      ) : null}
      {rows.length > 6 ? (
        <p className="mt-1 text-[0.8125rem] text-ink/75">and {rows.length - 6} more</p>
      ) : null}
    </Bento>
  );
}

function PlanBento({
  detail,
  cancelled,
  onEditPlan,
}: {
  detail: LessonDetailDto;
  cancelled: boolean;
  onEditPlan: () => void;
}) {
  const l = detail.lesson;
  const sync = useLessonCacheSync();
  const complete = useMutation<unknown, Error, CompleteVars>({
    mutationKey: ["lessons", "complete"],
  });
  const reopen = useMutation({
    mutationFn: () => api.post<LessonDetailDto>(`/lessons/${l.id}/reopen`),
    onSuccess: (d) => sync(d),
  });
  return (
    <Bento
      tone="lime"
      title="Session plan"
      subtitle={l.status === "completed" ? "Completed" : "Drills and focus for this session"}
    >
      {l.notes ? (
        <p className="text-[0.9375rem] whitespace-pre-line">{l.notes}</p>
      ) : (
        <p className="text-[0.9375rem] text-ink/75">
          No plan yet. Jot the drills and focus so they're in your pocket on court.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {l.status === "completed" ? (
          <Button
            variant="dark"
            size="sm"
            isPending={reopen.isPending}
            onPress={() => reopen.mutate()}
          >
            Reopen
          </Button>
        ) : (
          <Button
            variant="dark"
            size="sm"
            isDisabled={cancelled}
            onPress={() => {
              complete.mutate({ lessonId: l.id, mutationId: uuidv7() });
              notify({ tone: "success", title: "Session completed" });
            }}
          >
            Mark complete
          </Button>
        )}
        <Button variant="light" size="sm" isDisabled={cancelled} onPress={onEditPlan}>
          {l.notes ? "Edit plan" : "Add plan"}
        </Button>
      </div>
    </Bento>
  );
}

function AddPlayerSheet({
  isOpen,
  onOpenChange,
  detail,
}: {
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
  detail: LessonDetailDto;
}) {
  const l = detail.lesson;
  const sync = useLessonCacheSync();
  const [full, setFull] = useState<{ clientId: string; name: string } | null>(null);
  const add = useMutation({
    meta: { silent: true },
    mutationFn: (v: { clientId: string; name: string; force?: boolean }) =>
      api.post<LessonDetailDto>(`/lessons/${l.id}/participants${v.force ? "?force=1" : ""}`, {
        clientId: v.clientId,
      }),
    onSuccess: (d, v) => {
      sync(d);
      setFull(null);
      notify({
        tone: "success",
        title: `${v.name} added`,
        body: "Check them in when they arrive.",
      });
    },
    onError: (err, v) => {
      if (err instanceof ApiRequestError && err.status === 409 && !v.force)
        setFull({ clientId: v.clientId, name: v.name });
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the sheet opens.
  useEffect(() => {
    if (isOpen) {
      setFull(null);
      add.reset();
    }
  }, [isOpen]);

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Add player"
      description={
        l.capacity
          ? `${l.bookedCount} of ${l.capacity} spots taken`
          : "Search your clients. Adding doesn't use a credit until check-in."
      }
    >
      <div className="flex flex-col gap-4">
        <ClientPicker
          label="Client"
          autoFocus
          exclude={detail.roster.map((r) => r.clientId)}
          onSelect={(c) => add.mutate({ clientId: c.id, name: c.firstName })}
        />
        {full ? (
          <div role="alert" className="flex flex-col gap-3 rounded-[22px] bg-amber-soft p-4">
            <p className="font-medium">This session is full.</p>
            <p className="text-[0.875rem] text-ink-2">
              Add {full.name} anyway? The roster goes over capacity by one.
            </p>
            <Button
              variant="dark"
              size="sm"
              className="self-start"
              isPending={add.isPending}
              onPress={() => add.mutate({ ...full, force: true })}
            >
              Add anyway
            </Button>
          </div>
        ) : add.error && !(add.error instanceof ApiRequestError && add.error.status === 409) ? (
          <InlineError>{errorMessage(add.error)}</InlineError>
        ) : null}
        {detail.roster.length ? (
          <p className="text-[0.8125rem] text-ink-2">
            Already on the roster: {detail.roster.map((r) => r.firstName).join(", ")}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

const DURATIONS = [30, 45, 60, 75, 90, 120, 150, 180];

function EditSessionSheet({
  isOpen,
  onOpenChange,
  detail,
  focusPlan,
}: {
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
  detail: LessonDetailDto;
  focusPlan: boolean;
}) {
  const fmt = useFormat();
  const navigate = useNavigate();
  const sync = useLessonCacheSync();
  const venues = useVenues();
  const l = detail.lesson;
  const initialDuration = Math.round((l.endsAt - l.startsAt) / 60_000);
  const [title, setTitle] = useState(l.title);
  const [date, setDate] = useState(fmt.dayOf(l.startsAt));
  const [start, setStart] = useState(localTime(l.startsAt, fmt.tz));
  const [duration, setDuration] = useState(String(initialDuration));
  const [venueId, setVenueId] = useState(l.venueId ?? "none");
  const [court, setCourt] = useState(l.court ?? "");
  const [capacity, setCapacity] = useState(l.capacity ? String(l.capacity) : "");
  const [price, setPrice] = useState<number | null>(l.priceMinor);
  const [plan, setPlan] = useState(l.notes ?? "");
  const [scope, setScope] = useState("this");

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed the form when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setTitle(l.title);
    setDate(fmt.dayOf(l.startsAt));
    setStart(localTime(l.startsAt, fmt.tz));
    setDuration(String(initialDuration));
    setVenueId(l.venueId ?? "none");
    setCourt(l.court ?? "");
    setCapacity(l.capacity ? String(l.capacity) : "");
    setPrice(l.priceMinor);
    setPlan(l.notes ?? "");
    setScope("this");
  }, [isOpen]);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api.patch<LessonDetailDto | null>(`/lessons/${l.id}`, {
        title: title.trim() !== l.title ? title.trim() || null : undefined,
        date,
        startTime: start,
        durationMinutes: Number(duration),
        venueId: venueId === "none" ? null : venueId,
        court: court.trim() || null,
        capacity: capacity ? Number(capacity) : null,
        priceMinor: price,
        notes: plan.trim() || null,
        scope,
      }),
    onSuccess: (d) => {
      sync(d);
      notify({
        tone: "success",
        title: scope === "following" ? "Series updated" : "Session updated",
      });
      onOpenChange(false);
      if (d && d.lesson.id !== l.id)
        void navigate({ to: "/sessions/$lessonId", params: { lessonId: d.lesson.id } });
    },
  });

  const durationOptions = [...new Set([...DURATIONS, initialDuration])]
    .sort((a, b) => a - b)
    .map((m) => ({ id: String(m), label: `${m} min` }));

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title={focusPlan ? "Session plan" : "Edit session"}
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dark" isPending={save.isPending} onPress={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {focusPlan ? (
          <TextAreaField
            label="Plan"
            rows={6}
            autoFocus
            value={plan}
            onChange={setPlan}
            placeholder="Warm-up: dinking ladder. Focus: third-shot drops. Finish: skinny singles."
          />
        ) : (
          <>
            {l.seriesId ? (
              <Segmented
                label="Apply changes to"
                value={scope}
                onChange={setScope}
                options={[
                  { id: "this", label: "This session" },
                  { id: "following", label: "This and following" },
                ]}
              />
            ) : null}
            <TextField label="Title" value={title} onChange={setTitle} />
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label="Date" type="date" value={date} onChange={setDate} />
              <TextField label="Start" type="time" value={start} onChange={setStart} />
              <SelectField
                label="Length"
                options={durationOptions}
                value={duration}
                onChange={setDuration}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Venue"
                options={[
                  { id: "none", label: "No venue" },
                  ...(venues.data ?? []).map((v) => ({ id: v.id, label: v.name })),
                ]}
                value={venueId}
                onChange={setVenueId}
              />
              <TextField label="Court" value={court} onChange={setCourt} placeholder="e.g. 3" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Capacity"
                type="number"
                min="1"
                inputMode="numeric"
                value={capacity}
                onChange={setCapacity}
                placeholder="No limit"
              />
              <MoneyField
                label="Price per player"
                currency={fmt.currency}
                valueMinor={price}
                onChange={setPrice}
                placeholder={fmt.money(l.effectivePriceMinor)}
                description="Leave empty to use your rate card."
              />
            </div>
            <TextAreaField
              label="Plan"
              value={plan}
              onChange={setPlan}
              placeholder="Drills and focus for this session"
            />
          </>
        )}
        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function CancelSessionSheet({
  isOpen,
  onOpenChange,
  detail,
}: {
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
  detail: LessonDetailDto;
}) {
  const l = detail.lesson;
  const sync = useLessonCacheSync();
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState("this");
  useEffect(() => {
    if (isOpen) {
      setReason("");
      setScope("this");
    }
  }, [isOpen]);
  const cancel = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api.post<LessonDetailDto>(`/lessons/${l.id}/cancel`, {
        reason: reason.trim() || null,
        scope,
      }),
    onSuccess: (d) => {
      sync(d);
      notify({
        tone: "neutral",
        title:
          scope === "following"
            ? "Session and the rest of the series cancelled"
            : "Session cancelled",
        body: "Any credits used were returned.",
      });
      onOpenChange(false);
    },
  });
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Cancel session"
      description="Credits already used go back to players' packages, and pay-per-session charges are voided."
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button variant="danger" isPending={cancel.isPending} onPress={() => cancel.mutate()}>
            Cancel session
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {l.seriesId ? (
          <Segmented
            label="Cancel"
            value={scope}
            onChange={setScope}
            options={[
              { id: "this", label: "Only this one" },
              { id: "following", label: "This and following" },
            ]}
          />
        ) : null}
        <TextField
          label="Reason (optional)"
          value={reason}
          onChange={setReason}
          placeholder="Rain, court closed, coach unwell…"
        />
        {cancel.error ? <InlineError>{errorMessage(cancel.error)}</InlineError> : null}
      </div>
    </Sheet>
  );
}

function DeleteSessionSheet({
  isOpen,
  onOpenChange,
  detail,
}: {
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
  detail: LessonDetailDto;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const del = useMutation({
    meta: { silent: true },
    mutationFn: () => api.del(`/lessons/${detail.lesson.id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.lesson(detail.lesson.id) });
      void qc.invalidateQueries({ queryKey: ["lessons"] });
      void qc.invalidateQueries({ queryKey: keys.today });
      notify({ tone: "neutral", title: "Session deleted" });
      onOpenChange(false);
      void navigate({ to: "/schedule" });
    },
    onError: (err) => notify({ tone: "danger", title: "Couldn't delete", body: errorMessage(err) }),
  });
  return (
    <ConfirmSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Delete this session?"
      body={`${detail.lesson.title} and its roster are removed for good. To keep a record, cancel it instead.`}
      confirmLabel="Delete session"
      isPending={del.isPending}
      onConfirm={() => del.mutate()}
    />
  );
}
