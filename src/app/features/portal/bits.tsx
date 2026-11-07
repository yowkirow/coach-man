import type { PortalCoachRefDto } from "@shared/api-types";
import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SearchX, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { buttonClass } from "../../components/ui/button";
import { Avatar, Card } from "../../components/ui/display";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/feedback";
import { ApiRequestError, errorMessage, portalFileUrl } from "../../lib/api";

export function personOf(name: string) {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

/** A student or coach photo through the portal's own file routes, else initials. */
export function PortalAvatar({
  name,
  photoKey,
  size = "md",
}: {
  name: string;
  photoKey: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}) {
  return <Avatar person={personOf(name)} size={size} src={portalFileUrl(photoKey)} />;
}

/** "Ana Reyes" with their photo, as families see coaches (no ids, no contact details). */
export function CoachLine({
  coach,
  extra,
}: {
  coach: PortalCoachRefDto | null;
  extra?: ReactNode;
}) {
  if (!coach) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <PortalAvatar name={coach.name} photoKey={coach.photoKey} size="xs" />
      <span className="min-w-0 truncate">
        <span className="font-medium">{coach.name}</span>
        {extra ? <span className="text-ink-2"> · {extra}</span> : null}
      </span>
    </span>
  );
}

/** A white card with an h2 title row (the portal's one card shape). */
export function PortalCard({
  title,
  action,
  children,
  className = "",
  id,
  label,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  /** The card's region name when it should differ from its title (unique landmark names). */
  label?: string;
}) {
  return (
    <Card className={className} label={label ?? (typeof title === "string" ? title : undefined)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-2">
        <h2 id={id} className="text-[1.125rem] font-medium">
          {title}
        </h2>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </Card>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-40 rounded-[28px]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Skeleton className="h-32 rounded-[28px]" />
        <Skeleton className="h-32 rounded-[28px]" />
      </div>
      <Skeleton className="h-56 rounded-[28px]" />
    </div>
  );
}

/**
 * Loading, offline, not-linked, and error states of a student page's read, so every page says
 * the same thing the same way. Renders `children` once there's data.
 */
export function QueryGate<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  // Access can end while a copy is cached: a 404 wins over the stale copy.
  const notLinked = query.error instanceof ApiRequestError && query.error.status === 404;
  if (query.data !== undefined && !notLinked) return <>{children(query.data)}</>;
  if (query.isPending && query.fetchStatus === "paused") {
    return (
      <Card className="px-6 py-2">
        <EmptyState
          icon={<WifiOff aria-hidden className="size-5" />}
          title="Not saved on this device yet"
          body="Pages you've opened while online stay readable offline. Reconnect to open this one."
        />
      </Card>
    );
  }
  if (query.isPending) return <PageSkeleton />;
  if (notLinked) {
    return (
      <Card className="px-6 py-2">
        <EmptyState
          icon={<SearchX aria-hidden className="size-5" />}
          title="Not linked to your account"
          body="This student isn't linked to you, or the academy has ended your access. Your linked students are on the home page."
          action={
            <Link to="/my" className={buttonClass("dark")}>
              Home
            </Link>
          }
        />
      </Card>
    );
  }
  return (
    <Card className="px-6 py-2">
      <ErrorState
        title="Couldn't load this"
        message={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    </Card>
  );
}
