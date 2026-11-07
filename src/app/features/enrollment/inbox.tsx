import type {
  EnrollmentListDto,
  EnrollmentListItemDto,
  RenewalDueDto,
  RenewalsDueDto,
} from "@shared/api-types";
import { ENROLLMENT_STATUSES, type EnrollmentStatus } from "@shared/domain";
import { ENROLLMENT_STATUS_LABELS, renewalReminderMessage } from "@shared/enrollment";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Copy, Inbox, Phone } from "lucide-react";
import { useState } from "react";
import { copyText } from "../../components/domain/invite-link";
import { Button } from "../../components/ui/button";
import {
  Avatar,
  Card,
  CardHeader,
  KpiTile,
  Pill,
  useCurrentInView,
} from "../../components/ui/display";
import { EmptyState, ErrorState, RowsSkeleton } from "../../components/ui/feedback";
import { errorMessage } from "../../lib/api";
import { type Format, fullName } from "../../lib/format";
import { useRenewalsDue } from "./queries";
import { enrollmentStatusPill, periodText } from "./text";

export type InboxStatus = EnrollmentStatus | "all";
/** Which list is showing: a status, "Not yet renewed", or none (a request is open). */
export type InboxActive = InboxStatus | "renewals" | null;

export interface InboxSearch {
  status?: InboxStatus;
  view?: "renewals";
}

const FILTERS: InboxStatus[] = [...ENROLLMENT_STATUSES, "all"];
/**
 * A list link is current only on its own list: by default the router also counts `/enrollments`,
 * the Requested list, as current on every other list and on each request's page.
 */
const EXACT = { exact: true } as const;
const filterLabel = (s: InboxStatus) => (s === "all" ? "All" : ENROLLMENT_STATUS_LABELS[s]);

/** Status chips (and "Not yet renewed") above the list on the canvas. */
export function InboxFilters({
  active,
  counts,
  renewals,
}: {
  active: InboxActive;
  counts: EnrollmentListDto["counts"] | undefined;
  renewals: number | undefined;
}) {
  const chip = (on: boolean) =>
    `inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[0.875rem] font-medium whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
      on ? "bg-ink text-white" : "bg-card text-ink hover:bg-panel"
    }`;
  const total = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : undefined;
  const row = useCurrentInView<HTMLUListElement>(active);
  return (
    <ul
      ref={row}
      aria-label="Filters"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      {FILTERS.map((s) => {
        const on = active === s;
        const n = s === "all" ? total : counts?.[s];
        return (
          <li key={s} className="shrink-0">
            <Link
              to="/enrollments"
              search={s === "requested" ? {} : { status: s }}
              activeOptions={EXACT}
              aria-current={on ? "true" : undefined}
              className={chip(on)}
            >
              {filterLabel(s)}
              {n !== undefined ? (
                <span className={`num ${on ? "text-white/70" : "text-ink-2"}`}>{n}</span>
              ) : null}
            </Link>
          </li>
        );
      })}
      <li className="shrink-0">
        <Link
          to="/enrollments"
          search={{ view: "renewals" }}
          activeOptions={EXACT}
          aria-current={active === "renewals" ? "true" : undefined}
          className={chip(active === "renewals")}
        >
          Not yet renewed
          {renewals !== undefined ? (
            <span className={`num ${active === "renewals" ? "text-white/70" : "text-ink-2"}`}>
              {renewals}
            </span>
          ) : null}
        </Link>
      </li>
    </ul>
  );
}

/**
 * The command panel (desktop): what's waiting, the same lists as dark rows, and on a request's
 * page the queue it came from, to work straight through it.
 */
export function InboxPanel({
  active,
  counts,
  renewals,
  queue,
  fmt,
}: {
  active: InboxActive;
  counts: EnrollmentListDto["counts"] | undefined;
  renewals: number | undefined;
  queue?: { title: string; items: EnrollmentListItemDto[]; selectedId: string };
  fmt: Format;
}) {
  const dash = "–";
  const row = (on: boolean) =>
    `flex h-12 items-center gap-3 rounded-full px-4 text-[0.9375rem] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
      on ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:bg-night-3"
    }`;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;
  return (
    <div className="flex flex-col gap-5">
      <div className="px-1">
        <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">Enrollments</h2>
        <p className="mt-1 text-[0.875rem] text-night-ink-2">Requests from your academy page</p>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <KpiTile label="To review" value={counts ? counts.requested : dash} tint="lime" />
        <KpiTile label="Waitlisted" value={counts ? counts.waitlisted : dash} tint="amber" />
      </div>
      <nav aria-label="Enrollment lists" className="flex flex-col gap-2">
        {FILTERS.map((s) => {
          const on = active === s;
          const n = s === "all" ? total : counts?.[s];
          return (
            <Link
              key={s}
              to="/enrollments"
              search={s === "requested" ? {} : { status: s }}
              activeOptions={EXACT}
              aria-current={on ? "true" : undefined}
              className={row(on)}
            >
              <span className="min-w-0 flex-1 truncate">{filterLabel(s)}</span>
              {n !== undefined ? (
                <span className={`num text-[0.875rem] ${on ? "text-ink/70" : "text-night-ink-2"}`}>
                  {n}
                </span>
              ) : null}
            </Link>
          );
        })}
        <Link
          to="/enrollments"
          search={{ view: "renewals" }}
          activeOptions={EXACT}
          aria-current={active === "renewals" ? "true" : undefined}
          className={row(active === "renewals")}
        >
          <span className="min-w-0 flex-1 truncate">Not yet renewed</span>
          {renewals !== undefined ? (
            <span
              className={`num text-[0.875rem] ${active === "renewals" ? "text-ink/70" : "text-night-ink-2"}`}
            >
              {renewals}
            </span>
          ) : null}
        </Link>
      </nav>
      {queue?.items.length ? (
        <section aria-label={queue.title} className="flex flex-col gap-2">
          <h3 className="px-1 text-[0.8125rem] font-medium text-night-ink-2">{queue.title}</h3>
          <ul className="flex flex-col gap-1.5">
            {queue.items.map((item) => {
              const on = item.id === queue.selectedId;
              return (
                <li key={item.id}>
                  <Link
                    to="/enrollments/$requestId"
                    params={{ requestId: item.id }}
                    aria-current={on ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-[20px] px-3 py-2.5 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
                      on ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:bg-night-3"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem]">
                        {fullName(item.student)}
                      </span>
                      <span
                        className={`num block truncate text-[0.8125rem] ${on ? "text-ink/70" : "text-night-ink-2"}`}
                      >
                        {item.tierName} · {periodText(item, fmt)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
function RequestRow({
  item,
  fmt,
  showStatus,
}: {
  item: EnrollmentListItemDto;
  fmt: Format;
  showStatus: boolean;
}) {
  const pill = enrollmentStatusPill(item.status);
  const person = { firstName: item.student.firstName, lastName: item.student.lastName };
  const from =
    item.submitter.relation === "guardian"
      ? `From ${item.submitter.name}, parent or guardian`
      : item.submitter.relation === "self"
        ? "From the student"
        : `From ${item.submitter.name}`;
  return (
    <li>
      <Link
        to="/enrollments/$requestId"
        params={{ requestId: item.id }}
        className="flex items-center gap-3 rounded-2xl px-2 py-3 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
      >
        <Avatar person={person} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{fullName(person)}</span>
            {item.student.isNew ? <Pill tone="violet">New student</Pill> : null}
            {item.renewal ? <Pill tone="outline">Renewal</Pill> : null}
            {showStatus ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
            {item.proofsPending ? <Pill tone="sky">Proof to review</Pill> : null}
          </span>
          <span className="num mt-0.5 block text-[0.8125rem] text-ink-2">
            {item.tierName} · {periodText(item, fmt)}
            {item.programName ? ` · ${item.programName}` : ""}
          </span>
          <span className="num block text-[0.8125rem] text-ink-2">
            {from} · {fmt.date(fmt.dayOf(item.createdAt))}
          </span>
        </span>
        <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ink-3" />
      </Link>
    </li>
  );
}
/** The requests in the chosen status, newest first. */
export function RequestList({
  list,
  status,
  fmt,
  isPending,
  error,
  onRetry,
}: {
  list: EnrollmentListDto | undefined;
  status: InboxStatus;
  fmt: Format;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const title = status === "all" ? "All requests" : filterLabel(status);
  if (isPending && !list) {
    return (
      <Card className="px-5 py-2">
        <RowsSkeleton rows={4} />
      </Card>
    );
  }
  if (!list) {
    return (
      <Card className="px-6 py-2">
        <ErrorState
          title="Couldn't load the requests"
          message={errorMessage(error)}
          onRetry={onRetry}
        />
      </Card>
    );
  }
  return (
    <Card label={title}>
      <CardHeader
        title={title}
        action={list.items.length ? <Pill tone="panel">{list.items.length}</Pill> : null}
      />
      {list.items.length ? (
        <ul className="flex flex-col px-3 pb-3">
          {list.items.map((item) => (
            <RequestRow key={item.id} item={item} fmt={fmt} showStatus={status === "all"} />
          ))}
        </ul>
      ) : (
        <div className="px-6 pb-4">
          <EmptyState
            icon={<Inbox aria-hidden className="size-5" />}
            title={
              status === "requested" ? "Nothing to review" : `No ${title.toLowerCase()} requests`
            }
            body={
              status === "requested"
                ? "Requests families send from your academy page land here. Turn on taking enrollment requests in Settings, Academy profile."
                : "Requests show here once they're in this state."
            }
          />
        </div>
      )}
    </Card>
  );
}

function RenewalRow({
  item,
  data,
  fmt,
}: {
  item: RenewalDueDto;
  data: RenewalsDueDto;
  fmt: Format;
}) {
  const [shown, setShown] = useState(false);
  const person = { firstName: item.firstName, lastName: item.lastName };
  const text = renewalReminderMessage({
    academyName: data.academyName,
    studentFirstName: item.firstName,
    tierName: item.tierName,
    endsOn: fmt.date(item.expiresOn),
    nextMonth: fmt.month(data.nextMonth),
    link: data.portalUrl,
  });
  const messageId = `renewal-message-${item.clientId}`;
  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link
          to="/clients/$clientId"
          params={{ clientId: item.clientId }}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          <Avatar person={person} size="md" />
          <span className="min-w-0">
            <span className="block font-medium">{fullName(person)}</span>
            <span className="num block text-[0.8125rem] text-ink-2">
              {item.tierName} ends {fmt.date(item.expiresOn)}
            </span>
            {item.contactName || item.contactPhone ? (
              <span className="num flex items-center gap-1.5 text-[0.8125rem] text-ink-2">
                <Phone aria-hidden className="size-3.5" />
                {[item.contactName, item.contactPhone].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </span>
        </Link>
        <Button
          variant="dark"
          size="sm"
          icon={<Copy aria-hidden className="size-4" />}
          onPress={() => {
            setShown(true);
            void copyText(text, "Reminder");
          }}
          aria-describedby={shown ? messageId : undefined}
          className="self-start sm:self-center"
        >
          Copy reminder message
          <span className="sr-only"> for {fullName(person)}</span>
        </Button>
      </div>
      {shown ? (
        <p
          id={messageId}
          className="rounded-[22px] bg-panel px-4 py-3 text-[0.875rem] break-words whitespace-pre-line"
        >
          {text}
        </p>
      ) : null}
    </li>
  );
}
/** "Not yet renewed": month-end packages ending this month with nothing for next month. */
export function RenewalsList({ fmt }: { fmt: Format }) {
  const q = useRenewalsDue();
  if (q.isPending) {
    return (
      <Card className="px-5 py-2">
        <RowsSkeleton rows={3} />
      </Card>
    );
  }
  if (!q.data) {
    return (
      <Card className="px-6 py-2">
        <ErrorState
          title="Couldn't load renewals"
          message={errorMessage(q.error)}
          onRetry={() => void q.refetch()}
        />
      </Card>
    );
  }
  const data = q.data;
  return (
    <Card label="Not yet renewed">
      <CardHeader
        title="Not yet renewed"
        action={data.items.length ? <Pill tone="panel">{data.items.length}</Pill> : null}
      />
      <p className="-mt-1 max-w-[70ch] px-5 pb-3 text-[0.875rem] text-ink-2">
        Monthly packages that end this month, with nothing yet for {fmt.month(data.nextMonth)}.
        Families renew in one tap from their portal; the reminder says how.
      </p>
      {data.items.length ? (
        <ul className="flex flex-col divide-y divide-line px-5 pb-5">
          {data.items.map((item) => (
            <RenewalRow key={item.clientId} item={item} data={data} fmt={fmt} />
          ))}
        </ul>
      ) : (
        <div className="px-6 pb-4">
          <EmptyState
            title="Everyone's renewed"
            body={`No monthly package ending this month is waiting on ${fmt.month(data.nextMonth)}.`}
          />
        </div>
      )}
    </Card>
  );
}
