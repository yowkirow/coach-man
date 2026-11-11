import { currencyDigits, minorToInput, parseMoney } from "@shared/money";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { type ClipboardEvent, type ReactNode, type Ref, useEffect, useState } from "react";
import {
  Input,
  type Key,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Button as RACButton,
  Checkbox as RACCheckbox,
  SearchField as RACSearchField,
  Switch as RACSwitch,
  TextArea as RACTextArea,
  TextField as RACTextField,
  Radio,
  RadioGroup,
  Select,
  SelectValue,
  Text,
} from "react-aria-components";

export const fieldClass =
  "h-12 w-full rounded-2xl border border-line-strong bg-card px-4 text-[0.9375rem] text-ink placeholder:text-ink-2 " +
  "outline-none transition-[border-color,box-shadow] duration-150 " +
  "data-[focused]:border-ink data-[focused]:shadow-[0_0_0_4px_rgb(218_238_99/0.55)] focus:border-ink focus:shadow-[0_0_0_4px_rgb(218_238_99/0.55)] " +
  "data-[invalid]:border-coral data-[disabled]:opacity-50";

export const popoverClass =
  "rounded-2xl bg-card p-1.5 shadow-pop outline-none data-[entering]:animate-[fade-in_120ms_ease-out]";

const labelClass = "text-[0.8125rem] font-medium text-ink-2";
const helpClass = "text-[0.8125rem] text-ink-2";
const errorClass = "text-[0.8125rem] font-medium text-[#b42318]";

interface BaseFieldProps {
  label: string;
  description?: ReactNode;
  error?: string;
  className?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  name?: string;
}

function Help({ description, error }: { description?: ReactNode; error?: string }) {
  if (error) {
    return (
      <Text slot="errorMessage" className={errorClass}>
        {error}
      </Text>
    );
  }
  return description ? (
    <Text slot="description" className={helpClass}>
      {description}
    </Text>
  ) : null;
}

export interface TextFieldProps extends BaseFieldProps {
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel" | "url" | "date" | "time" | "number" | "password";
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "text" | "decimal" | "numeric" | "tel" | "email" | "search";
  autoFocus?: boolean;
  min?: string;
  max?: string;
  step?: string;
  maxLength?: number;
  prefix?: ReactNode;
  /** The input itself: to focus or select it, read its paste, or set its type larger. */
  inputRef?: Ref<HTMLInputElement>;
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void;
  inputClassName?: string;
}

export function TextField({
  label,
  description,
  error,
  className = "",
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
  autoFocus,
  min,
  max,
  step,
  maxLength,
  prefix,
  inputRef,
  onPaste,
  inputClassName = "",
  ...rest
}: TextFieldProps) {
  return (
    <RACTextField
      {...rest}
      value={value}
      onChange={onChange}
      type={type}
      isInvalid={Boolean(error)}
      autoFocus={autoFocus}
      className={`flex flex-col gap-1.5 ${className}`}
    >
      <Label className={labelClass}>{label}</Label>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-ink-2">
            {prefix}
          </span>
        ) : null}
        <Input
          ref={inputRef}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          min={min}
          max={max}
          step={step}
          maxLength={maxLength}
          onPaste={onPaste}
          className={`${fieldClass} ${prefix ? "pl-9" : ""} ${type === "date" || type === "time" || type === "number" ? "num" : ""} ${inputClassName}`}
        />
      </div>
      <Help description={description} error={error} />
    </RACTextField>
  );
}

export interface TextAreaProps extends BaseFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
}

export function TextAreaField({
  label,
  description,
  error,
  className = "",
  value,
  onChange,
  placeholder,
  rows = 3,
  autoFocus,
  ...rest
}: TextAreaProps) {
  return (
    <RACTextField
      {...rest}
      value={value}
      onChange={onChange}
      isInvalid={Boolean(error)}
      autoFocus={autoFocus}
      className={`flex flex-col gap-1.5 ${className}`}
    >
      <Label className={labelClass}>{label}</Label>
      <RACTextArea
        placeholder={placeholder}
        rows={rows}
        className={`${fieldClass} h-auto min-h-24 resize-y py-3 leading-snug`}
      />
      <Help description={description} error={error} />
    </RACTextField>
  );
}

export interface MoneyFieldProps extends BaseFieldProps {
  valueMinor: number | null;
  onChange: (minor: number | null) => void;
  currency: string;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Money input: free typing, parsed to integer minor units. */
export function MoneyField({ valueMinor, onChange, currency, ...props }: MoneyFieldProps) {
  const [text, setText] = useState(valueMinor === null ? "" : minorToInput(valueMinor, currency));
  useEffect(() => {
    setText((prev) => {
      const parsed = parseMoney(prev, currency);
      if (parsed === valueMinor) return prev;
      return valueMinor === null ? "" : minorToInput(valueMinor, currency);
    });
  }, [valueMinor, currency]);
  const symbol = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  })
    .formatToParts(0)
    .find((p) => p.type === "currency")?.value;
  return (
    <TextField
      {...props}
      value={text}
      inputMode={currencyDigits(currency) > 0 ? "decimal" : "numeric"}
      prefix={symbol}
      onChange={(v) => {
        setText(v);
        onChange(v.trim() === "" ? null : parseMoney(v, currency));
      }}
    />
  );
}

export interface SelectOption {
  id: string;
  label: string;
  description?: string;
}

export interface SelectFieldProps extends BaseFieldProps {
  options: SelectOption[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
}

export function SelectField({
  label,
  description,
  error,
  className = "",
  options,
  value,
  onChange,
  placeholder = "Choose…",
  ...rest
}: SelectFieldProps) {
  return (
    <Select
      {...rest}
      selectedKey={value}
      onSelectionChange={(k: Key | null) => k !== null && onChange(String(k))}
      isInvalid={Boolean(error)}
      placeholder={placeholder}
      className={`flex flex-col gap-1.5 ${className}`}
    >
      <Label className={labelClass}>{label}</Label>
      <RACButton
        className={`${fieldClass} flex cursor-pointer items-center justify-between gap-2 text-left data-[pressed]:border-ink`}
      >
        {/* Show only the chosen option's text; the full option (description, check) is for the list. */}
        <SelectValue className="min-w-0 truncate data-[placeholder]:text-ink-2">
          {({ isPlaceholder, selectedText, defaultChildren }) =>
            isPlaceholder ? defaultChildren : selectedText
          }
        </SelectValue>
        <ChevronDown aria-hidden className="size-4.5 shrink-0 text-ink-2" />
      </RACButton>
      <Help description={description} error={error} />
      <Popover className={`min-w-(--trigger-width) ${popoverClass}`}>
        <ListBox className="max-h-72 overflow-auto outline-none">
          {options.map((o) => (
            <ListBoxItem
              key={o.id}
              id={o.id}
              textValue={o.label}
              className="group flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-ink outline-none data-[focused]:bg-panel data-[selected]:font-semibold"
            >
              <span className="flex flex-col">
                <span>{o.label}</span>
                {o.description ? (
                  <span className="text-[0.8125rem] font-normal text-ink-2">{o.description}</span>
                ) : null}
              </span>
              <Check aria-hidden className="size-4 opacity-0 group-data-[selected]:opacity-100" />
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  className = "",
  autoFocus,
  dark = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  dark?: boolean;
}) {
  const field = dark
    ? "h-11 w-full rounded-full border border-night-line bg-night-2 px-4 text-[0.9375rem] text-night-ink placeholder:text-night-ink-2 outline-none focus:border-lime"
    : `${fieldClass} rounded-full`;
  return (
    <RACSearchField
      value={value}
      onChange={onChange}
      aria-label={label}
      autoFocus={autoFocus}
      className={`group relative ${className}`}
    >
      <Search
        aria-hidden
        className={`pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 ${dark ? "text-night-ink-2" : "text-ink-2"}`}
      />
      <Input
        placeholder={placeholder}
        data-command-search
        className={`${field} pr-11 pl-11 [&::-webkit-search-cancel-button]:hidden`}
      />
      <RACButton
        aria-label="Clear search"
        className={`absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full outline-none group-data-[empty]:hidden ${dark ? "text-night-ink-2 hover:bg-night-3" : "text-ink-2 hover:bg-panel"}`}
      >
        <X aria-hidden className="size-4" />
      </RACButton>
    </RACSearchField>
  );
}

/** Round check (matches the reference's checklist circles). */
export function Checkbox({
  children,
  isSelected,
  onChange,
  isDisabled,
  className = "",
}: {
  children: ReactNode;
  isSelected: boolean;
  onChange: (v: boolean) => void;
  isDisabled?: boolean;
  className?: string;
}) {
  return (
    <RACCheckbox
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}
      className={`group flex cursor-pointer items-center gap-3 py-1.5 text-ink outline-none data-[disabled]:opacity-50 ${className}`}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-card transition-colors group-data-[selected]:border-ink group-data-[selected]:bg-ink group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-ink">
        <Check
          aria-hidden
          strokeWidth={3}
          className="size-3.5 text-white opacity-0 group-data-[selected]:opacity-100"
        />
      </span>
      <span>{children}</span>
    </RACCheckbox>
  );
}

export function Switch({
  children,
  isSelected,
  onChange,
  isDisabled,
  description,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  isSelected: boolean;
  onChange: (v: boolean) => void;
  isDisabled?: boolean;
  description?: ReactNode;
  /** A fuller name than the visible label, which it should start with (a row's "Public"). */
  "aria-label"?: string;
}) {
  return (
    <RACSwitch
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}
      aria-label={ariaLabel}
      className={`group flex cursor-pointer justify-between gap-4 py-2 text-ink outline-none data-[disabled]:opacity-50 ${description ? "items-start" : "items-center"}`}
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{children}</span>
        {description ? <span className="text-[0.8125rem] text-ink-2">{description}</span> : null}
      </span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full bg-line-strong transition-colors group-data-[selected]:bg-ink group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-ink ${description ? "mt-0.5" : ""}`}
      >
        <span className="absolute top-1 left-1 size-5 rounded-full bg-card shadow-lift transition-transform duration-200 ease-out group-data-[selected]:translate-x-5 group-data-[selected]:bg-lime" />
      </span>
    </RACSwitch>
  );
}

export interface SegmentOption {
  id: string;
  label: ReactNode;
}

/** Pill segmented control with radio dots, as in the reference ("○ Negotiation  ○ Close"). */
export function Segmented({
  label,
  options,
  value,
  onChange,
  className = "",
  hideLabel = false,
  tone = "panel",
}: {
  label: string;
  options: SegmentOption[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
  hideLabel?: boolean;
  tone?: "panel" | "glass";
}) {
  return (
    <RadioGroup
      value={value}
      onChange={onChange}
      orientation="horizontal"
      className={`flex flex-col gap-1.5 ${className}`}
    >
      <Label className={hideLabel ? "sr-only" : labelClass}>{label}</Label>
      <div
        className={`flex w-full gap-1 rounded-full p-1 ${tone === "glass" ? "bg-white/35" : "bg-panel"}`}
      >
        {options.map((o) => (
          <Radio
            key={o.id}
            value={o.id}
            className="group flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full px-3 text-center text-[0.875rem] font-medium text-ink-2 outline-none transition-colors data-[selected]:bg-card data-[selected]:text-ink data-[selected]:shadow-lift data-[hovered]:text-ink data-[focus-visible]:outline-2 data-[focus-visible]:outline-ink"
          >
            <span
              aria-hidden
              className="flex size-3.5 items-center justify-center rounded-full border-[1.5px] border-current"
            >
              <span className="size-1.5 rounded-full bg-current opacity-0 group-data-[selected]:opacity-100" />
            </span>
            {o.label}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
