import { ENROLLMENT_STATUSES } from "@shared/domain";
import { createFileRoute } from "@tanstack/react-router";
import { Page, ShellAside } from "../../components/layout/app-shell";
import { NoAccess } from "../../components/layout/no-access";
import { PageHeader } from "../../components/ui/display";
import {
  InboxFilters,
  InboxPanel,
  type InboxSearch,
  type InboxStatus,
  RenewalsList,
  RequestList,
} from "../../features/enrollment/inbox";
import { useEnrollments, useRenewalsDue } from "../../features/enrollment/queries";
import { useFormat } from "../../lib/format";
import { useCan } from "../../lib/hooks";

const STATUSES: readonly string[] = [...ENROLLMENT_STATUSES, "all"];

export const Route = createFileRoute("/_app/enrollments/")({
  validateSearch: (s: Record<string, unknown>): InboxSearch => ({
    status:
      typeof s.status === "string" && STATUSES.includes(s.status)
        ? (s.status as InboxStatus)
        : undefined,
    view: s.view === "renewals" ? "renewals" : undefined,
  }),
  component: EnrollmentsRoute,
});

function EnrollmentsRoute() {
  const can = useCan();
  if (!can.enrollment) {
    return (
      <NoAccess
        title="Enrollments"
        body="Enrollment requests are for the academy's owner and admins. New students show up in Clients once they're approved."
      />
    );
  }
  return <EnrollmentsPage />;
}

function EnrollmentsPage() {
  const search = Route.useSearch();
  const fmt = useFormat();
  const renewalsView = search.view === "renewals";
  const status: InboxStatus = search.status ?? "requested";
  const list = useEnrollments(status);
  const renewals = useRenewalsDue();
  const active = renewalsView ? "renewals" : status;
  const counts = list.data?.counts;
  const renewalCount = renewals.data?.items.length;
  return (
    <>
      <ShellAside>
        <InboxPanel active={active} counts={counts} renewals={renewalCount} fmt={fmt} />
      </ShellAside>
      <Page className="flex flex-col gap-5">
        <PageHeader
          title={renewalsView ? "Not yet renewed" : "Enrollments"}
          subtitle={
            renewalsView
              ? "Monthly students to remind before the month ends"
              : "Requests from your academy page, newest first"
          }
        />
        <div className="lg:hidden">
          <InboxFilters active={active} counts={counts} renewals={renewalCount} />
        </div>
        {renewalsView ? (
          <RenewalsList fmt={fmt} />
        ) : (
          <RequestList
            list={list.data}
            status={status}
            fmt={fmt}
            isPending={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
          />
        )}
      </Page>
    </>
  );
}
