import type { ClientConsentsDto, ConsentDocumentDto } from "@shared/api-types";
import { type ConsentStatus, consentParagraphs } from "@shared/consents";
import type { ConsentKind } from "@shared/domain";
import { useQuery } from "@tanstack/react-query";
import { Camera, FileSignature, FileText, ShieldCheck, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { PillTone } from "../../components/ui/display";
import { api } from "../../lib/api";
import { keys } from "../../lib/query";

export function useConsentDocuments(enabled = true) {
  return useQuery({
    queryKey: keys.consentDocuments,
    queryFn: () => api.get<ConsentDocumentDto[]>("/consent-documents"),
    enabled,
  });
}

export function useClientConsents(clientId: string) {
  return useQuery({
    queryKey: keys.clientConsents(clientId),
    queryFn: () => api.get<ClientConsentsDto>(`/clients/${clientId}/consents`),
  });
}

export const CONSENT_KIND_ICONS: Record<ConsentKind, typeof FileText> = {
  waiver: FileSignature,
  privacy: ShieldCheck,
  parental: Users,
  media: Camera,
  other: FileText,
};

/** A student's standing on a document, as a pill; optional documents are never "missing". */
export function consentStatusPill(
  status: ConsentStatus,
  required: boolean,
): { tone: PillTone; label: string } {
  if (status === "signed") return { tone: "mint", label: "Signed" };
  if (status === "needs_resign") return { tone: "amber", label: "Needs re-signing" };
  return required ? { tone: "coral", label: "Missing" } : { tone: "panel", label: "Not signed" };
}

/**
 * A consent document's text: plain text in paragraphs (blank lines between them), rendered as
 * text only, never as HTML.
 */
export function ConsentText({ body, className = "" }: { body: string; className?: string }) {
  return (
    <div
      className={`flex max-w-[65ch] flex-col gap-3 text-[0.9375rem] leading-relaxed ${className}`}
    >
      {consentParagraphs(body).map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of a fixed text, in order.
        <p key={i} className="whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  );
}

/** "Not legal advice" for starter texts and drafts. */
export function StarterTextNote({ children }: { children?: ReactNode }) {
  return (
    <div role="note" className="rounded-[18px] bg-amber-soft px-4 py-3 text-[0.875rem] text-ink">
      <p className="font-medium">A starting point, not legal advice</p>
      <p className="mt-0.5 text-ink/80">
        {children ??
          "Starter texts are general examples. Read them, change them to fit how your academy works, and have them checked by your own adviser before families sign."}
      </p>
    </div>
  );
}
