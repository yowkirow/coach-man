import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import type { ReactNode } from "react";
import { dismiss, useNotices } from "../../lib/notify";

/** Black pill toasts with a lime action, stacked above the tab bar on phones. */
export function Toaster() {
  const notices = useNotices();
  return (
    <section
      aria-label="Notifications"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-60 flex flex-col items-center gap-2 px-3 lg:bottom-6 lg:left-auto lg:right-6 lg:items-end print:hidden"
    >
      {notices.map((n) => (
        <div
          key={n.id}
          role={n.tone === "danger" ? "alert" : "status"}
          className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[22px] bg-ink py-2.5 pr-2.5 pl-4 text-white shadow-pop animate-[sheet-up_220ms_var(--ease-out-expo)]"
        >
          {n.tone === "danger" ? (
            <AlertTriangle aria-hidden className="size-5 shrink-0 text-coral" />
          ) : n.tone === "success" ? (
            <CheckCircle2 aria-hidden className="size-5 shrink-0 text-lime" />
          ) : null}
          <div className="min-w-0 flex-1 py-0.5">
            <p className="leading-tight font-medium">{n.title}</p>
            {n.body ? <p className="mt-0.5 text-[0.8125rem] text-night-ink-2">{n.body}</p> : null}
          </div>
          {n.action ? (
            <button
              type="button"
              onClick={() => {
                n.action?.onAction();
                dismiss(n.id);
              }}
              className="h-9 shrink-0 cursor-pointer rounded-full bg-lime px-4 text-[0.875rem] font-semibold text-ink outline-none hover:bg-lime-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
            >
              {n.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(n.id)}
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-night-ink-2 outline-none hover:bg-night-3 focus-visible:outline-2 focus-visible:outline-lime"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ))}
    </section>
  );
}

export function Skeleton({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return (
    <div
      aria-hidden
      className={`rounded-xl bg-[length:200%_100%] animate-[shimmer_1.6s_linear_infinite] ${
        dark
          ? "bg-[linear-gradient(90deg,rgb(255_255_255/0.05),rgb(255_255_255/0.12),rgb(255_255_255/0.05))]"
          : "bg-[linear-gradient(90deg,rgb(17_17_17/0.05),rgb(17_17_17/0.1),rgb(17_17_17/0.05))]"
      } ${className}`}
    />
  );
}

export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col divide-y divide-line" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows.
        <div key={i} className="flex items-center gap-3 py-3.5">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="size-11 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-6">
      {icon ? (
        <div className="flex size-12 items-center justify-center rounded-full bg-lime text-ink">
          {icon}
        </div>
      ) : null}
      <h3 className="text-[1.375rem] leading-tight font-light">{title}</h3>
      <div className="max-w-[52ch] text-ink-2">{body}</div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-6">
      <div className="flex size-12 items-center justify-center rounded-full bg-coral text-ink">
        <AlertTriangle aria-hidden className="size-5" />
      </div>
      <h3 className="text-[1.375rem] leading-tight font-light">{title}</h3>
      <p className="max-w-[52ch] text-ink-2">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="h-11 cursor-pointer rounded-full bg-ink px-5 font-medium text-white outline-none hover:bg-night-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-2xl bg-coral-soft px-4 py-3 text-[0.875rem] font-medium text-[#7a1212]"
    >
      {children}
    </p>
  );
}
