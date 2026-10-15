import type { ClientDetailDto } from "@shared/api-types";
import { ATTENDANCE_LABELS, LESSON_KIND_LABELS, type RegistrationStatus } from "@shared/domain";
import { Link } from "@tanstack/react-router";
import { CalendarPlus, ChevronRight, History, Tent } from "lucide-react";
import { LessonRow } from "../../components/domain/lesson";
import { buttonClass } from "../../components/ui/button";
import { Card, Pill, type PillTone } from "../../components/ui/display";
import { plural, useFormat } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import { SectionHead } from "./bits";
import { ATTENDANCE_PILL } from "./client-utils";

const REGISTRATION: Record<RegistrationStatus, { label: string; tone: PillTone }> = {
  registered: { label: "Registered", tone: "mint" },
  waitlisted: { label: "Waitlisted", tone: "amber" },
  cancelled: { label: "Cancelled", tone: "outline" },
};

export function UpcomingList({
  detail,
  limit,
  firstName,
}: {
  detail: ClientDetailDto;
  limit?: number;
  firstName: string;
}) {
  const now = useNow();
  const rows = limit ? detail.upcoming.slice(0, limit) : detail.upcoming;
  if (!rows.length) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-2">
        <p className="text-ink-2">Nothing booked for {firstName} yet.</p>
        <Link to="/schedule" search={{ new: "1" }} className={buttonClass("light", "sm")}>
          <CalendarPlus aria-hidden className="size-4" />
          New session
        </Link>
      </div>
    );
  }
  return (
    <ul className="flex flex-col">
      {rows.map((l) => (
        <li key={l.id}>
          <LessonRow lesson={l} showDate now={now} />
        </li>
      ))}
    </ul>
  );
}

export function SessionsTab({ detail }: { detail: ClientDetailDto }) {
  const fmt = useFormat();
  const c = detail.client;
  const past = detail.recentAttendance;
  const attended = past.filter((a) => a.status === "present" || a.status === "late").length;
  const missed = past.filter((a) => a.status === "no_show" || a.status === "absent").length;
  const lateCancels = past.filter((a) => a.status === "late_cancel").length;
  const summary = [
    `${attended} attended`,
    missed ? `${missed} missed` : null,
    lateCancels ? plural(lateCancels, "late cancel") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <Card label="Coming up">
        <SectionHead title="Coming up" count={detail.upcoming.length || undefined} />
        <div className="px-3 pb-3">
          <UpcomingList detail={detail} firstName={c.firstName} />
        </div>
      </Card>

      {detail.registrations.length ? (
        <Card label="Events">
          <SectionHead title="Events" count={detail.registrations.length} />
          <ul className="flex flex-col px-3 pb-3">
            {detail.registrations.map((r) => (
              <li key={r.id}>
                <Link
                  to="/events/$eventId"
                  params={{ eventId: r.eventId }}
                  className="flex items-center gap-4 rounded-2xl px-2 py-3 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber text-ink">
                    <Tent aria-hidden className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.eventName}</span>
                    <span className="num block text-[0.8125rem] text-ink-2">
                      Starts {fmt.date(r.startsOn)}
                    </span>
                  </span>
                  <Pill tone={REGISTRATION[r.status].tone}>{REGISTRATION[r.status].label}</Pill>
                  <ChevronRight aria-hidden className="size-4.5 shrink-0 text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card label="Attendance history">
        <SectionHead title="Attendance" count={past.length ? summary : undefined} />
        {past.length ? (
          <ul className="flex flex-col px-3 pb-3">
            {past.map((a) => {
              const day = fmt.dayOf(a.startsAt);
              const used =
                a.kind === "event"
                  ? "Event registration"
                  : a.packageName
                    ? a.packageName
                    : a.status === "present" || a.status === "late"
                      ? "No package used"
                      : null;
              return (
                <li key={`${a.lessonId}-${a.startsAt}`}>
                  <Link
                    to="/sessions/$lessonId"
                    params={{ lessonId: a.lessonId }}
                    className="flex items-center gap-4 rounded-2xl px-2 py-3 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    <span className="flex w-[4.75rem] shrink-0 flex-col">
                      <span className="text-[0.75rem] text-ink-2">{fmt.day(day)}</span>
                      <span className="num font-medium">{fmt.time(a.startsAt)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.title}</span>
                      <span className="block truncate text-[0.8125rem] text-ink-2">
                        {LESSON_KIND_LABELS[a.kind]}
                        {used ? ` · ${used}` : ""}
                      </span>
                    </span>
                    <Pill tone={ATTENDANCE_PILL[a.status]}>
                      {a.status === "booked" ? "Not marked" : ATTENDANCE_LABELS[a.status]}
                    </Pill>
                    <ChevronRight aria-hidden className="size-4.5 shrink-0 text-ink-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="flex items-center gap-2 px-5 pb-5 text-ink-2">
            <History aria-hidden className="size-4.5 shrink-0" />
            No past sessions yet. Check-ins show here with the package each one used.
          </p>
        )}
      </Card>
    </div>
  );
}
