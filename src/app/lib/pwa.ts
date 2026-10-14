import { useEffect, useState } from "react";
import { api } from "./api";

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

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(
  vapidPublicKey: string,
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
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.post("/push/subscriptions", { endpoint: json.endpoint, keys: json.keys });
  return "granted";
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await api.del("/push/subscriptions", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}
