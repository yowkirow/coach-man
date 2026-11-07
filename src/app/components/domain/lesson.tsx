import type { ClientListItemDto, LessonSummaryDto } from "@shared/api-types";
import { LESSON_KIND_LABELS } from "@shared/domain";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleX,
  Radio,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ComboBox, Input, Label, ListBox, ListBoxItem, Popover } from "react-aria-components";
import { fullName, useFormat } from "../../lib/format";
import { useClients } from "../../lib/hooks";
import { Avatar, AvatarStack, Pill, type PillTone } from "../ui/display";
import { fieldClass, popoverClass } from "../ui/field";

export type SessionPhase = "live" | "upcoming" | "done" | "cancelled";

export function sessionPhase(
  l: { startsAt: number; endsAt: number; status: string },
  now: number,
): SessionPhase {
  if (l.status === "cancelled") return "cancelled";
  if (l.status === "completed" || now > l.endsAt) return "done";
  if (now >= l.startsAt - 10 * 60_000) return "live";
  return "upcoming";
}

const phasePill: Record<SessionPhase, PillTone> = {
  live: "lime",
  upcoming: "violet",
  done: "sky",
  cancelled: "coral",
};

/** Dark list card for the command panel (reference: worklist cards; selected one turns lime). */
export function SessionTile({
  lesson,
  people,
  now,
  selected,
  linkTo,
}: {
  lesson: LessonSummaryDto;
  people: { firstName: string; lastName: string; photoKey?: string | null }[];
  now: number;
  selected: boolean;
  /** "today" selects the session in place on Today; "session" opens the session page. */
  linkTo: "today" | "session";
}) {
  const fmt = useFormat();
  const phase = sessionPhase(lesson, now);
  const where = [lesson.court ? `Court ${lesson.court}` : null, lesson.venueName]
    .filter(Boolean)
    .join(" · ");
  const status =
    phase === "live"
      ? now < lesson.startsAt
        ? `Starts ${fmt.relative(lesson.startsAt, now)}`
        : "On court now"
      : phase === "upcoming"
        ? `Starts ${fmt.relative(lesson.startsAt, now)}`
        : phase === "done"
          ? lesson.status === "completed"
            ? "Completed"
            : "Finished"
          : "Cancelled";
  const StatusIcon =
    phase === "live"
      ? Radio
      : phase === "upcoming"
        ? CalendarClock
        : phase === "done"
          ? CircleCheck
          : CircleX;
  const cls = `group block rounded-[24px] p-4 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
    selected
      ? "bg-lime text-ink [--avatar-ring:var(--color-lime)]"
      : "bg-night-2 text-night-ink [--avatar-ring:var(--color-night-2)] hover:bg-night-3 hover:[--avatar-ring:var(--color-night-3)]"
  }`;
  const body = (
    <>
      <div className="flex items-start gap-3">
        {people.length ? (
          <AvatarStack people={people} max={2} dark={!selected} />
        ) : (
          <span
            className={`flex size-9 items-center justify-center rounded-full ${selected ? "bg-ink/10" : "bg-night-3"}`}
          >
            <CircleDot aria-hidden className="size-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[1rem] leading-snug">{lesson.title}</span>
          <span
            className={`num block truncate text-[0.75rem] ${selected ? "text-ink/70" : "text-night-ink-2"}`}
          >
            {fmt.timeRange(lesson.startsAt, lesson.endsAt)}
            {where ? ` · ${where}` : ""}
          </span>
        </span>
        <ArrowUpRight
          aria-hidden
          className={`size-4 shrink-0 ${selected ? "text-ink/70" : "text-night-ink-2"}`}
        />
      </div>
      <div
        className={`mt-3 flex h-11 items-center gap-2 rounded-full border px-3 ${selected ? "border-ink/15" : "border-night-4"}`}
      >
        <StatusIcon aria-hidden className="size-4 shrink-0" />
        <span className="flex-1 truncate text-[0.8125rem]">{status}</span>
        <Pill tone={selected ? "white" : phasePill[phase]}>
          <span className="num">
            {lesson.checkedInCount}/{lesson.bookedCount}
          </span>
          in
        </Pill>
      </div>
    </>
  );
  return linkTo === "today" ? (
    <Link
      to="/"
      search={{ session: lesson.id }}
      aria-current={selected ? "true" : undefined}
      className={cls}
    >
      {body}
    </Link>
  ) : (
    <Link
      to="/sessions/$lessonId"
      params={{ lessonId: lesson.id }}
      aria-current={selected ? "true" : undefined}
      className={cls}
    >
      {body}
    </Link>
  );
}

/** Light list row: time, title, where, and fill. */
export function LessonRow({
  lesson,
  showDate = false,
  now = Date.now(),
}: {
  lesson: LessonSummaryDto;
  showDate?: boolean;
  now?: number;
}) {
  const fmt = useFormat();
  const phase = sessionPhase(lesson, now);
  const where = [lesson.court ? `Court ${lesson.court}` : null, lesson.venueName]
    .filter(Boolean)
    .join(" · ");
  const cancelled = phase === "cancelled";
  return (
    <Link
      to="/sessions/$lessonId"
      params={{ lessonId: lesson.id }}
      className="group flex items-center gap-4 rounded-2xl px-2 py-3 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
    >
      <span className="flex w-[4.5rem] shrink-0 flex-col">
        {showDate ? (
          <span className="text-[0.75rem] text-ink-2">{fmt.day(fmt.dayOf(lesson.startsAt))}</span>
        ) : null}
        <span
          className={`num text-[1.125rem] font-medium ${cancelled ? "text-ink-3 line-through" : ""}`}
        >
          {fmt.time(lesson.startsAt)}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={`line-clamp-2 font-medium ${cancelled ? "text-ink-2 line-through" : ""}`}>
          {lesson.title}
        </span>
        <span className="block truncate text-[0.8125rem] text-ink-2">
          {LESSON_KIND_LABELS[lesson.kind]}
          {where ? ` · ${where}` : ""}
        </span>
      </span>
      <Pill tone={phasePill[phase]}>
        {cancelled ? (
          "Cancelled"
        ) : (
          <>
            <span className="num">
              {lesson.checkedInCount}/{lesson.bookedCount}
            </span>{" "}
            in
          </>
        )}
      </Pill>
      <ChevronRight aria-hidden className="size-4.5 shrink-0 text-ink-3" />
    </Link>
  );
}

/** Searchable client picker (works offline from the cached client list). */
export function ClientPicker({
  label,
  onSelect,
  exclude = [],
  placeholder = "Search clients",
  autoFocus,
}: {
  label: string;
  onSelect: (client: ClientListItemDto) => void;
  exclude?: string[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const clients = useClients({});
  const [text, setText] = useState("");
  const items = useMemo(() => {
    const skip = new Set(exclude);
    const needle = text.trim().toLowerCase();
    return (clients.data ?? [])
      .filter((c) => !skip.has(c.id))
      .filter(
        (c) =>
          !needle ||
          fullName(c).toLowerCase().includes(needle) ||
          c.email?.includes(needle) ||
          c.phone?.includes(needle),
      )
      .slice(0, 50);
  }, [clients.data, exclude, text]);
  return (
    <ComboBox
      inputValue={text}
      onInputChange={setText}
      onSelectionChange={(key) => {
        const c = clients.data?.find((x) => x.id === key);
        if (c) {
          onSelect(c);
          setText("");
        }
      }}
      menuTrigger="focus"
      autoFocus={autoFocus}
      className="flex flex-col gap-1.5"
    >
      <Label className="text-[0.8125rem] font-medium text-ink-2">{label}</Label>
      <Input placeholder={placeholder} className={fieldClass} />
      <Popover className={`w-(--trigger-width) ${popoverClass}`}>
        <ListBox
          className="max-h-72 overflow-auto outline-none"
          renderEmptyState={() => <p className="px-3 py-3 text-ink-2">No matching clients.</p>}
        >
          {items.map((c) => (
            <ListBoxItem
              key={c.id}
              id={c.id}
              textValue={fullName(c)}
              className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 outline-none data-[focused]:bg-panel"
            >
              <Avatar person={c} size="sm" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{fullName(c)}</span>
                <span className="truncate text-[0.8125rem] text-ink-2">
                  {c.creditsRemaining > 0 ? `${c.creditsRemaining} credits` : "No credits"}
                  {c.level ? ` · ${c.level}` : ""}
                </span>
              </span>
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}
