import type { ClientDetailDto, PackageBalanceDto } from "@shared/api-types";
import { LESSON_KIND_LABELS } from "@shared/domain";
import { addDays, daysBetween } from "@shared/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History, Minus, Plus, Shirt, Ticket } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Bento, Meter } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { Segmented, Switch, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { useCan } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineHint } from "./bits";
import { EXPIRY_WINDOW_DAYS } from "./client-utils";
import { useRefreshClient } from "./queries";

/** Packages that still matter: active ones, and expired ones with credits left to rescue. */
export function livePackages(detail: ClientDetailDto) {
  return detail.packages
    .filter((p) => p.status === "active" || (p.status === "expired" && p.remaining > 0))
    .sort(
      (a, b) =>
        Number(a.status === "expired") - Number(b.status === "expired") ||
        (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999"),
    );
}

function ExpiryLine({ p }: { p: PackageBalanceDto }) {
  const fmt = useFormat();
  const today = fmt.today();
  const kinds = p.lessonKinds.length
    ? p.lessonKinds.map((k) => LESSON_KIND_LABELS[k]).join(", ")
    : "Any session";
  // A month-end package sold for next month pays for nothing before the 1st.
  if (p.status === "active" && p.startsOn && p.startsOn > today)
    return (
      <p className="num text-[0.8125rem] text-ink/75">
        <span className="font-medium text-ink">Starts {fmt.date(p.startsOn)}</span>
        {p.expiresOn ? ` · expires ${fmt.date(p.expiresOn)}` : ""} · {kinds}
      </p>
    );
  if (p.status === "expired" && p.expiresOn)
    return (
      <p className="text-[0.8125rem] font-medium text-[#7a1212]">
        Expired {fmt.date(p.expiresOn)} with {plural(p.remaining, "credit")} unused
      </p>
    );
  if (!p.expiresOn) return <p className="text-[0.8125rem] text-ink/75">No expiry · {kinds}</p>;
  const days = daysBetween(today, p.expiresOn);
  return (
    <p className="num text-[0.8125rem] text-ink/75">
      <span className={days <= EXPIRY_WINDOW_DAYS ? "font-medium text-ink" : undefined}>
        Expires {fmt.date(p.expiresOn)}
        {days <= EXPIRY_WINDOW_DAYS
          ? ` · ${days === 0 ? "today" : `in ${plural(days, "day")}`}`
          : ""}
      </span>{" "}
      · {kinds}
    </p>
  );
}

/** Lavender bento: each live package with its meter, plus the ways to change it. */
export function PackagesBento({
  detail,
  onSell,
  onLedger,
}: {
  detail: ClientDetailDto;
  onSell: () => void;
  onLedger: () => void;
}) {
  const online = useOnline();
  // Selling, adjusting, and re-dating packages is money: coaches see the credits only.
  const can = useCan();
  const [adjusting, setAdjusting] = useState<PackageBalanceDto | null>(null);
  const [expiry, setExpiry] = useState<PackageBalanceDto | null>(null);
  const [uniform, setUniform] = useState<PackageBalanceDto | null>(null);
  const live = livePackages(detail);
  const active = live.filter((p) => p.status === "active");
  const left = active.reduce((n, p) => n + p.remaining, 0);
  const total = active.reduce((n, p) => n + p.creditsTotal, 0);
  return (
    <Bento
      tone="lavender"
      title="Packages"
      subtitle={
        active.length
          ? `${left} of ${total} credits left${active.length > 1 ? ` across ${active.length} packages` : ""}`
          : live.length
            ? "Nothing active right now"
            : "No package yet"
      }
    >
      {live.length ? (
        <ul className="flex flex-col gap-2.5">
          {live.map((p) => (
            <li key={p.id} className="rounded-[20px] bg-white/45 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-medium">{p.name}</p>
                <p className="num shrink-0 text-[1.375rem] leading-none font-light">
                  {p.remaining}
                  <span className="text-[0.875rem] text-ink/70">
                    {p.remaining > p.creditsTotal ? " left" : ` of ${p.creditsTotal}`}
                  </span>
                </p>
              </div>
              <div className="mt-3">
                <Meter
                  value={p.remaining}
                  max={p.creditsTotal}
                  tone={p.status === "expired" || p.remaining <= 1 ? "coral" : "ink"}
                />
              </div>
              <div className="mt-2">
                <ExpiryLine p={p} />
              </div>
              {p.includesUniform ? (
                <UniformLine p={p} online={online} onEdit={() => setUniform(p)} />
              ) : null}
              {can.money ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="light"
                    size="sm"
                    isDisabled={!online}
                    onPress={() => setAdjusting(p)}
                  >
                    Adjust
                  </Button>
                  <Button
                    variant="light"
                    size="sm"
                    isDisabled={!online}
                    onPress={() => setExpiry(p)}
                  >
                    {p.status === "expired" ? "Extend" : "Change expiry"}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.9375rem] text-ink/80">
          {can.money
            ? "Sell a package and credits come off automatically at check-in, earliest expiry first."
            : "Once the academy sells a package, credits come off automatically at check-in."}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {can.money ? (
          <Button
            variant="dark"
            size="sm"
            isDisabled={!online}
            icon={<Ticket aria-hidden className="size-4" />}
            onPress={onSell}
          >
            Sell package
          </Button>
        ) : null}
        <Button
          variant="light"
          size="sm"
          icon={<History aria-hidden className="size-4" />}
          onPress={onLedger}
        >
          Credit history
        </Button>
      </div>
      <AdjustCreditsSheet
        pkg={adjusting}
        clientId={detail.client.id}
        onClose={() => setAdjusting(null)}
      />
      <ExpirySheet pkg={expiry} clientId={detail.client.id} onClose={() => setExpiry(null)} />
      <UniformSheet pkg={uniform} clientId={detail.client.id} onClose={() => setUniform(null)} />
    </Bento>
  );
}

function AdjustCreditsSheet({
  pkg,
  clientId,
  onClose,
}: {
  pkg: PackageBalanceDto | null;
  clientId: string;
  onClose: () => void;
}) {
  const online = useOnline();
  const refresh = useRefreshClient();
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [count, setCount] = useState(1);
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState<PackageBalanceDto | null>(pkg);
  const adjust = useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; delta: number; note: string }) =>
      api.post<PackageBalanceDto>(`/client-packages/${v.id}/adjust`, {
        delta: v.delta,
        note: v.note,
      }),
    onSuccess: (p, v) => {
      refresh(clientId);
      notify({
        tone: "success",
        title: `${plural(Math.abs(v.delta), "credit")} ${v.delta > 0 ? "added" : "removed"}`,
        body: `${p.name} now has ${p.remaining} of ${p.creditsTotal} left.`,
      });
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another package opens.
  useEffect(() => {
    if (!pkg) return;
    setShown(pkg);
    setDirection("add");
    setCount(1);
    setReason("");
    adjust.reset();
  }, [pkg?.id]);
  const p = pkg ?? shown;
  const max = direction === "remove" ? Math.max(0, p?.remaining ?? 0) : 100;
  const n = Math.min(count, max);
  const after = p ? p.remaining + (direction === "add" ? n : -n) : 0;
  const errs = fieldErrors(adjust.error);
  const canSave = Boolean(p && n > 0 && reason.trim() && online);
  const submit = () =>
    p &&
    canSave &&
    adjust.mutate({ id: p.id, delta: direction === "add" ? n : -n, note: reason.trim() });
  return (
    <Sheet
      isOpen={pkg !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Adjust credits"
      description={p ? `${p.name} · ${p.remaining} of ${p.creditsTotal} left` : undefined}
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!canSave}
            isPending={adjust.isPending}
            onPress={submit}
          >
            {direction === "add" ? `Add ${plural(n, "credit")}` : `Remove ${plural(n, "credit")}`}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Segmented
          label="Change"
          value={direction}
          onChange={(v) => setDirection(v as "add" | "remove")}
          options={[
            { id: "add", label: "Add credits" },
            { id: "remove", label: "Remove credits" },
          ]}
        />
        <div className="flex flex-col gap-1.5">
          <span id="adjust-count-label" className="text-[0.8125rem] font-medium text-ink-2">
            Credits
          </span>
          <div className="flex items-center gap-3">
            <IconButton
              label="One fewer"
              variant="soft"
              isDisabled={n <= 1}
              onPress={() => setCount(Math.max(1, n - 1))}
            >
              <Minus aria-hidden className="size-5" />
            </IconButton>
            <output
              aria-labelledby="adjust-count-label"
              aria-live="polite"
              className="num w-12 text-center text-[2rem] leading-none font-light"
            >
              {n}
            </output>
            <IconButton
              label="One more"
              variant="soft"
              isDisabled={n >= max}
              onPress={() => setCount(Math.min(max, n + 1))}
            >
              <Plus aria-hidden className="size-5" />
            </IconButton>
            {p ? (
              <p className="num ml-auto text-[0.9375rem] text-ink-2">
                {p.remaining} → <span className="font-medium text-ink">{after}</span> left
              </p>
            ) : null}
          </div>
          {direction === "remove" && max === 0 ? (
            <p className="text-[0.8125rem] text-ink-2">There are no credits left to remove.</p>
          ) : null}
        </div>
        <TextField
          label="Reason"
          isRequired
          value={reason}
          onChange={setReason}
          placeholder={
            direction === "add"
              ? "Make-up for a rained-out session, goodwill…"
              : "Used outside the app, entered twice…"
          }
          description="Shows on the credit history, so every credit can be explained."
          error={errs.note}
        />
        {adjust.error && !errs.note ? (
          <InlineError>{errorMessage(adjust.error)}</InlineError>
        ) : null}
        <OfflineHint>You're offline. Reconnect to adjust credits.</OfflineHint>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function ExpirySheet({
  pkg,
  clientId,
  onClose,
}: {
  pkg: PackageBalanceDto | null;
  clientId: string;
  onClose: () => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const refresh = useRefreshClient();
  const [noExpiry, setNoExpiry] = useState(false);
  const [date, setDate] = useState("");
  const [shown, setShown] = useState<PackageBalanceDto | null>(pkg);
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; expiresOn: string | null }) =>
      api.patch<PackageBalanceDto>(`/client-packages/${v.id}`, { expiresOn: v.expiresOn }),
    onSuccess: (p) => {
      refresh(clientId);
      notify({
        tone: "success",
        title: p.expiresOn ? `Expires ${fmt.date(p.expiresOn)}` : "No expiry",
        body: `${p.name} · ${plural(p.remaining, "credit")} left.`,
      });
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed when another package opens.
  useEffect(() => {
    if (!pkg) return;
    setShown(pkg);
    setNoExpiry(!pkg.expiresOn);
    const base = pkg.expiresOn && pkg.expiresOn > fmt.today() ? pkg.expiresOn : fmt.today();
    setDate(pkg.status === "expired" ? addDays(base, 30) : (pkg.expiresOn ?? addDays(base, 30)));
    save.reset();
  }, [pkg?.id]);
  const p = pkg ?? shown;
  const expired = p?.status === "expired";
  const value = noExpiry ? null : date || null;
  const changed = p ? value !== p.expiresOn : false;
  const valid = noExpiry || Boolean(date);
  const errs = fieldErrors(save.error);
  const submit = () => p && valid && online && save.mutate({ id: p.id, expiresOn: value });
  const base = date || fmt.today();
  return (
    <Sheet
      isOpen={pkg !== null}
      onOpenChange={(o) => !o && onClose()}
      title={expired ? "Extend package" : "Change expiry"}
      description={
        p
          ? `${p.name} · ${p.expiresOn ? `${expired ? "expired" : "expires"} ${fmt.date(p.expiresOn)}` : "no expiry"}`
          : undefined
      }
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!valid || !changed || !online}
            isPending={save.isPending}
            onPress={submit}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="rounded-[22px] bg-panel px-4 py-2">
          <Switch isSelected={noExpiry} onChange={setNoExpiry}>
            No expiry
          </Switch>
        </div>
        {!noExpiry ? (
          <>
            <TextField
              label="Expires on"
              type="date"
              value={date}
              onChange={setDate}
              description={
                expired ? "A date in the future makes the unused credits usable again." : undefined
              }
              error={errs.expiresOn}
            />
            <div className="flex flex-wrap gap-2">
              {[7, 14, 30].map((d) => (
                <Button key={d} variant="light" size="sm" onPress={() => setDate(addDays(base, d))}>
                  +{d} days
                </Button>
              ))}
            </div>
          </>
        ) : null}
        {save.error && !errs.expiresOn ? (
          <InlineError>{errorMessage(save.error)}</InlineError>
        ) : null}
        <OfflineHint>You're offline. Reconnect to change the expiry.</OfflineHint>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/** The training uniform a package came with: its size and whether it was handed out. */
function UniformLine({
  p,
  online,
  onEdit,
}: {
  p: PackageBalanceDto;
  online: boolean;
  onEdit: () => void;
}) {
  const fmt = useFormat();
  const issued = p.uniformIssuedAt ?? null;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-[16px] bg-white/55 py-1.5 pr-1.5 pl-3">
      <Shirt aria-hidden className="size-4.5 shrink-0" />
      <p className="min-w-0 flex-1 text-[0.8125rem]">
        <span className="font-medium">Uniform</span>
        {p.uniformSize ? ` · size ${p.uniformSize}` : " · size not recorded"}
        <span className="block text-ink/75">
          {issued ? `Handed out ${fmt.date(fmt.dayOf(issued))}` : "To hand out"}
        </span>
      </p>
      <Button variant="light" size="sm" isDisabled={!online} onPress={onEdit}>
        {issued ? "Edit" : "Update"}
        <span className="sr-only"> uniform for {p.name}</span>
      </Button>
    </div>
  );
}

function UniformSheet({
  pkg,
  clientId,
  onClose,
}: {
  pkg: PackageBalanceDto | null;
  clientId: string;
  onClose: () => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const refresh = useRefreshClient();
  const qc = useQueryClient();
  const [size, setSize] = useState("");
  const [issued, setIssued] = useState(false);
  const [shown, setShown] = useState<PackageBalanceDto | null>(pkg);
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; uniformSize: string; issued: boolean }) =>
      api.patch<PackageBalanceDto>(`/client-packages/${v.id}/uniform`, {
        uniformSize: v.uniformSize,
        issued: v.issued,
      }),
    onSuccess: (p) => {
      refresh(clientId);
      void qc.invalidateQueries({ queryKey: keys.today });
      notify({
        tone: "success",
        title: p.uniformIssuedAt ? "Uniform handed out" : "Uniform saved",
        body: p.uniformSize ? `Size ${p.uniformSize} · ${p.name}` : p.name,
      });
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed when another package opens.
  useEffect(() => {
    if (!pkg) return;
    setShown(pkg);
    setSize(pkg.uniformSize ?? "");
    setIssued(Boolean(pkg.uniformIssuedAt));
    save.reset();
  }, [pkg?.id]);
  const p = pkg ?? shown;
  const errs = fieldErrors(save.error);
  const submit = () => p && online && save.mutate({ id: p.id, uniformSize: size.trim(), issued });
  return (
    <Sheet
      isOpen={pkg !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Training uniform"
      description={p ? `Comes with ${p.name}.` : undefined}
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="dark" isDisabled={!online} isPending={save.isPending} onPress={submit}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label="Size"
          value={size}
          onChange={setSize}
          placeholder="e.g. M, L, Youth 10"
          error={errs.uniformSize}
          className="sm:max-w-[16rem]"
        />
        <div className="rounded-[22px] bg-panel px-4 py-2">
          <Switch
            isSelected={issued}
            onChange={setIssued}
            description={
              p?.uniformIssuedAt && issued
                ? `Handed out ${fmt.date(fmt.dayOf(p.uniformIssuedAt))}.`
                : "Turn on once the player has it."
            }
          >
            Uniform handed out
          </Switch>
        </div>
        {save.error && !errs.uniformSize ? (
          <InlineError>{errorMessage(save.error)}</InlineError>
        ) : null}
        <OfflineHint>You're offline. Reconnect to update the uniform.</OfflineHint>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
