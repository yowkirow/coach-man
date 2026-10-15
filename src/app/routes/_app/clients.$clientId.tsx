import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SearchX, WifiOff } from "lucide-react";
import { Page, ShellAside } from "../../components/layout/app-shell";
import { buttonClass } from "../../components/ui/button";
import { Card } from "../../components/ui/display";
import { EmptyState, ErrorState } from "../../components/ui/feedback";
import { type ProfileSearch, parseProfileSearch } from "../../features/clients/client-utils";
import { ClientProfile, ProfileSkeleton } from "../../features/clients/profile";
import { useClientDetail, useProgress, useStatement } from "../../features/clients/queries";
import { ClientWorklist } from "../../features/clients/worklist";
import { RecordPaymentSheet, type SelectedClient } from "../../features/money/record-payment-sheet";
import { SellPackageSheet } from "../../features/packages/sell-package-sheet";
import { ApiRequestError, errorMessage } from "../../lib/api";

export const Route = createFileRoute("/_app/clients/$clientId")({
  validateSearch: (
    s: Record<string, unknown>,
  ): {
    tab?: "overview" | "progress" | "sessions" | "money";
    sell?: "1";
    pay?: "1";
  } => parseProfileSearch(s),
  component: ClientProfilePage,
});

function ClientProfilePage() {
  const { clientId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const detail = useClientDetail(clientId);
  // Start progress and the statement alongside the profile instead of after it.
  useProgress(clientId);
  useStatement(clientId);
  const tab = search.tab ?? "overview";
  const c = detail.data?.client;

  // Tabs and the sell/pay sheets live in the URL; changes replace history instead of piling up.
  const patch = (p: Partial<ProfileSearch>) =>
    void navigate({
      search: (prev: ProfileSearch) => {
        const next: ProfileSearch = { ...prev, ...p };
        if (!next.tab || next.tab === "overview") delete next.tab;
        if (!next.sell) delete next.sell;
        if (!next.pay) delete next.pay;
        return next;
      },
      replace: true,
    });

  const selected: SelectedClient | null = c
    ? {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        photoKey: c.photoKey,
        balanceMinor: c.balanceMinor,
      }
    : null;

  return (
    <>
      <ShellAside>
        <ClientWorklist selectedId={clientId} current={c} tab={tab} />
      </ShellAside>
      <Page className="pb-8">
        {detail.data ? (
          <ClientProfile
            detail={detail.data}
            tab={tab}
            onTab={(t) => patch({ tab: t })}
            onSell={() => patch({ sell: "1" })}
            onPay={() => patch({ pay: "1" })}
          />
        ) : detail.isPending && detail.fetchStatus === "paused" ? (
          <Card className="px-6 py-2">
            <EmptyState
              icon={<WifiOff aria-hidden className="size-5" />}
              title="This client isn't saved on this device"
              body="Profiles you've opened while online stay readable offline. Reconnect to open this one."
              action={
                <Link to="/clients" className={buttonClass("dark")}>
                  All clients
                </Link>
              }
            />
          </Card>
        ) : detail.isPending ? (
          <ProfileSkeleton />
        ) : detail.error instanceof ApiRequestError && detail.error.status === 404 ? (
          <Card className="px-6 py-2">
            <EmptyState
              icon={<SearchX aria-hidden className="size-5" />}
              title="This client isn't here anymore"
              body="They may have been deleted. Everyone else is in your client list."
              action={
                <Link to="/clients" className={buttonClass("dark")}>
                  All clients
                </Link>
              }
            />
          </Card>
        ) : (
          <Card className="px-6 py-2">
            <ErrorState
              title="Couldn't load this client"
              message={errorMessage(detail.error)}
              onRetry={() => void detail.refetch()}
            />
          </Card>
        )}
      </Page>
      {selected ? (
        <>
          <SellPackageSheet
            isOpen={search.sell === "1"}
            onOpenChange={(open) => {
              if (!open) patch({ sell: undefined });
            }}
            client={selected}
            lockClient
          />
          <RecordPaymentSheet
            isOpen={search.pay === "1"}
            onOpenChange={(open) => {
              if (!open) patch({ pay: undefined });
            }}
            client={selected}
            lockClient
          />
        </>
      ) : null}
    </>
  );
}
