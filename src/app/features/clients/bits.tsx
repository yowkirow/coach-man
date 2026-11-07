import { WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "../../components/ui/display";
import { Skeleton } from "../../components/ui/feedback";
import { useOnline } from "../../lib/offline";

/** Inline note where a write is disabled for lack of a connection. Renders nothing online. */
export function OfflineHint({
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

/** Card title row: an h2 with optional count and actions, matching CardHeader's rhythm. */
export function SectionHead({
  title,
  count,
  action,
  id,
}: {
  title: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-2">
      <h2 id={id} className="text-[1.125rem] font-medium">
        {title}
        {count !== undefined ? (
          <span className="num ml-1.5 font-normal text-ink-2">{count}</span>
        ) : null}
      </h2>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Card className="flex flex-col gap-4 p-5" as="div">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows.
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </Card>
  );
}

const FIGURE_TONES = {
  coral: "bg-coral hover:brightness-95",
  amber: "bg-amber hover:brightness-95",
  sky: "bg-sky hover:brightness-95",
  mint: "bg-mint hover:brightness-95",
  white: "bg-card hover:bg-panel",
};

/** A figure in a 44px pill that opens its proof (credit history, statement). */
export function FigureButton({
  children,
  onPress,
  tone,
  label,
}: {
  children: ReactNode;
  onPress: () => void;
  tone: keyof typeof FIGURE_TONES;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className={`num inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full px-4.5 text-[0.9375rem] font-medium text-ink outline-none transition-[filter,background-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${FIGURE_TONES[tone]}`}
    >
      {children}
    </button>
  );
}
