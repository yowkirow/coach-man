import type { ImportResultDto } from "@shared/api-types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, FileUp, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Page, ShellAside } from "../../components/layout/app-shell";
import { NoAccess } from "../../components/layout/no-access";
import { Button, buttonClass } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/display";
import {
  CHUNK,
  checkRows,
  type FieldKey,
  guessMapping,
  MAX_ROWS,
  type ParsedCsv,
  parseCsv,
  type RowCheck,
  TEMPLATE_CSV,
} from "../../features/import/csv";
import {
  ExportSection,
  FileStep,
  MapStep,
  PhoneSteps,
  ResultStep,
  ReviewStep,
  type Step,
  StepRail,
} from "../../features/import/import-steps";
import { api, errorMessage } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { useCan, useClients } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { keys } from "../../lib/query";

export const Route = createFileRoute("/_app/import")({
  component: ImportRoute,
});

function ImportRoute() {
  const can = useCan();
  if (!can.data) {
    return (
      <NoAccess
        title="Import clients"
        body="Importing and exporting the academy's data is for its owner and admins. You can still add players one by one from Clients."
      />
    );
  }
  return <ImportPage />;
}

interface Skipped {
  line: number;
  name: string;
  reason: string;
}

/** True when the workspace locale writes dates month first (3/4/2010 = March 4). */
function monthFirstFor(locale: string) {
  const parts = new Intl.DateTimeFormat(locale).formatToParts(new Date(Date.UTC(2020, 11, 31)));
  return parts.findIndex((p) => p.type === "month") < parts.findIndex((p) => p.type === "day");
}

function ImportPage() {
  const fmt = useFormat();
  const qc = useQueryClient();
  const existing = useClients({ status: "all" });
  const [step, setStep] = useState<Step>("file");
  const [source, setSource] = useState<{ name: string; csv: ParsedCsv } | null>(null);
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [included, setIncluded] = useState<Set<number>>(new Set());
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: Skipped[] } | null>(null);
  const createdSoFar = useRef(0);

  const templateHref = useMemo(
    () =>
      URL.createObjectURL(new Blob([`\uFEFF${TEMPLATE_CSV}`], { type: "text/csv;charset=utf-8" })),
    [],
  );
  useEffect(() => () => URL.revokeObjectURL(templateHref), [templateHref]);

  const monthFirst = useMemo(() => monthFirstFor(fmt.locale), [fmt.locale]);
  const today = fmt.today();
  const rows = useMemo<RowCheck[]>(
    () =>
      source && step !== "file"
        ? checkRows(source.csv, mapping, { existing: existing.data ?? [], monthFirst, today })
        : [],
    [source, mapping, existing.data, monthFirst, today, step],
  );
  const hasName = mapping.includes("firstName") || mapping.includes("fullName");

  const onText = (text: string, name: string) => {
    const csv = parseCsv(text);
    if (!csv.rows.length) {
      setFileError("We couldn't find any rows under the header line.");
      return;
    }
    if (csv.rows.length > MAX_ROWS) {
      setFileError(
        `That file has ${csv.rows.length.toLocaleString()} rows. Import up to ${MAX_ROWS.toLocaleString()} at a time.`,
      );
      return;
    }
    setFileError(null);
    setSource({ name, csv });
    setMapping(guessMapping(csv.headers));
    setIncluded(new Set());
    setResult(null);
    setStep("map");
  };

  const setField = (column: number, field: FieldKey) =>
    setMapping((prev) =>
      prev.map((f, i) => (i === column ? field : field !== "skip" && f === field ? "skip" : f)),
    );

  const run = useMutation({
    meta: { silent: true },
    mutationFn: async (toSend: RowCheck[]) => {
      createdSoFar.current = 0;
      const skipped: Skipped[] = [];
      const keepDuplicates = toSend.some((r) => r.duplicateOf);
      const parts = Math.ceil(toSend.length / CHUNK);
      for (let i = 0; i < parts; i++) {
        const part = toSend.slice(i * CHUNK, (i + 1) * CHUNK);
        setProgress(parts > 1 ? `Part ${i + 1} of ${parts}` : null);
        const res = await api.post<ImportResultDto>("/clients/import", {
          rows: part.map((r) => r.input),
          skipDuplicates: !keepDuplicates,
        });
        createdSoFar.current += res.created;
        for (const s of res.skipped) {
          const r = part[s.row - 1];
          skipped.push({ line: r?.line ?? 0, name: r?.name ?? "", reason: s.reason });
        }
      }
      return { created: createdSoFar.current, skipped };
    },
    onSuccess: (res) => {
      const setAside: Skipped[] = rows
        .filter((r) => r.problem || (r.duplicateOf && !included.has(r.line)))
        .map((r) => ({ line: r.line, name: r.name, reason: r.problem ?? r.duplicateOf ?? "" }));
      setResult({
        created: res.created,
        skipped: [...setAside, ...res.skipped].sort((a, b) => a.line - b.line),
      });
      setStep("done");
      setProgress(null);
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: keys.today });
      notify({ tone: "success", title: `${plural(res.created, "client")} imported` });
    },
    onError: () => {
      setProgress(null);
      void qc.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  const toImport = rows.filter((r) => !r.problem && (!r.duplicateOf || included.has(r.line)));
  const runError = run.error
    ? `${errorMessage(run.error)}${
        createdSoFar.current
          ? ` ${plural(createdSoFar.current, "client")} were imported before it stopped; importing again skips them by email or phone.`
          : ""
      }`
    : null;

  const reset = () => {
    setSource(null);
    setMapping([]);
    setIncluded(new Set());
    setResult(null);
    setFileError(null);
    run.reset();
    setStep("file");
  };

  const reachable = (s: Step) =>
    s === "file"
      ? !run.isPending
      : s === "map"
        ? Boolean(source) && step !== "done" && !run.isPending
        : s === "review"
          ? Boolean(source) && hasName && step !== "done" && !run.isPending
          : Boolean(result);

  return (
    <>
      <ShellAside>
        <StepRail
          step={step}
          reachable={reachable}
          onStep={(s) => (s === "file" ? reset() : setStep(s))}
        />
      </ShellAside>
      <Page className="flex flex-col gap-5 pb-8">
        <PageHeader
          title="Import clients"
          subtitle="Bring your list over from a spreadsheet. Nothing is saved until the last step."
          actions={
            <a
              href={templateHref}
              download="coachman-clients-template.csv"
              className={buttonClass("light")}
            >
              <Download aria-hidden className="size-4.5" />
              Template
            </a>
          }
        />
        <div className="lg:hidden">
          <PhoneSteps step={step} />
        </div>

        {step === "file" ? (
          <FileStep onText={onText} error={fileError} templateHref={templateHref} />
        ) : null}
        {step === "map" && source ? (
          <MapStep
            csv={source.csv}
            fileName={source.name}
            mapping={mapping}
            onField={setField}
            onBack={reset}
            onNext={() => setStep("review")}
          />
        ) : null}
        {step === "review" && source ? (
          <ReviewStep
            rows={rows}
            included={included}
            onInclude={(line, on) =>
              setIncluded((prev) => {
                const next = new Set(prev);
                if (on) next.add(line);
                else next.delete(line);
                return next;
              })
            }
            onBack={() => setStep("map")}
            onImport={() => run.mutate(toImport)}
            isPending={run.isPending || existing.isPending}
            progress={existing.isPending ? "Checking for duplicates…" : progress}
            error={runError}
          />
        ) : null}
        {step === "done" && result ? (
          <ResultStep created={result.created} skipped={result.skipped}>
            <Link to="/clients" className={buttonClass("dark")}>
              <Users aria-hidden className="size-4.5" />
              View clients
            </Link>
            <Button
              variant="light"
              icon={<FileUp aria-hidden className="size-4.5" />}
              onPress={reset}
            >
              Import another file
            </Button>
          </ResultStep>
        ) : null}

        <ExportSection />
      </Page>
    </>
  );
}
