import { WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { SyncStatus } from "../../components/layout/app-shell";
import { useOnline } from "../../lib/offline";

/** Header pill shown beside write actions while they're disabled for lack of a connection. */
export function OfflinePill() {
  const online = useOnline();
  if (online) return null;
  return (
    <span
      role="status"
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-sync px-3.5 text-[0.8125rem] font-semibold text-ink"
    >
      <WifiOff aria-hidden className="size-4" />
      You're offline
    </span>
  );
}

/** One connection indicator for page headers: "You're offline", or the sync count when online. */
export function ConnectionPill({ dark = false }: { dark?: boolean }) {
  const online = useOnline();
  return online ? <SyncStatus dark={dark} /> : <OfflinePill />;
}

/** Inline note for sheets and cards: saving needs a connection. Renders nothing when online. */
export function OfflineNote({
  children = "You're offline. Reconnect to save changes.",
}: {
  children?: ReactNode;
}) {
  const online = useOnline();
  if (online) return null;
  return (
    <p
      role="status"
      className="flex items-center gap-2.5 rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem] font-medium text-ink"
    >
      <WifiOff aria-hidden className="size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
