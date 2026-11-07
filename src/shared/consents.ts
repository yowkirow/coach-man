import type {
  ConsentAppliesTo,
  ConsentKind,
  ConsentSignerRelation,
  FamilyRelation,
} from "./domain";

// Consents: versioned documents an academy asks families to sign by typing a name.
// - A document `appliesTo` everyone, or only to minors (under 18, or marked junior without a birth
//   date: `isMinor` in family.ts).
// - For a minor, only a parent or guardian's signature counts; an adult signs for themselves.
//   Staff can record a signature made on paper (relation `staff`), which counts either way.
// - Changing a document's text once someone signed the current version starts a new version;
//   earlier signatures stay tied to the version they signed, and those students need to sign again.

export const CONSENT_KIND_LABELS: Record<ConsentKind, string> = {
  waiver: "Waiver",
  privacy: "Data privacy",
  parental: "Parental consent",
  media: "Photo and video",
  other: "Other",
};

export const CONSENT_APPLIES_TO_LABELS: Record<ConsentAppliesTo, string> = {
  all: "Everyone",
  minors: "Students under 18",
};

export const CONSENT_SIGNER_LABELS: Record<ConsentSignerRelation, string> = {
  self: "the student",
  guardian: "a parent or guardian",
  staff: "on paper",
};

/** Where a student stands on one document. */
export const CONSENT_STATUSES = ["signed", "needs_resign", "missing"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/** Whether a document asks anything of this student. */
export function consentApplies(doc: { appliesTo: ConsentAppliesTo }, minor: boolean): boolean {
  return doc.appliesTo === "all" || minor;
}

/** Whether a signature counts for this student: a guardian's for a minor, their own as an adult. */
export function signatureCounts(sig: { relation: ConsentSignerRelation }, minor: boolean): boolean {
  if (sig.relation === "staff") return true;
  return minor ? sig.relation === "guardian" : sig.relation === "self";
}

export interface SignatureFacts {
  documentId: string;
  documentVersion: number;
  relation: ConsentSignerRelation;
  signedAt: number;
}

/**
 * A student's status on a document from their signatures: signed (a counting signature of the
 * current version), needs re-signing (only of earlier versions), or missing. Returns the signature
 * the status rests on (the latest that counts).
 */
export function consentStatus<S extends SignatureFacts>(
  doc: { id: string; version: number },
  signatures: readonly S[],
  minor: boolean,
): { status: ConsentStatus; signature: S | null } {
  const counting = signatures
    .filter((s) => s.documentId === doc.id && signatureCounts(s, minor))
    .sort((a, b) => b.documentVersion - a.documentVersion || b.signedAt - a.signedAt);
  const current = counting.find((s) => s.documentVersion === doc.version);
  if (current) return { status: "signed", signature: current };
  const earlier = counting.find((s) => s.documentVersion < doc.version);
  if (earlier) return { status: "needs_resign", signature: earlier };
  return { status: "missing", signature: null };
}

/** Required, active documents this student still has to sign (missing or needs re-signing). */
export function missingConsents<S extends SignatureFacts>(
  docs: readonly {
    id: string;
    version: number;
    required: boolean;
    active: boolean;
    appliesTo: ConsentAppliesTo;
  }[],
  signatures: readonly S[],
  minor: boolean,
): number {
  return docs.filter(
    (d) =>
      d.active &&
      d.required &&
      consentApplies(d, minor) &&
      consentStatus(d, signatures, minor).status !== "signed",
  ).length;
}

export type PortalSignerCheck =
  | { ok: true; relation: "guardian" | "self" }
  | { ok: false; code: "needs_guardian" | "adult_signs"; message: string };

/**
 * Who may sign in the family portal: a parent or guardian for a minor, the student themself as
 * an adult. A teen's own login sees the forms but can't sign them.
 */
export function portalSigner(
  link: FamilyRelation,
  minor: boolean,
  firstName: string,
): PortalSignerCheck {
  const name = firstName || "the student";
  if (minor) {
    return link === "guardian"
      ? { ok: true, relation: "guardian" }
      : {
          ok: false,
          code: "needs_guardian",
          message:
            "A parent or guardian signs these for students under 18. Ask yours to open this page on their account.",
        };
  }
  return link === "self"
    ? { ok: true, relation: "self" }
    : {
        ok: false,
        code: "adult_signs",
        message: `${name} is 18 or older, so ${name} signs these on their own account.`,
      };
}

/** Text compared for changes: line endings and surrounding blank space don't make a new version. */
export function normalizeConsentBody(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/**
 * The version a document has after an edit: one more when its text changes and someone signed
 * the current version (their signature keeps pointing at the text they read), else the same.
 */
export function versionAfterEdit(
  doc: { version: number; body: string },
  nextBody: string | undefined,
  currentVersionSigned: boolean,
): number {
  if (nextBody === undefined) return doc.version;
  const changed = normalizeConsentBody(nextBody) !== normalizeConsentBody(doc.body);
  return changed && currentVersionSigned ? doc.version + 1 : doc.version;
}

/** Paragraphs of a plain-text document (blank lines separate them; single breaks stay). */
export function consentParagraphs(body: string): string[] {
  return normalizeConsentBody(body)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
