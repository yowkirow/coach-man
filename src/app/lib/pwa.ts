import type { PushDeviceStateDto } from "@shared/api-types";
import { useEffect, useState } from "react";
import { accountApi, api, portalApi } from "./api";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    for (const l of listeners) l();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    for (const l of listeners) l();
  });
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function useInstallPrompt() {
  const [canPrompt, setCanPrompt] = useState(Boolean(deferred));
  useEffect(() => {
    const update = () => setCanPrompt(Boolean(deferred));
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return {
    installed: isStandalone(),
    canPrompt,
    ios: isIOS(),
    async prompt() {
      if (!deferred) return false;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      setCanPrompt(false);
      return choice.outcome === "accepted";
    },
  };
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Messenger, Facebook, Instagram, Viber, LINE, or WeChat's built-in browser (no push, no install). */
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /FBAN|FBAV|FB_IAB|Messenger|Instagram|Viber|\bLine\/|MicroMessenger/i.test(
    navigator.userAgent,
  );
}

/**
 * What this browser can do about push: `ok`; on iPhone and iPad, `ios-install` (push works only in
 * the app added to the Home Screen, iOS 16.4 or later) or `ios-update` (installed, but iOS is too
 * old); `in-app` (a messaging app's built-in browser); else `unsupported`.
 */
export type PushSupport = "ok" | "ios-install" | "ios-update" | "in-app" | "unsupported";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (isIOS()) {
    if (!isStandalone()) return "ios-install";
    return pushSupported() ? "ok" : "ios-update";
  }
  if (isInAppBrowser()) return "in-app";
  return pushSupported() ? "ok" : "unsupported";
}

/** Which settings page registers this browser: the staff app's or the family portal's. */
export type PushSurface = "staff" | "family";

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function register(surface: PushSurface, sub: PushSubscription) {
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const body = { endpoint: json.endpoint, keys: json.keys };
  if (surface === "staff") await api.post("/push/subscriptions", body);
  else await portalApi.post("/notifications/devices", body);
}

/**
 * Asks for permission, subscribes this browser (or reuses its subscription: one browser has one,
 * shared by the staff app and the family portal), and registers it for one surface.
 */
export async function enablePush(
  vapidPublicKey: string,
  surface: PushSurface = "staff",
): Promise<"granted" | "denied" | "unsupported"> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));
  await register(surface, sub);
  return "granted";
}

/**
 * Stops one surface's notifications on this browser. The browser's subscription is kept while
 * the other surface still uses it (coach and parent on one phone): `otherOn` says so, so the page
 * can tell the person instead of silently switching the other off too.
 */
export async function disablePush(surface: PushSurface = "staff"): Promise<{ otherOn: boolean }> {
  const sub = await currentPushSubscription();
  if (!sub) return { otherOn: false };
  const state =
    surface === "staff"
      ? await api.del<PushDeviceStateDto>("/push/subscriptions", { endpoint: sub.endpoint })
      : await portalApi.del<PushDeviceStateDto>("/notifications/devices", {
          endpoint: sub.endpoint,
        });
  const otherOn = surface === "staff" ? Boolean(state?.family) : Boolean(state?.staff);
  if (!otherOn) await sub.unsubscribe();
  return { otherOn };
}

/** Whether this browser gets the signed-in person's notifications, for each surface. */
export async function pushDeviceState(
  surface: PushSurface,
): Promise<PushDeviceStateDto & { subscribed: boolean }> {
  const sub = await currentPushSubscription();
  if (!sub) return { subscribed: false, staff: false, family: false };
  const query = `?endpoint=${encodeURIComponent(sub.endpoint)}`;
  const state =
    surface === "staff"
      ? await api.get<PushDeviceStateDto>(`/push/device${query}`)
      : await portalApi.get<PushDeviceStateDto>(`/notifications/device${query}`);
  return { subscribed: true, staff: state.staff, family: state.family };
}

/**
 * Signing out: this browser stops getting the person's notifications (staff and family) and drops
 * its subscription, so the next person on a shared phone never sees someone else's reminders.
 * Best effort: signing out goes ahead whatever happens here.
 */
export async function forgetThisDevice(): Promise<void> {
  try {
    const sub = await Promise.race([
      currentPushSubscription(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    if (!sub) return;
    await accountApi.del("/push-device", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
  } catch {
    // Push isn't available here: nothing to forget.
  }
}
