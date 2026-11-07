import { createFileRoute } from "@tanstack/react-router";
import { PortalPay } from "../../features/portal/pay";

interface PaySearch {
  /** The approved enrollment request being paid (its Pay button). */
  request?: string;
  /** A proof the academy didn't accept, sent again. */
  resubmit?: string;
}

const ID = /^[A-Za-z0-9-]{8,64}$/;

export const Route = createFileRoute("/_portal/my/$clientId/pay")({
  validateSearch: (s: Record<string, unknown>): PaySearch => ({
    request: typeof s.request === "string" && ID.test(s.request) ? s.request : undefined,
    resubmit: typeof s.resubmit === "string" && ID.test(s.resubmit) ? s.resubmit : undefined,
  }),
  component: Page,
});

function Page() {
  const { clientId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <PortalPay
      clientId={clientId}
      requestId={search.request ?? null}
      resubmitId={search.resubmit ?? null}
    />
  );
}
