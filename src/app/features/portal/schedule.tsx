import type { PortalSessionDto } from "@shared/api-types";
import { ATTENDANCE_LABELS } from "@shared/domain";
import { addDays, localDate } from "@shared/time";
import { CalendarCheck2, CalendarClock, History } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Pill } from "../../components/ui/display";
import type { Format } from "../../lib/format";
import { ATTENDANCE_PILL } from "../clients/client-utils";
import { CoachLine, QueryGate } from "./bits";
import { dayLabel } from "./home";
import { useAcademyFormat, usePortalSchedule } from "./queries";
import { PortalPage, useCurrentStudent } from "./shell";

function statusPill(s: PortalSessionDto, past: boolean) {
  if (s.status === "cancelled") return <Pill tone="coral">Cancelled</Pill>;
  if (!s.attendance) return null;
  if (!past && s.attendance === "booked") return <Pill tone="panel">Booked</Pill>;
  if (past && s.attendance === "booked") return <Pill tone="outline">Not marked</Pill>;
  return <Pill tone={ATTENDANCE_PILL[s.attendance]}>{ATTENDANCE_LABELS[s.attendance]}</Pill>;
}

function SessionRow({
  s,
  fmt,
  past,
  next,
}: {
  s: PortalSessionDto;
  fmt: Format;
  past: boolean;
  next?: boolean;
}) {
  const where = [s.venue?.name, s.court ? `Court ${s.court}` : null].filter(Boolean).join(" · ");
  return (
    <li
      className={`flex items-start gap-3 rounded-[22px] px-4 py-3.5 ${next ? "bg-lime" : "bg-card"}`}
    >
      <span className="num w-[5.5rem] shrink-0 pt-0.5 text-[0.875rem] font-medium">
        {fmt.time(s.startsAt)}
        <span
          className={`block text-[0.8125rem] font-normal ${next ? "text-ink/70" : "text-ink-2"}`}
        >
          to {fmt.time(s.endsAt)}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`font-medium ${s.status === "cancelled" ? "line-through" : ""}`}>
            {s.title}
          </span>
          {next ? <Pill tone="white">Next</Pill> : null}
          {statusPill(s, past)}
        </span>
        {where ? (
          <span className={`block text-[0.8125rem] ${next ? "text-ink/75" : "text-ink-2"}`}>
            {where}
          </span>
        ) : null}
        {s.venue?.address ? (
          <span className={`block text-[0.8125rem] ${next ? "text-ink/75" : "text-ink-2"}`}>
            {s.venue.address}
          </span>
        ) : null}
        {s.coach ? (
          <span className="mt-1.5 block text-[0.8125rem]">
            <CoachLine coach={s.coach} extra="coach" />
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** "Today · Thu 6 Nov", "Tomorrow · Fri 7 Nov", else "Saturday 8 November". */
function upcomingDay(day: string, startsAt: number, fmt: Format) {
  const label = dayLabel(startsAt, fmt);
  return label === "Today" || label === "Tomorrow"
    ? `${label} · ${fmt.day(day)}`
    : fmt.longDay(day);
}

/** Sessions grouped under their day, in the order given. */
function Days({
  sessions,
  fmt,
  past,
  nextId,
}: {
  sessions: PortalSessionDto[];
  fmt: Format;
  past: boolean;
  nextId?: string;
}) {
  const days: { day: string; items: PortalSessionDto[] }[] = [];
  for (const s of sessions) {
    const day = fmt.dayOf(s.startsAt);
    const group = days.at(-1);
    if (group?.day === day) group.items.push(s);
    else days.push({ day, items: [s] });
  }
  return (
    <div className="flex flex-col gap-4">
      {days.map((d) => (
        <section key={d.day} aria-label={fmt.longDay(d.day)}>
          <h3 className="num mb-2 px-1 text-[0.9375rem] font-medium">
            {past ? fmt.longDay(d.day) : upcomingDay(d.day, d.items[0]?.startsAt ?? 0, fmt)}
          </h3>
          <ul className="flex flex-col gap-2">
            {d.items.map((s) => (
              <SessionRow key={s.id} s={s} fmt={fmt} past={past} next={s.id === nextId} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Schedule & attendance: sessions ahead (the next one in lime) and the ones already held. */
export function PortalSchedule({ clientId }: { clientId: string }) {
  const { current } = useCurrentStudent();
  const today = localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [back, setBack] = useState(90);
  const from = addDays(today, -back);
  const to = addDays(today, 60);
  const schedule = usePortalSchedule(clientId, from, to);
  const fmt = useAcademyFormat(schedule.data?.academy);
  const self = current?.relation === "self";
  const who = self ? "you" : (current?.firstName ?? "them");
  return (
    <PortalPage
      title="Schedule"
      subtitle={current ? `${current.firstName} ${current.lastName}`.trim() : undefined}
      students
    >
      <QueryGate query={schedule}>
        {(data) => {
          const now = Date.now();
          const upcoming = data.sessions.filter((s) => s.endsAt >= now);
          const past = data.sessions.filter((s) => s.endsAt < now).reverse();
          const next = upcoming.find(
            (s) =>
              s.status !== "cancelled" &&
              s.attendance !== "excused" &&
              s.attendance !== "late_cancel",
          );
          const attended = past.filter(
            (s) => s.attendance === "present" || s.attendance === "late",
          ).length;
          return (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
              <section aria-labelledby="schedule-upcoming" className="flex flex-col gap-3">
                <h2 id="schedule-upcoming" className="px-1 text-[1.125rem] font-medium">
                  Coming up
                </h2>
                {upcoming.length ? (
                  <Days sessions={upcoming} fmt={fmt} past={false} nextId={next?.id} />
                ) : (
                  <p className="flex items-start gap-3 rounded-[22px] bg-card px-4 py-4 text-[0.9375rem] text-ink-2">
                    <CalendarClock aria-hidden className="mt-0.5 size-4.5 shrink-0" />
                    <span>
                      Nothing booked from today. When the academy books {who} into a session, it
                      shows here with its time, court, and coach.
                    </span>
                  </p>
                )}
              </section>
              <section aria-labelledby="schedule-past" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                  <h2 id="schedule-past" className="text-[1.125rem] font-medium">
                    Attendance
                  </h2>
                  {past.length ? (
                    <span className="num text-[0.875rem] text-ink-2">
                      {attended} of {past.length} checked in
                    </span>
                  ) : null}
                </div>
                {past.length ? (
                  <Days sessions={past} fmt={fmt} past />
                ) : (
                  <p className="flex items-start gap-3 rounded-[22px] bg-card px-4 py-4 text-[0.9375rem] text-ink-2">
                    <CalendarCheck2 aria-hidden className="mt-0.5 size-4.5 shrink-0" />
                    <span>
                      Sessions from the last {Math.round(back / 30)} months show here, with whether{" "}
                      {who} {self ? "were" : "was"} checked in.
                    </span>
                  </p>
                )}
                <Button
                  variant="light"
                  size="sm"
                  className="self-start"
                  icon={<History aria-hidden className="size-4" />}
                  isPending={schedule.isFetching && schedule.isPlaceholderData}
                  isDisabled={back >= 360}
                  onPress={() => setBack((b) => Math.min(360, b + 90))}
                >
                  Show earlier sessions
                </Button>
              </section>
            </div>
          );
        }}
      </QueryGate>
    </PortalPage>
  );
}
