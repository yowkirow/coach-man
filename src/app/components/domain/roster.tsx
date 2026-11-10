import type { LedgerLineDto, RosterEntryDto } from "@shared/api-types";
import { ATTENDANCE_LABELS, type AttendanceStatus, type LessonKind } from "@shared/domain";
import { uuidv7 } from "@shared/ids";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, Clock3, HeartPulse, History, X } from "lucide-react";
import { useState } from "react";
import { ToggleButton } from "react-aria-components";
import { RosterSafety } from "../../features/safety/roster";
import { api } from "../../lib/api";
import { fullName, plural, useFormat } from "../../lib/format";
import { useCan, useWritesCoaching } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { type AttendanceVars, keys, type NoteVars } from "../../lib/query";
import { Button } from "../ui/button";
import { Avatar, Meter, Pill } from "../ui/display";
import { RowsSkeleton } from "../ui/feedback";
import { TextAreaField } from "../ui/field";
import { Sheet } from "../ui/overlay";

const IN: AttendanceStatus[] = ["present", "late"];

export function useAttendance() {
  return useMutation<unknown, Error, AttendanceVars>({ mutationKey: ["attendance"] });
}

export function CheckInToggle({
  status,
  pending,
  name,
  onToggle,
  isDisabled,
}: {
  status: AttendanceStatus;
  pending?: boolean;
  name: string;
  onToggle: (checked: boolean) => void;
  isDisabled?: boolean;
}) {
  const checked = IN.includes(status);
  const out = status === "absent" || status === "no_show";
  return (
    <ToggleButton
      isSelected={checked}
      onChange={onToggle}
      isDisabled={isDisabled}
      aria-label={checked ? `${name} is checked in. Undo check-in` : `Check in ${name}`}
      className={`relative flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-colors duration-150 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink ${
        checked
          ? "bg-lime text-ink animate-[settle_220ms_var(--ease-out-expo)]"
          : out
            ? "bg-coral-soft text-[#9f1d1d]"
            : "bg-card text-ink-3 ring-1 ring-line-strong hover:bg-panel hover:text-ink-2"
      }`}
    >
      {checked ? (
        status === "late" ? (
          <Clock3 aria-hidden className="size-5" strokeWidth={2.25} />
        ) : (
          <Check aria-hidden className="size-5.5" strokeWidth={2.75} />
        )
      ) : out ? (
        <X aria-hidden className="size-5" strokeWidth={2.5} />
      ) : (
        <Check aria-hidden className="size-5" strokeWidth={2} />
      )}
      {pending ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full border-2 border-card bg-sync"
        />
      ) : null}
    </ToggleButton>
  );
}

function statusPill(status: AttendanceStatus) {
  switch (status) {
    case "late":
      return <Pill tone="violet">Late</Pill>;
    case "absent":
      return <Pill tone="panel">Absent</Pill>;
    case "no_show":
      return <Pill tone="coral">No-show</Pill>;
    case "late_cancel":
      return <Pill tone="amber">Late cancel</Pill>;
    case "excused":
      return <Pill tone="outline">Excused</Pill>;
    default:
      return null;
  }
}

export function creditLine(
  entry: RosterEntryDto,
  kind: LessonKind | undefined,
  money: (m: number) => string,
): { text: string; tone: "ink" | "warn" | "sync" } {
  if (entry.pending) return { text: "Waiting to sync", tone: "sync" };
  if (kind === "event") return { text: "Covered by event registration", tone: "ink" };
  if (entry.complimentary) return { text: "Complimentary session", tone: "ink" };
  // chargeMinor is absent for coaches (no money): they still see that the player pays per session.
  if (entry.chargeMinor != null)
    return { text: `Pay per session · ${money(entry.chargeMinor)}`, tone: "warn" };
  if (entry.chargeId) return { text: "Pay per session", tone: "warn" };
  if (entry.packageRemaining !== null && entry.packageCredits !== null) {
    const left = entry.packageRemaining;
    return {
      text: `${left} of ${entry.packageCredits} left · ${entry.packageName}`,
      tone: left <= 1 ? "warn" : "ink",
    };
  }
  return { text: "No package · pays per session", tone: "warn" };
}

export function RosterRow({
  entry,
  lessonId,
  lessonKind,
  lessonCancelled,
  onRemove,
}: {
  entry: RosterEntryDto;
  lessonId: string;
  lessonKind?: LessonKind;
  lessonCancelled?: boolean;
  onRemove?: (clientId: string) => void;
}) {
  const fmt = useFormat();
  const mutation = useAttendance();
  const [sheetOpen, setSheetOpen] = useState(false);
  const name = fullName(entry);
  const line = creditLine(entry, lessonKind, fmt.moneyShort);

  const send = (status: AttendanceStatus, extra: Partial<AttendanceVars> = {}) => {
    const previous = entry.status;
    mutation.mutate(
      { lessonId, attendanceId: entry.attendanceId, status, mutationId: uuidv7(), ...extra },
      {
        onSuccess: () => {
          if (status === "present" && previous !== "present" && !extra.packageId) {
            const left =
              entry.packageRemaining !== null && entry.usablePackages.length > 0
                ? entry.packageRemaining - 1
                : null;
            notify({
              tone: "success",
              title: `${entry.firstName} checked in`,
              body:
                left !== null && lessonKind !== "event"
                  ? `${plural(left, "credit")} left on ${entry.packageName}`
                  : undefined,
              action: {
                label: "Undo",
                onAction: () =>
                  mutation.mutate({
                    lessonId,
                    attendanceId: entry.attendanceId,
                    status: previous,
                    mutationId: uuidv7(),
                  }),
              },
            });
          }
        },
      },
    );
    if (!navigator.onLine && IN.includes(status)) {
      notify({
        tone: "neutral",
        title: `${entry.firstName} checked in offline`,
        body: "It will sync when you're back online.",
      });
    }
  };

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label={`${name}: ${ATTENDANCE_LABELS[entry.status]}. ${line.text}. Open player options`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <Avatar person={entry} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[1rem] font-medium">{name}</span>
              {entry.isJunior ? <Pill tone="sky">Junior</Pill> : null}
              {entry.medicalFlag && !entry.safety ? (
                <HeartPulse
                  aria-label="Has a medical note"
                  className="size-4 shrink-0 text-[#b42318]"
                />
              ) : null}
              {statusPill(entry.status)}
            </span>
            <span
              className={`mt-0.5 block truncate text-[0.8125rem] ${line.tone === "warn" ? "text-[#9a5b00]" : line.tone === "sync" ? "text-[#b4480c]" : "text-ink-2"}`}
            >
              {line.text}
            </span>
          </span>
        </button>
        <CheckInToggle
          status={entry.status}
          pending={entry.pending}
          name={name}
          isDisabled={lessonCancelled}
          onToggle={(on) => send(on ? "present" : "booked")}
        />
      </div>
      {/* Its own line under the player, the full width of the row: room for both pills. */}
      <RosterSafety entry={entry} className="mt-2 pl-14" />
      <PlayerSheet
        isOpen={sheetOpen}
        onOpenChange={setSheetOpen}
        entry={entry}
        lessonId={lessonId}
        lessonKind={lessonKind}
        onSend={send}
        onRemove={onRemove}
      />
    </div>
  );
}

const STATUS_CHOICES: AttendanceStatus[] = [
  "present",
  "late",
  "absent",
  "no_show",
  "late_cancel",
  "excused",
  "booked",
];

function PlayerSheet({
  isOpen,
  onOpenChange,
  entry,
  lessonId,
  lessonKind,
  onSend,
  onRemove,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  entry: RosterEntryDto;
  lessonId: string;
  lessonKind?: LessonKind;
  onSend: (status: AttendanceStatus, extra?: Partial<AttendanceVars>) => void;
  onRemove?: (clientId: string) => void;
}) {
  const fmt = useFormat();
  const can = useCan();
  const writes = useWritesCoaching();
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [note, setNote] = useState("");
  const createNote = useMutation<unknown, Error, NoteVars>({ mutationKey: ["notes", "create"] });
  const checked = IN.includes(entry.status);
  const isEvent = lessonKind === "event";
  const funded = Boolean(entry.consumedPackageId || entry.chargeId);
  const close = () => onOpenChange(false);
  const pick = (status: AttendanceStatus, extra: Partial<AttendanceVars> = {}) => {
    onSend(status, extra);
    close();
  };

  return (
    <>
      <Sheet
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title={fullName(entry)}
        description={`${ATTENDANCE_LABELS[entry.status]} · ${creditLine(entry, lessonKind, fmt.moneyShort).text}`}
      >
        <div className="flex flex-col gap-6">
          <section aria-label="Attendance">
            <h3 className="mb-2 text-[0.8125rem] font-medium text-ink-2">Attendance</h3>
            <div className="flex flex-wrap gap-2">
              {STATUS_CHOICES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={entry.status === s}
                  onClick={() => pick(s)}
                  className={`h-10 cursor-pointer rounded-full px-4 text-[0.875rem] font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                    entry.status === s ? "bg-ink text-white" : "bg-panel text-ink hover:bg-line"
                  }`}
                >
                  {s === "booked" ? "Not marked" : ATTENDANCE_LABELS[s]}
                </button>
              ))}
            </div>
          </section>

          {!isEvent ? (
            <section aria-label="Payment">
              <h3 className="mb-2 text-[0.8125rem] font-medium text-ink-2">Pays with</h3>
              <ul className="flex flex-col gap-2">
                {entry.usablePackages.map((p) => {
                  const current = entry.consumedPackageId === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-pressed={current}
                        onClick={() =>
                          pick(checked ? entry.status : "present", { packageId: p.id })
                        }
                        className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-ink ${current ? "bg-lime" : "bg-panel hover:bg-line"}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block text-[0.8125rem] text-ink-2">
                            {plural(p.remaining, "credit")} left
                            {p.expiresOn ? ` · expires ${fmt.day(p.expiresOn)}` : ""}
                          </span>
                        </span>
                        {current ? <Check aria-hidden className="size-5" /> : null}
                      </button>
                    </li>
                  );
                })}
                <li>
                  <button
                    type="button"
                    aria-pressed={Boolean(entry.chargeId)}
                    onClick={() => pick(checked ? entry.status : "present", { packageId: "none" })}
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-ink ${entry.chargeId ? "bg-lime" : "bg-panel hover:bg-line"}`}
                  >
                    <span className="flex-1 font-medium">Pay per session</span>
                    {entry.chargeMinor != null ? (
                      <span className="num text-ink-2">{fmt.money(entry.chargeMinor)}</span>
                    ) : null}
                  </button>
                </li>
                {can.money ? (
                  <li>
                    <button
                      type="button"
                      aria-pressed={entry.complimentary}
                      onClick={() =>
                        pick(checked ? entry.status : "present", {
                          complimentary: !entry.complimentary,
                        })
                      }
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-ink ${entry.complimentary ? "bg-lime" : "bg-panel hover:bg-line"}`}
                    >
                      <span className="flex-1 font-medium">No charge (complimentary)</span>
                    </button>
                  </li>
                ) : null}
              </ul>
              {entry.packageRemaining !== null && entry.packageCredits ? (
                <div className="mt-3">
                  <Meter
                    value={entry.packageRemaining}
                    max={entry.packageCredits}
                    tone={entry.packageRemaining <= 1 ? "coral" : "ink"}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          {writes ? (
            <section aria-label="Note" className="flex flex-col gap-2">
              <TextAreaField
                label={`Note about ${entry.firstName}`}
                value={note}
                onChange={setNote}
                rows={2}
                placeholder="What clicked today, what to work on next…"
              />
              <Button
                variant="light"
                size="sm"
                className="self-start"
                isDisabled={!note.trim()}
                onPress={() => {
                  createNote.mutate({
                    id: uuidv7(),
                    lessonId,
                    clientId: entry.clientId,
                    body: note.trim(),
                  });
                  setNote("");
                  notify({
                    tone: "success",
                    title: "Note saved",
                    body: `On ${entry.firstName}'s profile and this session.`,
                  });
                }}
              >
                Save note
              </Button>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button
              variant="light"
              size="sm"
              icon={<History aria-hidden className="size-4" />}
              onPress={() => setLedgerOpen(true)}
            >
              Credit history
            </Button>
            <Link
              to="/clients/$clientId"
              params={{ clientId: entry.clientId }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-4 text-[0.875rem] font-medium text-ink ring-1 ring-line-strong outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
            >
              Profile <ArrowUpRight aria-hidden className="size-4" />
            </Link>
            {onRemove ? (
              <Button
                variant="ghost"
                size="sm"
                isDisabled={funded}
                className="text-[#b42318]"
                onPress={() => {
                  onRemove(entry.clientId);
                  close();
                }}
              >
                Remove from session
              </Button>
            ) : null}
          </div>
        </div>
      </Sheet>
      <LedgerSheet
        isOpen={ledgerOpen}
        onOpenChange={setLedgerOpen}
        clientId={entry.clientId}
        name={fullName(entry)}
        balanceMinor={entry.balanceMinor}
      />
    </>
  );
}

const REASON_LABEL: Record<string, string> = {
  use: "Used",
  reversal: "Returned",
  adjustment: "Adjusted",
  expiry: "Expired",
  void: "Voided",
};

/** The proof behind a credit count: every ledger line, newest first. */
export function LedgerSheet({
  isOpen,
  onOpenChange,
  clientId,
  name,
  balanceMinor,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  name: string;
  balanceMinor?: number;
}) {
  const fmt = useFormat();
  const can = useCan();
  const q = useQuery({
    queryKey: keys.ledger(clientId),
    queryFn: () => api.get<LedgerLineDto[]>(`/clients/${clientId}/ledger`),
    enabled: isOpen,
  });
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`${name}'s credits`}
      description={
        balanceMinor
          ? `Balance due ${fmt.money(balanceMinor)}`
          : "Every credit used, returned, or adjusted."
      }
    >
      {q.isPending ? (
        <RowsSkeleton rows={4} />
      ) : q.data && q.data.length > 0 ? (
        <ol className="flex flex-col divide-y divide-line">
          {q.data.map((line) => (
            <li key={line.id} className="flex items-center gap-3 py-3">
              <span
                className={`num flex size-10 shrink-0 items-center justify-center rounded-full text-[0.9375rem] font-semibold ${line.delta < 0 ? "bg-panel text-ink" : "bg-lime text-ink"}`}
              >
                {line.delta > 0 ? `+${line.delta}` : line.delta}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {REASON_LABEL[line.reason] ?? line.reason}
                  {line.lessonTitle ? ` · ${line.lessonTitle}` : ""}
                </p>
                <p className="truncate text-[0.8125rem] text-ink-2">
                  {line.packageName} · {fmt.day(fmt.dayOf(line.lessonStartsAt ?? line.createdAt))}
                  {line.note ? ` · ${line.note}` : ""}
                </p>
              </div>
              <span className="num text-[0.875rem] text-ink-2">{line.runningRemaining} left</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-ink-2">
          {can.money
            ? "No credit history yet. Sell a package from the client's profile to start one."
            : "No credit history yet. It starts when the academy sells this player a package."}
        </p>
      )}
    </Sheet>
  );
}
