import type {
  PortalAcademyDto,
  PortalChargeDto,
  PortalEnrollmentDto,
  PortalMoneyDto,
  PortalPackageDto,
  PortalPaymentDto,
} from "@shared/api-types";
import { CircleDollarSign, QrCode, ReceiptText, Ticket } from "lucide-react";
import { Card, Meter, Pill } from "../../components/ui/display";
import { Skeleton } from "../../components/ui/feedback";
import { publicFileUrl } from "../../lib/api";
import type { Format } from "../../lib/format";
import { CHARGE_KIND_LABELS } from "../clients/client-utils";
import { RenewCard, StudentRequests } from "../enrollment/family";
import { usePortalStudentEnrollments } from "../enrollment/queries";
import { paymentPill, periodText } from "../enrollment/text";
import { PortalCard, QueryGate } from "./bits";
import { balanceState } from "./home";
import { useAcademyFormat, usePortalAcademy, usePortalMoney } from "./queries";
import { PortalPage, useCurrentStudent } from "./shell";

const PACKAGE_STATUS = {
  active: { tone: "mint", label: "Active" },
  exhausted: { tone: "amber", label: "Used up" },
  expired: { tone: "outline", label: "Expired" },
  void: { tone: "outline", label: "Cancelled" },
} as const;

function Packages({ packages, fmt }: { packages: PortalPackageDto[]; fmt: Format }) {
  if (!packages.length) {
    return (
      <PortalCard title="Packages and credits">
        <p className="flex items-start gap-3 text-[0.9375rem] text-ink-2">
          <Ticket aria-hidden className="mt-0.5 size-4.5 shrink-0" />
          <span>Packages the academy sells you show here, with their credits and expiry.</span>
        </p>
      </PortalCard>
    );
  }
  return (
    <section aria-labelledby="portal-packages" className="flex flex-col gap-3">
      <h2 id="portal-packages" className="px-1 text-[1.125rem] font-medium">
        Packages and credits
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {packages.map((p) => {
          const status = PACKAGE_STATUS[p.status];
          const live = p.status === "active";
          return (
            <li
              key={p.id}
              className={`flex flex-col rounded-[28px] p-5 text-ink ${live ? "bg-lavender" : "bg-card"}`}
            >
              <p className="flex items-start justify-between gap-2">
                <span className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">
                  {p.name}
                </span>
                <Pill tone={live ? "white" : status.tone}>{status.label}</Pill>
              </p>
              <p className="num mt-3 text-[2rem] leading-none font-light">
                {p.remaining}
                <span className={`text-[1rem] ${live ? "text-ink/70" : "text-ink-2"}`}>
                  {" "}
                  of {p.creditsTotal} left
                </span>
              </p>
              <span className="mt-3 block">
                <Meter
                  value={p.remaining}
                  max={p.creditsTotal}
                  tone={live && p.remaining <= 1 ? "coral" : "ink"}
                />
              </span>
              <p className={`num mt-2 text-[0.8125rem] ${live ? "text-ink/75" : "text-ink-2"}`}>
                Bought {fmt.date(p.purchasedOn)}
                {p.expiresOn
                  ? ` · ${live ? "use by" : "valid until"} ${fmt.date(p.expiresOn)}`
                  : " · no expiry"}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type HistoryItem =
  | { kind: "charge"; date: string; charge: PortalChargeDto }
  | { kind: "payment"; date: string; payment: PortalPaymentDto };

function paidPill(c: PortalChargeDto, fmt: Format) {
  if (c.amountMinor <= 0) return null;
  if (c.paidMinor >= c.amountMinor) return <Pill tone="mint">Paid</Pill>;
  if (c.paidMinor > 0)
    return (
      <Pill tone="amber">
        <span className="num">{fmt.moneyShort(c.amountMinor - c.paidMinor)} due</span>
      </Pill>
    );
  return <Pill tone="coral">Unpaid</Pill>;
}

function History({ money, fmt }: { money: PortalMoneyDto; fmt: Format }) {
  const items: HistoryItem[] = [
    ...money.charges.map((c) => ({ kind: "charge" as const, date: c.occurredOn, charge: c })),
    ...money.payments.map((p) => ({ kind: "payment" as const, date: p.paidOn, payment: p })),
  ].sort((a, b) => b.date.localeCompare(a.date) || (a.kind === "payment" ? -1 : 1));
  return (
    <PortalCard title="History">
      {items.length ? (
        <ol className="flex flex-col divide-y divide-line">
          {items.map((it) =>
            it.kind === "charge" ? (
              <li
                key={`c-${it.charge.id}`}
                className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-panel text-ink"
                >
                  <ReceiptText className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{it.charge.description}</span>
                  <span className="num block text-[0.8125rem] text-ink-2">
                    {CHARGE_KIND_LABELS[it.charge.kind]} · {fmt.date(it.charge.occurredOn)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="num font-medium">{fmt.money(it.charge.amountMinor)}</span>
                  {paidPill(it.charge, fmt)}
                </span>
              </li>
            ) : (
              <li
                key={`p-${it.payment.id}`}
                className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-mint text-ink"
                >
                  <CircleDollarSign className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Payment received</span>
                  <span className="num block text-[0.8125rem] text-ink-2">
                    {[
                      it.payment.method,
                      it.payment.reference ? `Ref ${it.payment.reference}` : null,
                      fmt.date(it.payment.paidOn),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="num shrink-0 font-medium">
                  {fmt.money(it.payment.amountMinor)}
                </span>
              </li>
            ),
          )}
        </ol>
      ) : (
        <p className="text-[0.9375rem] text-ink-2">
          Charges and the payments the academy records show here, newest first.
        </p>
      )}
    </PortalCard>
  );
}

/**
 * How to pay: the academy's own instructions and QR code. Payment happens outside CoachMan
 * (GCash, bank transfer, cash); the academy records it, and it shows in the history.
 */
function HowToPay({ academy }: { academy: PortalAcademyDto | undefined }) {
  if (!academy) {
    return (
      <PortalCard title="How to pay">
        <Skeleton className="h-24" />
      </PortalCard>
    );
  }
  const qr = publicFileUrl(academy.paymentQrKey);
  const methods = academy.paymentMethods;
  return (
    <PortalCard title="How to pay">
      {academy.paymentInstructions || qr ? (
        <div className="flex flex-col gap-4">
          {academy.paymentInstructions ? (
            <p className="max-w-[65ch] text-[0.9375rem] whitespace-pre-line">
              {academy.paymentInstructions}
            </p>
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
      {methods.length ? (
        <p className="mt-4 text-[0.875rem] text-ink-2">
          Accepted: <span className="text-ink">{methods.join(", ")}</span>
        </p>
      ) : null}
      <p className="mt-3 text-[0.875rem] text-ink-2">
        Once {academy.name} records your payment, it shows in the history here.
      </p>
    </PortalCard>
  );
}

/**
 * What's owed for approved enrollments, beside How to pay. Payment proofs (WS4c) add sending a
 * screenshot of the payment here.
 */
function AmountDue({ requests, fmt }: { requests: PortalEnrollmentDto[]; fmt: Format }) {
  const owed = requests.filter((r) => r.payment && r.payment.dueMinor > 0);
  if (!owed.length) return null;
  return (
    <PortalCard title="To pay">
      <ul className="flex flex-col divide-y divide-line">
        {owed.map((r) => (
          <li key={r.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{r.tier.name}</span>
              <span className="num block text-[0.8125rem] text-ink-2">
                {periodText({ ...r, sessionStartsAt: r.session?.startsAt ?? null }, fmt)}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="num text-[1.375rem] leading-tight font-light">
                {fmt.money(r.payment?.dueMinor ?? 0)}
              </span>
              {r.payment ? (
                <Pill tone={paymentPill(r.payment).tone}>{paymentPill(r.payment).label}</Pill>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[0.875rem] text-ink-2">
        Pay the academy as it asks below. Once it records your payment, this clears.
      </p>
    </PortalCard>
  );
}

/** Payments: the balance, packages and credits, the history, and how to pay. */
export function PortalPayments({ clientId }: { clientId: string }) {
  const money = usePortalMoney(clientId);
  const enroll = usePortalStudentEnrollments(clientId);
  const { current } = useCurrentStudent();
  const academy = usePortalAcademy(money.data?.academy.workspaceId ?? current?.workspaceId);
  const fmt = useAcademyFormat(money.data?.academy);
  const requests = enroll.data?.requests ?? [];
  const renewal = enroll.data?.renewal ?? null;
  return (
    <PortalPage
      title="Payments"
      subtitle={current ? `${current.firstName} ${current.lastName}`.trim() : undefined}
      students
    >
      <QueryGate query={money}>
        {(m) => {
          const b = balanceState(m.balanceMinor, fmt);
          return (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
              <div className="flex flex-col gap-5">
                <Card label="Balance" className="flex flex-col gap-3 p-5">
                  <h2 className="text-[1.125rem] font-medium">Balance</h2>
                  <p className="flex flex-wrap items-center gap-3">
                    <span className="num text-[3rem] leading-none font-light tracking-[-0.03em] lg:text-[3.5rem]">
                      {b.figure}
                    </span>
                    {b.pill}
                  </p>
                  <p className="text-[0.875rem] text-ink-2">
                    {m.balanceMinor > 0
                      ? "Charges not yet covered by payments. How to pay is below."
                      : "Every charge so far is covered by payments."}
                  </p>
                </Card>
                {renewal ? (
                  <div className="grid">
                    <RenewCard renewal={renewal} fmt={fmt} />
                  </div>
                ) : null}
                <StudentRequests requests={requests} fmt={fmt} title="Enrollment requests" />
                <Packages packages={m.packages} fmt={fmt} />
                <History money={m} fmt={fmt} />
              </div>
              <div className="flex flex-col gap-5">
                <AmountDue requests={requests} fmt={fmt} />
                <HowToPay academy={academy.data} />
              </div>
            </div>
          );
        }}
      </QueryGate>
    </PortalPage>
  );
}
