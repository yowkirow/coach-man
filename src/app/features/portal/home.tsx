import type {
  PortalAcademyDto,
  PortalCommentDto,
  PortalHomeDto,
  PortalHomeStudentDto,
} from "@shared/api-types";
import { daysBetween } from "@shared/time";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarDays,
  FileSignature,
  Megaphone,
  MessageSquareText,
  UserRound,
} from "lucide-react";
import { buttonClass } from "../../components/ui/button";
import { Card, Meter, Pill } from "../../components/ui/display";
import { EmptyState } from "../../components/ui/feedback";
import { type Format, fullName, plural } from "../../lib/format";
import { AcademyCard } from "./academy";
import { CoachLine, PortalAvatar, PortalCard, QueryGate } from "./bits";
import { useAcademyFormat, usePortalHome } from "./queries";
import { PortalPage } from "./shell";

/** "Today", "Tomorrow", "Thu 6 Nov" for a session's day. */
export function dayLabel(epoch: number, fmt: Format): string {
  const day = fmt.dayOf(epoch);
  const diff = daysBetween(fmt.today(), day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return fmt.day(day);
}

/** A balance in words and a pill: owed (coral), paid up or in credit (mint). */
export function balanceState(balanceMinor: number, fmt: Format) {
  if (balanceMinor > 0) {
    return { figure: fmt.money(balanceMinor), pill: <Pill tone="coral">Due</Pill> };
  }
  if (balanceMinor < 0) {
    return { figure: fmt.money(-balanceMinor), pill: <Pill tone="mint">In credit</Pill> };
  }
  return { figure: fmt.money(0), pill: <Pill tone="mint">Paid up</Pill> };
}

const figureLink =
  "rounded-[22px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

function NextSession({ s, fmt }: { s: PortalHomeStudentDto; fmt: Format }) {
  const next = s.nextSession;
  const who = s.relation === "self" ? "you" : s.firstName;
  return (
    <section
      aria-label={`${s.relation === "self" ? "Your" : `${s.firstName}'s`} next session`}
      className="rounded-[28px] bg-lime p-5 text-ink sm:col-span-2"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">
          Next session
        </h3>
        <Link
          to="/my/$clientId/schedule"
          params={{ clientId: s.clientId }}
          className={buttonClass("dark", "sm")}
        >
          <CalendarDays aria-hidden className="size-4" />
          Schedule
        </Link>
      </div>
      {next ? (
        <div className="mt-3 flex flex-col gap-1">
          <p className="num text-[2rem] leading-none font-light tracking-[-0.02em]">
            {dayLabel(next.startsAt, fmt)}
          </p>
          <p className="num text-[1.375rem] leading-tight font-light tracking-[-0.01em] text-ink/80">
            {fmt.timeRange(next.startsAt, next.endsAt)}
          </p>
          <p className="mt-2 text-[1rem] font-medium">{next.title}</p>
          <p className="text-[0.875rem] text-ink/75">
            {[next.venue?.name, next.court ? `Court ${next.court}` : null]
              .filter(Boolean)
              .join(" · ") || "Venue to be confirmed"}
          </p>
          {next.coach ? (
            <p className="mt-2 text-[0.875rem]">
              <CoachLine coach={next.coach} extra="coach" />
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 max-w-[46ch] text-[0.9375rem] text-ink/80">
          Nothing booked yet. When the academy books a session for {who}, the date, time, and court
          show here.
        </p>
      )}
    </section>
  );
}

function Credits({ s, fmt }: { s: PortalHomeStudentDto; fmt: Format }) {
  const c = s.credits;
  return (
    <Link
      to="/my/$clientId/payments"
      params={{ clientId: s.clientId }}
      aria-label={
        c.activePackages
          ? `Credits: ${c.remaining} of ${c.total} left. Open packages and payments.`
          : "Credits: no active package. Open packages and payments."
      }
      className={`${figureLink} group flex flex-col rounded-[28px] bg-lavender p-5 text-ink`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">Credits</span>
        <ArrowUpRight aria-hidden className="size-4.5 text-ink/60 group-hover:text-ink" />
      </span>
      {c.activePackages ? (
        <>
          <span className="num mt-3 text-[2rem] leading-none font-light">
            {c.remaining}
            <span className="text-[1rem] text-ink/70"> of {c.total} left</span>
          </span>
          <span className="mt-3 block">
            <Meter value={c.remaining} max={c.total} tone={c.remaining <= 1 ? "coral" : "ink"} />
          </span>
          <span className="num mt-2 text-[0.8125rem] text-ink/75">
            {c.nextExpiryOn ? `Use by ${fmt.day(c.nextExpiryOn)}` : "No expiry date"}
          </span>
        </>
      ) : (
        <span className="mt-3 text-[0.9375rem] text-ink/80">
          No active package. Its credits show here once the academy adds one.
        </span>
      )}
    </Link>
  );
}

function Balance({ s, fmt }: { s: PortalHomeStudentDto; fmt: Format }) {
  const b = balanceState(s.balanceMinor, fmt);
  return (
    <Link
      to="/my/$clientId/payments"
      params={{ clientId: s.clientId }}
      aria-label={`Balance: ${b.figure}${s.balanceMinor > 0 ? " due" : ""}. Open payments.`}
      className={`${figureLink} group flex flex-col rounded-[28px] bg-card p-5 text-ink hover:bg-panel`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">Balance</span>
        <ArrowUpRight aria-hidden className="size-4.5 text-ink-3 group-hover:text-ink" />
      </span>
      <span className="num mt-3 text-[2rem] leading-none font-light">{b.figure}</span>
      <span className="mt-3 flex items-center gap-2 text-[0.8125rem] text-ink-2">
        {b.pill}
        {s.balanceMinor > 0 ? "How to pay is on Payments" : "Nothing to pay right now"}
      </span>
    </Link>
  );
}

function StudentBlock({
  s,
  academy,
  showAcademy,
}: {
  s: PortalHomeStudentDto;
  academy: PortalAcademyDto | undefined;
  showAcademy: boolean;
}) {
  const fmt = useAcademyFormat(academy);
  const headingId = `student-${s.clientId}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-center gap-3 px-1">
        <PortalAvatar name={fullName(s)} photoKey={s.photoKey} size="md" />
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            className="truncate text-[1.375rem] leading-tight font-light tracking-[-0.01em]"
          >
            {fullName(s)}
          </h2>
          <p className="truncate text-[0.8125rem] text-ink-2">
            {s.relation === "self" ? "Your own training" : "You're their parent or guardian"}
            {showAcademy && academy ? ` · ${academy.name}` : ""}
          </p>
        </div>
        <Link
          to="/my/$clientId/progress"
          params={{ clientId: s.clientId }}
          className={buttonClass("light", "sm")}
        >
          Progress
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NextSession s={s} fmt={fmt} />
        <Credits s={s} fmt={fmt} />
        <Balance s={s} fmt={fmt} />
        {s.consentsMissing ? <ConsentsDue s={s} /> : null}
      </div>
    </section>
  );
}

/** Required consent forms still to sign (or to sign again after the academy changed them). */
function ConsentsDue({ s }: { s: PortalHomeStudentDto }) {
  const n = s.consentsMissing ?? 0;
  return (
    <Link
      to="/my/$clientId/consents"
      params={{ clientId: s.clientId }}
      className={`${figureLink} group flex items-center gap-4 rounded-[28px] bg-amber-soft p-5 text-ink sm:col-span-2`}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber">
        <FileSignature aria-hidden className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[1.125rem] font-medium">
          {plural(n, "consent form")} to sign
        </span>
        <span className="block text-[0.875rem] text-ink/75">
          The academy asks for {n === 1 ? "it" : "them"} before training. Read and sign online.
        </span>
      </span>
      <ArrowUpRight aria-hidden className="size-4.5 shrink-0 text-ink/60 group-hover:text-ink" />
    </Link>
  );
}

function Comments({ home }: { home: PortalHomeDto }) {
  const many = home.students.length > 1;
  const byId = new Map(home.students.map((s) => [s.clientId, s]));
  const academyOf = (clientId: string) =>
    home.academies.find((a) => a.workspaceId === byId.get(clientId)?.workspaceId);
  const first = home.students[0];
  return (
    <PortalCard title="From the coaches">
      {home.comments.length ? (
        <ol className="flex flex-col divide-y divide-line">
          {home.comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              about={many ? byId.get(c.clientId)?.firstName : undefined}
              academy={academyOf(c.clientId)}
            />
          ))}
        </ol>
      ) : (
        <p className="text-[0.9375rem] text-ink-2">
          When a coach shares a comment about{" "}
          {first ? (first.relation === "self" ? "your" : `${first.firstName}'s`) : "the"} training,
          it shows here.
        </p>
      )}
    </PortalCard>
  );
}

function CommentRow({
  comment,
  about,
  academy,
}: {
  comment: PortalCommentDto;
  about?: string;
  academy: PortalAcademyDto | undefined;
}) {
  const fmt = useAcademyFormat(academy);
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.875rem]">
        {comment.author ? (
          <CoachLine coach={comment.author} />
        ) : (
          <span className="font-medium">A coach</span>
        )}
        <span className="num text-ink-2">· {fmt.date(fmt.dayOf(comment.createdAt))}</span>
        {about ? <Pill tone="panel">{about}</Pill> : null}
      </p>
      <p className="mt-1.5 max-w-[65ch] text-[0.9375rem] whitespace-pre-line">{comment.body}</p>
      <Link
        to="/my/$clientId/progress"
        params={{ clientId: comment.clientId }}
        className="mt-1.5 inline-flex items-center gap-1 rounded-sm text-[0.8125rem] font-medium text-ink-2 underline decoration-line-strong underline-offset-4 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
      >
        All progress
      </Link>
    </li>
  );
}

function Announcements({ home }: { home: PortalHomeDto }) {
  const academy = home.academies[0]?.name ?? "your academy";
  return (
    <PortalCard title="Announcements">
      {home.announcements.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {home.announcements.map((a) => (
            <li key={a.id} className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{a.title}</p>
              <p className="mt-1 text-[0.9375rem] whitespace-pre-line text-ink-2">{a.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-start gap-3 text-[0.9375rem] text-ink-2">
          <Megaphone aria-hidden className="mt-0.5 size-4.5 shrink-0" />
          <span>News from {academy}, like schedule changes and events, will show here.</span>
        </p>
      )}
    </PortalCard>
  );
}

/** The family portal's first page: each student's next session, credits, and balance. */
export function PortalHome({ greetingName }: { greetingName?: string }) {
  const home = usePortalHome();
  const data = home.data;
  const firstName = data?.user.firstName || greetingName;
  const academyFor = (workspaceId: string) =>
    data?.academies.find((a) => a.workspaceId === workspaceId);
  const first = data?.academies[0];
  const fmt = useAcademyFormat(first);
  return (
    <PortalPage
      title={firstName ? `Hi, ${firstName}` : "Hi"}
      subtitle={fmt.longDay(fmt.today())}
      academy={first ? { name: first.name, logoKey: first.logoKey } : undefined}
    >
      <QueryGate query={home}>
        {(h) => (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
            <div className="flex flex-col gap-6">
              {h.students.length ? (
                h.students.map((s) => (
                  <StudentBlock
                    key={s.clientId}
                    s={s}
                    academy={academyFor(s.workspaceId)}
                    showAcademy={h.academies.length > 1}
                  />
                ))
              ) : (
                <Card className="px-6 py-2">
                  <EmptyState
                    icon={<UserRound aria-hidden className="size-5" />}
                    title="No students linked yet"
                    body="Your academy links your account to a player with an invite link. Open the link they sent you, and that player's sessions, progress, and payments show up here."
                  />
                </Card>
              )}
            </div>
            <div className="flex flex-col gap-5">
              {h.students.length ? <Comments home={h} /> : null}
              {h.students.length ? <Announcements home={h} /> : null}
              {h.academies.map((a) => (
                <AcademyCard key={a.workspaceId} academy={a} />
              ))}
              {h.students.length > 1 ? (
                <p className="flex items-center gap-2 px-1 text-[0.8125rem] text-ink-2">
                  <MessageSquareText aria-hidden className="size-4" />
                  {plural(h.students.length, "student")} linked to your account
                </p>
              ) : null}
            </div>
          </div>
        )}
      </QueryGate>
    </PortalPage>
  );
}
