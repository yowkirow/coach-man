import { describe, expect, it } from "vitest";
import { CONSENT_TEMPLATE_KINDS, consentTemplate } from "../../src/shared/consent-templates";
import {
  consentApplies,
  consentParagraphs,
  consentStatus,
  missingConsents,
  normalizeConsentBody,
  portalSigner,
  type SignatureFacts,
  signatureCounts,
  versionAfterEdit,
} from "../../src/shared/consents";
import { isMinor } from "../../src/shared/family";
import { consentDocumentSchema, consentSignSchema } from "../../src/shared/schemas";

const sig = (over: Partial<SignatureFacts>): SignatureFacts => ({
  documentId: "waiver",
  documentVersion: 1,
  relation: "guardian",
  signedAt: 1000,
  ...over,
});

describe("who a document asks, and whose signature counts", () => {
  it("asks minors-only documents of minors alone", () => {
    expect(consentApplies({ appliesTo: "all" }, false)).toBe(true);
    expect(consentApplies({ appliesTo: "all" }, true)).toBe(true);
    expect(consentApplies({ appliesTo: "minors" }, true)).toBe(true);
    expect(consentApplies({ appliesTo: "minors" }, false)).toBe(false);
  });

  it("counts a guardian for a minor and the student as an adult; paper either way", () => {
    expect(signatureCounts({ relation: "guardian" }, true)).toBe(true);
    expect(signatureCounts({ relation: "self" }, true)).toBe(false);
    expect(signatureCounts({ relation: "staff" }, true)).toBe(true);
    expect(signatureCounts({ relation: "self" }, false)).toBe(true);
    expect(signatureCounts({ relation: "guardian" }, false)).toBe(false);
    expect(signatureCounts({ relation: "staff" }, false)).toBe(true);
  });

  it("treats juniors without a birth date as minors, like guardian links do", () => {
    expect(isMinor({ birthDate: null, isJunior: true, today: "2026-11-05" })).toBe(true);
    expect(isMinor({ birthDate: "2008-11-05", isJunior: true, today: "2026-11-05" })).toBe(false);
    expect(isMinor({ birthDate: "2008-11-06", isJunior: false, today: "2026-11-05" })).toBe(true);
  });
});

describe("consentStatus", () => {
  const doc = { id: "waiver", version: 2 };

  it("is signed with a counting signature of the current version", () => {
    const s = sig({ documentVersion: 2, signedAt: 5 });
    expect(consentStatus(doc, [sig({ documentVersion: 1 }), s], true)).toEqual({
      status: "signed",
      signature: s,
    });
  });

  it("needs re-signing when only earlier versions were signed, and shows the latest", () => {
    const older = sig({ documentVersion: 1, signedAt: 10 });
    expect(consentStatus(doc, [older], true)).toEqual({ status: "needs_resign", signature: older });
  });

  it("is missing when nothing that counts was signed", () => {
    expect(consentStatus(doc, [], false).status).toBe("missing");
    // A teen's own signature never counts, nor one of another document.
    expect(
      consentStatus(
        doc,
        [sig({ relation: "self", documentVersion: 2 }), sig({ documentId: "x" })],
        true,
      ),
    ).toEqual({ status: "missing", signature: null });
  });

  it("asks an adult to sign for themselves even if a parent signed while they were a minor", () => {
    expect(
      consentStatus(doc, [sig({ relation: "guardian", documentVersion: 2 })], false).status,
    ).toBe("missing");
    expect(consentStatus(doc, [sig({ relation: "staff", documentVersion: 2 })], false).status).toBe(
      "signed",
    );
  });
});

describe("missingConsents", () => {
  const docs = [
    { id: "waiver", version: 1, required: true, active: true, appliesTo: "all" as const },
    { id: "parental", version: 1, required: true, active: true, appliesTo: "minors" as const },
    { id: "media", version: 1, required: false, active: true, appliesTo: "all" as const },
    { id: "draft", version: 1, required: true, active: false, appliesTo: "all" as const },
  ];

  it("counts required, active documents that apply and aren't signed", () => {
    expect(missingConsents(docs, [], true)).toBe(2);
    expect(missingConsents(docs, [], false)).toBe(1);
    expect(missingConsents(docs, [sig({ documentId: "waiver" })], true)).toBe(1);
    expect(
      missingConsents(
        docs,
        [sig({ documentId: "waiver" }), sig({ documentId: "parental", relation: "staff" })],
        true,
      ),
    ).toBe(0);
  });
});

describe("versioning", () => {
  const doc = { version: 3, body: "First paragraph.\n\nSecond paragraph." };

  it("starts a new version when signed text changes", () => {
    expect(versionAfterEdit(doc, "First paragraph.\n\nA new second paragraph.", true)).toBe(4);
  });

  it("changes unsigned text in place", () => {
    expect(versionAfterEdit(doc, "Something else entirely.", false)).toBe(3);
  });

  it("ignores line endings and blank space at the edges, and edits that leave the text alone", () => {
    expect(versionAfterEdit(doc, "  First paragraph.  \r\n\r\nSecond paragraph.\n", true)).toBe(3);
    expect(versionAfterEdit(doc, undefined, true)).toBe(3);
    expect(normalizeConsentBody("a  \r\nb\r\n\r\n")).toBe("a\nb");
  });

  it("splits text into paragraphs on blank lines", () => {
    expect(consentParagraphs("One\nline two\n\n\nTwo\n \nThree")).toEqual([
      "One\nline two",
      "Two",
      "Three",
    ]);
  });
});

describe("who may sign in the family portal", () => {
  it("lets a parent sign for a minor, and an adult student for themself", () => {
    expect(portalSigner("guardian", true, "Mia")).toEqual({ ok: true, relation: "guardian" });
    expect(portalSigner("self", false, "Ana")).toEqual({ ok: true, relation: "self" });
  });

  it("keeps a teen's own login from signing, and a parent from signing for an adult", () => {
    expect(portalSigner("self", true, "Jun")).toMatchObject({ ok: false, code: "needs_guardian" });
    expect(portalSigner("guardian", false, "Ana")).toMatchObject({
      ok: false,
      code: "adult_signs",
      message: expect.stringContaining("Ana"),
    });
  });
});

describe("schemas", () => {
  it("needs a typed name of at least two characters and a version", () => {
    expect(consentSignSchema.safeParse({ signerName: " Pat Santos ", version: 2 }).data).toEqual({
      signerName: "Pat Santos",
      version: 2,
    });
    expect(consentSignSchema.safeParse({ signerName: "P", version: 2 }).success).toBe(false);
    expect(consentSignSchema.safeParse({ signerName: "Pat", version: 0 }).success).toBe(false);
  });

  it("refuses an empty document", () => {
    const base = { kind: "waiver", title: "Waiver" };
    expect(consentDocumentSchema.safeParse({ ...base, body: "  \n " }).success).toBe(false);
    expect(consentDocumentSchema.safeParse({ ...base, body: "Text." }).success).toBe(true);
  });
});

describe("starter templates", () => {
  it("fill in the academy's name and leave no placeholders", () => {
    for (const kind of CONSENT_TEMPLATE_KINDS) {
      const t = consentTemplate(kind, "Riverside Pickleball Academy");
      expect(t.kind).toBe(kind);
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.body).toContain("Riverside Pickleball Academy");
      expect(t.body).not.toMatch(/\{|\}|undefined|TODO/);
      expect(consentParagraphs(t.body).length).toBeGreaterThan(2);
    }
  });

  it("set who each one applies to, and whether it's required", () => {
    expect(consentTemplate("parental", "A").appliesTo).toBe("minors");
    expect(consentTemplate("waiver", "A")).toMatchObject({ appliesTo: "all", required: true });
    expect(consentTemplate("media", "A").required).toBe(false);
    expect(consentTemplate("privacy", "A").body).toContain("Republic Act No. 10173");
  });

  it("still produce text without a name", () => {
    const body = consentTemplate("waiver", "  ").body;
    expect(body).toMatch(/academy/i);
    expect(body).not.toContain("undefined");
  });
});
