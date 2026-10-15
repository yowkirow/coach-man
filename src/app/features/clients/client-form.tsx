import type { ClientDto } from "@shared/api-types";
import type { ClientStatus } from "@shared/domain";
import { DATE_RE } from "@shared/time";
import { Check, ChevronDown, HeartPulse, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
  CheckboxGroup,
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Button as RACButton,
  Checkbox as RACCheckbox,
  TextField as RACTextField,
  Tag,
  TagGroup,
  TagList,
  Text,
} from "react-aria-components";
import {
  fieldClass,
  popoverClass,
  Segmented,
  SelectField,
  Switch,
  TextAreaField,
  TextField,
} from "../../components/ui/field";
import { useFormat } from "../../lib/format";
import { useClients, useGroups } from "../../lib/hooks";
import { LEVEL_SUGGESTIONS, STATUS_LABELS } from "./client-utils";

type Hand = "right" | "left" | "ambidextrous";

export interface ClientFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: ClientStatus;
  level: string;
  isJunior: boolean;
  birthDate: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  duprId: string;
  duprRating: string;
  dominantHand: Hand | "";
  paddle: string;
  goals: string;
  medicalNotes: string;
  emergencyName: string;
  emergencyPhone: string;
  tags: string[];
  groupIds: string[];
  source: string;
  notes: string;
}

/** The JSON body POST /clients and PATCH /clients/:id accept. */
export interface ClientPayload {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: ClientStatus;
  level: string | null;
  isJunior: boolean;
  birthDate: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  duprId: string | null;
  duprRating: number | null;
  dominantHand: Hand | null;
  paddle: string | null;
  goals: string | null;
  medicalNotes: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  tags: string[];
  groupIds: string[];
  source: string | null;
  notes: string | null;
}

export type ClientErrors = Partial<Record<keyof ClientFormValues, string>>;

export function emptyClientValues(): ClientFormValues {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    status: "active",
    level: "",
    isJunior: false,
    birthDate: "",
    guardianName: "",
    guardianPhone: "",
    guardianEmail: "",
    duprId: "",
    duprRating: "",
    dominantHand: "",
    paddle: "",
    goals: "",
    medicalNotes: "",
    emergencyName: "",
    emergencyPhone: "",
    tags: [],
    groupIds: [],
    source: "",
    notes: "",
  };
}

export function clientToValues(c: ClientDto): ClientFormValues {
  const s = (v: string | null) => v ?? "";
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    email: s(c.email),
    phone: s(c.phone),
    status: c.status,
    level: s(c.level),
    isJunior: c.isJunior,
    birthDate: s(c.birthDate),
    guardianName: s(c.guardianName),
    guardianPhone: s(c.guardianPhone),
    guardianEmail: s(c.guardianEmail),
    duprId: s(c.duprId),
    duprRating: c.duprRating === null ? "" : String(c.duprRating),
    dominantHand: (c.dominantHand as Hand | null) ?? "",
    paddle: s(c.paddle),
    goals: s(c.goals),
    medicalNotes: s(c.medicalNotes),
    emergencyName: s(c.emergencyName),
    emergencyPhone: s(c.emergencyPhone),
    tags: [...c.tags],
    groupIds: [...c.groupIds],
    source: s(c.source),
    notes: s(c.notes),
  };
}

const text = (v: string) => v.trim() || null;
const parseRating = (v: string) => Number(v.trim().replace(",", "."));

export function toPayload(v: ClientFormValues): ClientPayload {
  return {
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    email: text(v.email)?.toLowerCase() ?? null,
    phone: text(v.phone),
    status: v.status,
    level: text(v.level),
    isJunior: v.isJunior,
    birthDate: v.birthDate || null,
    guardianName: text(v.guardianName),
    guardianPhone: text(v.guardianPhone),
    guardianEmail: text(v.guardianEmail)?.toLowerCase() ?? null,
    duprId: text(v.duprId),
    duprRating: v.duprRating.trim() ? Math.round(parseRating(v.duprRating) * 1000) / 1000 : null,
    dominantHand: v.dominantHand || null,
    paddle: text(v.paddle),
    goals: text(v.goals),
    medicalNotes: text(v.medicalNotes),
    emergencyName: text(v.emergencyName),
    emergencyPhone: text(v.emergencyPhone),
    tags: v.tags,
    groupIds: v.groupIds,
    source: text(v.source),
    notes: text(v.notes),
  };
}

const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
    : a === b;

/** Only the fields that changed, so an edit never overwrites what it didn't touch. */
export function changedFields(before: ClientPayload, after: ClientPayload): Partial<ClientPayload> {
  const out: Partial<ClientPayload> = {};
  for (const key of Object.keys(after) as (keyof ClientPayload)[]) {
    if (!sameValue(before[key], after[key])) Object.assign(out, { [key]: after[key] });
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateClient(v: ClientFormValues, today: string): ClientErrors {
  const e: ClientErrors = {};
  if (!v.firstName.trim()) e.firstName = "Add a first name.";
  if (v.email.trim() && !EMAIL_RE.test(v.email.trim()))
    e.email = "That email doesn't look complete.";
  if (v.guardianEmail.trim() && !EMAIL_RE.test(v.guardianEmail.trim()))
    e.guardianEmail = "That email doesn't look complete.";
  if (v.duprRating.trim()) {
    const n = parseRating(v.duprRating);
    if (!Number.isFinite(n) || n < 1 || n > 8) e.duprRating = "Use a rating from 1.0 to 8.0.";
  }
  if (v.birthDate && (!DATE_RE.test(v.birthDate) || v.birthDate > today))
    e.birthDate = "Use a date in the past.";
  return e;
}

/** Moves keyboard focus to the first field flagged invalid. */
export function focusFirstInvalid(root: HTMLElement | null) {
  requestAnimationFrame(() => {
    root?.querySelector<HTMLElement>("[data-invalid] input, [data-invalid] textarea")?.focus();
  });
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <legend className="mb-4 p-0">
        <span className="block text-[1.125rem] font-medium">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-[0.8125rem] text-ink-2">{description}</span>
        ) : null}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Every client field, grouped the way coaches think about a player. Controlled: the page or sheet
 * owns the values and decides what to do on save.
 */
export function ClientFields({
  values,
  onChange,
  errors,
  layout = "page",
  editing = false,
  autoFocus = false,
}: {
  values: ClientFormValues;
  onChange: (patch: Partial<ClientFormValues>) => void;
  errors: ClientErrors;
  /** "page" splits into two columns on desktop; "sheet" stays single column. */
  layout?: "page" | "sheet";
  editing?: boolean;
  autoFocus?: boolean;
}) {
  const fmt = useFormat();
  const groups = useGroups();
  const set =
    <K extends keyof ClientFormValues>(key: K) =>
    (value: ClientFormValues[K]) =>
      onChange({ [key]: value } as Partial<ClientFormValues>);
  const activeGroups = (groups.data ?? []).filter(
    (g) => !g.archivedAt || values.groupIds.includes(g.id),
  );
  const statuses: ClientStatus[] = editing
    ? values.status === "archived"
      ? ["active", "lead", "paused", "archived"]
      : ["active", "lead", "paused"]
    : ["active", "lead"];
  const showBirthDate = values.isJunior || Boolean(values.birthDate);

  const contact = (
    <Section title="Contact">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="First name"
          isRequired
          autoFocus={autoFocus}
          autoComplete="off"
          value={values.firstName}
          onChange={set("firstName")}
          error={errors.firstName}
        />
        <TextField
          label="Last name"
          autoComplete="off"
          value={values.lastName}
          onChange={set("lastName")}
          error={errors.lastName}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={values.email}
          onChange={set("email")}
          error={errors.email}
        />
        <TextField
          label="Phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={values.phone}
          onChange={set("phone")}
          error={errors.phone}
        />
      </div>
    </Section>
  );

  const level = (
    <Section title="Level and status">
      <Segmented
        label="Status"
        value={values.status}
        onChange={(v) => onChange({ status: v as ClientStatus })}
        options={statuses.map((s) => ({ id: s, label: STATUS_LABELS[s] }))}
      />
      <LevelField value={values.level} onChange={set("level")} error={errors.level} />
      <div className="rounded-[22px] bg-panel px-4 py-2">
        <Switch
          isSelected={values.isJunior}
          onChange={set("isJunior")}
          description="Adds a birth date and guardian contact."
        >
          Junior
        </Switch>
        {showBirthDate || values.isJunior ? (
          <div className="flex flex-col gap-4 pt-2 pb-3">
            {showBirthDate ? (
              <TextField
                label="Birth date"
                type="date"
                max={fmt.today()}
                value={values.birthDate}
                onChange={set("birthDate")}
                error={errors.birthDate}
              />
            ) : null}
            {values.isJunior ? (
              <>
                <TextField
                  label="Guardian name"
                  autoComplete="off"
                  value={values.guardianName}
                  onChange={set("guardianName")}
                  error={errors.guardianName}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Guardian phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    value={values.guardianPhone}
                    onChange={set("guardianPhone")}
                    error={errors.guardianPhone}
                  />
                  <TextField
                    label="Guardian email"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    value={values.guardianEmail}
                    onChange={set("guardianEmail")}
                    error={errors.guardianEmail}
                  />
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  );

  const groupsAndTags = (
    <Section title="Groups and tags">
      {activeGroups.length ? (
        <GroupChoices
          groups={activeGroups}
          value={values.groupIds}
          onChange={set("groupIds")}
          editing={editing}
        />
      ) : (
        <p className="text-[0.875rem] text-ink-2">
          No groups yet. Create groups for recurring classes, then add players to them.
        </p>
      )}
      <TagInput value={values.tags} onChange={set("tags")} error={errors.tags} />
    </Section>
  );

  const onCourt = (
    <Section title="On court">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="DUPR rating"
          inputMode="decimal"
          placeholder="e.g. 3.25"
          value={values.duprRating}
          onChange={set("duprRating")}
          error={errors.duprRating}
        />
        <TextField
          label="DUPR ID"
          autoComplete="off"
          value={values.duprId}
          onChange={set("duprId")}
          error={errors.duprId}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Dominant hand"
          value={values.dominantHand || "none"}
          onChange={(v) => onChange({ dominantHand: v === "none" ? "" : (v as Hand) })}
          options={[
            { id: "none", label: "Not set" },
            { id: "right", label: "Right" },
            { id: "left", label: "Left" },
            { id: "ambidextrous", label: "Both" },
          ]}
        />
        <TextField
          label="Paddle"
          autoComplete="off"
          placeholder="Brand and model"
          value={values.paddle}
          onChange={set("paddle")}
          error={errors.paddle}
        />
      </div>
    </Section>
  );

  const health = (
    <Section title="Goals and health">
      <TextAreaField
        label="Goals"
        rows={3}
        placeholder="What they want from lessons: a rating, a tournament, fitness…"
        value={values.goals}
        onChange={set("goals")}
        error={errors.goals}
      />
      <div className="flex flex-col gap-1.5">
        <TextAreaField
          label="Medical notes"
          rows={2}
          placeholder="Injuries, conditions, allergies, medication"
          value={values.medicalNotes}
          onChange={set("medicalNotes")}
          error={errors.medicalNotes}
        />
        <p className="flex items-center gap-1.5 text-[0.8125rem] text-ink-2">
          <HeartPulse aria-hidden className="size-4 shrink-0 text-[#b42318]" />
          Anything here shows as a medical flag on rosters and the profile.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Emergency contact"
          autoComplete="off"
          placeholder="Name"
          value={values.emergencyName}
          onChange={set("emergencyName")}
          error={errors.emergencyName}
        />
        <TextField
          label="Emergency phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={values.emergencyPhone}
          onChange={set("emergencyPhone")}
          error={errors.emergencyPhone}
        />
      </div>
    </Section>
  );

  const notes = (
    <Section title="Notes">
      <TextField
        label="How they found you"
        autoComplete="off"
        placeholder="Referral, Instagram, walk-in…"
        value={values.source}
        onChange={set("source")}
        error={errors.source}
      />
      <TextAreaField
        label="Notes"
        rows={4}
        placeholder="Anything worth remembering about this player"
        value={values.notes}
        onChange={set("notes")}
        error={errors.notes}
      />
    </Section>
  );

  if (layout === "sheet") {
    return (
      <div className="flex flex-col gap-8">
        {contact}
        {level}
        {groupsAndTags}
        {onCourt}
        {health}
        {notes}
      </div>
    );
  }
  return (
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-9">
        {contact}
        {level}
        {groupsAndTags}
      </div>
      <div className="flex min-w-0 flex-col gap-9">
        {onCourt}
        {health}
        {notes}
      </div>
    </div>
  );
}

/** Level with suggestions from the usual scale and from levels already in use. */
export function LevelField({
  value,
  onChange,
  error,
  label = "Level",
  description = "Pick a common level or type your own.",
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  label?: string;
  description?: string;
}) {
  const clients = useClients({});
  const options = useMemo(() => {
    const used = (clients.data ?? []).map((c) => c.level).filter((l): l is string => Boolean(l));
    return [...new Set([...LEVEL_SUGGESTIONS, ...used])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [clients.data]);
  return (
    <ComboBox
      allowsCustomValue
      menuTrigger="focus"
      inputValue={value}
      onInputChange={onChange}
      isInvalid={Boolean(error)}
      className="flex flex-col gap-1.5"
    >
      <Label className="text-[0.8125rem] font-medium text-ink-2">{label}</Label>
      <div className="relative">
        <Input placeholder="e.g. 3.0" className={`${fieldClass} num pr-12`} />
        <RACButton
          aria-label="Show levels"
          className="absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-ink-2 outline-none hover:bg-panel data-[focus-visible]:outline-2 data-[focus-visible]:outline-ink"
        >
          <ChevronDown aria-hidden className="size-4.5" />
        </RACButton>
      </div>
      {error ? (
        <Text slot="errorMessage" className="text-[0.8125rem] font-medium text-[#b42318]">
          {error}
        </Text>
      ) : (
        <Text slot="description" className="text-[0.8125rem] text-ink-2">
          {description}
        </Text>
      )}
      <Popover className={`min-w-(--trigger-width) ${popoverClass}`}>
        <ListBox className="max-h-64 overflow-auto outline-none">
          {options.map((o) => (
            <ListBoxItem
              key={o}
              id={o}
              textValue={o}
              className="num flex cursor-pointer items-center rounded-xl px-3 py-2.5 text-ink outline-none data-[focused]:bg-panel data-[selected]:font-semibold"
            >
              {o}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}

function GroupChoices({
  groups,
  value,
  onChange,
  editing,
}: {
  groups: { id: string; name: string; memberCount: number }[];
  value: string[];
  onChange: (v: string[]) => void;
  editing: boolean;
}) {
  return (
    <CheckboxGroup value={value} onChange={onChange} className="flex flex-col gap-2">
      <Label className="text-[0.8125rem] font-medium text-ink-2">Groups</Label>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <RACCheckbox
            key={g.id}
            value={g.id}
            className="group inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-panel pr-4 pl-2.5 text-[0.9375rem] text-ink outline-none transition-colors hover:bg-line data-[selected]:bg-violet data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink"
          >
            <span className="flex size-6 items-center justify-center rounded-full border border-line-strong bg-card transition-colors group-data-[selected]:border-ink group-data-[selected]:bg-ink">
              <Check
                aria-hidden
                strokeWidth={3}
                className="size-3.5 text-white opacity-0 group-data-[selected]:opacity-100"
              />
            </span>
            {g.name}
          </RACCheckbox>
        ))}
      </div>
      <Text slot="description" className="text-[0.8125rem] text-ink-2">
        {editing
          ? "Joining adds them to the group's upcoming sessions; leaving takes them off."
          : "They're added to each group's upcoming sessions."}
      </Text>
    </CheckboxGroup>
  );
}

const MAX_TAGS = 20;

/** Chip input: Enter or a comma adds a tag, Backspace on an empty field removes the last one. */
export function TagInput({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  error?: string;
}) {
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const next = [...value];
    for (const part of raw.split(",")) {
      const tag = part.trim().slice(0, 30);
      if (!tag || next.length >= MAX_TAGS) continue;
      if (!next.some((t) => t.toLowerCase() === tag.toLowerCase())) next.push(tag);
    }
    setDraft("");
    if (next.length !== value.length) onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <RACTextField
        value={draft}
        onChange={(v) => {
          const cut = v.lastIndexOf(",");
          if (cut === -1) return setDraft(v);
          commit(v.slice(0, cut));
          setDraft(v.slice(cut + 1).trimStart());
        }}
        isInvalid={Boolean(error)}
        className="flex flex-col gap-1.5"
      >
        <Label className="text-[0.8125rem] font-medium text-ink-2">Tags</Label>
        <Input
          placeholder="Type a tag, then Enter"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
          className={fieldClass}
        />
        {error ? (
          <Text slot="errorMessage" className="text-[0.8125rem] font-medium text-[#b42318]">
            {error}
          </Text>
        ) : (
          <Text slot="description" className="text-[0.8125rem] text-ink-2">
            {value.length >= MAX_TAGS
              ? `That's the most tags a client can have (${MAX_TAGS}).`
              : `Short labels you can search by, like "tournament" or "morning".`}
          </Text>
        )}
      </RACTextField>
      {value.length ? (
        <TagGroup
          aria-label="Tags added"
          onRemove={(keys) => onChange(value.filter((t) => !keys.has(t)))}
        >
          <TagList className="flex flex-wrap gap-1.5">
            {value.map((t) => (
              <Tag
                key={t}
                id={t}
                textValue={t}
                className="inline-flex h-9 cursor-default items-center gap-1 rounded-full pr-1 pl-3.5 text-[0.875rem] font-medium text-ink ring-1 ring-line-strong outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink"
              >
                {t}
                <RACButton
                  slot="remove"
                  aria-label={`Remove ${t}`}
                  className="relative flex size-7 cursor-pointer items-center justify-center rounded-full text-ink-2 outline-none before:absolute before:-inset-1.5 hover:bg-panel hover:text-ink data-[focus-visible]:outline-2 data-[focus-visible]:outline-ink"
                >
                  <X aria-hidden className="size-4" />
                </RACButton>
              </Tag>
            ))}
          </TagList>
        </TagGroup>
      ) : null}
    </div>
  );
}
