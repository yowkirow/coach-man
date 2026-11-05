import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CheckCircle2,
  Download,
  FileUp,
  Share,
  Smartphone,
  Sparkles,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button";
import { Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { ConfirmSheet } from "../../components/ui/overlay";
import { api, errorMessage } from "../../lib/api";
import { plural } from "../../lib/format";
import { useCan, useMe } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { clearLocalData, useOnline, usePendingChanges } from "../../lib/offline";
import { useInstallPrompt } from "../../lib/pwa";
import { OfflineNote } from "./offline";
import { SettingsSection } from "./sections";
import { SignOutButton } from "./sign-out";

/** Every file GET /export/:file offers. */
const EXPORTS = [
  { file: "clients.csv", label: "Clients", body: "Contacts, levels, tags, and credits left" },
  {
    file: "attendance.csv",
    label: "Attendance",
    body: "Every check-in and no-show, and what paid for it",
  },
  { file: "payments.csv", label: "Payments", body: "Amounts, methods, references, and voids" },
  { file: "charges.csv", label: "Charges", body: "Sessions, packages, events, and adjustments" },
  { file: "packages.csv", label: "Client packages", body: "Credits bought, left, and expiry" },
  { file: "workspace.json", label: "Everything", body: "A full backup of your academy" },
] as const;

function Block({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="py-5 first:pt-0 last:pb-0">
      <h3 className="text-[1.0625rem] font-medium">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-[60ch] text-[0.875rem] text-ink-2">{description}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function AppDataSection() {
  const me = useMe().data;
  const can = useCan();
  const online = useOnline();
  const pending = usePendingChanges();
  const install = useInstallPrompt();
  const qc = useQueryClient();
  const [confirmSample, setConfirmSample] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const removeSample = useMutation({
    meta: { silent: true },
    mutationFn: () => api.del<{ removed: number }>("/workspace/sample-data"),
    onSuccess: () => {
      // Sample clients reach every screen: lists, money, packages, the schedule.
      void qc.invalidateQueries();
      notify({
        tone: "success",
        title: "Sample data removed",
        body: "Your own clients and sessions weren't touched.",
      });
      setConfirmSample(false);
    },
  });

  const clearDevice = async () => {
    setClearing(true);
    try {
      await clearLocalData();
    } finally {
      window.location.reload();
    }
  };

  return (
    <SettingsSection
      id="app-data"
      title="App & data"
      description={
        can.data
          ? "Install CoachMan, take your data with you, and tidy up this device."
          : "Install CoachMan and tidy up this device."
      }
    >
      <div className="flex flex-col divide-y divide-line">
        <Block
          title="Install the app"
          description="Opens full screen, loads instantly, and works on court without signal."
        >
          {install.installed ? (
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 aria-hidden className="size-5" />
              Installed on this device.
            </p>
          ) : install.canPrompt ? (
            <Button
              variant="dark"
              icon={<Smartphone aria-hidden className="size-4.5" />}
              onPress={() => void install.prompt()}
            >
              Install CoachMan
            </Button>
          ) : install.ios ? (
            <p className="rounded-2xl bg-panel px-4 py-3 text-[0.9375rem]">
              In Safari, tap <Share aria-label="Share" className="inline size-4 align-[-2px]" />{" "}
              then “Add to Home Screen”.
            </p>
          ) : (
            <p className="rounded-2xl bg-panel px-4 py-3 text-[0.9375rem]">
              Use your browser's “Install app” option, in the address bar or the browser menu.
            </p>
          )}
        </Block>

        {can.data ? (
          <>
            <Block
              title="Export your data"
              description="Spreadsheet-ready CSVs, plus a full backup. Your data is yours, any time."
            >
              <ul className="-mx-2 grid gap-1 sm:grid-cols-2">
                {EXPORTS.map((x) => (
                  <li key={x.file}>
                    <a
                      href={`/api/v1/export/${x.file}`}
                      download
                      onClick={(e) => {
                        if (online) return;
                        e.preventDefault();
                        notify({ tone: "neutral", title: "Exports need a connection" });
                      }}
                      className="flex items-center gap-3 rounded-2xl px-2 py-2.5 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
                    >
                      <span
                        aria-hidden
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-panel text-ink"
                      >
                        <Download className="size-4.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{x.label}</span>
                          <Pill tone="outline">{x.file.endsWith(".json") ? "JSON" : "CSV"}</Pill>
                        </span>
                        <span className="block truncate text-[0.8125rem] text-ink-2">{x.body}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </Block>

            <Block title="Import clients" description="Bring your list over from a spreadsheet.">
              <Link
                to="/import"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-card px-5 font-medium text-ink ring-1 ring-line-strong outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <FileUp aria-hidden className="size-4.5" />
                Import from CSV
                <ArrowUpRight aria-hidden className="size-4 text-ink-2" />
              </Link>
            </Block>
          </>
        ) : null}

        {me?.hasSampleData && can.data ? (
          <Block
            title="Sample data"
            description="The clients tagged Sample, with their sessions, packages, and payments, are synthetic. Remove them once you're settled in."
          >
            <Button
              variant="light"
              icon={<Sparkles aria-hidden className="size-4.5" />}
              isDisabled={!online}
              onPress={() => {
                removeSample.reset();
                setConfirmSample(true);
              }}
            >
              Remove sample data
            </Button>
          </Block>
        ) : null}

        <Block
          title="This device"
          description="Clearing removes the offline copy CoachMan keeps on this device. Your academy's data stays safe on the server."
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="light"
              icon={<Trash2 aria-hidden className="size-4.5" />}
              onPress={() => setConfirmClear(true)}
            >
              Clear this device's data
            </Button>
            <SignOutButton />
          </div>
        </Block>
      </div>
      {can.data ? (
        <div className="mt-4">
          <OfflineNote>
            You're offline. Exports and removing sample data need a connection.
          </OfflineNote>
        </div>
      ) : null}

      <ConfirmSheet
        isOpen={confirmSample}
        onOpenChange={setConfirmSample}
        title="Remove sample data?"
        body={
          <div className="flex flex-col gap-3">
            <p>
              This deletes every client tagged Sample, with their sessions, packages, and payments.
              Anything you added yourself stays.
            </p>
            {removeSample.error ? (
              <InlineError>{errorMessage(removeSample.error)}</InlineError>
            ) : null}
          </div>
        }
        confirmLabel="Remove sample data"
        isPending={removeSample.isPending}
        onConfirm={() => {
          if (online) removeSample.mutate();
        }}
      />
      <ConfirmSheet
        isOpen={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear this device's data?"
        body={
          pending > 0
            ? `${plural(pending, "change")} from this device haven't synced yet and will be lost. Reconnect and wait for the sync first if you can. CoachMan reloads and downloads a fresh copy.`
            : "CoachMan reloads and downloads a fresh copy from the server. Nothing in your academy is deleted."
        }
        confirmLabel={pending > 0 ? "Clear anyway" : "Clear and reload"}
        isPending={clearing}
        onConfirm={() => void clearDevice()}
      />
    </SettingsSection>
  );
}
