import { and, asc, desc, eq, sql } from "drizzle-orm";
import type {
  ClientConsentDto,
  ClientConsentsDto,
  ConsentDocumentDto,
  ConsentSignatureDto,
  PortalConsentDocumentDto,
} from "../../shared/api-types";
import {
  consentApplies,
  consentStatus,
  missingConsents,
  normalizeConsentBody,
} from "../../shared/consents";
import type { ConsentSignerRelation } from "../../shared/domain";
import { isMinor } from "../../shared/family";
import { uuidv7 } from "../../shared/ids";
import type { Db } from "../db/client";
import {
  auditLog,
  type client,
  consentDocument,
  consentDocumentVersion,
  consentSignature,
} from "../db/schema";
import { inList, unique } from "../lib/sql";
import { coachRefs } from "./coaches";

type ClientRow = typeof client.$inferSelect;
type DocumentRow = typeof consentDocument.$inferSelect;
type SignatureRow = typeof consentSignature.$inferSelect;

/** A student counts as a minor for consents by the same rule as guardian links. */
export const studentIsMinor = (c: Pick<ClientRow, "birthDate" | "isJunior">, today: string) =>
  isMinor({ birthDate: c.birthDate, isJunior: c.isJunior, today });

/** The academy's documents (drafts too unless `activeOnly`), oldest first. */
export function documentsOf(db: Db, workspaceId: string, opts: { activeOnly?: boolean } = {}) {
  return db
    .select()
    .from(consentDocument)
    .where(
      and(
        eq(consentDocument.workspaceId, workspaceId),
        opts.activeOnly ? eq(consentDocument.active, true) : undefined,
      ),
    )
    .orderBy(asc(consentDocument.createdAt));
}

/** Every signature of the given students in one academy. */
export function signaturesOf(db: Db, workspaceId: string, clientIds: readonly string[]) {
  if (!clientIds.length) return Promise.resolve([] as SignatureRow[]);
  return db
    .select()
    .from(consentSignature)
    .where(
      and(
        eq(consentSignature.workspaceId, workspaceId),
        inList(consentSignature.clientId, clientIds),
      ),
    )
    .orderBy(desc(consentSignature.signedAt));
}

/** Staff list: each document with how many signed its current version, and in total. */
export async function documentDtos(db: Db, workspaceId: string): Promise<ConsentDocumentDto[]> {
  const [docs, counts] = await Promise.all([
    documentsOf(db, workspaceId),
    db
      .select({
        documentId: consentSignature.documentId,
        version: consentSignature.documentVersion,
        n: sql<number>`count(*)`,
      })
      .from(consentSignature)
      .where(eq(consentSignature.workspaceId, workspaceId))
      .groupBy(consentSignature.documentId, consentSignature.documentVersion),
  ]);
  return docs.map((d) => {
    const mine = counts.filter((c) => c.documentId === d.id);
    return {
      id: d.id,
      kind: d.kind,
      title: d.title,
      body: d.body,
      version: d.version,
      required: d.required,
      appliesTo: d.appliesTo,
      active: d.active,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      signedCurrent: Number(mine.find((c) => c.version === d.version)?.n ?? 0),
      signedTotal: mine.reduce((s, c) => s + Number(c.n), 0),
    };
  });
}

/** Builds (does not run) the upsert keeping a version's text, so signatures match their words. */
export function versionSnapshot(
  db: Db,
  doc: Pick<DocumentRow, "id" | "workspaceId" | "version" | "title" | "body">,
) {
  return db
    .insert(consentDocumentVersion)
    .values({
      id: uuidv7(),
      workspaceId: doc.workspaceId,
      documentId: doc.id,
      version: doc.version,
      title: doc.title,
      body: normalizeConsentBody(doc.body),
    })
    .onConflictDoUpdate({
      target: [consentDocumentVersion.documentId, consentDocumentVersion.version],
      set: { title: doc.title, body: normalizeConsentBody(doc.body) },
    });
}

/** Whether anyone signed this version of the document. */
export async function versionSigned(db: Db, documentId: string, version: number) {
  const [row] = await db
    .select({ id: consentSignature.id })
    .from(consentSignature)
    .where(
      and(
        eq(consentSignature.documentId, documentId),
        eq(consentSignature.documentVersion, version),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Required documents each student still has to sign (missing or needing a new signature). */
export async function missingByClient(
  db: Db,
  workspaceId: string,
  students: Pick<ClientRow, "id" | "birthDate" | "isJunior">[],
  today: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const docs = (await documentsOf(db, workspaceId, { activeOnly: true })).filter((d) => d.required);
  if (!docs.length || !students.length) return out;
  // Every signature of the academy, grouped by student: lists are short, and the
  // (workspace_id, document_id) index serves the read.
  const rows = await db
    .select({
      clientId: consentSignature.clientId,
      documentId: consentSignature.documentId,
      documentVersion: consentSignature.documentVersion,
      relation: consentSignature.relation,
      signedAt: consentSignature.signedAt,
    })
    .from(consentSignature)
    .where(
      and(
        eq(consentSignature.workspaceId, workspaceId),
        inList(
          consentSignature.documentId,
          docs.map((d) => d.id),
        ),
      ),
    );
  const byClient = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byClient.get(r.clientId);
    if (list) list.push(r);
    else byClient.set(r.clientId, [r]);
  }
  for (const s of students) {
    out.set(s.id, missingConsents(docs, byClient.get(s.id) ?? [], studentIsMinor(s, today)));
  }
  return out;
}

function toSignatureDto(
  s: SignatureRow,
  recordedBy: ConsentSignatureDto["recordedBy"],
): ConsentSignatureDto {
  return {
    id: s.id,
    documentVersion: s.documentVersion,
    signerName: s.signerName,
    relation: s.relation,
    signedAt: s.signedAt,
    recordedBy,
  };
}

/** A student's standing on every active document that applies to them (staff view). */
export async function clientConsents(
  db: Db,
  student: ClientRow,
  today: string,
): Promise<ClientConsentsDto> {
  const minor = studentIsMinor(student, today);
  const [docs, signatures] = await Promise.all([
    documentsOf(db, student.workspaceId, { activeOnly: true }),
    signaturesOf(db, student.workspaceId, [student.id]),
  ]);
  const applying = docs.filter((d) => consentApplies(d, minor));
  const staffIds = unique(
    signatures.filter((s) => s.relation === "staff").map((s) => s.signedByUserId),
  );
  const refs = await coachRefs(db, student.workspaceId, staffIds);
  const documents: ClientConsentDto[] = applying
    .map((d) => {
      const { status, signature } = consentStatus(d, signatures, minor);
      const recordedBy =
        signature?.relation === "staff" && signature.signedByUserId
          ? (refs.get(signature.signedByUserId) ?? {
              userId: signature.signedByUserId,
              name: "Former staff",
              photoKey: null,
            })
          : null;
      return {
        document: {
          id: d.id,
          kind: d.kind,
          title: d.title,
          version: d.version,
          required: d.required,
          appliesTo: d.appliesTo,
        },
        status,
        signature: signature ? toSignatureDto(signature, recordedBy) : null,
      };
    })
    // Required first, then the academy's order.
    .sort((a, b) => Number(b.document.required) - Number(a.document.required));
  return {
    clientId: student.id,
    firstName: student.firstName,
    minor,
    documents,
    missing: missingConsents(docs, signatures, minor),
  };
}

/** The same documents for the family portal, with their text to read before signing. */
export async function portalConsentDocuments(
  db: Db,
  student: ClientRow,
  today: string,
): Promise<{ minor: boolean; documents: PortalConsentDocumentDto[]; missing: number }> {
  const minor = studentIsMinor(student, today);
  const [docs, signatures] = await Promise.all([
    documentsOf(db, student.workspaceId, { activeOnly: true }),
    signaturesOf(db, student.workspaceId, [student.id]),
  ]);
  const documents = docs
    .filter((d) => consentApplies(d, minor))
    .map((d): PortalConsentDocumentDto => {
      const { status, signature } = consentStatus(d, signatures, minor);
      return {
        id: d.id,
        kind: d.kind,
        title: d.title,
        body: d.body,
        version: d.version,
        required: d.required,
        status,
        signature: signature
          ? {
              signerName: signature.signerName,
              relation: signature.relation,
              signedAt: signature.signedAt,
              documentVersion: signature.documentVersion,
            }
          : null,
      };
    })
    .sort((a, b) => Number(b.required) - Number(a.required));
  return { minor, documents, missing: missingConsents(docs, signatures, minor) };
}

/**
 * Records a signature (and its audit entry) in one batch. `signedByUserId` is the family member
 * who signed, or the staff member who recorded a paper form.
 */
export async function recordSignature(
  db: Db,
  input: {
    workspaceId: string;
    document: Pick<DocumentRow, "id" | "version" | "title">;
    clientId: string;
    signedByUserId: string;
    signerName: string;
    relation: ConsentSignerRelation;
    ipAddress: string | null;
    userAgent: string | null;
    enrollmentId?: string | null;
  },
): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  await db.batch([
    db.insert(consentSignature).values({
      id,
      workspaceId: input.workspaceId,
      documentId: input.document.id,
      documentVersion: input.document.version,
      clientId: input.clientId,
      signedByUserId: input.signedByUserId,
      signerName: input.signerName,
      relation: input.relation,
      signedAt: now,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
      enrollmentId: input.enrollmentId ?? null,
    }),
    db.insert(auditLog).values({
      id: uuidv7(),
      workspaceId: input.workspaceId,
      userId: input.signedByUserId,
      action: input.relation === "staff" ? "record" : "sign",
      entity: "consent_signature",
      entityId: id,
      data: {
        clientId: input.clientId,
        documentId: input.document.id,
        version: input.document.version,
        title: input.document.title,
        relation: input.relation,
      },
      createdAt: now,
    }),
  ]);
  return id;
}
