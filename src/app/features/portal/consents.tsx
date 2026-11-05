import type { PortalConsentDocumentDto, PortalConsentsDto } from "@shared/api-types";
import { CONSENT_SIGNER_LABELS } from "@shared/consents";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileSignature, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { errorMessage, fieldErrors, portalApi } from "../../lib/api";
import { type Format, plural } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { CONSENT_KIND_ICONS, ConsentText, consentStatusPill } from "../consents/consents";
import { PortalCard, QueryGate } from "./bits";
import { useAcademyFormat, usePortalAccount, usePortalConsents } from "./queries";
import { PortalPage, useCurrentStudent } from "./shell";

function signedLine(d: PortalConsentDocumentDto, fmt: Format): string | null {
  const s = d.signature;
  if (!s) return null;
  const when = fmt.date(fmt.dayOf(s.signedAt));
  const who =
    s.relation === "staff"
      ? `Signed on paper by ${s.signerName}`
      : `Signed by ${s.signerName} (${CONSENT_SIGNER_LABELS[s.relation]})`;
  return d.status === "needs_resign"
    ? `${who} on ${when}, before the academy changed it`
    : `${who} on ${when}`;
}

/** Read the document, then sign it by typing a full name (or just read it once it's signed). */
function SignSheet({
  data,
  doc,
  onClose,
}: {
  data: PortalConsentsDto;
  doc: PortalConsentDocumentDto | null;
  onClose: () => void;
}) {
  const online = useOnline();
  const qc = useQueryClient();
  const account = usePortalAccount().data;
  const fmt = useAcademyFormat(data.academy);
  const [name, setName] = useState("");
  const [shown, setShown] = useState<PortalConsentDocumentDto | null>(doc);
  const sign = useMutation({
    meta: { silent: true },
    mutationFn: (v: { documentId: string; signerName: string; version: number }) =>
      portalApi.post<PortalConsentsDto>(
        `/students/${encodeURIComponent(data.student.clientId)}/consents/${v.documentId}/sign`,
        { signerName: v.signerName, version: v.version },
      ),
    onSuccess: (next, v) => {
      const userId = account?.user.id ?? "";
      qc.setQueryData(keys.portal.consents(userId, data.student.clientId), next);
      void qc.invalidateQueries({ queryKey: keys.portal.home(userId) });
      notify({ tone: "success", title: "Signed", body: `Signed by ${v.signerName}.` });
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed when another document opens.
  useEffect(() => {
    if (!doc) return;
    setShown(doc);
    setName(account?.emailIsPlaceholder ? "" : (account?.user.name ?? ""));
    sign.reset();
  }, [doc?.id]);
  const d = doc ?? shown;
  const canSign = data.signer.ok && d !== null && d.status !== "signed";
  const as =
    data.signer.ok && data.signer.relation === "guardian"
      ? `as ${data.student.firstName}'s parent or guardian`
      : "for yourself";
  const errs = fieldErrors(sign.error);
  const submit = () =>
    canSign &&
    online &&
    d &&
    name.trim().length >= 2 &&
    sign.mutate({ documentId: d.id, signerName: name.trim(), version: d.version });
  return (
    <Sheet
      isOpen={doc !== null}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={d?.title ?? "Consent form"}
      description={d ? `${data.academy.name} · version ${d.version}` : undefined}
      footer={
        canSign ? (
          <>
            <Button variant="light" onPress={onClose}>
              Not now
            </Button>
            <Button
              variant="dark"
              isDisabled={!online || name.trim().length < 2}
              isPending={sign.isPending}
              onPress={submit}
              icon={<FileSignature aria-hidden className="size-4.5" />}
            >
              Sign
            </Button>
          </>
        ) : (
          <Button variant="dark" onPress={onClose}>
            Done
          </Button>
        )
      }
    >
      {d ? (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <section
            aria-label={`${d.title} text`}
            className="max-h-[45dvh] overflow-y-auto rounded-[22px] bg-panel p-4 sm:p-5"
          >
            <ConsentText body={d.body} />
          </section>
          {d.signature && d.status === "signed" ? (
            <p className="text-[0.875rem] text-ink-2">{signedLine(d, fmt)}.</p>
          ) : null}
          {canSign ? (
            <>
              <TextField
                label="Type your full name to sign"
                value={name}
                onChange={setName}
                autoComplete="name"
                description={`By typing your name you sign version ${d.version} ${as}, today. The academy keeps the date and time.`}
                error={errs.signerName}
              />
              {sign.error && !errs.signerName ? (
                <InlineError>{errorMessage(sign.error)}</InlineError>
              ) : null}
            </>
          ) : !data.signer.ok && d.status !== "signed" ? (
            <p className="flex items-start gap-2 rounded-[18px] bg-amber-soft px-4 py-3 text-[0.875rem]">
              <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{data.signer.message}</span>
            </p>
          ) : null}
          <button type="submit" hidden />
        </form>
      ) : null}
    </Sheet>
  );
}

function ConsentList({ data }: { data: PortalConsentsDto }) {
  const fmt = useAcademyFormat(data.academy);
  const [open, setOpen] = useState<PortalConsentDocumentDto | null>(null);
  const who = data.signer.ok && data.signer.relation === "self" ? "you" : data.student.firstName;
  return (
    <div className="flex flex-col gap-4">
      {!data.signer.ok ? (
        <p
          role="note"
          className="flex items-start gap-3 rounded-[22px] bg-amber-soft px-4 py-3 text-[0.9375rem]"
        >
          <Lock aria-hidden className="mt-0.5 size-4.5 shrink-0" />
          <span>{data.signer.message}</span>
        </p>
      ) : null}
      <PortalCard
        title={data.missing ? `${plural(data.missing, "form")} to sign` : "Consent forms"}
      >
        {data.documents.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {data.documents.map((d) => {
              const Icon = CONSENT_KIND_ICONS[d.kind];
              const pill = consentStatusPill(d.status, d.required);
              const line = signedLine(d, fmt);
              const action = data.signer.ok && d.status !== "signed" ? "Read and sign" : "Read";
              return (
                <li
                  key={d.id}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span
                      aria-hidden
                      className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-panel"
                    >
                      <Icon className="size-4.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium break-words">{d.title}</span>
                        <Pill tone={pill.tone}>{pill.label}</Pill>
                      </p>
                      <p className="mt-0.5 text-[0.8125rem] text-ink-2">
                        {line ??
                          (d.required
                            ? `Required before ${who === "you" ? "you train" : `${who} trains`}`
                            : "Optional")}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant={action === "Read and sign" ? "dark" : "light"}
                    size="sm"
                    onPress={() => setOpen(d)}
                    className="self-start sm:self-center"
                  >
                    {action}
                    <span className="sr-only"> {d.title}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[0.9375rem] text-ink-2">
            {data.academy.name} hasn't asked for any consent forms.
          </p>
        )}
      </PortalCard>
      <SignSheet data={data} doc={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** A student's consent forms: what's signed, what's missing, and signing for those who may. */
export function PortalConsents({ clientId }: { clientId: string }) {
  const q = usePortalConsents(clientId);
  const { current } = useCurrentStudent();
  const whose = current ? (current.relation === "self" ? "Your" : `${current.firstName}'s`) : "";
  return (
    <PortalPage
      title="Consents"
      subtitle={whose ? `${whose} waivers and consent forms` : undefined}
      students
    >
      <QueryGate query={q}>{(data) => <ConsentList data={data} />}</QueryGate>
    </PortalPage>
  );
}
