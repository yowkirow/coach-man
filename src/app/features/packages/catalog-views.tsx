import type { PackageTemplateDto, RateDto } from "@shared/api-types";
import type { RateKind } from "@shared/domain";
import type { UseQueryResult } from "@tanstack/react-query";
import { Globe, Pencil, Plus, ReceiptText, Shirt, Star, Ticket } from "lucide-react";
import { Button, IconButton } from "../../components/ui/button";
import { Card, CardHeader, Pill } from "../../components/ui/display";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/feedback";
import { Switch } from "../../components/ui/field";
import { errorMessage } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { useGroups } from "../../lib/hooks";
import { useOnline } from "../../lib/offline";
import {
  durationText,
  orderedKinds,
  perCredit,
  RATE_KIND_DOTS,
  RATE_KIND_LABELS,
  rateCounterpart,
  rateKindsInOrder,
  SESSION_TYPE_LABELS,
  SESSION_TYPE_TONES,
  templateValidityText,
} from "./catalog";

export function PackageCard({
  template: t,
  programName,
  onEdit,
  onSell,
  onToggle,
}: {
  template: PackageTemplateDto;
  /** The program the tier belongs to, when it has one. */
  programName?: string | null;
  onEdit: () => void;
  onSell: () => void;
  onToggle: (active: boolean) => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const kinds = orderedKinds(t.lessonKinds);
  const headingId = `package-${t.id}`;
  const sessions = t.sessionsLabel ? `${t.sessionsLabel} · ` : "";
  return (
    <article
      aria-labelledby={headingId}
      className={`flex flex-col rounded-[28px] p-5 ${t.active ? "bg-card" : "bg-card/55"}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3
            id={headingId}
            className="text-[1.25rem] leading-tight font-medium tracking-[-0.01em] break-words"
          >
            {t.name}
          </h3>
          <p className="num mt-1 text-[0.875rem] text-ink-2">
            {sessions}
            {plural(t.credits, "credit")} · {templateValidityText(t)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <IconButton label={`Edit ${t.name}`} variant="soft" isDisabled={!online} onPress={onEdit}>
            <Pencil aria-hidden className="size-4.5" />
          </IconButton>
          {t.active ? (
            <IconButton
              label={`Sell ${t.name}`}
              variant="lime"
              isDisabled={!online}
              onPress={onSell}
            >
              <Ticket aria-hidden className="size-5" />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <p className="num text-[2.25rem] leading-none font-light tracking-[-0.02em]">
          {fmt.moneyShort(t.priceMinor)}
        </p>
        <p className="num text-[0.875rem] text-ink-2">{fmt.moneyShort(perCredit(t))} per credit</p>
      </div>

      {t.description ? (
        <p className="mt-3 line-clamp-2 text-[0.875rem] text-ink-2">{t.description}</p>
      ) : null}

      <ul aria-label="Covers and status" className="mt-4 flex flex-wrap gap-1.5">
        {t.isPublic ? (
          <li>
            <Pill tone="mint">
              <Globe aria-hidden className="size-3" />
              Public
            </Pill>
          </li>
        ) : null}
        {t.highlight ? (
          <li>
            <Pill tone="amber">
              <Star aria-hidden className="size-3" />
              Featured
            </Pill>
          </li>
        ) : null}
        {programName ? (
          <li>
            <Pill tone="outline">{programName}</Pill>
          </li>
        ) : null}
        {t.includesUniform ? (
          <li>
            <Pill tone="outline">
              <Shirt aria-hidden className="size-3" />
              Uniform
            </Pill>
          </li>
        ) : null}
        {kinds.length ? (
          kinds.map((k) => (
            <li key={k}>
              <Pill tone={SESSION_TYPE_TONES[k]}>{SESSION_TYPE_LABELS[k]}</Pill>
            </li>
          ))
        ) : (
          <li>
            <Pill tone="outline">Any session</Pill>
          </li>
        )}
      </ul>

      <div className="mt-auto pt-4">
        {/* Top-aligned so the sold count lines up with the switch's label. */}
        <div className="flex items-start justify-between gap-3 border-t border-line pt-2">
          <span className="num pt-2 text-[0.875rem] text-ink-2">
            {t.soldCount ? `Sold ${plural(t.soldCount, "time")}` : "Not sold yet"}
          </span>
          <Switch isSelected={t.active} isDisabled={!online} onChange={onToggle}>
            <span className="text-[0.875rem]">For sale</span>
          </Switch>
        </div>
      </div>
    </article>
  );
}

function CardsSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-4 md:grid-cols-2">
      <span className="sr-only">Loading…</span>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-[28px] bg-card p-5">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/3" />
          <Skeleton className="mt-6 h-10 w-1/2" />
          <Skeleton className="mt-5 h-6 w-2/5" />
        </div>
      ))}
    </div>
  );
}

export function PackageGrid({
  query,
  onNew,
  onEdit,
  onSell,
  onToggle,
}: {
  query: UseQueryResult<PackageTemplateDto[]>;
  onNew: () => void;
  onEdit: (t: PackageTemplateDto) => void;
  onSell: (t: PackageTemplateDto) => void;
  onToggle: (t: PackageTemplateDto, active: boolean) => void;
}) {
  const online = useOnline();
  const groups = useGroups();
  if (query.isPending) return <CardsSkeleton />;
  if (!query.data) {
    return (
      <Card className="px-6 py-2">
        <ErrorState
          title="Couldn't load packages"
          message={errorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }
  const programNames = new Map((groups.data ?? []).map((g) => [g.id, g.name]));
  const onSale = query.data.filter((t) => t.active);
  const off = query.data.filter((t) => !t.active);
  if (query.data.length === 0) {
    return (
      <Card className="px-6 py-4">
        <EmptyState
          icon={<Ticket aria-hidden className="size-5" />}
          title="No packages yet"
          body="Bundle sessions into credits clients buy up front, like 10 group classes for 90 days. Check-ins use the credits automatically."
          action={
            <Button
              variant="dark"
              icon={<Plus aria-hidden className="size-4.5" />}
              isDisabled={!online}
              onPress={onNew}
            >
              New package
            </Button>
          }
        />
      </Card>
    );
  }
  const card = (t: PackageTemplateDto) => (
    <PackageCard
      key={t.id}
      template={t}
      programName={t.programId ? programNames.get(t.programId) : null}
      onEdit={() => onEdit(t)}
      onSell={() => onSell(t)}
      onToggle={(active) => onToggle(t, active)}
    />
  );
  return (
    <div className="flex flex-col gap-6">
      {onSale.length ? (
        <section aria-labelledby="packages-on" className="flex flex-col">
          <h2 id="packages-on" className="sr-only">
            For sale
          </h2>
          <div className="grid gap-4 md:grid-cols-2">{onSale.map(card)}</div>
        </section>
      ) : (
        <p className="rounded-[22px] bg-panel px-4 py-3 text-[0.875rem] text-ink-2">
          Nothing is for sale right now. Turn a package back on below, or create a new one.
        </p>
      )}
      {off.length ? (
        <section aria-labelledby="packages-off" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
            <h2 id="packages-off" className="text-[1.125rem] font-medium">
              Not for sale
            </h2>
            <p className="text-[0.8125rem] text-ink-2">
              Hidden when you sell. Clients keep the credits they bought.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">{off.map(card)}</div>
        </section>
      ) : null}
    </div>
  );
}

function RateRow({
  rate: r,
  onEdit,
  onToggle,
}: {
  rate: RateDto;
  onEdit: () => void;
  onToggle: (active: boolean) => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const counterpart = rateCounterpart(r, fmt);
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`font-medium break-words ${r.active ? "" : "text-ink-2"}`}>
            {r.name}
          </span>
          {r.active ? null : <Pill tone="panel">Off</Pill>}
        </p>
        <p className="num mt-0.5 text-[0.8125rem] text-ink-2">
          {durationText(r.durationMinutes)}
          {counterpart ? ` · ${counterpart}` : ""}
        </p>
      </div>
      <p className="num shrink-0 text-right">
        <span className={`block text-[1.125rem] ${r.active ? "" : "text-ink-2"}`}>
          {fmt.moneyShort(r.priceMinor)}
        </span>
        <span className="block text-[0.75rem] text-ink-2">
          {r.unit === "hour" ? "per hour" : "per session"}
        </span>
      </p>
      <div className="hidden sm:block">
        <Switch isSelected={r.active} isDisabled={!online} onChange={onToggle}>
          <span className="sr-only">{r.name} on the rate card</span>
        </Switch>
      </div>
      <IconButton label={`Edit ${r.name}`} isDisabled={!online} onPress={onEdit}>
        <Pencil aria-hidden className="size-4.5" />
      </IconButton>
    </li>
  );
}

export function RateGroups({
  query,
  onNew,
  onEdit,
  onToggle,
}: {
  query: UseQueryResult<RateDto[]>;
  onNew: (kind?: RateKind) => void;
  onEdit: (r: RateDto) => void;
  onToggle: (r: RateDto, active: boolean) => void;
}) {
  const online = useOnline();
  if (query.isPending) return <CardsSkeleton />;
  if (!query.data) {
    return (
      <Card className="px-6 py-2">
        <ErrorState
          title="Couldn't load your rate card"
          message={errorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }
  if (query.data.length === 0) {
    return (
      <Card className="px-6 py-4">
        <EmptyState
          icon={<ReceiptText aria-hidden className="size-5" />}
          title="No rates yet"
          body="Rates price the sessions clients pay for one at a time, like a private lesson or a drop-in clinic. Package credits cover the rest."
          action={
            <Button
              variant="dark"
              icon={<Plus aria-hidden className="size-4.5" />}
              isDisabled={!online}
              onPress={() => onNew()}
            >
              New rate
            </Button>
          }
        />
      </Card>
    );
  }
  const rates = query.data;
  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      {rateKindsInOrder(rates).map((kind) => {
        const list = rates
          .filter((r) => r.kind === kind)
          .sort((a, b) => Number(b.active) - Number(a.active) || a.priceMinor - b.priceMinor);
        return (
          <Card key={kind} label={RATE_KIND_LABELS[kind]}>
            <CardHeader
              className="pb-1"
              title={
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className={`size-3 shrink-0 rounded-full ${RATE_KIND_DOTS[kind]}`}
                  />
                  {RATE_KIND_LABELS[kind]}
                </span>
              }
              action={
                <IconButton
                  label={`New ${RATE_KIND_LABELS[kind].toLowerCase()} rate`}
                  variant="soft"
                  isDisabled={!online}
                  onPress={() => onNew(kind)}
                >
                  <Plus aria-hidden className="size-4.5" />
                </IconButton>
              }
            />
            <ul className="flex flex-col divide-y divide-line px-5 pb-2">
              {list.map((r) => (
                <RateRow
                  key={r.id}
                  rate={r}
                  onEdit={() => onEdit(r)}
                  onToggle={(active) => onToggle(r, active)}
                />
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
