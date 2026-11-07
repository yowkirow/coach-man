import type { ClientConsentDto, ClientConsentsDto } from "@shared/api-types";
import { CONSENT_KIND_LABELS, CONSENT_SIGNER_LABELS } from "@shared/consents";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileSignature } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, buttonClass } from "../../components/ui/button";
import { Card, Pill } from "../../components/ui/display";
import { ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { type Format, useFormat } from "../../lib/format";
import { useCan, useMe } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineHint, SectionHead } from "../clients/bits";
import { CONSENT_KIND_ICONS, consentStatusPill, useClientConsents } from "./consents";

/** "Signed by Ana Cruz (a parent or guardian), Mar 3 · version 2" and the paper-form variant. */
function signatureLine(c: ClientConsentDto, fmt: Format): string | null {
  const s = c.signature;
  if (!s) return null;
  const when = fmt.date(fmt.dayOf(s.signedAt));
  const who =
    s.relation === "staff"
      ? `Signed on paper by ${s.signerName}, recorded by ${s.recordedBy?.name ?? "staff"}`
      : `Signed by ${s.signerName} (${CONSENT_SIGNER_LABELS[s.relation]})`;
  if (c.status === "needs_resign")
    return `${who}, ${when} · version ${s.documentVersion}; version ${c.document.version} needs a new signature`;
  return `${who}, ${when} · version ${s.documentVersion}`;
}

function PaperSignatureSheet({
  consents,
  item,
  onClose,
}: {
  consents: ClientConsentsDto;
  item: ClientConsentDto | null;
  onClose: () => void;
}) {
  const online = useOnline();
  const qc = useQueryClient();
  const me = useMe().data;
  const [name, setName] = useState("");
  const [shown, setShown] = useState<ClientConsentDto | null>(item);
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (v: { documentId: string; signerName: string; version: number }) =>
      api.post<ClientConsentsDto>(`/clients/${consents.clientId}/consents/${v.documentId}/paper`, {
        signerName: v.signerName,
        version: v.version,
      }),
    onSuccess: (next, v) => {
      qc.setQueryData(keys.clientConsents(consents.clientId), next);
      void qc.invalidateQueries({ queryKey: ["clients"] });
      notify({
        tone: "success",
        title: "Paper signature recorded",
        body: `Signed on paper by ${v.signerName}.`,
      });
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed when another document opens.
  useEffect(() => {
    if (!item) return;
    setShown(item);
    setName("");
    save.reset();
  }, [item?.document.id]);
  const c = item ?? shown;
  const errs = fieldErrors(save.error);
  const submit = () =>
    c &&
    online &&
    name.trim().length >= 2 &&
    save.mutate({
      documentId: c.document.id,
      signerName: name.trim(),
      version: c.document.version,
    });
  return (
    <Sheet
      isOpen={item !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Record a paper signature"
      description={c ? `${c.document.title} · version ${c.document.version}` : undefined}
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!online || name.trim().length < 2}
            isPending={save.isPending}
            onPress={submit}
          >
            Record signature
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="text-[0.9375rem] text-ink-2">
          {consents.minor
            ? `${consents.firstName} is under 18: check the form was signed by a parent or guardian.`
            : `Check the form was signed by ${consents.firstName}.`}{" "}
          Keep the paper form: this records that it exists
          {me ? `, with you (${me.user.name}) as the one who recorded it` : ""}.
        </p>
        <TextField
          label="Name on the signed form"
          value={name}
          onChange={setName}
          autoFocus
          placeholder={consents.minor ? "Parent or guardian's full name" : "Full name"}
          error={errs.signerName}
        />
        {save.error && !errs.signerName ? (
          <InlineError>{errorMessage(save.error)}</InlineError>
        ) : null}
        <OfflineHint>You're offline. Reconnect to record the signature.</OfflineHint>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/**
 * The student's consents: each active document that applies to them as signed (version, by
 * whom, when), missing, or needing a new signature after the text changed. Any staff member can
 * record a form signed on paper.
 */
export function ConsentsCard({ clientId }: { clientId: string }) {
  const fmt = useFormat();
  const can = useCan();
  const online = useOnline();
  const q = useClientConsents(clientId);
  const [paper, setPaper] = useState<ClientConsentDto | null>(null);

  if (q.isPending)
    return (
      <Card label="Consents">
        <SectionHead title="Consents" />
        <div className="px-5 pb-3">
          <RowsSkeleton rows={2} />
        </div>
      </Card>
    );
  if (!q.data)
    return (
      <Card label="Consents" className="px-5">
        <ErrorState
          title="Couldn't load consents"
          message={errorMessage(q.error)}
          onRetry={() => void q.refetch()}
        />
      </Card>
    );
  const data = q.data;
  return (
    <Card label="Consents">
      <SectionHead
        title="Consents"
        count={data.missing ? `${data.missing} missing` : undefined}
        action={
          can.settings ? (
            <Link to="/settings" hash="consents" className={buttonClass("light", "sm")}>
              Consent forms
            </Link>
          ) : null
        }
      />
      {data.documents.length ? (
        <ul className="flex flex-col divide-y divide-line px-5 pb-3">
          {data.documents.map((c) => {
            const Icon = CONSENT_KIND_ICONS[c.document.kind];
            const pill = consentStatusPill(c.status, c.document.required);
            const line = signatureLine(c, fmt);
            return (
              <li
                key={c.document.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-panel"
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium break-words">{c.document.title}</span>
                      <Pill tone={pill.tone}>{pill.label}</Pill>
                    </p>
                    <p className="num mt-0.5 text-[0.8125rem] text-ink-2">
                      {line ??
                        `${CONSENT_KIND_LABELS[c.document.kind]} · version ${c.document.version}${
                          c.document.required ? "" : " · optional"
                        }${data.minor ? " · a parent or guardian signs" : ""}`}
                    </p>
                  </div>
                </div>
                {c.status !== "signed" ? (
                  <Button
                    variant="light"
                    size="sm"
                    isDisabled={!online}
                    icon={<FileSignature aria-hidden className="size-4" />}
                    onPress={() => setPaper(c)}
                    className="self-start sm:self-center"
                  >
                    Record paper signature
                    <span className="sr-only"> for {c.document.title}</span>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-5 pb-5 text-[0.875rem] text-ink-2">
          {can.settings
            ? "No consent forms are active. Add a waiver or consent in Settings, Consent forms."
            : "The academy hasn't turned on any consent forms."}
        </p>
      )}
      <PaperSignatureSheet consents={data} item={paper} onClose={() => setPaper(null)} />
    </Card>
  );
}
