import { isReviewableProof } from "@shared/payment-proofs";
import { Card, CardHeader, Pill } from "../../components/ui/display";
import type { Format } from "../../lib/format";
import { useClientProofs } from "./queries";
import { ProofList } from "./review";

/**
 * A student's payment proofs on their profile's Money tab, newest first, with Confirm and Not
 * accepted on the ones waiting. Nothing shows until the family has sent one.
 */
export function ClientProofsCard({ clientId, fmt }: { clientId: string; fmt: Format }) {
  const q = useClientProofs(clientId);
  const proofs = q.data ?? [];
  if (!proofs.length) return null;
  const waiting = proofs.filter((p) => isReviewableProof(p.status)).length;
  return (
    <Card label="Payment proofs">
      <CardHeader
        title="Payment proofs"
        action={
          waiting ? (
            <Pill tone="sky">
              <span className="num">{waiting}</span> to review
            </Pill>
          ) : (
            <Pill tone="panel">{proofs.length}</Pill>
          )
        }
      />
      <div className="px-5 pb-2">
        <ProofList proofs={proofs} fmt={fmt} context="client" />
      </div>
    </Card>
  );
}
