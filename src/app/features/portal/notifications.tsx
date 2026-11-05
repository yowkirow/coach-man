import type { FamilyNotificationsDto, PushTestResultDto } from "@shared/api-types";
import {
  FAMILY_CATEGORIES,
  FAMILY_CATEGORY_HINTS,
  FAMILY_CATEGORY_LABELS,
  type FamilyCategory,
  type FamilyPrefs,
  SESSION_LEADS,
  type SessionLead,
} from "@shared/notifications";
import { TIME_RE } from "@shared/time";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BellOff,
  BellRing,
  CalendarDays,
  Compass,
  type LucideIcon,
  Megaphone,
  Moon,
  Package,
  Send,
  Share,
  SquarePlus,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import { Segmented, Switch, TextField } from "../../components/ui/field";
import { errorMessage, portalApi } from "../../lib/api";
import { plural } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import {
  disablePush,
  enablePush,
  isInAppBrowser,
  isIOS,
  type PushSupport,
  pushDeviceState,
  pushSupport,
} from "../../lib/pwa";
import { keys } from "../../lib/query";
import { PortalCard, QueryGate } from "./bits";
import { usePortalAccount } from "./queries";
import { PortalPage } from "./shell";

const CATEGORY_ICONS: Record<FamilyCategory, LucideIcon> = {
  sessions: CalendarDays,
  packages: Package,
  enrollment: Wallet,
  progress: TrendingUp,
  announcements: Megaphone,
};

/** Short on screen (three fit a phone), complete for screen readers. */
const LEAD_OPTIONS: Record<SessionLead, ReactNode> = {
  "1h": (
    <span className="whitespace-nowrap">
      1 hour<span className="sr-only"> before</span>
    </span>
  ),
  "2h": (
    <span className="whitespace-nowrap">
      2 hours<span className="sr-only"> before</span>
    </span>
  ),
  evening: (
    <span className="whitespace-nowrap">
      Evening<span className="sr-only"> before, at 7pm</span>
    </span>
  ),
};

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/** The signed-in person's family notification settings (refetched when the page opens). */
export function useFamilyNotifications() {
  const userId = usePortalAccount().data?.user.id ?? "";
  return useQuery({
    queryKey: keys.portal.notifications(userId),
    queryFn: () => portalApi.get<FamilyNotificationsDto>("/notifications"),
    enabled: Boolean(userId),
    staleTime: 0,
  });
}

type DeviceState = "checking" | "on" | "off";

/**
 * This browser and family notifications: whether it can get them at all (iPhone needs the Home
 * Screen app), whether it's on, and whether the staff app uses it too (coach and parent on one
 * phone: turning one off leaves the other on).
 */
function useThisDevice(enabled: boolean) {
  const support = pushSupport();
  const [state, setState] = useState<DeviceState>(support === "ok" ? "checking" : "off");
  const [coachOn, setCoachOn] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(() =>
    support === "ok" ? Notification.permission : null,
  );
  useEffect(() => {
    if (support !== "ok" || !enabled) return;
    let alive = true;
    withTimeout(pushDeviceState("family"), 5000, "timeout")
      .then((s) => {
        if (!alive) return;
        setState(s.family ? "on" : "off");
        setCoachOn(s.staff);
      })
      .catch(() => alive && setState("off"));
    return () => {
      alive = false;
    };
  }, [support, enabled]);
  return { support, state, setState, coachOn, setCoachOn, permission, setPermission };
}

function StepIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-panel text-ink"
    >
      <Icon className="size-4.5" strokeWidth={1.75} />
    </span>
  );
}

/** iPhone and iPad: push works only in the app added to the Home Screen (iOS 16.4 or later). */
function InstallSteps() {
  const inApp = isInAppBrowser();
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[60ch] text-[0.9375rem]">
        On iPhone and iPad, reminders work once CoachMan is on your Home Screen. It takes three
        steps, and needs iOS 16.4 or later.
      </p>
      <ol className="flex flex-col gap-3" aria-label="Add CoachMan to your Home Screen">
        <li className="flex items-start gap-3">
          <StepIcon icon={Compass} />
          <span className="pt-1.5 text-[0.9375rem]">
            <span className="sr-only">Step 1: </span>
            Open this page in Safari.
            {inApp ? (
              <span className="block text-[0.8125rem] text-ink-2">
                You're in Messenger or Viber's browser: tap the menu, then Open in Safari.
              </span>
            ) : null}
          </span>
        </li>
        <li className="flex items-start gap-3">
          <StepIcon icon={Share} />
          <span className="pt-1.5 text-[0.9375rem]">
            <span className="sr-only">Step 2: </span>
            Tap Share, then Add to Home Screen.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <StepIcon icon={SquarePlus} />
          <span className="pt-1.5 text-[0.9375rem]">
            <span className="sr-only">Step 3: </span>
            Open CoachMan from your Home Screen, come back to Notifications, and turn them on.
          </span>
        </li>
      </ol>
    </div>
  );
}

const SUPPORT_TEXT: Partial<Record<PushSupport, string>> = {
  "ios-update":
    "This iPhone or iPad needs iOS 16.4 or later for reminders. Update it in Settings, General, Software Update, then come back here.",
  "in-app":
    "Messenger and Viber's built-in browser can't show notifications. Open this page in Chrome or your phone's own browser, then turn them on there.",
  unsupported:
    "This browser can't show notifications. Open CoachMan in Chrome, Edge, Firefox, or Safari to get reminders.",
};

/** "This device": turn family notifications on or off here, send a test, or learn why it can't. */
function DeviceCard({ data }: { data: FamilyNotificationsDto }) {
  const online = useOnline();
  const qc = useQueryClient();
  const userId = usePortalAccount().data?.user.id ?? "";
  const noServer = data.vapidPublicKey === null;
  const device = useThisDevice(!noServer);
  const [coachNote, setCoachNote] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.portal.notifications(userId) });

  const turnOn = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      if (!data.vapidPublicKey) throw new Error("Notifications aren't set up on this server yet.");
      return withTimeout(
        enablePush(data.vapidPublicKey, "family"),
        20_000,
        "This browser didn't finish turning notifications on. Try again, or try another browser.",
      );
    },
    onSettled: () => {
      if (device.support === "ok") device.setPermission(Notification.permission);
    },
    onSuccess: (result) => {
      if (result !== "granted") return;
      device.setState("on");
      setCoachNote(false);
      refresh();
      notify({ tone: "success", title: "Reminders are on for this device" });
    },
  });
  const turnOff = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      withTimeout(disablePush("family"), 10_000, "This browser didn't respond. Try again."),
    onSuccess: ({ otherOn }) => {
      device.setState("off");
      device.setCoachOn(otherOn);
      setCoachNote(otherOn);
      refresh();
      notify({ tone: "neutral", title: "Reminders are off for this device" });
    },
  });
  const test = useMutation({
    meta: { silent: true },
    mutationFn: () => portalApi.post<PushTestResultDto>("/notifications/test"),
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
              body: "Turn reminders on for this device first.",
            },
      ),
  });

  const { support, state, permission } = device;
  const on = support === "ok" && state === "on";
  const blocked = support === "ok" && permission === "denied" && !on;
  let status: ReactNode;
  if (noServer) status = "Notifications aren't set up on this server yet.";
  else if (support === "ios-install")
    status = "Not on yet: add CoachMan to your Home Screen first.";
  else if (support !== "ok") status = SUPPORT_TEXT[support];
  else if (state === "checking") status = "Checking this device…";
  else if (on) status = "On for this device. You get what you choose below.";
  else if (blocked) {
    status =
      "Notifications are blocked for CoachMan in this browser. Allow them in the browser's site settings, then turn them on here.";
  } else status = "Off for this device.";
  const canToggle = support === "ok" && !noServer && state !== "checking" && !blocked;
  const deviceError = turnOn.error ?? turnOff.error ?? test.error;

  return (
    <PortalCard title="This device">
      <div className="flex flex-col gap-4">
        <div
          className={`flex flex-wrap items-center gap-3 rounded-[22px] p-4 ${on ? "bg-lime" : "bg-panel"}`}
        >
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-ink"
          >
            {on ? <BellRing className="size-5" /> : <BellOff className="size-5" />}
          </span>
          <div className="min-w-0 flex-1 basis-[13rem]">
            <p className="font-medium">Reminders on this device</p>
            <p role="status" className={`text-[0.875rem] ${on ? "text-ink/75" : "text-ink-2"}`}>
              {status}
            </p>
          </div>
          {canToggle && !on ? (
            <Button
              variant="dark"
              icon={<BellRing aria-hidden className="size-4.5" />}
              isDisabled={!online}
              isPending={turnOn.isPending}
              onPress={() => {
                turnOff.reset();
                test.reset();
                turnOn.mutate();
              }}
            >
              Turn on
            </Button>
          ) : null}
        </div>

        {support === "ios-install" && !noServer ? <InstallSteps /> : null}

        {on ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="light"
              size="sm"
              icon={<Send aria-hidden className="size-4" />}
              isDisabled={!online}
              isPending={test.isPending}
              onPress={() => test.mutate()}
            >
              Send a test notification
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={!online}
              isPending={turnOff.isPending}
              onPress={() => {
                test.reset();
                turnOff.mutate();
              }}
            >
              Turn off
            </Button>
          </div>
        ) : null}

        {turnOn.data === "denied" && !blocked ? (
          <InlineError>
            Notifications weren't allowed. Allow them for CoachMan in your browser's site settings,
            then try again.
          </InlineError>
        ) : null}
        {deviceError ? <InlineError>{errorMessage(deviceError)}</InlineError> : null}

        {coachNote ? (
          <p role="status" className="rounded-[16px] bg-amber-soft px-4 py-3 text-[0.875rem]">
            Coach notifications stay on for this device. Turn them off in the coach app, under
            Settings, Notifications.
          </p>
        ) : device.coachOn && !on && support === "ok" ? (
          <p className="text-[0.8125rem] text-ink-2">
            Coach notifications are on for this device. Turning these on adds your family's
            reminders.
          </p>
        ) : null}

        <div className="flex flex-col gap-1 border-t border-line pt-4 text-[0.8125rem] text-ink-2">
          {data.devices > 0 ? (
            <p className="num">Your family reminders go to {plural(data.devices, "device")}.</p>
          ) : null}
          <p>
            CoachMan reminds you only with notifications on the devices you turn on. There are no
            emails or text messages.
          </p>
        </div>
      </div>
    </PortalCard>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";
type Scope = "categories" | "quiet";

/**
 * The settings a person changes on this page, saved as they change them (one request at a time,
 * always the latest choices). Times save once they're valid; until then the field says why.
 */
function usePrefsEditor(data: FamilyNotificationsDto) {
  const qc = useQueryClient();
  const userId = usePortalAccount().data?.user.id ?? "";
  const [draft, setDraft] = useState<FamilyPrefs>(data.prefs);
  const [status, setStatus] = useState<SaveState>("idle");
  // Which card's change is saving, so only that card says "Saved".
  const [scope, setScope] = useState<Scope>("categories");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(draft);
  // Choices made here that the server hasn't confirmed yet (waiting, saving, or failed).
  const dirty = useRef(false);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Remembered when quiet hours are switched off, so switching them back on restores them.
  const lastQuiet = useRef({
    start: data.prefs.quietStart ?? "21:00",
    end: data.prefs.quietEnd ?? "07:00",
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // A newer copy from the server (the saved copy refreshed as the page opens, or a change made on
  // another device) replaces what's shown, unless this page has changes of its own on the way.
  useEffect(() => {
    if (dirty.current) return;
    latest.current = data.prefs;
    setDraft(data.prefs);
    if (data.prefs.quietStart && data.prefs.quietEnd) {
      lastQuiet.current = { start: data.prefs.quietStart, end: data.prefs.quietEnd };
    }
  }, [data.prefs]);

  const flush = () => {
    timer.current = null;
    setStatus("saving");
    chain.current = chain.current.then(async () => {
      const body = latest.current;
      try {
        const res = await portalApi.put<FamilyNotificationsDto>("/notifications", body);
        const settled = latest.current === body;
        if (settled) dirty.current = false;
        qc.setQueryData(keys.portal.notifications(userId), res);
        if (settled) {
          setStatus("saved");
          setError(null);
        }
      } catch (err) {
        setStatus("error");
        setError(errorMessage(err));
      }
    });
  };

  const quietProblem = (p: FamilyPrefs): string | null => {
    if (p.quietStart === null && p.quietEnd === null) return null;
    if (!p.quietStart || !TIME_RE.test(p.quietStart) || !p.quietEnd || !TIME_RE.test(p.quietEnd)) {
      return "Pick when quiet hours start and end.";
    }
    if (p.quietStart === p.quietEnd) return "Quiet hours need to end at a different time.";
    return null;
  };

  const update = (patch: Partial<FamilyPrefs>, where: Scope, wait = 0) => {
    const next = { ...latest.current, ...patch };
    dirty.current = true;
    latest.current = next;
    setDraft(next);
    setScope(where);
    if (next.quietStart && next.quietEnd) {
      lastQuiet.current = { start: next.quietStart, end: next.quietEnd };
    }
    if (timer.current) clearTimeout(timer.current);
    if (quietProblem(next)) {
      setStatus("idle");
      return;
    }
    if (wait) timer.current = setTimeout(flush, wait);
    else flush();
  };

  return {
    draft,
    update,
    statusOf: (where: Scope): SaveState => (scope === where ? status : "idle"),
    error,
    quietProblem: quietProblem(draft),
    lastQuiet,
    retry: flush,
  };
}

function SaveStatus({ status }: { status: SaveState }) {
  return (
    <span role="status" className="text-[0.8125rem] text-ink-2">
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
    </span>
  );
}

function CategoryRow({
  category,
  draft,
  disabled,
  onChange,
}: {
  category: FamilyCategory;
  draft: FamilyPrefs;
  disabled: boolean;
  onChange: (patch: Partial<FamilyPrefs>) => void;
}) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <li className="py-3 first:pt-1 last:pb-1">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-panel text-ink"
        >
          <Icon className="size-4.5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <Switch
            isSelected={draft[category]}
            isDisabled={disabled}
            onChange={(v) => onChange({ [category]: v })}
            description={FAMILY_CATEGORY_HINTS[category]}
          >
            {FAMILY_CATEGORY_LABELS[category]}
          </Switch>
        </div>
      </div>
      {category === "sessions" && draft.sessions ? (
        // Full width on phones, so three choices fit on one line; under the label from sm up.
        <div className="mt-2 mb-1 sm:pl-13">
          <Segmented
            label="Remind me before each session"
            options={SESSION_LEADS.map((id) => ({ id, label: LEAD_OPTIONS[id] }))}
            value={draft.sessionLead}
            onChange={(v) => onChange({ sessionLead: v as SessionLead })}
          />
          <p className="mt-1.5 text-[0.8125rem] text-ink-2">
            Evening means 7pm the day before, academy time. A reminder that would land in quiet
            hours comes before they start, or as they end.
          </p>
        </div>
      ) : null}
    </li>
  );
}

/** The family's notification settings: this device, what they get, and quiet hours. */
export function PortalNotifications() {
  const settings = useFamilyNotifications();
  const dismissed = useRef(false);
  // Opening this page counts as seeing Home's one-time offer.
  useEffect(() => {
    if (!settings.data || settings.data.promptDismissed || dismissed.current) return;
    dismissed.current = true;
    void portalApi.post("/notifications/prompt-dismissed").catch(() => undefined);
  }, [settings.data]);
  return (
    <PortalPage
      title="Notifications"
      subtitle="Reminders and news from your academy, on the devices you choose."
    >
      <QueryGate query={settings}>{(data) => <NotificationSettings data={data} />}</QueryGate>
    </PortalPage>
  );
}

function NotificationSettings({ data }: { data: FamilyNotificationsDto }) {
  const online = useOnline();
  const editor = usePrefsEditor(data);
  const { draft, update } = editor;
  const quietOn = draft.quietStart !== null || draft.quietEnd !== null;
  const disabled = !online;
  // Phones: this device, what you get, quiet hours. Laptops: the device and quiet hours on the
  // left, the categories (the longest card) on the right.
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:items-start lg:gap-6">
      <div className="lg:col-start-1 lg:row-start-1">
        <DeviceCard data={data} />
      </div>
      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <PortalCard
          title="What you get"
          action={<SaveStatus status={editor.statusOf("categories")} />}
        >
          <ul className="flex flex-col divide-y divide-line">
            {FAMILY_CATEGORIES.map((c) => (
              <CategoryRow
                key={c}
                category={c}
                draft={draft}
                disabled={disabled}
                onChange={(patch) => update(patch, "categories")}
              />
            ))}
          </ul>
        </PortalCard>
      </div>
      <div className="flex flex-col gap-5 lg:col-start-1 lg:row-start-2">
        <PortalCard title="Quiet hours" action={<SaveStatus status={editor.statusOf("quiet")} />}>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-1.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-panel text-ink"
              >
                <Moon className="size-4.5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <Switch
                  isSelected={quietOn}
                  isDisabled={disabled}
                  onChange={(v) =>
                    update(
                      v
                        ? {
                            quietStart: editor.lastQuiet.current.start,
                            quietEnd: editor.lastQuiet.current.end,
                          }
                        : { quietStart: null, quietEnd: null },
                      "quiet",
                    )
                  }
                  description="Nothing buzzes overnight. News waits until quiet hours end; session reminders are timed around them where possible."
                >
                  Use quiet hours
                </Switch>
              </div>
            </div>
            {quietOn ? (
              <div className="grid grid-cols-2 gap-3 sm:max-w-[22rem]">
                <TextField
                  label="From"
                  type="time"
                  value={draft.quietStart ?? ""}
                  isDisabled={disabled}
                  onChange={(v) => update({ quietStart: v || null }, "quiet", 700)}
                  error={!draft.quietStart ? (editor.quietProblem ?? undefined) : undefined}
                />
                <TextField
                  label="Until"
                  type="time"
                  value={draft.quietEnd ?? ""}
                  isDisabled={disabled}
                  onChange={(v) => update({ quietEnd: v || null }, "quiet", 700)}
                  error={draft.quietStart ? (editor.quietProblem ?? undefined) : undefined}
                />
              </div>
            ) : null}
            <p className="text-[0.8125rem] text-ink-2">
              Times are your academy's ({data.timezone.replace(/_/g, " ")}).
            </p>
          </div>
        </PortalCard>
        {editor.error ? (
          <div className="flex flex-col gap-2">
            <InlineError>Your last change wasn't saved: {editor.error}</InlineError>
            <Button
              variant="light"
              size="sm"
              className="self-start"
              isDisabled={!online}
              onPress={() => editor.retry()}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {!online ? (
          <p className="px-1 text-[0.8125rem] text-ink-2">
            You're offline. Changes to notifications need a connection.
          </p>
        ) : null}
        {data.staff ? (
          <p className="px-1 text-[0.8125rem] text-ink-2">
            Coach notifications (your sessions as a coach, the morning digest) are set in the coach
            app, under Settings, Notifications.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Home's one-time offer, "Get reminders on this phone": shown until it's dismissed or the
 * settings are opened, never on a device that already gets them, and only where reminders can
 * work (or iPhone, where the settings page explains Add to Home Screen).
 */
export function RemindersPrompt() {
  const settings = useFamilyNotifications();
  const userId = usePortalAccount().data?.user.id ?? "";
  const qc = useQueryClient();
  const support = pushSupport();
  const usable = support === "ok" || support === "ios-install";
  const [deviceOn, setDeviceOn] = useState<boolean | null>(support === "ok" ? null : false);
  const [hidden, setHidden] = useState(false);
  const data = settings.data;
  const show = Boolean(data && !data.promptDismissed && data.vapidPublicKey && usable && !hidden);
  useEffect(() => {
    if (!show || support !== "ok") return;
    let alive = true;
    withTimeout(pushDeviceState("family"), 5000, "timeout")
      .then((s) => alive && setDeviceOn(s.family))
      .catch(() => alive && setDeviceOn(false));
    return () => {
      alive = false;
    };
  }, [show, support]);
  const dismiss = useMutation({
    meta: { silent: true },
    mutationFn: () => portalApi.post("/notifications/prompt-dismissed"),
    onMutate: () => setHidden(true),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.portal.notifications(userId) }),
  });
  if (!show || deviceOn !== false) return null;
  const phone =
    isIOS() || /Android|Mobi/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent);
  return (
    <section
      aria-labelledby="reminders-offer"
      className="flex flex-col gap-4 rounded-[28px] bg-card p-5 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lime text-ink"
        >
          <BellRing className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="reminders-offer" className="text-[1.125rem] font-medium">
            {phone ? "Get reminders on this phone" : "Get reminders on this computer"}
          </h2>
          <p className="mt-0.5 max-w-[52ch] text-[0.875rem] text-ink-2">
            Before each session, and when the academy has news. You choose which, and when it's
            quiet.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-15 sm:pl-0">
        <Link to="/my/notifications" className={buttonClass("dark", "sm")}>
          Set up reminders
        </Link>
        <Button variant="ghost" size="sm" onPress={() => dismiss.mutate()}>
          Not now
        </Button>
      </div>
    </section>
  );
}
