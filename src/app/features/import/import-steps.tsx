import { Check, ChevronDown, Download, FileSpreadsheet, FileUp, WifiOff } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
  Disclosure,
  DisclosurePanel,
  DropZone,
  FileTrigger,
  Heading,
  Button as RACButton,
  Checkbox as RACCheckbox,
} from "react-aria-components";
import { Button, buttonClass } from "../../components/ui/button";
import { Card, Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { SelectField, TextAreaField } from "../../components/ui/field";
import { plural } from "../../lib/format";
import { useOnline } from "../../lib/offline";
import { SectionHead } from "../clients/bits";
import { FIELD_LABELS, FIELD_ORDER, type FieldKey, type ParsedCsv, type RowCheck } from "./csv";

export type Step = "file" | "map" | "review" | "done";

export const STEPS: { id: Step; title: string; body: string }[] = [
  { id: "file", title: "Choose a file", body: "A CSV, or rows pasted from a spreadsheet" },
  { id: "map", title: "Match columns", body: "Tell us which column is which" },
  { id: "review", title: "Check rows", body: "Duplicates and problems are set aside" },
  { id: "done", title: "Import", body: "Clients land in your list" },
];

/** Dark step tiles for the command panel; the current step is lime. */
export function StepRail({
  step,
  reachable,
  onStep,
}: {
  step: Step;
  reachable: (s: Step) => boolean;
  onStep: (s: Step) => void;
}) {
  const index = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="flex flex-col gap-5">
      <div className="px-1">
        <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">Import</h2>
        <p className="mt-1 text-[0.875rem] text-night-ink-2">Bring your client list over</p>
      </div>
      <ol className="flex flex-col gap-2.5">
        {STEPS.map((s, i) => {
          const current = s.id === step;
          const done = i < index;
          const can = !current && reachable(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!can}
                aria-current={current ? "step" : undefined}
                onClick={() => onStep(s.id)}
                className={`flex w-full items-center gap-3 rounded-[24px] p-4 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
                  current
                    ? "bg-lime text-ink"
                    : can
                      ? "cursor-pointer bg-night-2 text-night-ink hover:bg-night-3"
                      : "bg-night-2 text-night-ink-2"
                }`}
              >
                <span
                  aria-hidden
                  className={`num flex size-9 shrink-0 items-center justify-center rounded-full text-[0.875rem] font-semibold ${
                    current
                      ? "bg-ink text-lime"
                      : done
                        ? "bg-night-4 text-night-ink"
                        : "border border-night-4"
                  }`}
                >
                  {done ? <Check className="size-4" strokeWidth={2.5} /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">
                    <span className="sr-only">
                      Step {i + 1}
                      {done ? ", done" : ""}:{" "}
                    </span>
                    {s.title}
                  </span>
                  <span
                    className={`block text-[0.8125rem] ${current ? "text-ink/70" : "text-night-ink-2"}`}
                  >
                    {s.body}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="rounded-[24px] border border-night-line p-4 text-[0.8125rem] text-night-ink-2">
        <p className="font-medium text-night-ink">How duplicates are found</p>
        <p className="mt-1">
          A row matching an existing client's email or phone is set aside, so importing the same
          file twice is safe.
        </p>
      </div>
    </div>
  );
}

/** Phone: "Step 2 of 4" with a segmented bar. */
export function PhoneSteps({ step }: { step: Step }) {
  const index = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.875rem] text-ink-2">
        Step <span className="num">{index + 1}</span> of {STEPS.length} ·{" "}
        <span className="font-medium text-ink">{STEPS[index]?.title}</span>
      </p>
      <div aria-hidden className="grid grid-cols-4 gap-1.5">
        {STEPS.map((s, i) => (
          <span
            key={s.id}
            className={`h-1.5 rounded-full ${i < index ? "bg-ink" : i === index ? "bg-lime-strong" : "bg-ink/10"}`}
          />
        ))}
      </div>
    </div>
  );
}

const MAX_BYTES = 5_000_000;

export function FileStep({
  onText,
  error,
  templateHref,
}: {
  onText: (text: string, name: string) => void;
  error: string | null;
  templateHref: string;
}) {
  const [pasted, setPasted] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const readFile = async (file: File) => {
    setReadError(null);
    if (file.size > MAX_BYTES)
      return setReadError("That file is over 5 MB. Split it and import in parts.");
    if (/\.(xlsx?|numbers|ods)$/i.test(file.name))
      return setReadError(
        "That's a spreadsheet file. Save or export it as CSV first, then choose it here.",
      );
    try {
      onText(await file.text(), file.name);
    } catch {
      setReadError("Couldn't read that file. Try saving it again as CSV.");
    }
  };
  const shown = readError ?? error;
  return (
    <Card className="p-5 sm:p-6" label="Choose a file">
      <h2 className="text-[1.125rem] font-medium">Choose a file</h2>
      <p className="mt-1 text-[0.9375rem] text-ink-2">
        Export your list from Google Sheets, Excel, or another app as a .csv file. The first row
        should hold the column names.
      </p>
      <DropZone
        aria-label="Drop a CSV file"
        getDropOperation={() => "copy"}
        onDrop={async (e) => {
          for (const item of e.items) {
            if (item.kind === "file") return void readFile(await item.getFile());
            if (item.kind === "text" && item.types.has("text/plain"))
              return onText(await item.getText("text/plain"), "Dropped text");
          }
        }}
        className="mt-5 flex flex-col items-center justify-center gap-3 rounded-[24px] border-2 border-dashed border-line-strong bg-panel px-6 py-12 text-center outline-none transition-colors data-[drop-target]:border-ink data-[drop-target]:bg-lime-soft data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-lime text-ink">
          <FileSpreadsheet aria-hidden className="size-6" />
        </span>
        <p className="text-[1.25rem] font-light">Drop a CSV file here</p>
        <p className="text-[0.875rem] text-ink-2">or</p>
        <FileTrigger
          acceptedFileTypes={[".csv", "text/csv", "text/plain", "text/tab-separated-values"]}
          onSelect={(files) => {
            const file = files?.[0];
            if (file) void readFile(file);
          }}
        >
          <Button variant="dark" icon={<FileUp aria-hidden className="size-4.5" />}>
            Choose a file
          </Button>
        </FileTrigger>
      </DropZone>
      {shown ? (
        <div className="mt-4">
          <InlineError>{shown}</InlineError>
        </div>
      ) : null}
      <Disclosure className="group mt-5 rounded-[22px] bg-panel">
        <Heading level={3}>
          <RACButton
            slot="trigger"
            className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-[22px] px-4 text-left font-medium outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-ink"
          >
            Paste rows instead
            <ChevronDown
              aria-hidden
              className="size-5 text-ink-2 transition-transform group-data-[expanded]:rotate-180"
            />
          </RACButton>
        </Heading>
        <DisclosurePanel>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <TextAreaField
              label="Rows with a header line"
              rows={6}
              value={pasted}
              onChange={setPasted}
              placeholder={
                "First name,Last name,Email,Phone\nAlex,Example,alex@example.com,+1 555 0100"
              }
              description="Copy cells straight from a spreadsheet, or paste CSV text."
            />
            <Button
              variant="dark"
              size="sm"
              className="self-start"
              isDisabled={!pasted.trim()}
              onPress={() => onText(pasted, "Pasted rows")}
            >
              Use these rows
            </Button>
          </div>
        </DisclosurePanel>
      </Disclosure>
      <p className="mt-5 text-[0.875rem] text-ink-2">
        Not sure how to lay it out?{" "}
        <a
          href={templateHref}
          download="coachman-clients-template.csv"
          className="font-medium text-ink underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          Download the template
        </a>
        .
      </p>
    </Card>
  );
}

export function MapStep({
  csv,
  fileName,
  mapping,
  onField,
  onBack,
  onNext,
}: {
  csv: ParsedCsv;
  fileName: string;
  mapping: FieldKey[];
  onField: (column: number, field: FieldKey) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const hasName = mapping.includes("firstName") || mapping.includes("fullName");
  const options = FIELD_ORDER.map((f) => ({ id: f, label: FIELD_LABELS[f] }));
  return (
    <Card label="Match columns">
      <SectionHead
        title="Match columns"
        count={`${plural(csv.rows.length, "row")} in ${fileName}`}
      />
      <p className="px-5 text-[0.9375rem] text-ink-2">
        We matched what we recognised. Check each column, or choose "Don't import" to leave it out.
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-line px-5">
        {csv.headers.map((h, i) => {
          const samples = csv.rows
            .map((r) => r[i]?.trim())
            .filter(Boolean)
            .slice(0, 3);
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional and can repeat names.
              key={i}
              className="grid items-center gap-x-6 gap-y-2 py-3.5 sm:grid-cols-[minmax(0,1fr)_17rem]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{h}</p>
                <p className="truncate text-[0.8125rem] text-ink-2">
                  {samples.length ? samples.join(" · ") : "Empty column"}
                </p>
              </div>
              <SelectField
                label={`Imports "${h}" as`}
                options={options}
                value={mapping[i] ?? "skip"}
                onChange={(v) => onField(i, v as FieldKey)}
              />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
        {!hasName ? (
          <InlineError>Match a name column (full name or first name) to continue.</InlineError>
        ) : null}
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="light" onPress={onBack}>
            Choose another file
          </Button>
          <Button variant="dark" isDisabled={!hasName} onPress={onNext}>
            Check rows
          </Button>
        </div>
      </div>
    </Card>
  );
}

function RowStatus({ row, included }: { row: RowCheck; included: boolean }) {
  if (row.problem) return <Pill tone="coral">Can't import</Pill>;
  if (row.duplicateOf)
    return (
      <Pill tone={included ? "sky" : "amber"}>
        {included ? "Importing anyway" : "Already here"}
      </Pill>
    );
  return <Pill tone="mint">Ready</Pill>;
}

function RowLine({
  row,
  included,
  onInclude,
}: {
  row: RowCheck;
  included: boolean;
  onInclude: (line: number, on: boolean) => void;
}) {
  const contact = [row.input.email, row.input.phone].filter(Boolean).join(" · ");
  const reason = row.problem ?? row.duplicateOf;
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex items-start gap-3">
        <span className="num w-10 shrink-0 pt-0.5 text-[0.8125rem] text-ink-2">{row.line}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{row.name}</p>
          {contact ? (
            <p className="truncate text-[0.8125rem] text-ink-2">{String(contact)}</p>
          ) : null}
        </div>
        <RowStatus row={row} included={included} />
      </div>
      {reason || row.warnings.length ? (
        <div className="ml-13 flex flex-col gap-1 text-[0.8125rem]">
          {reason ? (
            <p className={row.problem ? "font-medium text-[#b42318]" : "text-ink"}>{reason}</p>
          ) : null}
          {row.warnings.map((w) => (
            <p key={w} className="text-ink-2">
              {w}
            </p>
          ))}
          {row.duplicateOf && !row.problem ? (
            <RACCheckbox
              isSelected={included}
              onChange={(on) => onInclude(row.line, on)}
              className="group flex min-h-11 cursor-pointer items-center gap-2.5 self-start text-[0.875rem] outline-none"
            >
              <span className="flex size-5 items-center justify-center rounded-md border border-line-strong bg-card group-data-[selected]:border-ink group-data-[selected]:bg-ink group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-ink">
                <Check
                  aria-hidden
                  strokeWidth={3}
                  className="size-3.5 text-white opacity-0 group-data-[selected]:opacity-100"
                />
              </span>
              Import this row anyway
            </RACCheckbox>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ReviewStep({
  rows,
  included,
  onInclude,
  onBack,
  onImport,
  isPending,
  progress,
  error,
}: {
  rows: RowCheck[];
  included: Set<number>;
  onInclude: (line: number, on: boolean) => void;
  onBack: () => void;
  onImport: () => void;
  isPending: boolean;
  progress: string | null;
  error: string | null;
}) {
  const online = useOnline();
  const ready = rows.filter((r) => !r.problem && (!r.duplicateOf || included.has(r.line)));
  const dupes = rows.filter((r) => !r.problem && r.duplicateOf && !included.has(r.line));
  const invalid = rows.filter((r) => r.problem);
  const preview = rows.slice(0, 20);
  const setAside = useMemo(() => rows.slice(20).filter((r) => r.problem || r.duplicateOf), [rows]);
  return (
    <Card label="Check rows">
      <SectionHead title="Check rows" />
      <div className="flex flex-wrap gap-2 px-5">
        <Pill tone="mint" size="md">
          <span className="num">{ready.length}</span> ready
        </Pill>
        {dupes.length ? (
          <Pill tone="amber" size="md">
            <span className="num">{dupes.length}</span> already in CoachMan
          </Pill>
        ) : null}
        {invalid.length ? (
          <Pill tone="coral" size="md">
            <span className="num">{invalid.length}</span> can't import
          </Pill>
        ) : null}
      </div>
      <p className="mt-3 px-5 text-[0.875rem] text-ink-2">
        {rows.length > 20
          ? `The first 20 of ${rows.length} rows. Rows set aside further down are listed after them.`
          : "Every row in the file."}{" "}
        Duplicates and rows that can't be imported are skipped unless you choose otherwise.
      </p>
      <ol className="mt-2 flex flex-col divide-y divide-line px-5">
        {preview.map((r) => (
          <RowLine key={r.line} row={r} included={included.has(r.line)} onInclude={onInclude} />
        ))}
      </ol>
      {setAside.length ? (
        <div className="mx-5 mt-2 border-t border-line pt-4">
          <h3 className="text-[0.9375rem] font-medium">
            Also set aside <span className="num font-normal text-ink-2">{setAside.length}</span>
          </h3>
          <ol className="flex flex-col divide-y divide-line">
            {setAside.map((r) => (
              <RowLine key={r.line} row={r} included={included.has(r.line)} onInclude={onInclude} />
            ))}
          </ol>
        </div>
      ) : null}
      <div className="mt-2 flex flex-col gap-3 border-t border-line px-5 py-4">
        {error ? <InlineError>{error}</InlineError> : null}
        {!online ? (
          <p
            role="status"
            className="flex items-center gap-2.5 rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem] font-medium"
          >
            <WifiOff aria-hidden className="size-4 shrink-0" />
            You're offline. Reconnect to import.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="light" onPress={onBack} isDisabled={isPending}>
            Back to columns
          </Button>
          <div className="flex items-center gap-3">
            {progress ? <span className="num text-[0.875rem] text-ink-2">{progress}</span> : null}
            <Button
              variant="dark"
              isDisabled={!ready.length || !online}
              isPending={isPending}
              onPress={onImport}
            >
              {ready.length ? `Import ${plural(ready.length, "client")}` : "Nothing to import"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function ResultStep({
  created,
  skipped,
  children,
}: {
  created: number;
  skipped: { line: number; name: string; reason: string }[];
  children: ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6" label="Import finished">
      <div className="flex flex-col items-start gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-lime text-ink">
          <Check aria-hidden className="size-5" strokeWidth={2.5} />
        </span>
        <h2 className="text-[1.75rem] leading-tight font-light">
          {created ? `${plural(created, "client")} imported` : "No clients imported"}
        </h2>
        <p className="max-w-[56ch] text-ink-2">
          {created
            ? "They're in your client list now, ready for packages and sessions."
            : "Every row was skipped. Check the reasons below, fix the file, and try again."}
          {skipped.length ? ` ${plural(skipped.length, "row")} skipped.` : ""}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">{children}</div>
      </div>
      {skipped.length ? (
        <div className="mt-6 border-t border-line pt-4">
          <h3 className="text-[0.9375rem] font-medium">Skipped</h3>
          <ol className="mt-1 flex flex-col divide-y divide-line">
            {skipped.map((s) => (
              <li key={s.line} className="flex items-start gap-3 py-2.5 text-[0.875rem]">
                <span className="num w-10 shrink-0 text-ink-2">{s.line}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{s.name}</span>
                  <span className="block text-ink-2">{s.reason}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}

const EXPORTS = [
  { file: "clients.csv", label: "Clients" },
  { file: "attendance.csv", label: "Attendance" },
  { file: "payments.csv", label: "Payments" },
  { file: "charges.csv", label: "Charges" },
  { file: "packages.csv", label: "Packages" },
  { file: "workspace.json", label: "Full backup (JSON)" },
];

/** Every export the API offers, as plain download links. */
export function ExportSection() {
  const online = useOnline();
  return (
    <Card label="Export your data">
      <SectionHead title="Export your data" />
      <p className="px-5 text-[0.9375rem] text-ink-2">
        Your data stays yours. Download spreadsheets you can open anywhere, or a full backup of
        everything in this workspace.
      </p>
      <ul className="flex flex-wrap gap-2 px-5 pt-4 pb-5">
        {EXPORTS.map((e) => (
          <li key={e.file}>
            {online ? (
              <a href={`/api/v1/export/${e.file}`} download className={buttonClass("light")}>
                <Download aria-hidden className="size-4.5" />
                {e.label}
              </a>
            ) : (
              <span className={buttonClass("light", "md", "cursor-not-allowed opacity-45")}>
                <Download aria-hidden className="size-4.5" />
                {e.label}
              </span>
            )}
          </li>
        ))}
      </ul>
      {!online ? (
        <p className="px-5 pb-5 text-[0.875rem] text-ink-2">Exports need a connection.</p>
      ) : null}
    </Card>
  );
}
