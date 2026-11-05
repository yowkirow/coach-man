import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type {
  PaymentProofCountDto,
  PaymentProofDto,
  PaymentProofListDto,
} from "../../shared/api-types";
import {
  paymentProofConfirmSchema,
  paymentProofListQuerySchema,
  paymentProofRejectSchema,
} from "../../shared/schemas";
import { client } from "../db/schema";
import { notFound } from "../lib/errors";
import { v } from "../lib/validate";
import { assertCan, ctxOf, requireCap } from "../middleware";
import {
  clientProofs,
  confirmProof,
  listProofs,
  pendingProofCount,
  proofDetail,
  rejectProof,
} from "../services/payment-proofs";
import type { AppBindings } from "../types";

/**
 * Payment proofs to review (/api/v1/payment-proofs): owners and admins. Reviewing is the
 * `enrollment` capability; confirming records a payment, so it also needs `money` (owners and
 * admins have both). Coaches get 403 on every route.
 */
export const paymentProofRoutes = new Hono<AppBindings>()
  .use("/payment-proofs", requireCap("enrollment"))
  .use("/payment-proofs/*", requireCap("enrollment"))

  .get("/payment-proofs", v("query", paymentProofListQuerySchema), async (c) => {
    const status = c.req.valid("query").status ?? "pending";
    return c.json<PaymentProofListDto>(await listProofs(ctxOf(c), status));
  })

  /** The Money badge: proofs waiting for review. */
  .get("/payment-proofs/count", async (c) =>
    c.json<PaymentProofCountDto>({ pending: await pendingProofCount(ctxOf(c)) }),
  )

  .get("/payment-proofs/:id", async (c) =>
    c.json<PaymentProofDto>(await proofDetail(ctxOf(c), c.req.param("id"))),
  )

  /** Records the payment (amount, method, date, reference editable) and marks it confirmed. */
  .post("/payment-proofs/:id/confirm", v("json", paymentProofConfirmSchema), async (c) => {
    assertCan(c.var.role, "money");
    return c.json<PaymentProofDto>(
      await confirmProof(ctxOf(c), c.req.param("id"), c.req.valid("json")),
    );
  })

  /** Not accepted, with the reason the family reads. */
  .post("/payment-proofs/:id/reject", v("json", paymentProofRejectSchema), async (c) =>
    c.json<PaymentProofDto>(
      await rejectProof(ctxOf(c), c.req.param("id"), c.req.valid("json").reason),
    ),
  )

  /** A student's proofs (their profile's Money tab). */
  .get("/clients/:id/payment-proofs", requireCap("enrollment"), async (c) => {
    const ctx = ctxOf(c);
    const row = await ctx.db.query.client.findFirst({
      where: and(eq(client.id, c.req.param("id")), eq(client.workspaceId, ctx.workspaceId)),
      columns: { id: true },
    });
    if (!row) throw notFound("Client");
    return c.json<PaymentProofDto[]>(await clientProofs(ctx, row.id));
  });
