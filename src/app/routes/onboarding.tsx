import type { MeDto, NotificationPrefDto, WorkspaceSettingsDto } from "@shared/api-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { BellRing, Check, KeyRound, Share, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";
import { AuthLayout } from "../components/auth-layout";
import { Button } from "../components/ui/button";
import { InlineError } from "../components/ui/feedback";
import { Checkbox, SelectField, TextField } from "../components/ui/field";
import { ApiRequestError, api, errorMessage } from "../lib/api";
import { authClient, defaultPasskeyName, passkeysSupported } from "../lib/auth-client";
import { meQuery, useMe } from "../lib/hooks";
import { notify } from "../lib/notify";
import { enablePush, pushSupported, useInstallPrompt } from "../lib/pwa";
import { keys } from "../lib/query";

type Step = "workspace" | "passkey" | "reminders";

export const Route = createFileRoute("/onboarding")({
  validateSearch: (s: Record<string, unknown>): { step?: Step } =>
    s.step === "passkey" || s.step === "reminders" ? { step: s.step } : {},
  beforeLoad: async ({ context, search }) => {
    let me: MeDto;
    try {
      me = await context.queryClient.ensureQueryData(meQuery);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401)
        throw redirect({ to: "/sign-in", search: { next: "/onboarding" } });
      return;
    }
    if (me.settings.onboardedAt && !search.step) throw redirect({ to: "/" });
  },
  component: Onboarding,
});

const STEPS: { id: Step; label: string; body: string }[] = [
  { id: "workspace", label: "Your workspace", body: "Name, currency, and time zone" },
  { id: "passkey", label: "Passkey", body: "One-tap sign-in on this device" },
  { id: "reminders", label: "Reminders", body: "Session alerts and the app icon" },
];

const CURRENCIES = [
  "USD",
  "PHP",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "NZD",
  "SGD",
  "HKD",
  "MYR",
  "IDR",
  "THB",
  "VND",
  "INR",
  "JPY",
  "KRW",
  "CNY",
  "AED",
  "ZAR",
  "MXN",
  "BRL",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
];

const REGION_CURRENCY: Record<string, string> = {
  US: "USD",
  PH: "PHP",
  GB: "GBP",
  AU: "AUD",
  CA: "CAD",
  NZ: "NZD",
  SG: "SGD",
  HK: "HKD",
  MY: "MYR",
  ID: "IDR",
  TH: "THB",
  VN: "VND",
  IN: "INR",
  JP: "JPY",
  KR: "KRW",
  CN: "CNY",
  AE: "AED",
  ZA: "ZAR",
  MX: "MXN",
  BR: "BRL",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  BE: "EUR",
  IE: "EUR",
  PT: "EUR",
  AT: "EUR",
  FI: "EUR",
  GR: "EUR",
};

const TZ_CURRENCY: Record<string, string> = {
  "Asia/Manila": "PHP",
  "Asia/Singapore": "SGD",
  "Asia/Tokyo": "JPY",
  "Europe/London": "GBP",
};

function guessCurrency(timezone: string): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
  } catch {
    // fall through
  }
  return (
    TZ_CURRENCY[timezone] ??
    (timezone.startsWith("Europe/") ? "EUR" : timezone.startsWith("Australia/") ? "AUD" : "USD")
  );
}

function Onboarding() {
  const { step = "workspace" } = Route.useSearch();
  const index = STEPS.findIndex((s) => s.id === step);
  return (
    <AuthLayout
      panel={
        <div className="mt-10 flex flex-1 flex-col lg:justify-end">
          <p className="max-w-[16ch] text-[2.25rem] leading-[1.04] font-light tracking-[-0.025em] lg:text-[3rem]">
            Three quick steps, then you're on court.
          </p>
          <ol className="mt-8 flex max-w-md flex-col gap-2.5">
            {STEPS.map((s, i) => {
              const done = i < index;
              const current = i === index;
              return (
                <li
                  key={s.id}
                  aria-current={current ? "step" : undefined}
                  className={`flex items-center gap-3 rounded-[22px] p-3.5 ${current ? "bg-lime text-ink" : "bg-night-2 text-night-ink"}`}
                >
                  <span
                    aria-hidden
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[0.875rem] font-semibold ${
                      current
                        ? "bg-ink text-lime"
                        : done
                          ? "bg-lime text-ink"
                          : "bg-night-3 text-night-ink-2"
                    }`}
                  >
                    {done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{s.label}</span>
                    <span
                      className={`block text-[0.8125rem] ${current ? "text-ink/70" : "text-night-ink-2"}`}
                    >
                      {done ? "Done" : s.body}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      }
    >
      {step === "workspace" ? (
        <WorkspaceStep />
      ) : step === "passkey" ? (
        <PasskeyStep />
      ) : (
        <RemindersStep />
      )}
    </AuthLayout>
  );
}

function WorkspaceStep() {
  const me = useMe().data;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const first = (me?.user.name ?? "").split(" ")[0];
  const [name, setName] = useState(
    me?.workspace.name && me.workspace.name !== "My coaching"
      ? me.workspace.name
      : first
        ? `${first}'s coaching`
        : "My coaching",
  );
  const [timezone, setTimezone] = useState(
    me?.settings.onboardedAt ? me.settings.timezone : detectedTz,
  );
  const [currency, setCurrency] = useState(
    me?.settings.onboardedAt ? me.settings.currency : guessCurrency(detectedTz),
  );
  const [sample, setSample] = useState(true);

  const currencyOptions = useMemo(() => {
    const names = new Intl.DisplayNames([navigator.language], { type: "currency" });
    const list = CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES];
    return list.map((c) => ({ id: c, label: `${c} · ${names.of(c) ?? c}` }));
  }, [currency]);
  const zoneOptions = useMemo(() => {
    const zones = Intl.supportedValuesOf("timeZone");
    return (zones.includes(timezone) ? zones : [timezone, ...zones]).map((z) => ({
      id: z,
      label: z.replaceAll("_", " "),
    }));
  }, [timezone]);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api.post<WorkspaceSettingsDto>("/workspace/onboard", {
        name: name.trim(),
        currency,
        timezone,
        locale: navigator.language,
        withSampleData: sample,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.me });
      void navigate({ to: "/onboarding", search: { step: "passkey" } });
    },
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save.mutate();
      }}
    >
      <div>
        <h1 className="text-[2rem] leading-tight font-light tracking-[-0.02em]">
          Set up your workspace
        </h1>
        <p className="mt-2 text-ink-2">
          Prices, reminders, and the schedule use these. You can change them later in Settings.
        </p>
      </div>
      <TextField
        label="Workspace name"
        value={name}
        onChange={setName}
        autoFocus
        description="Shown on statements you send to clients."
      />
      <SelectField
        label="Currency"
        options={currencyOptions}
        value={currency}
        onChange={setCurrency}
      />
      <SelectField
        label="Time zone"
        options={zoneOptions}
        value={timezone}
        onChange={setTimezone}
        description={timezone === detectedTz ? "Detected from this device." : undefined}
      />
      <div className="rounded-[22px] bg-panel px-4 py-3">
        <Checkbox isSelected={sample} onChange={setSample}>
          Add sample clients and sessions
        </Checkbox>
        <p className="mt-1 pl-9 text-[0.8125rem] text-ink-2">
          A safe sandbox to look around. Remove it with one tap in Settings.
        </p>
      </div>
      {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
      <Button
        type="submit"
        variant="dark"
        size="lg"
        isDisabled={!name.trim()}
        isPending={save.isPending}
      >
        Continue
      </Button>
    </form>
  );
}

function PasskeyStep() {
  const me = useMe().data;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = () => void navigate({ to: "/onboarding", search: { step: "reminders" } });
  const supported = passkeysSupported();
  const has = (me?.passkeyCount ?? 0) > 0;

  const add = async () => {
    setBusy(true);
    setError(null);
    const res = await authClient.passkey.addPasskey({ name: defaultPasskeyName() });
    setBusy(false);
    if (res?.error) {
      setError(
        /cancel|not allowed/i.test(res.error.message ?? "")
          ? "Passkey setup was cancelled. You can try again or skip for now."
          : (res.error.message ?? "Couldn't add a passkey."),
      );
      return;
    }
    await qc.invalidateQueries({ queryKey: keys.me });
    notify({ tone: "success", title: "Passkey added", body: "Next time, sign in with a tap." });
    next();
  };

  return (
    <div className="flex flex-col gap-5">
      <span className="flex size-14 items-center justify-center rounded-full bg-lime text-ink">
        <KeyRound aria-hidden className="size-6" />
      </span>
      <div>
        <h1 className="text-[2rem] leading-tight font-light tracking-[-0.02em]">Add a passkey</h1>
        <p className="mt-2 text-ink-2">
          {has
            ? "You already have a passkey. Add another for this device, or carry on."
            : "Sign in with your fingerprint, face, or screen lock instead of waiting on Google. Nothing to remember, nothing to phish."}
        </p>
      </div>
      {!supported ? (
        <InlineError>
          This browser can't create passkeys. You can add one later from another device in Settings.
        </InlineError>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="flex flex-col gap-2.5">
        <Button
          variant="dark"
          size="lg"
          isDisabled={!supported}
          isPending={busy}
          onPress={() => void add()}
        >
          {has ? "Add a passkey for this device" : "Add a passkey"}
        </Button>
        <Button variant="ghost" size="lg" onPress={next}>
          {has ? "Continue" : "Skip for now"}
        </Button>
      </div>
    </div>
  );
}

function RemindersStep() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const install = useInstallPrompt();
  const prefs = useQuery({
    queryKey: keys.notificationPrefs,
    queryFn: () => api.get<NotificationPrefDto>("/notification-prefs"),
  });
  const [pushState, setPushState] = useState<"idle" | "on" | "denied" | "unsupported">(
    pushSupported() ? "idle" : "unsupported",
  );
  const [busy, setBusy] = useState(false);

  const turnOn = async () => {
    const key = prefs.data?.vapidPublicKey;
    if (!key) {
      setPushState("unsupported");
      return;
    }
    setBusy(true);
    try {
      const result = await enablePush(key);
      setPushState(result === "granted" ? "on" : result);
      if (result === "granted") {
        await api.put("/notification-prefs", {
          sessionReminderMinutes: prefs.data?.sessionReminderMinutes ?? 30,
          dailyDigestTime: prefs.data?.dailyDigestTime ?? "07:00",
          packageExpiryDays: prefs.data?.packageExpiryDays ?? 7,
        });
      }
    } catch {
      setPushState("denied");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await qc.invalidateQueries({ queryKey: keys.today });
    void navigate({ to: "/" });
  };

  return (
    <div className="flex flex-col gap-5">
      <span className="flex size-14 items-center justify-center rounded-full bg-lime text-ink">
        <BellRing aria-hidden className="size-6" />
      </span>
      <div>
        <h1 className="text-[2rem] leading-tight font-light tracking-[-0.02em]">
          Stay a step ahead
        </h1>
        <p className="mt-2 text-ink-2">
          A nudge 30 minutes before each session and a short morning digest of who's coming and who
          owes.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-[22px] bg-panel p-4">
        {pushState === "on" ? (
          <p className="flex items-center gap-2 font-medium">
            <Check aria-hidden className="size-4.5" /> Reminders are on for this device.
          </p>
        ) : pushState === "unsupported" ? (
          <p className="text-[0.9375rem] text-ink-2">
            {prefs.isPending
              ? "Checking this device…"
              : "Push reminders aren't available in this browser. Install CoachMan to your home screen, then turn them on in Settings."}
          </p>
        ) : pushState === "denied" ? (
          <p className="text-[0.9375rem] text-ink-2">
            Notifications are blocked for CoachMan. Allow them in your browser's site settings, then
            try again from Settings.
          </p>
        ) : (
          <Button
            variant="dark"
            icon={<BellRing aria-hidden className="size-4.5" />}
            isPending={busy}
            isDisabled={prefs.isPending}
            onPress={() => void turnOn()}
          >
            Turn on reminders
          </Button>
        )}
      </div>

      {!install.installed ? (
        <div className="flex flex-col gap-3 rounded-[22px] bg-panel p-4">
          <p className="flex items-center gap-2 font-medium">
            <Smartphone aria-hidden className="size-4.5" /> Put CoachMan on your home screen
          </p>
          {install.canPrompt ? (
            <Button variant="light" onPress={() => void install.prompt()}>
              Install app
            </Button>
          ) : install.ios ? (
            <p className="text-[0.9375rem] text-ink-2">
              In Safari, tap <Share aria-label="Share" className="inline size-4 align-[-2px]" />{" "}
              then “Add to Home Screen”. It opens full screen and works offline.
            </p>
          ) : (
            <p className="text-[0.9375rem] text-ink-2">
              Use your browser's “Install app” option. It opens full screen and works offline on
              court.
            </p>
          )}
        </div>
      ) : null}

      <Button variant="dark" size="lg" onPress={() => void finish()}>
        Go to Today
      </Button>
    </div>
  );
}
