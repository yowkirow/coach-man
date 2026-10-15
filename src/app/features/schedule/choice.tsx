import { WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { Checkbox, CheckboxGroup, Label, Radio, RadioGroup, Text } from "react-aria-components";
import { orderedWeekdays, weekdayName } from "./dates";

const labelClass = "text-[0.8125rem] font-medium text-ink-2";
const errorClass = "text-[0.8125rem] font-medium text-[#b42318]";

export interface ChoiceOption {
  id: string;
  label: ReactNode;
}

/**
 * The shared Segmented control (radio dots in a pill track), but allowed to wrap onto a second
 * row so five or six choices fit a phone-width sheet.
 */
export function WrapSegmented({
  label,
  options,
  value,
  onChange,
  error,
  className = "",
  isDisabled,
}: {
  label: string;
  options: ChoiceOption[];
  value: string;
  onChange: (v: string) => void;
  error?: string;
  className?: string;
  isDisabled?: boolean;
}) {
  return (
    <RadioGroup
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      isInvalid={Boolean(error)}
      orientation="horizontal"
      className={`flex flex-col gap-1.5 ${className}`}
    >
      <Label className={labelClass}>{label}</Label>
      <div className="flex flex-wrap gap-1 rounded-[24px] bg-panel p-1">
        {options.map((o) => (
          <Radio
            key={o.id}
            value={o.id}
            className="group flex min-h-10 flex-auto cursor-pointer items-center justify-center gap-2 rounded-full px-3.5 text-center text-[0.875rem] font-medium whitespace-nowrap text-ink-2 outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[focus-visible]:outline-2 data-[focus-visible]:outline-ink data-[hovered]:text-ink data-[selected]:bg-card data-[selected]:text-ink data-[selected]:shadow-lift"
          >
            <span
              aria-hidden
              className="flex size-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-current"
            >
              <span className="size-1.5 rounded-full bg-current opacity-0 group-data-[selected]:opacity-100" />
            </span>
            {o.label}
          </Radio>
        ))}
      </div>
      {error ? (
        <Text slot="errorMessage" className={errorClass}>
          {error}
        </Text>
      ) : null}
    </RadioGroup>
  );
}

/** Weekday toggles for repeating sessions, in the workspace's week order. */
export function WeekdayPicker({
  label,
  value,
  onChange,
  locale,
  weekStartsOn,
  error,
  description,
}: {
  label: string;
  value: number[];
  onChange: (days: number[]) => void;
  locale: string;
  weekStartsOn: number;
  error?: string;
  description?: ReactNode;
}) {
  return (
    <CheckboxGroup
      value={value.map(String)}
      onChange={(v) => onChange(v.map(Number))}
      isInvalid={Boolean(error)}
      className="flex flex-col gap-1.5"
    >
      <Label className={labelClass}>{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {orderedWeekdays(weekStartsOn).map((d) => (
          <Checkbox
            key={d}
            value={String(d)}
            aria-label={weekdayName(d, locale, "long")}
            className="flex h-11 min-w-13 cursor-pointer items-center justify-center rounded-full bg-panel px-3 text-[0.875rem] font-medium text-ink outline-none transition-colors data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink data-[hovered]:bg-line data-[selected]:bg-ink data-[selected]:text-white"
          >
            {weekdayName(d, locale, "short")}
          </Checkbox>
        ))}
      </div>
      {error ? (
        <Text slot="errorMessage" className={errorClass}>
          {error}
        </Text>
      ) : description ? (
        <Text slot="description" className="text-[0.8125rem] text-ink-2">
          {description}
        </Text>
      ) : null}
    </CheckboxGroup>
  );
}

/** Shown beside write actions while the device is offline (reads keep working from cache). */
export function OfflineNote({
  dark = false,
  children = "You're offline. Changes need a connection.",
  className = "",
}: {
  dark?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={`inline-flex items-center gap-1.5 text-[0.8125rem] ${dark ? "text-night-ink-2" : "text-ink-2"} ${className}`}
    >
      <WifiOff aria-hidden className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}
