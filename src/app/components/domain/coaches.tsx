import type { CoachRefDto, CoachSummaryDto } from "@shared/api-types";
import { STAFF_ROLE_LABELS } from "@shared/roles";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import {
  CheckboxGroup,
  Label,
  Checkbox as RACCheckbox,
  Radio,
  RadioGroup,
  Text,
} from "react-aria-components";
import { personOf, type SessionScope } from "../../lib/coaches";
import { useCoachChoices, useCoachMap } from "../../lib/hooks";
import { Avatar } from "../ui/display";
import { SelectField } from "../ui/field";

type CoachLike = Pick<CoachRefDto, "name" | "photoKey">;

export function CoachAvatar({
  coach,
  size = "sm",
  ring = false,
}: {
  coach: CoachLike;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  ring?: boolean;
}) {
  return <Avatar person={personOf(coach.name, coach.photoKey)} size={size} ring={ring} />;
}

/** A coach id as a name and photo, also for someone who has since left the team. */
export function resolveCoach(
  id: string,
  map: Map<string, CoachSummaryDto>,
): CoachLike & { userId: string; former: boolean } {
  const c = map.get(id);
  return c
    ? { userId: id, name: c.name, photoKey: c.photoKey, former: false }
    : { userId: id, name: "Former coach", photoKey: null, former: true };
}

/**
 * "Coach Sam Rivera · with Kim Lee": the lead and assistants of a session, program, or event as
 * small avatars and names. Renders nothing when nobody is set and `empty` isn't given.
 */
export function CoachLine({
  lead,
  assistants = [],
  map,
  empty,
  className = "",
}: {
  lead: string | null;
  assistants?: readonly string[];
  map: Map<string, CoachSummaryDto>;
  empty?: ReactNode;
  className?: string;
}) {
  const people = [
    ...(lead ? [{ ...resolveCoach(lead, map), lead: true }] : []),
    ...assistants.map((id) => ({ ...resolveCoach(id, map), lead: false })),
  ];
  if (!people.length) {
    return empty ? <p className={`text-[0.875rem] text-ink-2 ${className}`}>{empty}</p> : null;
  }
  return (
    <ul className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${className}`}>
      {people.map((p) => (
        <li key={`${p.userId}-${p.lead}`} className="inline-flex items-center gap-2">
          <CoachAvatar coach={p} size="xs" />
          <span className="text-[0.875rem]">
            <span className="font-medium">{p.name}</span>
            <span className="text-ink-2">{p.lead ? " · lead" : " · assistant"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface CoachChoice {
  lead: string | null;
  assistants: string[];
}

/**
 * Lead coach and assistant coaches for the create and edit sheets: a select for the lead and
 * checkbox chips for the assistants, offering the people who coach. Someone who no longer coaches
 * here (moved to the front desk, or left) stays listed while they're still set, so saving never
 * changes a coach nobody touched.
 */
export function CoachFields({
  value,
  onChange,
  leadLabel = "Lead coach",
  noLeadLabel = "No lead coach",
  description,
  error,
}: {
  value: CoachChoice;
  onChange: (next: CoachChoice) => void;
  leadLabel?: string;
  noLeadLabel?: string;
  description?: ReactNode;
  error?: string;
}) {
  const coaches = useCoachChoices();
  const team = useCoachMap();
  const offered = new Set(coaches.map((c) => c.userId));
  const kept = [value.lead, ...value.assistants].filter(
    (id): id is string => Boolean(id) && !offered.has(id as string),
  );
  const everyone: { userId: string; name: string; photoKey: string | null; detail: string }[] = [
    ...coaches.map((c) => ({
      userId: c.userId,
      name: c.name,
      photoKey: c.photoKey,
      detail: c.title ?? STAFF_ROLE_LABELS[c.role],
    })),
    ...kept.map((id) => {
      const person = team.get(id);
      return person
        ? {
            userId: id,
            name: person.name,
            photoKey: person.photoKey,
            detail: `${STAFF_ROLE_LABELS[person.role]} now`,
          }
        : { userId: id, name: "Former coach", photoKey: null, detail: "Left the team" };
    }),
  ];
  const assistantChoices = everyone.filter((c) => c.userId !== value.lead);
  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label={leadLabel}
        options={[
          { id: "none", label: noLeadLabel },
          ...everyone.map((c) => ({ id: c.userId, label: c.name, description: c.detail })),
        ]}
        value={value.lead ?? "none"}
        onChange={(id) => {
          const lead = id === "none" ? null : id;
          onChange({ lead, assistants: value.assistants.filter((a) => a !== lead) });
        }}
        description={description}
        error={error}
      />
      {assistantChoices.length ? (
        <CheckboxGroup
          value={value.assistants}
          onChange={(assistants) => onChange({ lead: value.lead, assistants })}
          className="flex flex-col gap-2"
        >
          <Label className="text-[0.8125rem] font-medium text-ink-2">Assistant coaches</Label>
          <div className="flex flex-wrap gap-2">
            {assistantChoices.map((c) => (
              <RACCheckbox
                key={c.userId}
                value={c.userId}
                className="group inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-panel pr-4 pl-1.5 text-[0.9375rem] text-ink outline-none transition-colors hover:bg-line data-[selected]:bg-violet data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink"
              >
                <CoachAvatar coach={c} size="xs" />
                {c.name}
                <span className="flex size-5 items-center justify-center rounded-full border border-line-strong bg-card transition-colors group-data-[selected]:border-ink group-data-[selected]:bg-ink">
                  <Check
                    aria-hidden
                    strokeWidth={3}
                    className="size-3 text-white opacity-0 group-data-[selected]:opacity-100"
                  />
                </span>
              </RACCheckbox>
            ))}
          </div>
          <Text slot="description" className="text-[0.8125rem] text-ink-2">
            Assistants help run it and get its reminders too.
          </Text>
        </CheckboxGroup>
      ) : null}
    </div>
  );
}

/**
 * "Mine / Everyone": whose sessions Today and the Schedule show. `dark` sits in the command panel
 * and the phone's black header, where the chosen option turns lime.
 */
export function ScopeToggle({
  value,
  onChange,
  dark = false,
  className = "",
}: {
  value: SessionScope;
  onChange: (v: SessionScope) => void;
  dark?: boolean;
  className?: string;
}) {
  const option = dark
    ? "text-night-ink-2 data-[hovered]:text-night-ink data-[selected]:bg-lime data-[selected]:text-ink data-[focus-visible]:outline-lime"
    : "text-ink-2 data-[hovered]:text-ink data-[selected]:bg-card data-[selected]:text-ink data-[selected]:shadow-lift data-[focus-visible]:outline-ink";
  return (
    <RadioGroup
      aria-label="Whose sessions to show"
      orientation="horizontal"
      value={value}
      onChange={(v) => onChange(v as SessionScope)}
      className={className}
    >
      <div className={`flex gap-1 rounded-full p-1 ${dark ? "bg-night-2" : "bg-panel"}`}>
        {(
          [
            ["mine", "Mine"],
            ["everyone", "Everyone"],
          ] as const
        ).map(([id, label]) => (
          <Radio
            key={id}
            value={id}
            className={`flex h-10 flex-1 cursor-pointer items-center justify-center rounded-full px-4 text-[0.875rem] font-medium whitespace-nowrap outline-none transition-colors data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 ${option}`}
          >
            {label}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
