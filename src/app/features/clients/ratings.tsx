import type { ProgressDto, RatingDto } from "@shared/api-types";
import { RATING_SOURCES, type RatingSource } from "@shared/domain";
import { useMutation } from "@tanstack/react-query";
import { Ellipsis, Plus, TrendingUp } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Card } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { Segmented, TextField } from "../../components/ui/field";
import { ActionMenu, Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { type Format, useFormat } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { OfflineHint, SectionHead } from "./bits";
import { RATING_SOURCE_LABELS, shortDate } from "./client-utils";
import { useRefreshClient, useStoreProgress } from "./queries";

/** DUPR's full range. The axis never rescales, so a flat line means a flat rating. */
const AXIS_MIN = 2;
const AXIS_MAX = 8;
const HEIGHT = 224;
const PAD = { l: 40, r: 24, t: 18, b: 30 };

const SERIES: Record<RatingSource, { stroke: string; dash?: string; width: number }> = {
  dupr: { stroke: "var(--color-ink)", width: 2.5 },
  coach: { stroke: "var(--color-ink-2)", dash: "7 5", width: 2 },
  self: { stroke: "var(--color-ink-3)", dash: "2 5", width: 2 },
};

const dayNumber = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function RatingChart({ ratings }: { ratings: RatingDto[] }) {
  return <RatingChartView ratings={ratings} fmt={useFormat()} />;
}

/** The chart itself, formatted by the caller (the family portal formats with its academy's). */
export function RatingChartView({
  ratings,
  fmt,
}: {
  ratings: Pick<RatingDto, "id" | "source" | "value" | "recordedOn">[];
  fmt: Format;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const sorted = [...ratings].sort((a, b) => a.recordedOn.localeCompare(b.recordedOn));
  const first = sorted[0];
  const last = sorted.at(-1);
  const plotW = Math.max(0, width - PAD.l - PAD.r);
  const plotH = HEIGHT - PAD.t - PAD.b;
  const d0 = first ? dayNumber(first.recordedOn) : 0;
  const span = last ? dayNumber(last.recordedOn) - d0 : 0;
  const x = (ymd: string) => PAD.l + (span ? ((dayNumber(ymd) - d0) / span) * plotW : plotW / 2);
  const y = (v: number) =>
    PAD.t +
    ((AXIS_MAX - Math.min(AXIS_MAX, Math.max(AXIS_MIN, v))) / (AXIS_MAX - AXIS_MIN)) * plotH;
  const sources = RATING_SOURCES.filter((s) => sorted.some((r) => r.source === s));
  // Latest value per series, labelled above its point unless that would collide with another label.
  const labels: { source: RatingSource; x: number; y: number; text: string }[] = [];
  for (const source of sources) {
    const end = sorted.filter((r) => r.source === source).at(-1);
    if (!end) continue;
    const px = x(end.recordedOn);
    const py = y(end.value);
    const above = py - 12;
    const clash = labels.some((l) => Math.abs(l.x - px) < 44 && Math.abs(l.y - above) < 18);
    labels.push({ source, x: px, y: clash ? py + 22 : above, text: end.value.toFixed(2) });
  }
  const dupr = sorted.filter((r) => r.source === "dupr");
  const summary =
    dupr.length > 1
      ? `DUPR rating from ${dupr[0]?.value.toFixed(2)} on ${fmt.date(dupr[0]?.recordedOn ?? "")} to ${dupr.at(-1)?.value.toFixed(2)} on ${fmt.date(dupr.at(-1)?.recordedOn ?? "")}, on a fixed 2.0 to 8.0 scale.`
      : `${sorted.length} rating${sorted.length === 1 ? "" : "s"} on a fixed 2.0 to 8.0 scale.`;

  return (
    <div className="flex flex-col gap-3">
      <div ref={ref} className="w-full">
        {width > 0 ? (
          <svg
            role="img"
            aria-label={summary}
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            className="block overflow-visible"
          >
            {Array.from({ length: AXIS_MAX - AXIS_MIN + 1 }, (_, i) => AXIS_MIN + i).map((v) => (
              <g key={v}>
                <line
                  x1={PAD.l}
                  x2={width - PAD.r}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="var(--color-line)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.l - 10}
                  y={y(v)}
                  dy="0.35em"
                  textAnchor="end"
                  className="num fill-ink-2 text-[11px]"
                >
                  {v.toFixed(1)}
                </text>
              </g>
            ))}
            {first && last ? (
              <>
                <text
                  x={span ? PAD.l : x(first.recordedOn)}
                  y={HEIGHT - 8}
                  textAnchor={span ? "start" : "middle"}
                  className="num fill-ink-2 text-[11px]"
                >
                  {shortDate(first.recordedOn, fmt)}
                </text>
                {span ? (
                  <text
                    x={width - PAD.r}
                    y={HEIGHT - 8}
                    textAnchor="end"
                    className="num fill-ink-2 text-[11px]"
                  >
                    {shortDate(last.recordedOn, fmt)}
                  </text>
                ) : null}
              </>
            ) : null}
            {sources.map((source) => {
              const points = sorted.filter((r) => r.source === source);
              const style = SERIES[source];
              const path = points
                .map((r, i) => `${i ? "L" : "M"}${x(r.recordedOn)} ${y(r.value)}`)
                .join(" ");
              return (
                <g key={source}>
                  {points.length > 1 ? (
                    <path
                      d={path}
                      fill="none"
                      stroke={style.stroke}
                      strokeWidth={style.width}
                      strokeDasharray={style.dash}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {points.map((r) => (
                    <circle
                      key={r.id}
                      cx={x(r.recordedOn)}
                      cy={y(r.value)}
                      r={source === "dupr" ? 4.5 : 4}
                      fill={source === "dupr" ? "var(--color-ink)" : "var(--color-card)"}
                      stroke={style.stroke}
                      strokeWidth={2}
                    />
                  ))}
                </g>
              );
            })}
            {labels.map((l) => (
              <text
                key={l.source}
                x={l.x}
                y={l.y}
                textAnchor={l.x > width - PAD.r - 20 ? "end" : "middle"}
                className={`num text-[13px] font-semibold ${l.source === "dupr" ? "fill-ink" : "fill-ink-2"}`}
              >
                {l.text}
              </text>
            ))}
          </svg>
        ) : (
          <div style={{ height: HEIGHT }} />
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-ink-2">
        {sources.map((s) => (
          <li key={s} className="inline-flex items-center gap-2">
            <svg aria-hidden width="22" height="8" className="overflow-visible">
              <line
                x1="0"
                x2="22"
                y1="4"
                y2="4"
                stroke={SERIES[s].stroke}
                strokeWidth={SERIES[s].width}
                strokeDasharray={SERIES[s].dash}
              />
            </svg>
            {RATING_SOURCE_LABELS[s]}
          </li>
        ))}
        <li>Fixed scale 2.0–8.0</li>
      </ul>
    </div>
  );
}

function useRatingWrites(clientId: string) {
  const storeProgress = useStoreProgress();
  const refresh = useRefreshClient();
  const done = (p: ProgressDto) => {
    storeProgress(clientId, p);
    refresh(clientId, { skip: "progress" });
  };
  const add = useMutation({
    meta: { silent: true },
    mutationFn: (v: { source: RatingSource; value: number; recordedOn: string }) =>
      api.post<ProgressDto>(`/clients/${clientId}/ratings`, v),
    onSuccess: done,
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (id: string) => api.del<ProgressDto>(`/ratings/${id}`),
    onSuccess: done,
  });
  return { add, remove };
}

export function RatingsCard({
  clientId,
  firstName,
  ratings,
}: {
  clientId: string;
  firstName: string;
  ratings: RatingDto[];
}) {
  const fmt = useFormat();
  const online = useOnline();
  const [adding, setAdding] = useState(false);
  const { remove } = useRatingWrites(clientId);
  const recent = [...ratings].sort((a, b) => b.recordedOn.localeCompare(a.recordedOn));
  return (
    <Card label="Ratings">
      <SectionHead
        title="Ratings"
        count={ratings.length || undefined}
        action={
          <Button
            variant="light"
            size="sm"
            isDisabled={!online}
            icon={<Plus aria-hidden className="size-4" />}
            onPress={() => setAdding(true)}
          >
            Add rating
          </Button>
        }
      />
      <div className="px-5 pb-4">
        {ratings.length ? (
          <>
            <RatingChart ratings={ratings} />
            <ul className="mt-4 flex flex-col divide-y divide-line border-t border-line">
              {recent.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-1.5">
                  <span className="num w-[6.5rem] shrink-0 text-[0.875rem] text-ink-2">
                    {fmt.date(r.recordedOn)}
                  </span>
                  <span className="flex-1 text-[0.9375rem]">{RATING_SOURCE_LABELS[r.source]}</span>
                  <span className="num text-[1rem] font-medium">{r.value.toFixed(2)}</span>
                  <ActionMenu
                    label={`Actions for the ${fmt.date(r.recordedOn)} rating`}
                    trigger={
                      <IconButton
                        label={`Actions for the ${fmt.date(r.recordedOn)} rating`}
                        isDisabled={!online}
                      >
                        <Ellipsis aria-hidden className="size-5" />
                      </IconButton>
                    }
                    actions={[
                      {
                        id: "delete",
                        label: "Delete rating",
                        tone: "danger",
                        onAction: () =>
                          remove.mutate(r.id, {
                            onSuccess: () => notify({ tone: "neutral", title: "Rating deleted" }),
                            onError: (err) =>
                              notify({
                                tone: "danger",
                                title: "Couldn't delete the rating",
                                body: errorMessage(err),
                              }),
                          }),
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex items-start gap-3 pb-1 text-ink-2">
            <TrendingUp aria-hidden className="mt-0.5 size-4.5 shrink-0" />
            <p>
              No ratings yet. Log {firstName}'s DUPR updates, or your own rating, to see the trend
              on a fixed 2.0–8.0 scale.
            </p>
          </div>
        )}
      </div>
      <RatingSheet isOpen={adding} onOpenChange={setAdding} clientId={clientId} />
    </Card>
  );
}

function RatingSheet({
  isOpen,
  onOpenChange,
  clientId,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const { add } = useRatingWrites(clientId);
  const [source, setSource] = useState<RatingSource>("dupr");
  const [value, setValue] = useState("");
  const [recordedOn, setRecordedOn] = useState(fmt.today());
  // biome-ignore lint/correctness/useExhaustiveDependencies: start fresh each time it opens.
  useEffect(() => {
    if (!isOpen) return;
    setSource("dupr");
    setValue("");
    setRecordedOn(fmt.today());
    add.reset();
  }, [isOpen]);
  const n = Number(value.trim().replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(n) && n >= 1 && n <= 8;
  const errs = fieldErrors(add.error);
  const submit = () => {
    if (!valid || !online) return;
    add.mutate(
      { source, value: Math.round(n * 1000) / 1000, recordedOn },
      {
        onSuccess: () => {
          notify({
            tone: "success",
            title: `${RATING_SOURCE_LABELS[source]} rating added`,
            body: n.toFixed(2),
          });
          onOpenChange(false);
        },
      },
    );
  };
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Add a rating"
      description="DUPR ratings also update the rating on their profile."
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!valid || !online}
            isPending={add.isPending}
            onPress={submit}
          >
            Add rating
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
          label="Source"
          value={source}
          onChange={(v) => setSource(v as RatingSource)}
          options={RATING_SOURCES.map((s) => ({ id: s, label: RATING_SOURCE_LABELS[s] }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Rating"
            inputMode="decimal"
            autoFocus
            placeholder="e.g. 3.62"
            value={value}
            onChange={setValue}
            error={value.trim() && !valid ? "Use a rating from 1.0 to 8.0." : errs.value}
          />
          <TextField
            label="Date"
            type="date"
            max={fmt.today()}
            value={recordedOn}
            onChange={setRecordedOn}
            error={errs.recordedOn}
          />
        </div>
        {add.error && !Object.keys(errs).length ? (
          <InlineError>{errorMessage(add.error)}</InlineError>
        ) : null}
        <OfflineHint>You're offline. Reconnect to add a rating.</OfflineHint>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
