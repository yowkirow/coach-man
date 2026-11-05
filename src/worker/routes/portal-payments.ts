import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { PortalPaymentProofDto, PortalPaymentProofsDto } from "../../shared/api-types";
import { paymentProofSubmitSchema } from "../../shared/schemas";
import { client } from "../db/schema";
import { later } from "../lib/defer";
import { badRequest, notFound } from "../lib/errors";
import { linkFor } from "../lib/portal-scope";
import { enforce } from "../lib/rate-limit";
import { MAX_IMAGE_BYTES, readImageFile } from "../lib/uploads";
import { parseWith } from "../lib/validate";
import { notifyStaffProof } from "../services/family-push";
import {
  familyProofs,
  type ProofImage,
  submitProof,
  withdrawProof,
} from "../services/payment-proofs";
import { academyRefFor } from "../services/portal";
import type { AppBindings } from "../types";

/** Sending proofs: plenty for a family, few enough to stop a script. */
const SUBMIT_RULE = { windowMs: 60 * 60_000, max: 30 };

/** The caller's link to the student in the path (404 for anyone else's student). */
async function linkedStudent(c: Context<AppBindings>) {
  const link = linkFor(c.var.portal, c.req.param("clientId") ?? "");
  if (!link) throw notFound("Student");
  const row = await c.var.db.query.client.findFirst({
    where: and(eq(client.id, link.clientId), eq(client.workspaceId, link.workspaceId)),
    columns: { id: true },
  });
  if (!row) throw notFound("Student");
  return link;
}

/**
 * A proof arrives as multipart/form-data (the screenshot in `proof`, the details as JSON in
 * `data`), or as JSON alone for cash at the court. The screenshot is checked by its bytes.
 */
async function readProofRequest(
  c: Context<AppBindings>,
): Promise<{ data: unknown; image: ProofImage | null }> {
  const type = (c.req.header("Content-Type") ?? "").toLowerCase();
  if (type.startsWith("multipart/form-data")) {
    const declared = Number(c.req.header("Content-Length") ?? Number.NaN);
    if (declared > MAX_IMAGE_BYTES + 200_000) {
      // Drain the body first: Miniflare's local proxy can fail a request answered unread.
      await c.req.raw.arrayBuffer().catch(() => undefined);
      throw badRequest("That screenshot is too large (1.5 MB max).", {
        fields: { proof: "Too large" },
      });
    }
    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      throw badRequest("Couldn't read the upload. Try again.");
    }
    const raw = form.get("data");
    let data: unknown;
    try {
      data = JSON.parse(typeof raw === "string" ? raw : "");
    } catch {
      throw badRequest("Some fields need attention.");
    }
    const file = form.get("proof");
    const image = file instanceof File && file.size > 0 ? await readImageFile(file) : null;
    return { data, image };
  }
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw badRequest("Send the details as JSON, or as a form with the screenshot.");
  }
  return { data, image: null };
}

/**
 * Payment proofs, from the family's side (mounted on /api/portal, behind `requirePortal`): a
 * student's proofs, sending one (a screenshot of a GCash or bank payment, or "I'll pay cash at the
 * court"), and withdrawing one that waits for review (only the person who sent it).
 */
export const portalPaymentRoutes = new Hono<AppBindings>()
  .get("/students/:clientId/payment-proofs", async (c) => {
    const link = await linkedStudent(c);
    const [academy, proofs] = await Promise.all([
      academyRefFor(c.var.db, link.workspaceId),
      familyProofs(c.var.db, c.var.user.id, [link]),
    ]);
    return c.json<PortalPaymentProofsDto>({ academy, proofs });
  })

  .post("/students/:clientId/payment-proofs", async (c) => {
    const link = linkFor(c.var.portal, c.req.param("clientId") ?? "");
    if (!link) {
      await c.req.raw.arrayBuffer().catch(() => undefined);
      throw notFound("Student");
    }
    const { data, image } = await readProofRequest(c);
    await linkedStudent(c);
    await enforce(c, `proof-submit:user:${c.var.user.id}`, SUBMIT_RULE);
    const input = parseWith(paymentProofSubmitSchema, data);
    const { proof, replay } = await submitProof(
      c.var.db,
      c.env,
      { userId: c.var.user.id },
      link,
      input,
      image,
    );
    if (!replay) {
      later(c, "Payment proof push failed", () =>
        notifyStaffProof(c.var.db, c.env, {
          workspaceId: proof.workspaceId,
          proofId: proof.id,
          actorUserId: c.var.user.id,
        }),
      );
    }
    return c.json<PortalPaymentProofDto>(proof, replay ? 200 : 201);
  })

  .post("/students/:clientId/payment-proofs/:id/withdraw", async (c) => {
    await c.req.raw.arrayBuffer().catch(() => undefined);
    const link = await linkedStudent(c);
    return c.json<PortalPaymentProofDto>(
      await withdrawProof(c.var.db, { userId: c.var.user.id }, link, c.req.param("id")),
    );
  });
