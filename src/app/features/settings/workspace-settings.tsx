import type { MeDto, WorkspaceSettingsDto } from "@shared/api-types";
import { COMMON_CURRENCIES } from "@shared/money";
import { type WorkspaceUpdateInput, workspaceUpdateSchema } from "@shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { InlineError } from "../../components/ui/feedback";
import { Segmented, SelectField, Switch, TextField } from "../../components/ui/field";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { makeFormat } from "../../lib/format";
import { useMe } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "./offline";
import { SaveBar, SettingsSection } from "./sections";
import { changedFields, issuesToFields, wholeNumber } from "./validation";

/** PATCH /workspace, keeping the cached /me in step. */
export function useSaveWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: true },
    mutationFn: (patch: WorkspaceUpdateInput) =>
      api.patch<WorkspaceSettingsDto>("/workspace", patch),
    onSuccess: (settings, patch) => {
      qc.setQueryData<MeDto>(keys.me, (old) =>
        old
          ? {
              ...old,
              settings,
              workspace: patch.name ? { ...old.workspace, name: patch.name } : old.workspace,
            }
          : old,
      );
      // Currency, time zone, locale, and week start change how every screen reads.
      const everywhere =
        patch.currency !== undefined ||
        patch.timezone !== undefined ||
        patch.locale !== undefined ||
        patch.weekStartsOn !== undefined;
      void qc.invalidateQueries(everywhere ? undefined : { queryKey: keys.me });
    },
  });
}

const EXTRA_CURRENCIES = ["EUR", "GBP", "AED", "ZAR", "BRL", "CHF", "SEK", "NOK", "DKK", "CNY"];

const LOCALES = [
  "en-US",
  "en-GB",
  "en-AU",
  "en-CA",
  "en-NZ",
  "en-PH",
  "en-SG",
  "en-IN",
  "fil-PH",
  "es-ES",
  "es-MX",
  "fr-FR",
  "fr-CA",
  "de-DE",
  "it-IT",
  "nl-NL",
  "pt-BR",
  "pt-PT",
  "sv-SE",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
  "id-ID",
  "ms-MY",
  "th-TH",
  "vi-VN",
];

const WEEK_STARTS = [
  { id: "1", label: "Monday" },
  { id: "0", label: "Sunday" },
  { id: "6", label: "Saturday" },
];

const LENGTHS = [30, 45, 60, 75, 90, 120];

function withCurrent<T>(list: readonly T[], current: T): T[] {
  return list.includes(current) ? [...list] : [current, ...list];
}

function displayName(type: "currency" | "language", code: string): string | undefined {
  try {
    return new Intl.DisplayNames(["en"], { type }).of(code);
  } catch {
    return undefined;
  }
}

interface WorkspaceDraft {
  name: string;
  currency: string;
  timezone: string;
  locale: string;
  weekStartsOn: number;
  defaultSessionMinutes: number;
}

function draftOf(me: MeDto): WorkspaceDraft {
  return {
    name: me.workspace.name,
    currency: me.settings.currency,
    timezone: me.settings.timezone,
    locale: me.settings.locale,
    weekStartsOn: me.settings.weekStartsOn,
    defaultSessionMinutes: me.settings.defaultSessionMinutes,
  };
}

/** Seeds a form from server values and re-seeds only when those values really change. */
function useDraft<T>(source: T | null) {
  const key = JSON.stringify(source);
  const [draft, setDraft] = useState<T | null>(source);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed when the saved values change.
  useEffect(() => setDraft(source), [key]);
  const dirty = draft !== null && JSON.stringify(draft) !== key;
  return { draft, setDraft, dirty, reset: () => setDraft(source) };
}

export function WorkspaceSection() {
  const me = useMe().data;
  const online = useOnline();
  const save = useSaveWorkspace();
  const { draft, setDraft, dirty, reset } = useDraft(me ? draftOf(me) : null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const currencyOptions = useMemo(() => {
    const list = [...new Set([...COMMON_CURRENCIES, ...EXTRA_CURRENCIES])].sort();
    return withCurrent(list, draft?.currency ?? "USD").map((c) => ({
      id: c,
      label: `${c} · ${displayName("currency", c) ?? c}`,
    }));
  }, [draft?.currency]);
  const zoneOptions = useMemo(() => {
    const zones = Intl.supportedValuesOf("timeZone");
    return withCurrent(zones, draft?.timezone ?? "UTC").map((z) => ({
      id: z,
      label: z.replaceAll("_", " "),
    }));
  }, [draft?.timezone]);
  const localeOptions = useMemo(
    () =>
      withCurrent(LOCALES, draft?.locale ?? "en-US").map((l) => ({
        id: l,
        label: displayName("language", l) ?? l,
      })),
    [draft?.locale],
  );
  const weekOptions = useMemo(() => {
    const current = String(draft?.weekStartsOn ?? 1);
    if (WEEK_STARTS.some((w) => w.id === current)) return WEEK_STARTS;
    const day = new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(
      Date.UTC(2023, 0, 1 + Number(current)),
    );
    return [...WEEK_STARTS, { id: current, label: day }];
  }, [draft?.weekStartsOn]);

  const preview = useMemo(() => {
    if (!draft) return null;
    try {
      const f = makeFormat(draft);
      return `${f.money(123450)} · ${f.longDay(f.today())} · ${f.time(Date.now())}`;
    } catch {
      return null;
    }
  }, [draft]);

  if (!me || !draft) return null;
  const set = <K extends keyof WorkspaceDraft>(k: K, v: WorkspaceDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const submit = () => {
    const patch = changedFields(draft, draftOf(me));
    const parsed = workspaceUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      setErrors(issuesToFields(parsed.error.issues, { name: "Give your workspace a name." }));
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess: () => notify({ tone: "success", title: "Workspace saved" }),
    });
  };
  const server = fieldErrors(save.error);
  const err = (k: string) => errors[k] ?? server[k];
  const currencyChanged = draft.currency !== me.settings.currency;

  return (
    <SettingsSection
      id="workspace"
      title="Workspace"
      description="How prices, dates, and your week read across CoachMan."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (online && dirty) submit();
        }}
      >
        <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
          <TextField
            label="Workspace name"
            value={draft.name}
            onChange={(v) => set("name", v)}
            error={err("name")}
            className="sm:col-span-2"
          />
          <SelectField
            label="Currency"
            options={currencyOptions}
            value={draft.currency}
            onChange={(v) => set("currency", v)}
            error={err("currency")}
            description={
              currencyChanged
                ? "Amounts you've recorded aren't converted. Only change this if it was set wrong."
                : undefined
            }
          />
          <SelectField
            label="Time zone"
            options={zoneOptions}
            value={draft.timezone}
            onChange={(v) => set("timezone", v)}
            error={err("timezone")}
          />
          <SelectField
            label="Number and date format"
            options={localeOptions}
            value={draft.locale}
            onChange={(v) => set("locale", v)}
            error={err("locale")}
          />
          <SelectField
            label="Default session length"
            options={withCurrent(LENGTHS, draft.defaultSessionMinutes).map((m) => ({
              id: String(m),
              label: `${m} min`,
            }))}
            value={String(draft.defaultSessionMinutes)}
            onChange={(v) => set("defaultSessionMinutes", Number(v))}
            description="Used when you schedule a new session."
            error={err("defaultSessionMinutes")}
          />
          <Segmented
            label="Week starts on"
            options={weekOptions}
            value={String(draft.weekStartsOn)}
            onChange={(v) => set("weekStartsOn", Number(v))}
            className="sm:col-span-2"
          />
        </div>
        {preview ? (
          <p className="num mt-5 rounded-2xl bg-panel px-4 py-3 text-[0.875rem] text-ink-2">
            Looks like <span className="font-medium text-ink">{preview}</span>
          </p>
        ) : null}
        {save.error ? (
          <div className="mt-4">
            <InlineError>{errorMessage(save.error)}</InlineError>
          </div>
        ) : null}
        {dirty ? (
          <div className="mt-4">
            <OfflineNote />
          </div>
        ) : null}
        <SaveBar
          dirty={dirty}
          onDiscard={() => {
            reset();
            setErrors({});
            save.reset();
          }}
          isPending={save.isPending}
          disabled={!online}
        />
      </form>
    </SettingsSection>
  );
}

interface PolicyDraft {
  noShowUsesCredit: boolean;
  lateCancelUsesCredit: boolean;
  lateCancelHours: string;
}

export function PoliciesSection() {
  const me = useMe().data;
  const online = useOnline();
  const save = useSaveWorkspace();
  const { draft, setDraft, dirty, reset } = useDraft<PolicyDraft>(
    me
      ? {
          noShowUsesCredit: me.settings.noShowUsesCredit,
          lateCancelUsesCredit: me.settings.lateCancelUsesCredit,
          lateCancelHours: String(me.settings.lateCancelHours),
        }
      : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!me || !draft) return null;
  const set = <K extends keyof PolicyDraft>(k: K, v: PolicyDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const submit = () => {
    const next = {
      noShowUsesCredit: draft.noShowUsesCredit,
      lateCancelUsesCredit: draft.lateCancelUsesCredit,
      lateCancelHours: wholeNumber(draft.lateCancelHours) ?? Number.NaN,
    };
    const parsed = workspaceUpdateSchema.safeParse(
      changedFields(next, {
        noShowUsesCredit: me.settings.noShowUsesCredit,
        lateCancelUsesCredit: me.settings.lateCancelUsesCredit,
        lateCancelHours: me.settings.lateCancelHours,
      }),
    );
    if (!parsed.success) {
      setErrors(
        issuesToFields(parsed.error.issues, {
          lateCancelHours: "Use a whole number of hours from 0 to 168.",
        }),
      );
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess: () => notify({ tone: "success", title: "Policies saved" }),
    });
  };
  const err = (k: string) => errors[k] ?? fieldErrors(save.error)[k];

  return (
    <SettingsSection
      id="policies"
      title="Policies"
      description="What a missed session costs. Changes apply to attendance you mark from now on."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (online && dirty) submit();
        }}
      >
        <div className="flex flex-col divide-y divide-line">
          <div className="pb-3">
            <Switch
              isSelected={draft.noShowUsesCredit}
              onChange={(v) => set("noShowUsesCredit", v)}
              description="Marking someone a no-show uses a credit, or charges the session price when they pay per session."
            >
              No-shows use a credit
            </Switch>
          </div>
          <div className="py-3">
            <Switch
              isSelected={draft.lateCancelUsesCredit}
              onChange={(v) => set("lateCancelUsesCredit", v)}
              description="Marking someone a late cancel costs them the same way."
            >
              Late cancels use a credit
            </Switch>
          </div>
          <div className="pt-4">
            <TextField
              label="Late-cancel window (hours)"
              type="number"
              inputMode="numeric"
              min="0"
              max="168"
              value={draft.lateCancelHours}
              onChange={(v) => set("lateCancelHours", v)}
              description="Cancelling less than this long before the start counts as late. You mark late cancels on the roster."
              error={err("lateCancelHours")}
              className="max-w-xs"
            />
          </div>
        </div>
        {save.error ? (
          <div className="mt-4">
            <InlineError>{errorMessage(save.error)}</InlineError>
          </div>
        ) : null}
        {dirty ? (
          <div className="mt-4">
            <OfflineNote />
          </div>
        ) : null}
        <SaveBar
          dirty={dirty}
          onDiscard={() => {
            reset();
            setErrors({});
            save.reset();
          }}
          isPending={save.isPending}
          disabled={!online}
        />
      </form>
    </SettingsSection>
  );
}
