import type {
  PortalConsentDocumentDto,
  PortalEnrollmentDto,
  PortalRenewalDto,
} from "@shared/api-types";
import { uuidv7 } from "@shared/ids";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CalendarSync, ClipboardList, Lock } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { Checkbox, TextField } from "../../components/ui/field";
import { ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { errorMessage, portalApi } from "../../lib/api";
import type { Format } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { ConsentText } from "../consents/consents";
import { usePortalAccount } from "../portal/queries";
import { enrollmentStatusPill, paymentPill, periodText } from "./text";

/** "Monthly · December 2026", "Trial · Tue 10 Nov · 7:00 PM". */
function whatAndWhen(r: PortalEnrollmentDto, fmt: Format) {
  return `${r.tier.name} · ${periodText(
    { ...r, sessionStartsAt: r.session?.startsAt ?? null },
    fmt,
  )}`;
}

function useRefreshPortal() {
  const qc = useQueryClient();
  const userId = usePortalAccount().data?.user.id ?? "";
  return () => {
    void qc.invalidateQueries({ queryKey: keys.portal.home(userId) });
    void qc.invalidateQueries({ queryKey: ["portal", userId, "enrollments"] });
    void qc.invalidateQueries({ queryKey: ["portal", userId, "money"] });
    void qc.invalidateQueries({ queryKey: ["portal", userId, "consents"] });
  };
}

/** One request: what it's for, where it stands, the academy's words, and what's owed. */
export function RequestCard({
  r,
  fmt,
  showStudent = false,
}: {
  r: PortalEnrollmentDto;
  fmt: Format;
  showStudent?: boolean;
}) {
  const online = useOnline();
  const refresh = useRefreshPortal();
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation({
    meta: { silent: true },
    mutationFn: () => portalApi.post<PortalEnrollmentDto>(`/enrollments/${r.id}/cancel`),
    onSuccess: () => {
      setConfirming(false);
      notify({ tone: "success", title: "Request cancelled" });
      refresh();
    },
  });
  const pill = enrollmentStatusPill(r.status);
  const owed = r.payment && r.payment.dueMinor > 0 ? r.payment : null;
  const headingId = `request-${r.id}`;
  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-[22px] bg-panel p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="num font-medium">
            {showStudent ? `${r.student.firstName}: ` : ""}
            {whatAndWhen(r, fmt)}
          </h3>
          <p className="text-[0.875rem] text-ink-2">
            {[r.renewal ? "Renewal" : "New enrollment", r.programName].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Pill tone={pill.tone}>{pill.label}</Pill>
      </div>
      {r.status === "requested" ? (
        <p className="text-[0.875rem]">
          Sent {fmt.date(fmt.dayOf(r.createdAt))}. The academy reviews it, then you pay.
        </p>
      ) : r.status === "waitlisted" ? (
        <p className="text-[0.875rem]">
          On the waitlist. The academy will approve it when a place opens.
          {r.note ? <span className="mt-1 block text-ink-2">“{r.note}”</span> : null}
        </p>
      ) : r.status === "declined" ? (
        <p className="text-[0.875rem]">
          {r.note ? (
            <>
              The academy declined it: <span className="font-medium">{r.note}</span>
            </>
          ) : (
            "The academy declined it."
          )}
        </p>
      ) : r.status === "cancelled" ? (
        <p className="text-[0.875rem] text-ink-2">You cancelled this request.</p>
      ) : r.payment ? (
        <div className="flex flex-wrap items-center gap-2 text-[0.875rem]">
          <Pill tone={paymentPill(r.payment).tone}>{paymentPill(r.payment).label}</Pill>
          {owed ? (
            <span className="num">
              <span className="font-medium">{fmt.money(owed.dueMinor)}</span> due
            </span>
          ) : (
            <span>Approved and paid. See you on court.</span>
          )}
          {owed ? (
            <Link
              to="/my/$clientId/payments"
              params={{ clientId: r.clientId }}
              className="inline-flex items-center gap-1 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
            >
              How to pay
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="text-[0.875rem]">Approved.</p>
      )}
      {r.canCancel ? (
        <div>
          <Button
            variant="light"
            size="sm"
            isDisabled={!online}
            onPress={() => setConfirming(true)}
          >
            Cancel request
          </Button>
        </div>
      ) : null}
      <ConfirmSheet
        isOpen={confirming}
        onOpenChange={(o) => {
          setConfirming(o);
          if (!o) cancel.reset();
        }}
        title="Cancel this request?"
        body={
          <div className="flex flex-col gap-3">
            <p>
              {r.student.firstName}'s request for {whatAndWhen(r, fmt)} is withdrawn. You can send a
              new one from the academy's page.
            </p>
            {cancel.error ? <InlineError>{errorMessage(cancel.error)}</InlineError> : null}
          </div>
        }
        confirmLabel="Cancel request"
        isPending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </article>
  );
}

/** Sign the forms a renewal needs, then renew (one batch on the server). */
function RenewSheet({
  renewal,
  fmt,
  isOpen,
  onClose,
}: {
  renewal: PortalRenewalDto;
  fmt: Format;
  isOpen: boolean;
  onClose: () => void;
}) {
  const online = useOnline();
  const refresh = useRefreshPortal();
  const account = usePortalAccount().data;
  const [agreed, setAgreed] = useState<string[]>([]);
  const [name, setName] = useState(account?.emailIsPlaceholder ? "" : (account?.user.name ?? ""));
  const [requestId] = useState(() => uuidv7());
  const renew = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      portalApi.post(`/students/${encodeURIComponent(renewal.clientId)}/renew`, {
        id: requestId,
        signatures: renewal.consents.map((d) => ({
          documentId: d.id,
          version: d.version,
          signerName: name.trim(),
        })),
      }),
    onSuccess: () => {
      notify({
        tone: "success",
        title: "Renewal sent",
        body: `${renewal.tierName} for ${fmt.month(renewal.startMonth)}`,
      });
      onClose();
      refresh();
    },
  });
  const ready =
    renewal.consents.every((d) => agreed.includes(d.id)) && name.trim().length >= 2 && online;
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={`Renew for ${fmt.month(renewal.startMonth)}`}
      description={`${renewal.tierName} for ${renewal.student.firstName}. Sign ${renewal.consents.length === 1 ? "this form" : "these forms"} first.`}
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Not now
          </Button>
          <Button
            variant="dark"
            isDisabled={!ready}
            isPending={renew.isPending}
            onPress={() => renew.mutate()}
          >
            Sign and renew
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {renewal.consents.map((d: PortalConsentDocumentDto) => (
          <section key={d.id} aria-labelledby={`renew-doc-${d.id}`} className="flex flex-col gap-3">
            <h3 id={`renew-doc-${d.id}`} className="font-medium">
              {d.title}
              {d.status === "needs_resign" ? (
                <span className="ml-2 align-middle">
                  <Pill tone="amber">Changed since you signed</Pill>
                </span>
              ) : null}
            </h3>
            <section
              aria-label={`${d.title} text`}
              className="max-h-[36dvh] overflow-y-auto rounded-[18px] bg-panel p-4"
            >
              <ConsentText body={d.body} />
            </section>
            <Checkbox
              isSelected={agreed.includes(d.id)}
              onChange={(on) =>
                setAgreed((a) => (on ? [...new Set([...a, d.id])] : a.filter((x) => x !== d.id)))
              }
            >
              I've read and agree to “{d.title}”
            </Checkbox>
          </section>
        ))}
        <TextField
          label="Type your full name to sign"
          value={name}
          onChange={setName}
          autoComplete="name"
        />
        {renew.error ? <InlineError>{errorMessage(renew.error)}</InlineError> : null}
      </div>
    </Sheet>
  );
}

/** "Renew for next month": one tap, or the forms to sign first. */
export function RenewCard({ renewal, fmt }: { renewal: PortalRenewalDto; fmt: Format }) {
  const online = useOnline();
  const refresh = useRefreshPortal();
  const [signing, setSigning] = useState(false);
  const [requestId] = useState(() => uuidv7());
  const renew = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      portalApi.post(`/students/${encodeURIComponent(renewal.clientId)}/renew`, {
        id: requestId,
        signatures: [],
      }),
    onSuccess: () => {
      notify({
        tone: "success",
        title: "Renewal sent",
        body: `${renewal.tierName} for ${fmt.month(renewal.startMonth)}`,
      });
      refresh();
    },
  });
  const blocked = !renewal.allowed.ok;
  const headingId = `renew-${renewal.clientId}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-[28px] bg-lime p-5 text-ink sm:col-span-2"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-lime"
        >
          <CalendarSync className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3
            id={headingId}
            className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]"
          >
            Renew for {fmt.month(renewal.startMonth)}
          </h3>
          <p className="num mt-1 text-[0.875rem] text-ink/75">
            {renewal.tierName} · {fmt.money(renewal.priceMinor)} · valid until{" "}
            {fmt.date(renewal.expiresOn)}
          </p>
        </div>
      </div>
      {blocked ? (
        <p className="flex items-start gap-2 rounded-[18px] bg-white/45 px-4 py-3 text-[0.875rem]">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{renewal.allowed.ok ? "" : renewal.allowed.message}</span>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="dark"
            isDisabled={!online}
            isPending={renew.isPending}
            onPress={() => (renewal.consents.length ? setSigning(true) : renew.mutate())}
          >
            Renew for next month
          </Button>
          <span className="text-[0.8125rem] text-ink/75">
            {renewal.consents.length
              ? `${renewal.consents.length === 1 ? "A form" : "Forms"} to sign first`
              : "The academy confirms it, then you pay."}
          </span>
        </div>
      )}
      {renew.error ? <InlineError>{errorMessage(renew.error)}</InlineError> : null}
      {renewal.consents.length ? (
        <RenewSheet
          renewal={renewal}
          fmt={fmt}
          isOpen={signing}
          onClose={() => setSigning(false)}
        />
      ) : null}
    </section>
  );
}

/** A student's requests (newest first) as a card on the portal. */
export function StudentRequests({
  requests,
  fmt,
  title = "Enrollment",
}: {
  requests: PortalEnrollmentDto[];
  fmt: Format;
  title?: string;
}) {
  if (!requests.length) return null;
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-[28px] bg-card p-5 sm:col-span-2"
    >
      <h3 className="flex items-center gap-2 text-[1.125rem] font-medium">
        <ClipboardList aria-hidden className="size-5" />
        {title}
      </h3>
      <div className="flex flex-col gap-2">
        {requests.map((r) => (
          <RequestCard key={r.id} r={r} fmt={fmt} />
        ))}
      </div>
    </section>
  );
}

/** The portal's way into enrolling (Home, More). */
export function EnrollLinkCard() {
  return (
    <Link
      to="/my/enroll"
      className="flex items-center gap-4 rounded-[24px] bg-card p-4 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-lime text-ink">
        <ClipboardList aria-hidden className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[1rem] font-medium">Enroll</span>
        <span className="block text-[0.875rem] text-ink-2">
          Programs and packages, for you or a child
        </span>
      </span>
      <ArrowUpRight aria-hidden className="size-4.5 shrink-0 text-ink-3" />
    </Link>
  );
}
