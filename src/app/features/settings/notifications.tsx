import type { NotificationPrefDto } from "@shared/api-types";
import { notificationPrefSchema } from "@shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { Segmented, Switch, TextField } from "../../components/ui/field";
import { api, errorMessage } from "../../lib/api";
import { plural } from "../../lib/format";
import { useCan } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { disablePush, enablePush, pushDeviceState, pushSupported } from "../../lib/pwa";
import { keys } from "../../lib/query";
import { OfflineNote } from "./offline";
import { SaveBar, SettingsSection } from "./sections";
import { issuesToFields } from "./validation";

type Device = "checking" | "on" | "off";
type Permission = NotificationPermission | "unsupported";

const REMINDERS = [
  { id: "off", label: "Off" },
  { id: "15", label: "15" },
  { id: "30", label: "30" },
  { id: "60", label: "60" },
];
const EXPIRY = ["3", "7", "14", "30"];

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function permissionNow(): Permission {
  return pushSupported() ? Notification.permission : "unsupported";
}

interface PrefDraft {
  reminder: string;
  digestOn: boolean;
  digestTime: string;
  expiryDays: string;
  enrollmentAlerts: boolean;
}

function draftOf(p: NotificationPrefDto): PrefDraft {
  return {
    reminder: p.sessionReminderMinutes ? String(p.sessionReminderMinutes) : "off",
    digestOn: Boolean(p.dailyDigestTime),
    digestTime: p.dailyDigestTime ?? "07:00",
    expiryDays: String(p.packageExpiryDays),
    enrollmentAlerts: p.enrollmentAlerts ?? true,
  };
}

export function NotificationsSection() {
  const online = useOnline();
  const can = useCan();
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: keys.notificationPrefs,
    queryFn: () => api.get<NotificationPrefDto>("/notification-prefs"),
  });
  const [device, setDevice] = useState<Device>("checking");
  // This browser also gets family reminders (the portal registered it): turning staff push off
  // keeps the browser subscribed for those, and says so.
  const [familyOn, setFamilyOn] = useState(false);
  const [permission, setPermission] = useState<Permission>(permissionNow);
  const [draft, setDraft] = useState<PrefDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const savedKey = prefs.data ? JSON.stringify(draftOf(prefs.data)) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed when the saved prefs change.
  useEffect(() => {
    if (prefs.data) setDraft(draftOf(prefs.data));
  }, [savedKey]);
  const dirty = draft !== null && savedKey !== null && JSON.stringify(draft) !== savedKey;

  useEffect(() => {
    let alive = true;
    if (!pushSupported()) {
      setDevice("off");
      return;
    }
    withTimeout(pushDeviceState("staff"), 5000, "timeout")
      .then((state) => {
        if (!alive) return;
        setDevice(state.staff ? "on" : "off");
        setFamilyOn(state.family);
      })
      .catch(() => alive && setDevice("off"));
    return () => {
      alive = false;
    };
  }, []);

  const turnOn = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      const key = prefs.data?.vapidPublicKey;
      if (!key) throw new Error("Reminders aren't set up on the server yet.");
      return withTimeout(
        enablePush(key),
        20_000,
        "This browser didn't finish setting up push. Install CoachMan to your home screen, or try another browser.",
      );
    },
    onSettled: () => setPermission(permissionNow()),
    onSuccess: (result) => {
      if (result !== "granted") return;
      setDevice("on");
      void qc.invalidateQueries({ queryKey: keys.notificationPrefs });
      notify({ tone: "success", title: "Push is on for this device" });
    },
  });
  const turnOff = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      withTimeout(disablePush("staff"), 10_000, "This browser didn't respond. Try again."),
    onSuccess: ({ otherOn }) => {
      setDevice("off");
      setFamilyOn(otherOn);
      void qc.invalidateQueries({ queryKey: keys.notificationPrefs });
      notify(
        otherOn
          ? {
              tone: "neutral",
              title: "Coach notifications are off for this device",
              body: "Family reminders stay on here. Turn them off in My family, Notifications.",
            }
          : { tone: "neutral", title: "Push is off for this device" },
      );
    },
  });
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: unknown) => api.put("/notification-prefs", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.notificationPrefs });
      notify({ tone: "success", title: "Notifications saved" });
    },
  });
  const test = useMutation({
    meta: { silent: true },
    mutationFn: () => api.post<{ delivered: number }>("/push/test"),
    onSuccess: ({ delivered }) =>
      notify(
        delivered > 0
          ? {
              tone: "success",
              title: "Test sent",
              body: `Sent to ${plural(delivered, "device")}. It should arrive in a moment.`,
            }
          : {
              tone: "neutral",
              title: "No devices to send to",
              body: "Turn on push for this device first.",
            },
      ),
  });

  const reminderOptions = useMemo(() => {
    const current = draft?.reminder;
    return current && !REMINDERS.some((r) => r.id === current)
      ? [...REMINDERS, { id: current, label: current }]
      : REMINDERS;
  }, [draft?.reminder]);
  const expiryOptions = useMemo(() => {
    const list =
      draft?.expiryDays && !EXPIRY.includes(draft.expiryDays)
        ? [...EXPIRY, draft.expiryDays].sort((a, b) => Number(a) - Number(b))
        : EXPIRY;
    return list.map((d) => ({ id: d, label: d }));
  }, [draft?.expiryDays]);

  const submit = () => {
    if (!draft) return;
    const parsed = notificationPrefSchema.safeParse({
      sessionReminderMinutes: draft.reminder === "off" ? null : Number(draft.reminder),
      dailyDigestTime: draft.digestOn ? draft.digestTime : null,
      packageExpiryDays: Number(draft.expiryDays),
      enrollmentAlerts: draft.enrollmentAlerts,
    });
    if (!parsed.success) {
      setErrors(
        issuesToFields(parsed.error.issues, { dailyDigestTime: "Pick a time for the digest." }),
      );
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };
  const set = <K extends keyof PrefDraft>(k: K, v: PrefDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const noServer = prefs.data ? prefs.data.vapidPublicKey === null : false;
  const deviceText = !pushSupported()
    ? "This browser can't show push notifications. On iPhone, add CoachMan to your Home Screen first."
    : noServer
      ? "Reminders aren't set up on the server yet."
      : permission === "denied"
        ? "Blocked in this browser. Allow notifications for CoachMan in your site settings, then turn it on here."
        : device === "checking"
          ? "Checking this device…"
          : device === "on"
            ? "On for this device."
            : familyOn
              ? "Off for coach notifications. This device gets your family reminders."
              : permission === "granted"
                ? "Off for this device. Notifications are allowed in this browser."
                : "Off for this device. Your browser will ask for permission.";
  const canToggle =
    pushSupported() && !noServer && permission !== "denied" && device !== "checking";
  const deviceError = turnOn.error ?? turnOff.error;

  return (
    <SettingsSection
      id="notifications"
      title="Notifications"
      description="Push reminders on your phone or laptop. Each device you turn on gets them."
    >
      {prefs.isPending || (prefs.data && !draft) ? (
        <RowsSkeleton rows={2} />
      ) : prefs.isError || !prefs.data || !draft ? (
        <ErrorState
          title="Couldn't load notification settings"
          message={errorMessage(prefs.error)}
          onRetry={() => void prefs.refetch()}
        />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (online && dirty) submit();
          }}
        >
          <div className="flex flex-wrap items-center gap-3 rounded-[22px] bg-panel p-4">
            <span
              aria-hidden
              className={`flex size-11 shrink-0 items-center justify-center rounded-full ${device === "on" ? "bg-lime" : "bg-card"} text-ink`}
            >
              {device === "on" ? <BellRing className="size-5" /> : <BellOff className="size-5" />}
            </span>
            <div className="min-w-0 flex-1 basis-[14rem]">
              <p className="font-medium">Push on this device</p>
              <p role="status" className="text-[0.875rem] text-ink-2">
                {deviceText}
              </p>
              {prefs.data.subscriptions > 0 ? (
                <p className="num text-[0.8125rem] text-ink-2">
                  Reminders go to {plural(prefs.data.subscriptions, "device")}.
                </p>
              ) : null}
            </div>
            {canToggle ? (
              device === "on" ? (
                <Button
                  variant="light"
                  isDisabled={!online}
                  isPending={turnOff.isPending}
                  onPress={() => turnOff.mutate()}
                >
                  Turn off
                </Button>
              ) : (
                <Button
                  variant="dark"
                  icon={<BellRing aria-hidden className="size-4.5" />}
                  isDisabled={!online}
                  isPending={turnOn.isPending}
                  onPress={() => turnOn.mutate()}
                >
                  Turn on
                </Button>
              )
            ) : null}
          </div>
          {deviceError ? (
            <div className="mt-3">
              <InlineError>{errorMessage(deviceError)}</InlineError>
            </div>
          ) : null}
          {turnOn.data === "denied" && permission !== "denied" ? (
            <div className="mt-3">
              <InlineError>
                Notifications are blocked for CoachMan. Allow them in your browser's site settings,
                then try again.
              </InlineError>
            </div>
          ) : null}

          <div className="mt-2 flex flex-col divide-y divide-line">
            <div className="py-4">
              <Segmented
                label="Session reminders (minutes before)"
                options={reminderOptions}
                value={draft.reminder}
                onChange={(v) => set("reminder", v)}
              />
              <p className="mt-1.5 text-[0.8125rem] text-ink-2">
                {draft.reminder === "off"
                  ? "No nudge before sessions."
                  : `A nudge ${draft.reminder} minutes before each session you're coaching.`}
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3 py-4">
              <div className="min-w-0 flex-1 basis-[16rem]">
                <Switch
                  isSelected={draft.digestOn}
                  onChange={(v) => set("digestOn", v)}
                  description={
                    can.money
                      ? "Who's coming today, low credits, and who owes, first thing."
                      : "Who's coming today and packages about to expire, first thing."
                  }
                >
                  Morning digest
                </Switch>
              </div>
              {draft.digestOn ? (
                <TextField
                  label="Send at"
                  type="time"
                  value={draft.digestTime}
                  onChange={(v) => set("digestTime", v)}
                  error={errors.dailyDigestTime}
                  className="w-40"
                />
              ) : null}
            </div>
            <div className={can.enrollment ? "py-4" : "pt-4"}>
              <Segmented
                label="Package expiry warning (days before)"
                options={expiryOptions}
                value={draft.expiryDays}
                onChange={(v) => set("expiryDays", v)}
              />
              <p className="mt-1.5 text-[0.8125rem] text-ink-2">
                Flags a client's package {draft.expiryDays} days before it expires.
              </p>
            </div>
            {can.enrollment ? (
              <div className="pt-4">
                <Switch
                  isSelected={draft.enrollmentAlerts}
                  onChange={(v) => set("enrollmentAlerts", v)}
                  description="A push for each new enrollment request and each payment proof to review."
                >
                  Enrollments & payments
                </Switch>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="light"
              icon={<Send aria-hidden className="size-4.5" />}
              isDisabled={!online || noServer}
              isPending={test.isPending}
              onPress={() => test.mutate()}
            >
              Send a test notification
            </Button>
            {noServer ? (
              <p className="text-[0.8125rem] text-ink-2">Available once the server is set up.</p>
            ) : null}
          </div>
          {test.error ? (
            <div className="mt-3">
              <InlineError>{errorMessage(test.error)}</InlineError>
            </div>
          ) : null}
          {save.error ? (
            <div className="mt-3">
              <InlineError>{errorMessage(save.error)}</InlineError>
            </div>
          ) : null}
          <div className="mt-3">
            <OfflineNote />
          </div>
          <SaveBar
            dirty={dirty}
            onDiscard={() => {
              if (prefs.data) setDraft(draftOf(prefs.data));
              setErrors({});
              save.reset();
            }}
            isPending={save.isPending}
            disabled={!online}
          />
        </form>
      )}
    </SettingsSection>
  );
}
