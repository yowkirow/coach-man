import type { LessonDetailDto } from "@shared/api-types";
import type { LessonKind } from "@shared/domain";
import { addDays, compareDates, DATE_RE, weekdayOf } from "@shared/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type CoachChoice, CoachFields } from "../../components/domain/coaches";
import { ClientPicker } from "../../components/domain/lesson";
import { Button, buttonClass } from "../../components/ui/button";
import { Avatar } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import {
  MoneyField,
  Segmented,
  SelectField,
  Switch,
  TextAreaField,
  TextField,
} from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { fullName, plural, useFormat } from "../../lib/format";
import {
  useCan,
  useCoachMap,
  useGroups,
  useHasTeam,
  useIsCoach,
  useMe,
  useRates,
  useVenues,
} from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys, storeLesson } from "../../lib/query";
import { plainAmount } from "../events/event-meta";
import { useEvent, useEvents } from "../events/queries";
import { OfflineNote, WeekdayPicker, WrapSegmented } from "./choice";
import { clampDate, dateRangeLabel, minutesOf, weekdayName, weekdaysBetween } from "./dates";
import { KIND_SHORT, LESSON_KIND_ORDER, PLAYER_KINDS } from "./kinds";

export interface NewSessionInitial {
  kind?: LessonKind;
  date?: string;
  startTime?: string;
  groupId?: string;
  eventId?: string;
  /** Start with "Repeats weekly" switched on. */
  repeat?: boolean;
}

export interface CreateLessonsResult {
  lessonIds: string[];
  seriesId: string | null;
  lesson: LessonDetailDto | null;
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  photoKey?: string | null;
}

const LAST_VENUE_KEY = "coachman.lastVenueId";
const DURATIONS = [30, 45, 60, 75, 90, 120, 150, 180, 240];

function readLastVenue(): string | null {
  try {
    return localStorage.getItem(LAST_VENUE_KEY);
  } catch {
    return null;
  }
}

function rememberVenue(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_VENUE_KEY, id);
  } catch {
    // Private mode: nothing to remember.
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Next full hour today (kept to court hours), otherwise a morning slot. */
function defaultStart(date: string, today: string, now: number, tz: string): string {
  if (date !== today) return "08:00";
  const next = Math.min(Math.max(Math.ceil((minutesOf(now, tz) + 1) / 60) * 60, 6 * 60), 21 * 60);
  return `${pad(Math.floor(next / 60))}:00`;
}

/** First date on or after `date` that falls on one of `days`. */
function firstOccurrence(date: string, days: number[]): string | null {
  for (let i = 0; i < 7; i++) {
    const d = addDays(date, i);
    if (days.includes(weekdayOf(d))) return d;
  }
  return null;
}

function countOccurrences(from: string, to: string, days: number[]): number {
  let n = 0;
  for (let d = from, i = 0; compareDates(d, to) <= 0 && i < 800; d = addDays(d, 1), i++) {
    if (days.includes(weekdayOf(d))) n++;
  }
  return n;
}

/**
 * Schedules a session or a weekly series. Opened from Schedule (`?new=1`), Quick add, and the
 * Groups and Events pages with prefilled values.
 */
export function NewSessionSheet({
  isOpen,
  onOpenChange,
  initial,
  onCreated,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: NewSessionInitial;
  /** Called instead of closing; the default closes and offers an "Open" toast action. */
  onCreated?: (result: CreateLessonsResult) => void;
}) {
  const fmt = useFormat();
  const can = useCan();
  const me = useMe().data;
  const online = useOnline();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const groupsQ = useGroups();
  const eventsQ = useEvents("upcoming");
  const ratesQ = useRates();
  const venuesQ = useVenues();
  const hasTeam = useHasTeam();
  const isCoach = useIsCoach();
  const coachMap = useCoachMap();
  const today = fmt.today();

  const [kind, setKind] = useState<LessonKind>("private");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("08:00");
  const [durationSel, setDurationSel] = useState<string | null>(null);
  const [venueSel, setVenueSel] = useState<string | null>(null);
  const [court, setCourt] = useState("");
  const [capacitySel, setCapacitySel] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [rateSel, setRateSel] = useState<string | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [plan, setPlan] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [endsMode, setEndsMode] = useState<"never" | "on">("never");
  const [endsOn, setEndsOn] = useState("");
  const [coachSel, setCoachSel] = useState<CoachChoice | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const eventDefaultsPending = useRef(false);

  const evDetail = useEvent(eventId ?? "", isOpen && kind === "event" && Boolean(eventId));
  const groups = groupsQ.data ?? [];
  const events = eventsQ.data ?? [];
  const venues = venuesQ.data ?? [];
  const activeRates = (ratesQ.data ?? []).filter((r) => r.active && r.kind !== "court_fee");
  const group = kind === "group" ? groups.find((g) => g.id === groupId) : undefined;
  const ev =
    kind === "event" && eventId
      ? (events.find((e) => e.id === eventId) ?? evDetail.data?.event)
      : undefined;

  const create = useMutation({
    meta: { silent: true },
    mutationFn: (body: Record<string, unknown>) => api.post<CreateLessonsResult>("/lessons", body),
  });

  // Re-seed the form each time the sheet opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    const d = initial?.date && DATE_RE.test(initial.date) ? initial.date : today;
    setKind(initial?.kind ?? (initial?.groupId ? "group" : initial?.eventId ? "event" : "private"));
    setTitle("");
    setDate(d);
    setStart(initial?.startTime ?? defaultStart(d, today, Date.now(), fmt.tz));
    setDurationSel(null);
    setVenueSel(null);
    setCourt("");
    setCapacitySel(null);
    setGroupId(initial?.groupId ?? null);
    setEventId(initial?.eventId ?? null);
    setPlayers([]);
    setRateSel(null);
    setPrice(null);
    setPlan("");
    setRepeat(Boolean(initial?.repeat));
    setWeekdays([weekdayOf(d)]);
    setEndsMode("never");
    setEndsOn(addDays(d, 55));
    setCoachSel(null);
    setLocalErrors({});
    eventDefaultsPending.current = Boolean(initial?.eventId);
    create.reset();
  }, [isOpen]);

  // Event sessions: start inside the event's dates and, for multi-day events, repeat each day.
  useEffect(() => {
    if (!isOpen || !ev || !eventDefaultsPending.current) return;
    eventDefaultsPending.current = false;
    const first = clampDate(
      compareDates(today, ev.startsOn) > 0 ? today : ev.startsOn,
      ev.startsOn,
      ev.endsOn,
    );
    setDate(first);
    if (ev.endsOn !== first) {
      setRepeat(true);
      setWeekdays(weekdaysBetween(first, ev.endsOn));
    } else {
      setRepeat(false);
      setWeekdays([weekdayOf(first)]);
    }
    setEndsMode("on");
    setEndsOn(ev.endsOn);
  }, [isOpen, ev, today]);

  const lastVenue = useMemo(() => (isOpen ? readLastVenue() : null), [isOpen]);
  const venueIds = new Set(venues.map((v) => v.id));
  const known = (id: string | null | undefined) => (id && venueIds.has(id) ? id : null);
  const autoVenue =
    known(group?.defaultVenueId) ??
    known(ev?.venueId) ??
    known(lastVenue) ??
    venues[0]?.id ??
    "none";
  const venueId = venueSel ?? autoVenue;

  const kindRates = activeRates.filter((r) => r.kind === kind || r.kind === "other");
  const rateChoices = kindRates.length ? kindRates : activeRates;
  const autoRate =
    kind === "event"
      ? null
      : group?.defaultRateId && activeRates.some((r) => r.id === group.defaultRateId)
        ? group.defaultRateId
        : (activeRates.find((r) => r.kind === kind)?.id ?? null);
  const rateId =
    kind === "event" ? null : rateSel === null ? autoRate : rateSel === "none" ? null : rateSel;
  const rate = activeRates.find((r) => r.id === rateId);
  const duration =
    durationSel ?? String(rate?.durationMinutes ?? me?.settings.defaultSessionMinutes ?? 60);
  const capacity =
    capacitySel ?? (kind === "group" && group?.capacity ? String(group.capacity) : "");

  // Sessions of a group or event start with its coaches; anything else with you as the lead (when
  // you coach: the front desk's sessions start with no lead).
  const coachSource = kind === "group" ? group : kind === "event" ? ev : undefined;
  const you = isCoach ? (me?.user.id ?? null) : null;
  const autoLead =
    coachSource?.coachUserId && coachMap.has(coachSource.coachUserId)
      ? coachSource.coachUserId
      : you;
  const coaches: CoachChoice = coachSel ?? {
    lead: autoLead,
    assistants: (coachSource?.assistantCoachIds ?? []).filter(
      (id) => id !== autoLead && coachMap.has(id),
    ),
  };

  const durationOptions = [...new Set([...DURATIONS, Number(duration)])]
    .filter((m) => Number.isFinite(m) && m >= 15)
    .sort((a, b) => a - b)
    .map((m) => ({
      id: String(m),
      label: m < 60 || m % 60 ? `${m} min` : `${m / 60} h`,
    }));

  const validDate = DATE_RE.test(date);
  const firstDate = repeat && validDate ? firstOccurrence(date, weekdays) : validDate ? date : null;
  const serverErrors = fieldErrors(create.error);
  const err = (k: string) => localErrors[k] ?? serverErrors[k];
  const titleHint =
    kind === "group"
      ? (group?.name ?? "Uses the group's name")
      : kind === "event"
        ? (ev?.name ?? "Uses the event's name")
        : players.length
          ? players.map((p) => p.firstName).join(", ")
          : kind === "clinic"
            ? "e.g. Dinking clinic"
            : "e.g. Third-shot drops";

  const changeDate = (d: string) => {
    if (DATE_RE.test(d) && validDate) {
      setWeekdays((w) => (w.length === 1 && w[0] === weekdayOf(date) ? [weekdayOf(d)] : w));
    }
    setDate(d);
  };

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!validDate) errs.date = "Pick a date.";
    if (!/^\d{2}:\d{2}$/.test(start)) errs.startTime = "Pick a start time.";
    if (kind === "group" && !groupId) errs.groupId = "Choose the group.";
    if (kind === "event" && !eventId) errs.eventId = "Choose the event.";
    if (repeat && !weekdays.length) errs["recurrence.weekdays"] = "Pick at least one day.";
    const until = kind === "event" && ev ? endsOn || ev.endsOn : endsMode === "on" ? endsOn : null;
    if (repeat && until !== null) {
      if (!DATE_RE.test(until)) errs["recurrence.endsOn"] = "Pick the last date.";
      else if (validDate && compareDates(until, date) < 0)
        errs["recurrence.endsOn"] = "This is before the first session.";
    }
    setLocalErrors(errs);
    if (Object.keys(errs).length) return;
    const body = {
      kind,
      title: title.trim() || null,
      date,
      startTime: start,
      durationMinutes: Number(duration),
      venueId: venueId === "none" ? null : venueId,
      court: court.trim() || null,
      groupId: kind === "group" ? groupId : null,
      eventId: kind === "event" ? eventId : null,
      rateId: kind === "event" ? null : rateId,
      // A price override is a money decision; coaches book at the rate's price.
      priceMinor: kind === "event" || !can.money ? null : price,
      capacity: capacity ? Number(capacity) : null,
      notes: plan.trim() || null,
      clientIds: PLAYER_KINDS.includes(kind) ? players.map((p) => p.id) : [],
      recurrence: repeat ? { weekdays, endsOn: until } : null,
      // A one-person academy leaves it to the server: you lead what you schedule.
      ...(hasTeam ? { coachUserId: coaches.lead, assistantCoachIds: coaches.assistants } : {}),
    };
    create.mutate(body, {
      onSuccess: (res) => {
        if (res.lesson) storeLesson(res.lesson);
        void qc.invalidateQueries({ queryKey: ["lessons"] });
        void qc.invalidateQueries({ queryKey: keys.today });
        if (body.groupId) void qc.invalidateQueries({ queryKey: keys.group(body.groupId) });
        if (body.eventId) {
          void qc.invalidateQueries({ queryKey: keys.event(body.eventId) });
          void qc.invalidateQueries({ queryKey: ["events"] });
        }
        rememberVenue(body.venueId);
        const first = res.lesson?.lesson;
        const n = res.lessonIds.length;
        if (!first || n === 0) {
          notify({
            tone: "neutral",
            title: "No sessions were created",
            body: "None of the days you picked fall inside those dates.",
          });
          onOpenChange(false);
          return;
        }
        const when = `${fmt.day(fmt.dayOf(first.startsAt))} · ${fmt.timeRange(first.startsAt, first.endsAt)}`;
        // Groups and events book their players automatically; say how many landed.
        const booked =
          (body.groupId || body.eventId) && res.lesson
            ? ` ${plural(res.lesson.roster.length, "player")} booked${n > 1 ? " into each" : ""}.`
            : "";
        notify({
          tone: "success",
          title: n > 1 ? `${n} sessions scheduled` : "Session scheduled",
          body:
            (n > 1
              ? res.seriesId && !body.recurrence?.endsOn
                ? `Weekly from ${when}. Later weeks are added as time goes by.`
                : `Starting ${when}.`
              : `${when}.`) + booked,
          action: onCreated
            ? undefined
            : {
                label: "Open",
                onAction: () =>
                  void navigate({ to: "/sessions/$lessonId", params: { lessonId: first.id } }),
              },
        });
        if (onCreated) onCreated(res);
        else onOpenChange(false);
      },
    });
  };

  const showPlayers = PLAYER_KINDS.includes(kind);
  const sessionsCount =
    repeat && validDate && endsMode === "on" && DATE_RE.test(endsOn)
      ? countOccurrences(date, endsOn, weekdays)
      : null;

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title="New session"
      description={
        kind === "group"
          ? "Group members are booked automatically, including people who join later."
          : kind === "event"
            ? "Registered players are booked automatically."
            : "Book players now or add them later from the session."
      }
      footer={
        <>
          {!online ? <OfflineNote className="mr-auto" /> : null}
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dark" isDisabled={!online} isPending={create.isPending} onPress={submit}>
            {repeat ? "Schedule sessions" : "Schedule session"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (online) submit();
        }}
      >
        <WrapSegmented
          label="Type"
          value={kind}
          onChange={(v) => {
            setKind(v as LessonKind);
            setRateSel(null);
            setPrice(null);
            setCapacitySel(null);
            if (v === "event" && eventId) eventDefaultsPending.current = true;
          }}
          options={LESSON_KIND_ORDER.map((k) => ({ id: k, label: KIND_SHORT[k] }))}
        />

        {kind === "group" ? (
          groupsQ.isSuccess && groups.length === 0 ? (
            <EmptyPicker
              text="You don't have any groups yet. A group keeps a class's members together and books them into every session."
              to="/groups"
              cta="Create a group"
            />
          ) : (
            <SelectField
              label="Group"
              placeholder="Choose a group"
              options={groups.map((g) => ({
                id: g.id,
                label: g.name,
                description: [g.level, plural(g.memberCount, "member")].filter(Boolean).join(" · "),
              }))}
              value={groupId}
              onChange={(id) => {
                setGroupId(id);
                setRateSel(null);
                setVenueSel(null);
                setCapacitySel(null);
                setCoachSel(null);
              }}
              error={err("groupId")}
              description={
                group ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Users aria-hidden className="size-3.5" />
                    {plural(group.memberCount, "member")} will be booked in
                  </span>
                ) : undefined
              }
            />
          )
        ) : null}

        {kind === "event" ? (
          eventsQ.isSuccess && events.length === 0 && !ev ? (
            <EmptyPicker
              text="No upcoming events. Create the camp, clinic, or tournament first, then add its sessions."
              to="/events"
              cta="Create an event"
            />
          ) : (
            <SelectField
              label="Event"
              placeholder="Choose an event"
              options={[...(ev && !events.some((e) => e.id === ev.id) ? [ev] : []), ...events].map(
                (e) => ({
                  id: e.id,
                  label: e.name,
                  description: dateRangeLabel(e.startsOn, e.endsOn, fmt.locale, { today }),
                }),
              )}
              value={eventId}
              onChange={(id) => {
                setEventId(id);
                setVenueSel(null);
                setCoachSel(null);
                eventDefaultsPending.current = true;
              }}
              error={err("eventId")}
              description={
                ev
                  ? `${dateRangeLabel(ev.startsOn, ev.endsOn, fmt.locale, { weekday: true, today })} · ${plural(ev.registeredCount, "player")} registered`
                  : undefined
              }
            />
          )
        ) : null}

        <TextField
          label="Title (optional)"
          value={title}
          onChange={setTitle}
          placeholder={titleHint}
          error={err("title")}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={changeDate}
            error={err("date")}
            isRequired
          />
          <TextField
            label="Start"
            type="time"
            value={start}
            onChange={setStart}
            error={err("startTime")}
            isRequired
          />
          <SelectField
            label="Length"
            options={durationOptions}
            value={duration}
            onChange={setDurationSel}
            error={err("durationMinutes")}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <SelectField
            label="Venue"
            options={[
              { id: "none", label: "No venue" },
              ...venues.map((v) => ({
                id: v.id,
                label: v.name,
                description: v.courtCount ? plural(v.courtCount, "court") : undefined,
              })),
            ]}
            value={venueId}
            onChange={setVenueSel}
          />
          <TextField
            label="Court"
            value={court}
            onChange={setCourt}
            placeholder="e.g. 3"
            error={err("court")}
          />
          <TextField
            label="Capacity"
            type="number"
            min="1"
            inputMode="numeric"
            value={capacity}
            onChange={setCapacitySel}
            placeholder="No limit"
            error={err("capacity")}
          />
        </div>

        {showPlayers ? (
          <div className="flex flex-col gap-2.5">
            <ClientPicker
              label="Players"
              placeholder="Search clients to add"
              exclude={players.map((p) => p.id)}
              onSelect={(c) => setPlayers((prev) => [...prev, c])}
            />
            {players.length ? (
              <ul className="flex flex-wrap gap-2" aria-label="Players to book">
                {players.map((p) => (
                  <li
                    key={p.id}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-panel pl-1.5"
                  >
                    <Avatar person={p} size="xs" />
                    <span className="text-[0.9375rem] font-medium">{fullName(p)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${fullName(p)}`}
                      onClick={() => setPlayers((prev) => prev.filter((x) => x.id !== p.id))}
                      className="flex size-11 cursor-pointer items-center justify-center rounded-full text-ink-2 outline-none hover:bg-line hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.8125rem] text-ink-2">
                {kind === "private"
                  ? "Usually one player. Booking doesn't use a credit until check-in."
                  : "Booking doesn't use a credit until check-in."}
              </p>
            )}
          </div>
        ) : null}

        {hasTeam ? (
          <CoachFields
            value={coaches}
            onChange={setCoachSel}
            description="The lead coach runs it and gets its reminders."
            error={err("coachUserId") ?? err("assistantCoachIds")}
          />
        ) : null}

        {kind !== "event" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Rate"
              options={[
                { id: "none", label: "No rate" },
                ...rateChoices.map((r) => ({
                  id: r.id,
                  label: r.name,
                  description: can.money
                    ? `${fmt.money(r.priceMinor)} per ${r.unit === "hour" ? "hour" : "session"}`
                    : undefined,
                })),
              ]}
              value={rateId ?? "none"}
              onChange={setRateSel}
              description="Charged per player who pays per session."
            />
            {can.money ? (
              <MoneyField
                label="Price override (optional)"
                currency={fmt.currency}
                valueMinor={price}
                onChange={setPrice}
                placeholder={plainAmount(rate ? rate.priceMinor : 0, fmt)}
                description="Leave empty to use the rate."
                error={err("priceMinor")}
              />
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-4 border-t border-line pt-4">
          <Switch
            isSelected={repeat}
            onChange={(on) => {
              setRepeat(on);
              if (on && !weekdays.length && validDate) setWeekdays([weekdayOf(date)]);
            }}
            description={
              kind === "event"
                ? "One session on each day you pick, inside the event's dates."
                : "Creates a weekly series. Later you can change one session or the rest."
            }
          >
            {kind === "event" ? "Repeats" : "Repeats weekly"}
          </Switch>
          {repeat ? (
            <>
              <WeekdayPicker
                label="On"
                value={weekdays}
                onChange={setWeekdays}
                locale={fmt.locale}
                weekStartsOn={fmt.weekStartsOn}
                error={err("recurrence.weekdays")}
                description={
                  firstDate && firstDate !== date && validDate
                    ? `First session ${fmt.day(firstDate)}: ${weekdayName(weekdayOf(date), fmt.locale, "long")} isn't one of the days picked.`
                    : undefined
                }
              />
              {kind === "event" ? (
                <TextField
                  label="Until"
                  type="date"
                  value={endsOn}
                  onChange={setEndsOn}
                  max={ev?.endsOn}
                  error={err("recurrence.endsOn")}
                  description={
                    sessionsCount !== null
                      ? `${plural(sessionsCount, "session")} through ${DATE_RE.test(endsOn) ? fmt.day(endsOn) : "the last day"}`
                      : undefined
                  }
                />
              ) : (
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  <Segmented
                    label="Ends"
                    value={endsMode}
                    onChange={(v) => setEndsMode(v as "never" | "on")}
                    options={[
                      { id: "never", label: "Never" },
                      { id: "on", label: "On a date" },
                    ]}
                  />
                  {endsMode === "on" ? (
                    <TextField
                      label="Last date"
                      type="date"
                      value={endsOn}
                      onChange={setEndsOn}
                      error={err("recurrence.endsOn")}
                      description={
                        sessionsCount !== null
                          ? `${plural(sessionsCount, "session")} in total`
                          : undefined
                      }
                    />
                  ) : (
                    <p className="pt-7 text-[0.8125rem] text-ink-2">
                      Sessions are scheduled eight weeks ahead and keep rolling forward.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        <TextAreaField
          label={repeat ? "Plan for the first session (optional)" : "Plan (optional)"}
          value={plan}
          onChange={setPlan}
          rows={3}
          placeholder="Warm-up, drills, and the focus for the day"
        />

        {create.error ? <InlineError>{errorMessage(create.error)}</InlineError> : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function EmptyPicker({ text, to, cta }: { text: string; to: "/groups" | "/events"; cta: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[22px] bg-panel p-4">
      <p className="text-[0.875rem] text-ink-2">{text}</p>
      {to === "/groups" ? (
        <Link to="/groups" search={{ new: "1" }} className={buttonClass("light", "sm")}>
          {cta}
        </Link>
      ) : (
        <Link to="/events" search={{ new: "1" }} className={buttonClass("light", "sm")}>
          {cta}
        </Link>
      )}
    </div>
  );
}
