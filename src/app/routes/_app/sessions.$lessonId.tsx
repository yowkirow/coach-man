import { createFileRoute, Link } from "@tanstack/react-router";
import { SessionTile } from "../../components/domain/lesson";
import { Page, ShellAside, SyncStatus } from "../../components/layout/app-shell";
import { Skeleton } from "../../components/ui/feedback";
import { SessionDetail } from "../../features/sessions/session-detail";
import { useFormat } from "../../lib/format";
import { useLesson, useLessons, useNow } from "../../lib/hooks";

export const Route = createFileRoute("/_app/sessions/$lessonId")({
  component: SessionPage,
});

function SessionPage() {
  const { lessonId } = Route.useParams();
  const fmt = useFormat();
  const now = useNow();
  const lesson = useLesson(lessonId);
  const day = lesson.data ? fmt.dayOf(lesson.data.lesson.startsAt) : null;
  return (
    <>
      <ShellAside>
        {day ? <DayPanel day={day} selectedId={lessonId} now={now} /> : <PanelSkeleton />}
      </ShellAside>
      <Page>
        <SessionDetail lessonId={lessonId} now={now} back />
      </Page>
    </>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton dark className="h-8 w-2/3" />
      <Skeleton dark className="h-[124px] rounded-[24px]" />
      <Skeleton dark className="h-[124px] rounded-[24px]" />
    </div>
  );
}

/** Every session on the same day, so the coach can hop between back-to-back courts. */
function DayPanel({ day, selectedId, now }: { day: string; selectedId: string; now: number }) {
  const fmt = useFormat();
  const lessons = useLessons(day, day);
  const isToday = day === fmt.today();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-2 px-1">
        <div>
          <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">
            {isToday ? "Today" : fmt.day(day)}
          </h2>
          <p className="mt-1 text-[0.875rem] text-night-ink-2">{fmt.longDay(day)}</p>
        </div>
        <SyncStatus dark />
      </div>
      <section aria-labelledby="day-sessions" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between px-1">
          <h3 id="day-sessions" className="text-[1.125rem] font-light">
            Sessions that day
          </h3>
          <Link
            to="/schedule"
            className="rounded-full px-2 py-1 text-[0.8125rem] text-night-ink-2 outline-none hover:text-night-ink focus-visible:outline-2 focus-visible:outline-lime"
          >
            Full schedule
          </Link>
        </div>
        {lessons.isPending ? (
          <Skeleton dark className="h-[124px] rounded-[24px]" />
        ) : (
          (lessons.data ?? []).map((l) => (
            <SessionTile
              key={l.id}
              lesson={l}
              people={[]}
              now={now}
              selected={l.id === selectedId}
              linkTo="session"
            />
          ))
        )}
      </section>
    </div>
  );
}
