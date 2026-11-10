import { createFileRoute } from "@tanstack/react-router";
import { Page, ShellAside } from "../../components/layout/app-shell";
import { NoAccess } from "../../components/layout/no-access";
import { InboxPanel } from "../../features/enrollment/inbox";
import { useEnrollments, useRenewalsDue } from "../../features/enrollment/queries";
import { RequestDetail } from "../../features/enrollment/request-detail";
import { useFormat } from "../../lib/format";
import { useCan } from "../../lib/hooks";

export const Route = createFileRoute("/_app/enrollments/$requestId")({
  component: RequestRoute,
});

function RequestRoute() {
  const can = useCan();
  if (!can.enrollment) {
    return (
      <NoAccess
        title="Enrollments"
        body="Enrollment requests are for the academy's owner, admins, and front desk staff. New students show up in Clients once they're approved."
      />
    );
  }
  return <RequestPage />;
}

function RequestPage() {
  const { requestId } = Route.useParams();
  const fmt = useFormat();
  const queue = useEnrollments("requested");
  const renewals = useRenewalsDue();
  return (
    <>
      <ShellAside>
        <InboxPanel
          active={null}
          counts={queue.data?.counts}
          renewals={renewals.data?.items.length}
          queue={{ title: "To review", items: queue.data?.items ?? [], selectedId: requestId }}
          fmt={fmt}
        />
      </ShellAside>
      <Page className="pb-6">
        <RequestDetail requestId={requestId} />
      </Page>
    </>
  );
}
