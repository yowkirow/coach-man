import type {
  PortalAcademyDto,
  PortalEnrollmentDto,
  PortalPaymentProofDto,
} from "@shared/api-types";
import { uuidv7 } from "@shared/ids";
import {
  accountNumberParts,
  cashMethodOf,
  checkProofDetails,
  isCashMethod,
  type ProofField,
} from "@shared/payment-proofs";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Copy, ImagePlus, QrCode, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { copyText } from "../../components/domain/invite-link";
import { Button } from "../../components/ui/button";
import { Card, Pill } from "../../components/ui/display";
import { InlineError, Skeleton } from "../../components/ui/feedback";
import {
  MoneyField,
  Segmented,
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/ui/field";
import { errorMessage, fieldErrors, portalApi, publicFileUrl } from "../../lib/api";
import type { Format } from "../../lib/format";
import { prepareProofImage } from "../../lib/images";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { usePortalStudentEnrollments } from "../enrollment/queries";
import { periodText } from "../enrollment/text";
import { ProofThumb } from "../payment-proofs/proof-image";
import { usePortalProofs, useRefreshPortalPayments } from "../payment-proofs/queries";
import { PortalCard, QueryGate } from "./bits";
import { useAcademyFormat, usePortalAcademy, usePortalMoney } from "./queries";
import { PortalPage, useCurrentStudent } from "./shell";

/**
 * How to pay the academy: its own instructions (account and mobile numbers get a copy button),
 * its QR code, and the ways it takes payments. Paying happens outside CoachMan.
 */
export function PayInstructions({
  academy,
  footer,
}: {
  academy: PortalAcademyDto | undefined;
  footer?: ReactNode;
}) {
  if (!academy) {
    return (
      <PortalCard title="How to pay">
        <Skeleton className="h-24" />
      </PortalCard>
    );
  }
  const qr = publicFileUrl(academy.paymentQrKey);
  const numbers = academy.paymentInstructions
    ? accountNumberParts(academy.paymentInstructions).filter((p) => p.copy)
    : [];
  return (
    <PortalCard title="How to pay">
      {academy.paymentInstructions || qr ? (
        <div className="flex flex-col gap-4">
          {academy.paymentInstructions ? (
            <p className="max-w-[65ch] text-[0.9375rem] whitespace-pre-line">
              {academy.paymentInstructions}
            </p>
          ) : null}
          {numbers.length ? (
            <ul aria-label="Numbers to copy" className="flex flex-col gap-2">
              {numbers.map((n) => (
                <li
                  key={n.text}
                  className="flex items-center justify-between gap-3 rounded-[16px] bg-panel py-1.5 pr-1.5 pl-4"
                >
                  <span className="num text-[1rem] font-medium tracking-[0.02em]">{n.text}</span>
                  <Button
                    variant="light"
                    size="sm"
                    aria-label={`Copy ${n.text}`}
                    icon={<Copy aria-hidden className="size-4" />}
                    onPress={() =>
                      void copyText(
                        n.copy ?? n.text,
                        "Number",
                        "Paste it into your GCash or bank app.",
                      )
                    }
                  >
                    Copy
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {qr ? (
            <figure className="flex flex-col items-start gap-2">
              <img
                src={qr}
                alt={`Payment QR code for ${academy.name}`}
                className="size-56 rounded-[22px] bg-panel object-contain p-3"
              />
              <figcaption className="text-[0.8125rem] text-ink-2">
                Scan it in your bank or e-wallet app.
              </figcaption>
            </figure>
          ) : null}
        </div>
      ) : (
        <p className="flex items-start gap-3 text-[0.9375rem] text-ink-2">
          <QrCode aria-hidden className="mt-0.5 size-4.5 shrink-0" />
          <span>
            {academy.name} hasn't put payment details here yet. Ask them how they'd like to be paid.
          </span>
        </p>
      )}
      {academy.paymentMethods.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[0.875rem] text-ink-2">Ways to pay</span>
          {academy.paymentMethods.map((m) => (
            <Pill key={m} tone="outline">
              {m}
            </Pill>
          ))}
        </div>
      ) : null}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </PortalCard>
  );
}

/** What's due: the request's charge when paying for one, else the student's balance. */
function DueCard({
  request,
  requestLoading,
  balanceMinor,
  fmt,
  whose,
}: {
  request: PortalEnrollmentDto | null;
  requestLoading: boolean;
  balanceMinor: number;
  fmt: Format;
  /** "Your" or "Mia's". */
  whose: string;
}) {
  if (requestLoading) {
    return (
      <Card className="p-5">
        <Skeleton className="h-24" />
      </Card>
    );
  }
  const due = request?.payment ? request.payment.dueMinor : Math.max(0, balanceMinor);
  const pending = request?.proofs?.find((p) => p.status === "pending");
  return (
    <section aria-labelledby="pay-due" className="rounded-[28px] bg-lime p-5 text-ink">
      <h2 id="pay-due" className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">
        {request ? `${request.tier.name}` : "Amount due"}
      </h2>
      <p className="num mt-1 text-[0.875rem] text-ink/75">
        {request
          ? periodText({ ...request, sessionStartsAt: request.session?.startsAt ?? null }, fmt)
          : `${whose} balance with the academy`}
      </p>
      <p className="num mt-4 text-[3rem] leading-none font-light tracking-[-0.03em] lg:text-[3.5rem]">
        {fmt.money(due)}
      </p>
      <p className="mt-2 text-[0.875rem] text-ink/75">
        {due > 0
          ? request
            ? `Due for this request${balanceMinor > due ? `. ${whose} whole balance is ${fmt.money(balanceMinor)}.` : "."}`
            : "Charges not covered by payments yet."
          : request
            ? "This request is paid. Nothing more to send."
            : "Nothing due right now. You can still send proof of a payment the academy asked for."}
      </p>
      {pending ? (
        <p className="mt-3 rounded-[18px] bg-white/45 px-4 py-3 text-[0.875rem]">
          You sent a proof on {fmt.day(fmt.dayOf(pending.createdAt))}. The academy is checking it.
        </p>
      ) : null}
    </section>
  );
}

interface PickedImage {
  blob: Blob;
  url: string;
  resized: boolean;
}

const kilobytes = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;

/**
 * Sending proof of a payment: the screenshot (shrunk on the phone when it's too big), the amount,
 * how it was paid, the reference, the date, and a note; or "I'll pay cash at the court", with no
 * screenshot. The academy reviews it; the family sees where it stands on Payments.
 */
function ProofForm({
  clientId,
  academy,
  fmt,
  defaultAmount,
  requestId,
  resubmit,
}: {
  clientId: string;
  academy: PortalAcademyDto | undefined;
  fmt: Format;
  defaultAmount: number | null;
  requestId: string | null;
  resubmit: PortalPaymentProofDto | null;
}) {
  const online = useOnline();
  const navigate = useNavigate();
  const refresh = useRefreshPortalPayments();
  const methods = academy?.paymentMethods ?? [];
  const cash = cashMethodOf(methods);
  const firstOnline = methods.find((m) => !isCashMethod(m)) ?? methods[0] ?? "";
  const today = fmt.today();
  const [id] = useState(() => uuidv7());
  const [mode, setMode] = useState<"screenshot" | "cash">("screenshot");
  const [image, setImage] = useState<PickedImage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [amount, setAmount] = useState<number | null>(resubmit?.amountMinor ?? defaultAmount);
  const [method, setMethod] = useState(resubmit?.method ?? "");
  const [reference, setReference] = useState(resubmit?.reference ?? "");
  const [paidOn, setPaidOn] = useState(resubmit?.paidOn ?? today);
  const [note, setNote] = useState("");
  const [local, setLocal] = useState<Partial<Record<ProofField, string>>>({});
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // The academy's methods arrive after the page: pick the first online one, once.
  useEffect(() => {
    if (!method && firstOnline) setMethod(firstOnline);
  }, [method, firstOnline]);
  useEffect(() => {
    if (amount === null && defaultAmount) setAmount(defaultAmount);
  }, [amount, defaultAmount]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: free the preview when it's replaced or the page closes.
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image?.url],
  );

  const usingCash = mode === "cash" && cash !== null;
  const chosenMethod = usingCash ? (cash as string) : method;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setImageError(null);
    setPreparing(true);
    try {
      const prepared = await prepareProofImage(file);
      setImage({ ...prepared, url: URL.createObjectURL(prepared.blob) });
      setLocal((l) => ({ ...l, proof: undefined }));
    } catch (err) {
      setImageError(errorMessage(err));
    } finally {
      setPreparing(false);
      if (input.current) input.current.value = "";
    }
  };

  const send = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const data = {
        id,
        amountMinor: amount,
        method: chosenMethod,
        reference: usingCash ? null : reference.trim() || null,
        paidOn: usingCash ? today : paidOn,
        note: note.trim() || null,
        enrollmentId: requestId,
        resubmitOf: resubmit?.id ?? null,
      };
      const path = `/students/${encodeURIComponent(clientId)}/payment-proofs`;
      if (!usingCash && image) {
        const form = new FormData();
        form.set("data", JSON.stringify(data));
        const ext =
          image.blob.type === "image/png"
            ? "png"
            : image.blob.type === "image/webp"
              ? "webp"
              : "jpg";
        form.set("proof", image.blob, `payment.${ext}`);
        return portalApi.post<PortalPaymentProofDto>(path, form);
      }
      return portalApi.post<PortalPaymentProofDto>(path, data);
    },
    onSuccess: () => {
      refresh();
      notify({
        tone: "success",
        title: usingCash ? "The academy knows you'll pay cash" : "Proof sent",
        body: `${academy?.name ?? "The academy"} checks it, then it shows as confirmed on Payments.`,
      });
      void navigate({ to: "/my/$clientId/payments", params: { clientId } });
    },
  });

  const submit = () => {
    const check = checkProofDetails({
      amountMinor: amount ?? 0,
      method: chosenMethod,
      methods,
      paidOn: usingCash ? today : paidOn,
      today,
      reference: usingCash ? null : reference,
      hasImage: !usingCash && Boolean(image),
    });
    if (!check.ok) {
      setLocal({ [check.field]: check.message });
      return;
    }
    setLocal({});
    send.mutate();
  };

  const server = fieldErrors(send.error);
  const err = (f: ProofField) => local[f] ?? server[f];
  const general = send.error && !Object.keys(server).length ? errorMessage(send.error) : null;

  return (
    <section aria-labelledby="pay-proof" className="rounded-[28px] bg-card p-5">
      <h2 id="pay-proof" className="text-[1.125rem] font-medium">
        {resubmit ? "Send a new proof" : "Send proof of payment"}
      </h2>
      <p className="mt-1 max-w-[60ch] text-[0.875rem] text-ink-2">
        Paid by GCash or a bank transfer? Add the screenshot from your app. The academy checks it,
        then records your payment.
      </p>
      {resubmit ? (
        <p className="mt-3 flex gap-2.5 rounded-2xl bg-coral-soft px-4 py-3 text-[0.875rem]">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            The academy didn't accept your proof of {fmt.day(resubmit.paidOn)}
            {resubmit.rejectReason ? (
              <>
                : <span className="font-medium">“{resubmit.rejectReason}”</span>
              </>
            ) : null}
            . Fix what they asked, then send it again.
          </span>
        </p>
      ) : null}
      <form
        className="mt-5 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {cash ? (
          <Segmented
            label="How are you paying?"
            options={[
              { id: "screenshot", label: "Online" },
              { id: "cash", label: "Cash at the court" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as "screenshot" | "cash")}
          />
        ) : null}

        {usingCash ? (
          <p className="rounded-[18px] bg-panel px-4 py-3 text-[0.9375rem]">
            Bring the cash to the court. The academy confirms it here once they have it. No
            screenshot needed.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-medium text-ink-2">
              Screenshot of the payment
            </span>
            <input
              ref={input}
              id={inputId}
              type="file"
              accept="image/*"
              aria-label="Screenshot of the payment"
              className="peer sr-only"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            {image ? (
              <div className="flex items-start gap-4 rounded-[22px] bg-panel p-3">
                <ProofThumb src={image.url} label="Your payment screenshot" size="lg" />
                <div className="flex min-w-0 flex-col gap-1 py-1">
                  <p className="font-medium">Ready to send</p>
                  <p className="num text-[0.8125rem] text-ink-2">
                    {image.resized
                      ? `Made smaller to send · ${kilobytes(image.blob.size)}`
                      : kilobytes(image.blob.size)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="light" size="sm" onPress={() => input.current?.click()}>
                      Change
                    </Button>
                    <Button variant="ghost" size="sm" onPress={() => setImage(null)}>
                      Remove
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <label
                htmlFor={inputId}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void pick(e.dataTransfer.files?.[0]);
                }}
                className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed px-4 py-6 text-center transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink ${
                  dragging
                    ? "border-ink bg-lime-soft"
                    : err("proof") || imageError
                      ? "border-coral bg-card"
                      : "border-line-strong bg-card hover:bg-panel"
                }`}
              >
                <span className="flex size-12 items-center justify-center rounded-full bg-lime text-ink">
                  <ImagePlus aria-hidden className="size-5" />
                </span>
                <span className="font-medium">
                  {preparing ? "Getting it ready…" : "Add the screenshot"}
                </span>
                <span className="max-w-[40ch] text-[0.8125rem] text-ink-2">
                  From GCash or your bank app. Big photos are made smaller to send.
                </span>
              </label>
            )}
            {imageError || err("proof") ? (
              <span role="alert" className="text-[0.8125rem] font-medium text-[#b42318]">
                {imageError ?? err("proof")}
              </span>
            ) : null}
          </div>
        )}

        <MoneyField
          label={usingCash ? "Amount you'll pay" : "Amount paid"}
          currency={fmt.currency}
          valueMinor={amount}
          onChange={setAmount}
          error={err("amountMinor")}
        />
        {usingCash ? null : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Paid with"
                options={methods.map((m) => ({ id: m, label: m }))}
                value={method || null}
                onChange={setMethod}
                error={err("method")}
              />
              <TextField
                label="Date paid"
                type="date"
                value={paidOn}
                onChange={setPaidOn}
                max={today}
                error={err("paidOn")}
              />
            </div>
            <TextField
              label="Reference number"
              value={reference}
              onChange={setReference}
              autoComplete="off"
              inputMode="text"
              description="GCash and bank apps show it on the receipt. It helps the academy find your payment."
              error={err("reference")}
            />
          </>
        )}
        <TextAreaField
          label="Note (optional)"
          value={note}
          onChange={setNote}
          rows={2}
          placeholder={
            usingCash ? "When you'll bring it" : "Paid from another account, part payment…"
          }
        />
        {general ? <InlineError>{general}</InlineError> : null}
        {!online ? (
          <p className="text-[0.875rem] text-ink-2">
            You're offline. Reconnect to send this to the academy.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="dark"
            size="lg"
            isDisabled={!online || preparing}
            isPending={send.isPending}
          >
            {usingCash ? "Tell the academy" : "Send proof"}
          </Button>
          <Link
            to="/my/$clientId/payments"
            params={{ clientId }}
            className="rounded-sm text-[0.9375rem] font-medium text-ink-2 underline decoration-line-strong underline-offset-4 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            Not now
          </Link>
        </div>
      </form>
    </section>
  );
}

/**
 * The Pay screen (/my/<student>/pay): what's due (a request's charge, or the balance), how to pay
 * the academy, and sending proof. Reached from "To pay", a request's card, and Payments.
 */
export function PortalPay({
  clientId,
  requestId,
  resubmitId,
}: {
  clientId: string;
  requestId: string | null;
  resubmitId: string | null;
}) {
  const money = usePortalMoney(clientId);
  const enroll = usePortalStudentEnrollments(clientId);
  const proofs = usePortalProofs(clientId);
  const { current } = useCurrentStudent();
  const academy = usePortalAcademy(money.data?.academy.workspaceId ?? current?.workspaceId);
  const fmt = useAcademyFormat(money.data?.academy);
  const request = requestId
    ? (enroll.data?.requests.find((r) => r.id === requestId && r.status === "approved") ?? null)
    : null;
  const resubmit = resubmitId
    ? (proofs.data?.proofs.find((p) => p.id === resubmitId && p.status === "rejected") ?? null)
    : null;
  const whose = current?.relation === "self" ? "Your" : current ? `${current.firstName}'s` : "The";
  const waiting = (requestId && enroll.isPending) || (resubmitId && proofs.isPending);
  return (
    <PortalPage
      title="Pay"
      subtitle={current ? `${current.firstName} ${current.lastName}`.trim() : undefined}
    >
      <QueryGate query={money}>
        {(m) => {
          const due = request?.payment ? request.payment.dueMinor : Math.max(0, m.balanceMinor);
          return (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
              <DueCard
                request={request}
                requestLoading={Boolean(requestId && enroll.isPending)}
                balanceMinor={m.balanceMinor}
                fmt={fmt}
                whose={whose}
              />
              <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
                <PayInstructions academy={academy.data} />
              </div>
              {waiting || !academy.data ? (
                <Card className="p-5">
                  <Skeleton className="h-64" />
                </Card>
              ) : (
                <ProofForm
                  key={`${requestId ?? ""}-${resubmit?.id ?? ""}`}
                  clientId={clientId}
                  academy={academy.data}
                  fmt={fmt}
                  defaultAmount={due > 0 ? due : null}
                  requestId={request?.id ?? null}
                  resubmit={resubmit}
                />
              )}
            </div>
          );
        }}
      </QueryGate>
    </PortalPage>
  );
}
