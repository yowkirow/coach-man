import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CloudRain } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import { SelectField, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { useLessons, useVenues } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "./choice";

/** Cancels every scheduled session on a day (optionally one venue) and returns credits. */
export function RainOutSheet({
  isOpen,
  onOpenChange,
  date: initialDate,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
}) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const online = useOnline();
  const venues = useVenues();
  const [date, setDate] = useState(initialDate);
  const [venueId, setVenueId] = useState("all");
  const [reason, setReason] = useState("");
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const lessons = useLessons(valid ? date : initialDate, valid ? date : initialDate);

  const rainOut = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api.post<{ cancelled: number }>("/lessons/rain-out", {
        date,
        venueId: venueId === "all" ? null : venueId,
        reason: reason.trim() || null,
      }),
    onSuccess: ({ cancelled }) => {
      const stale = [
        ["lessons"],
        ["lesson"],
        keys.today,
        ["clients"],
        ["client"],
        ["group"],
        ["event"],
      ];
      for (const key of stale) void qc.invalidateQueries({ queryKey: key });
      notify({
        tone: cancelled ? "success" : "neutral",
        title: cancelled ? `${plural(cancelled, "session")} cancelled` : "Nothing to cancel",
        body: cancelled ? "Credits were returned." : "No scheduled sessions were left that day.",
      });
      onOpenChange(false);
    },
  });
  const errs = fieldErrors(rainOut.error);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setDate(initialDate);
    setVenueId("all");
    setReason("");
    rainOut.reset();
  }, [isOpen]);

  const affected = (lessons.data ?? []).filter(
    (l) => l.status === "scheduled" && (venueId === "all" || l.venueId === venueId),
  );

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Rain-out"
      description="Cancels the day's scheduled sessions. Credits already used go back to players' packages and pay-per-session charges are voided."
      footer={
        <>
          {!online ? <OfflineNote className="mr-auto" /> : null}
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Keep sessions
          </Button>
          <Button
            variant="danger"
            icon={<CloudRain aria-hidden className="size-4.5" />}
            isDisabled={!online || !valid || affected.length === 0}
            isPending={rainOut.isPending}
            onPress={() => rainOut.mutate()}
          >
            {affected.length ? `Cancel ${plural(affected.length, "session")}` : "Cancel sessions"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (online && valid && affected.length) rainOut.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={setDate}
            error={errs.date}
            isRequired
          />
          <SelectField
            label="Venue"
            options={[
              { id: "all", label: "All venues" },
              ...(venues.data ?? []).map((v) => ({ id: v.id, label: v.name })),
            ]}
            value={venueId}
            onChange={setVenueId}
          />
        </div>
        <TextField
          label="Reason (optional)"
          value={reason}
          onChange={setReason}
          placeholder="Rain, court closed, coach unwell…"
          description="Shown on each cancelled session. Defaults to “Rain-out”."
        />
        <section
          aria-label="Sessions that will be cancelled"
          className="rounded-[22px] bg-panel p-4"
        >
          <h3 className="text-[0.9375rem] font-medium">
            {valid ? fmt.longDay(date) : "Pick a date"}
          </h3>
          {lessons.isPending ? (
            <p className="mt-1 text-[0.875rem] text-ink-2">Checking the schedule…</p>
          ) : affected.length ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {affected.map((l) => (
                <li key={l.id} className="flex items-baseline gap-3 text-[0.875rem]">
                  <span className="num w-[4.75rem] shrink-0 text-ink-2">
                    {fmt.time(l.startsAt)}
                  </span>
                  <span className="min-w-0 truncate font-medium">{l.title}</span>
                  <span className="ml-auto shrink-0 text-ink-2">
                    {plural(l.bookedCount, "player")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[0.875rem] text-ink-2">
              No scheduled sessions {venueId === "all" ? "that day" : "at this venue that day"}.
            </p>
          )}
        </section>
        {rainOut.error ? <InlineError>{errorMessage(rainOut.error)}</InlineError> : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
