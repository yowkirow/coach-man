import type { ClientListItemDto, EventDto } from "@shared/api-types";
import type { RegistrationStatus } from "@shared/domain";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ClientPicker } from "../../components/domain/lesson";
import { Button } from "../../components/ui/button";
import { Avatar, Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { MoneyField, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { fullName, useFormat } from "../../lib/format";
import { useCan } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { useInvalidateMoney } from "../money/record-payment-sheet";
import { OfflineNote } from "../schedule/choice";
import { currentPrice, plainAmount, REG_STATUS_LABEL, REG_STATUS_TONE } from "./event-meta";
import { useInvalidateEvents } from "./queries";

interface Added {
  id: string;
  name: string;
  status: RegistrationStatus;
  position: number | null;
}

/**
 * Registers clients one after another. The server waitlists automatically once the event is
 * full; each result shows the status it landed on.
 */
export function RegisterClientSheet({
  isOpen,
  onOpenChange,
  event,
  takenIds,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventDto;
  /** Clients already registered or waitlisted. */
  takenIds: string[];
}) {
  const fmt = useFormat();
  // Coaches register players at the event's list price; only money roles see or change prices.
  const can = useCan();
  const online = useOnline();
  const invalidateEvents = useInvalidateEvents();
  const invalidateMoney = useInvalidateMoney();
  const [client, setClient] = useState<ClientListItemDto | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [added, setAdded] = useState<Added[]>([]);
  const now = currentPrice(event, fmt.today());

  const register = useMutation({
    meta: { silent: true },
    mutationFn: (v: { client: ClientListItemDto; price: number | null; note: string }) =>
      api.post<{ status: RegistrationStatus; event: EventDto }>(
        `/events/${event.id}/registrations`,
        {
          clientId: v.client.id,
          priceMinor: can.money ? (v.price ?? undefined) : undefined,
          note: v.note.trim() || null,
        },
      ),
    onSuccess: (res, v) => {
      invalidateEvents(event.id);
      invalidateMoney(v.client.id);
      const waitlisted = res.status === "waitlisted";
      setAdded((prev) => [
        {
          id: v.client.id,
          name: fullName(v.client),
          status: res.status,
          position: waitlisted ? res.event.waitlistCount : null,
        },
        ...prev,
      ]);
      const charged = v.price ?? now.priceMinor;
      notify({
        tone: "success",
        title: waitlisted
          ? `${v.client.firstName} is on the waitlist`
          : `${v.client.firstName} registered`,
        body: waitlisted
          ? `The event is full. Number ${res.event.waitlistCount} in line; nothing is charged yet.`
          : can.money && charged > 0
            ? `${fmt.money(charged)} added to their balance. Booked into upcoming sessions.`
            : "Booked into upcoming sessions.",
      });
      setClient(null);
      setPrice(null);
      setNote("");
    },
  });
  const errs = fieldErrors(register.error);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setClient(null);
    setPrice(null);
    setNote("");
    setAdded([]);
    register.reset();
  }, [isOpen]);

  const registered = event.registeredCount;
  const full = event.capacity !== null && registered >= event.capacity;
  const description = event.capacity
    ? full
      ? `Full at ${event.capacity}. New players join the waitlist${event.waitlistCount ? ` (${event.waitlistCount} waiting)` : ""}.`
      : `${registered} of ${event.capacity} registered. Once it's full, new players join the waitlist.`
    : `${registered} registered. There's no capacity limit.`;

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Register client"
      description={description}
      footer={
        <>
          {!online ? <OfflineNote className="mr-auto" /> : null}
          <Button variant="light" onPress={() => onOpenChange(false)}>
            {added.length ? "Done" : "Cancel"}
          </Button>
          <Button
            variant="dark"
            isDisabled={!online || !client}
            isPending={register.isPending}
            onPress={() => client && register.mutate({ client, price, note })}
          >
            {client ? `${full ? "Waitlist" : "Register"} ${client.firstName}` : "Register"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (client && online) register.mutate({ client, price, note });
        }}
      >
        {client ? (
          <div className="flex items-center gap-3 rounded-[22px] bg-panel p-3">
            <Avatar person={client} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{fullName(client)}</p>
              {can.money ? (
                <p className="num truncate text-[0.8125rem] text-ink-2">
                  {client.balanceMinor > 0
                    ? `Owes ${fmt.money(client.balanceMinor)} already`
                    : "Nothing owed"}
                </p>
              ) : null}
            </div>
            <Button variant="ghost" size="sm" onPress={() => setClient(null)}>
              Change
            </Button>
          </div>
        ) : (
          <ClientPicker
            label="Client"
            autoFocus
            exclude={[...takenIds, ...added.map((a) => a.id)]}
            onSelect={(c) => {
              setClient(c);
              register.reset();
            }}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {can.money ? (
            <MoneyField
              label="Price (optional)"
              currency={fmt.currency}
              valueMinor={price}
              onChange={setPrice}
              placeholder={plainAmount(now.priceMinor, fmt)}
              description={
                now.earlyBird && event.earlyBirdUntil
                  ? `Early-bird price until ${fmt.day(event.earlyBirdUntil)}.`
                  : "Leave empty to charge the event price."
              }
              error={errs.priceMinor}
            />
          ) : null}
          <TextField
            label="Note (optional)"
            value={note}
            onChange={setNote}
            placeholder="e.g. Shirt size M, leaves early Friday"
            error={errs.note}
          />
        </div>

        {register.error ? <InlineError>{errorMessage(register.error)}</InlineError> : null}

        {added.length ? (
          <section aria-label="Added just now" className="rounded-[22px] bg-panel p-4">
            <h3 className="text-[0.9375rem] font-medium">Added just now</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {added.map((a) => (
                <li key={a.id} className="flex items-center gap-3 text-[0.9375rem]">
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <Pill tone={REG_STATUS_TONE[a.status]}>
                    {a.position ? `Waitlist #${a.position}` : REG_STATUS_LABEL[a.status]}
                  </Pill>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
