import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { ClientConsentsDto, ConsentDocumentDto } from "../../shared/api-types";
import { consentTemplate } from "../../shared/consent-templates";
import { normalizeConsentBody, versionAfterEdit } from "../../shared/consents";
import { uuidv7 } from "../../shared/ids";
import {
  consentDocumentSchema,
  consentDocumentUpdateSchema,
  consentSignSchema,
  consentTemplateSchema,
} from "../../shared/schemas";
import { todayIn } from "../../shared/time";
import { client, consentDocument, consentSignature, organization } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { conflict, notFound } from "../lib/errors";
import { clientIp } from "../lib/rate-limit";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import {
  clientConsents,
  documentDtos,
  recordSignature,
  versionSigned,
  versionSnapshot,
} from "../services/consents";
import { runBatch } from "../services/credits";
import type { AppBindings, Ctx } from "../types";

/** Consent documents are academy settings: owners and admins write them. */
const settingsOnly = requireCap("settings");

async function documentDto(ctx: Ctx, id: string): Promise<ConsentDocumentDto> {
  const doc = (await documentDtos(ctx.db, ctx.workspaceId)).find((d) => d.id === id);
  if (!doc) throw notFound("Document");
  return doc;
}

async function findDocument(ctx: Ctx, id: string) {
  const doc = await ctx.db.query.consentDocument.findFirst({
    where: and(eq(consentDocument.id, id), eq(consentDocument.workspaceId, ctx.workspaceId)),
  });
  if (!doc) throw notFound("Document");
  return doc;
}

async function findClient(ctx: Ctx, id: string) {
  const row = await ctx.db.query.client.findFirst({
    where: and(eq(client.id, id), eq(client.workspaceId, ctx.workspaceId)),
  });
  if (!row) throw notFound("Client");
  return row;
}

const VERSION_CHANGED =
  "This document changed since it was opened. Read the current version, then try again.";

/**
 * Consents (staff API). Owners and admins (`settings`) write the academy's documents: waivers,
 * data privacy consent, parental consent, photo and video consent. Every staff member sees a
 * student's standing and can record a form signed on paper.
 */
export const consentRoutes = new Hono<AppBindings>()
  .get("/consent-documents", settingsOnly, async (c) =>
    c.json(await documentDtos(c.var.db, c.var.workspaceId)),
  )

  .post("/consent-documents", settingsOnly, v("json", consentDocumentSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const id = uuidv7();
    const row = {
      id,
      workspaceId: ctx.workspaceId,
      kind: input.kind,
      title: input.title,
      body: normalizeConsentBody(input.body),
      version: 1,
      required: input.required ?? true,
      appliesTo: input.appliesTo ?? "all",
      active: input.active ?? true,
    };
    await runBatch(ctx, [
      ctx.db.insert(consentDocument).values(row),
      versionSnapshot(ctx.db, row),
      auditEntry(ctx, "create", "consent_document", id, { kind: row.kind, title: row.title }),
    ]);
    return c.json(await documentDto(ctx, id), 201);
  })

  /** A starter document filled in with the academy's name, added as a draft to review first. */
  .post(
    "/consent-documents/templates",
    settingsOnly,
    v("json", consentTemplateSchema),
    async (c) => {
      const ctx = ctxOf(c);
      const org = await ctx.db.query.organization.findFirst({
        where: eq(organization.id, ctx.workspaceId),
        columns: { name: true },
      });
      const template = consentTemplate(c.req.valid("json").kind, org?.name ?? "");
      const id = uuidv7();
      const row = {
        id,
        workspaceId: ctx.workspaceId,
        ...template,
        body: normalizeConsentBody(template.body),
        version: 1,
        active: false,
      };
      await runBatch(ctx, [
        ctx.db.insert(consentDocument).values(row),
        versionSnapshot(ctx.db, row),
        auditEntry(ctx, "create", "consent_document", id, { kind: row.kind, template: true }),
      ]);
      return c.json(await documentDto(ctx, id), 201);
    },
  )

  /**
   * Edits a document. Changing its text after someone signed the current version starts a new
   * version: their signatures stay with the version they read, and they show as needing to sign
   * again. Before anyone signs, the text changes in place.
   */
  .patch(
    "/consent-documents/:id",
    settingsOnly,
    v("json", consentDocumentUpdateSchema),
    async (c) => {
      const ctx = ctxOf(c);
      const input = c.req.valid("json");
      const doc = await findDocument(ctx, c.req.param("id"));
      const body = input.body === undefined ? undefined : normalizeConsentBody(input.body);
      const currentSigned = await versionSigned(ctx.db, doc.id, doc.version);
      const version = versionAfterEdit(doc, body, currentSigned);
      const next = {
        ...doc,
        ...input,
        body: body ?? doc.body,
        version,
      };
      // Guarded by the version read above, so two editors can't both keep one version.
      const updated = await ctx.db
        .update(consentDocument)
        .set({
          kind: next.kind,
          title: next.title,
          body: next.body,
          version,
          required: next.required,
          appliesTo: next.appliesTo,
          active: next.active,
        })
        .where(and(eq(consentDocument.id, doc.id), eq(consentDocument.version, doc.version)))
        .returning({ id: consentDocument.id });
      if (!updated.length) throw conflict(VERSION_CHANGED);
      await runBatch(ctx, [
        // A signed version's text never changes; a new version (or an unsigned one) is kept.
        ...(version !== doc.version || !currentSigned ? [versionSnapshot(ctx.db, next)] : []),
        auditEntry(ctx, "update", "consent_document", doc.id, {
          fields: Object.keys(input),
          ...(version !== doc.version ? { version } : {}),
        }),
      ]);
      return c.json(await documentDto(ctx, doc.id));
    },
  )

  /** Only a document nobody signed can be deleted; signed ones are turned off instead. */
  .delete("/consent-documents/:id", settingsOnly, async (c) => {
    const ctx = ctxOf(c);
    const doc = await findDocument(ctx, c.req.param("id"));
    const [signed] = await ctx.db
      .select({ id: consentSignature.id })
      .from(consentSignature)
      .where(eq(consentSignature.documentId, doc.id))
      .limit(1);
    if (signed) {
      throw conflict(
        "People have signed this document, so it's kept with their signatures. Turn it off instead.",
      );
    }
    await runBatch(ctx, [
      ctx.db.delete(consentDocument).where(eq(consentDocument.id, doc.id)),
      auditEntry(ctx, "delete", "consent_document", doc.id, { title: doc.title }),
    ]);
    return c.body(null, 204);
  })

  .get("/clients/:id/consents", async (c) => {
    const ctx = ctxOf(c);
    const student = await findClient(ctx, c.req.param("id"));
    return c.json<ClientConsentsDto>(
      await clientConsents(ctx.db, student, todayIn(ctx.settings.timezone)),
    );
  })

  /**
   * Records a form signed on paper (relation `staff`): "Signed on paper by <name>, recorded by
   * <staff>". It counts for minors and adults alike; staff check who signed the paper.
   */
  .post("/clients/:id/consents/:documentId/paper", v("json", consentSignSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const student = await findClient(ctx, c.req.param("id"));
    const doc = await findDocument(ctx, c.req.param("documentId"));
    if (!doc.active) throw conflict("This document is a draft. Turn it on before recording it.");
    if (doc.version !== input.version) throw conflict(VERSION_CHANGED);
    await recordSignature(ctx.db, {
      workspaceId: ctx.workspaceId,
      document: doc,
      clientId: student.id,
      signedByUserId: ctx.userId,
      signerName: input.signerName,
      relation: "staff",
      ipAddress: clientIp(c.req.raw.headers),
      userAgent: c.req.header("User-Agent") ?? null,
    });
    return c.json<ClientConsentsDto>(
      await clientConsents(ctx.db, student, todayIn(ctx.settings.timezone)),
      201,
    );
  });
