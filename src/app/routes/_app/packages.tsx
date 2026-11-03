import type { PackageTemplateDto, RateDto } from "@shared/api-types";
import type { RateKind } from "@shared/domain";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { Page, ShellAside, useIsDesktop } from "../../components/layout/app-shell";
import { NoAccess } from "../../components/layout/no-access";
import { Button, IconButton } from "../../components/ui/button";
import { PageHeader, PillTabs } from "../../components/ui/display";
import { Skeleton } from "../../components/ui/feedback";
import { type CatalogTab, useToggleActive } from "../../features/packages/catalog";
import { PackageGrid, RateGroups } from "../../features/packages/catalog-views";
import { PackageTemplateSheet } from "../../features/packages/package-sheet";
import { CatalogPanel, CreditsExplainer } from "../../features/packages/panel";
import { RateSheet } from "../../features/packages/rate-sheet";
import { SellPackageSheet } from "../../features/packages/sell-package-sheet";
import { ConnectionPill } from "../../features/settings/offline";
import { plural } from "../../lib/format";
import { useCan, usePackageTemplates, useRates } from "../../lib/hooks";
import { useOnline } from "../../lib/offline";

interface PackagesSearch {
  sell?: "1";
  tab?: CatalogTab;
}

export const Route = createFileRoute("/_app/packages")({
  // A hand-typed `?sell=1` arrives as the number 1; in-app links send the string.
  validateSearch: (s: Record<string, unknown>): PackagesSearch => ({
    sell: s.sell === "1" || s.sell === 1 ? "1" : undefined,
    tab: s.tab === "packages" || s.tab === "rates" ? s.tab : undefined,
  }),
  component: PackagesRoute,
});

function PackagesRoute() {
  const can = useCan();
  if (!can.catalog) {
    return (
      <NoAccess
        title="Packages & rates"
        body="The rate card and packages are set by the academy's owner and admins. You see each player's credits on their profile and at check-in."
      />
    );
  }
  return <PackagesPage />;
}

function PackagesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const desktop = useIsDesktop();
  const online = useOnline();
  const templates = usePackageTemplates();
  const rates = useRates();
  const toggleTemplate = useToggleActive("package");
  const toggleRate = useToggleActive("rate");
  const tab: CatalogTab = search.tab ?? "packages";

  const [sellTemplate, setSellTemplate] = useState<string | null>(null);
  const [sellOpen, setSellOpen] = useState(false);
  const [template, setTemplate] = useState<PackageTemplateDto | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [rate, setRate] = useState<RateDto | null>(null);
  const [rateKind, setRateKind] = useState<RateKind>("private");
  const [rateOpen, setRateOpen] = useState(false);

  const setTab = (t: CatalogTab) =>
    void navigate({
      search: (p: PackagesSearch) => ({ ...p, tab: t === "packages" ? undefined : t }),
      replace: true,
    });
  const sell = (templateId: string | null) => {
    setSellTemplate(templateId);
    setSellOpen(true);
  };
  const newTemplate = () => {
    setTemplate(null);
    setTemplateOpen(true);
  };
  const newRate = (kind: RateKind = "private") => {
    setRate(null);
    setRateKind(kind);
    setRateOpen(true);
  };
  const createNew = () => (tab === "rates" ? newRate() : newTemplate());
  const newLabel = tab === "rates" ? "New rate" : "New package";

  const forSale = templates.data?.filter((t) => t.active).length;
  const onCard = rates.data?.filter((r) => r.active).length;
  const counts =
    forSale !== undefined && onCard !== undefined ? (
      <span className="num">
        {plural(forSale, "package")} for sale · {plural(onCard, "rate")} on the card
      </span>
    ) : (
      <Skeleton className="h-4 w-44" />
    );
  const shortCounts =
    forSale !== undefined && onCard !== undefined ? (
      <span className="num">
        {forSale} for sale · {plural(onCard, "rate")}
      </span>
    ) : (
      <Skeleton className="h-4 w-32" />
    );

  const tabs = (
    <PillTabs
      label="Packages and rates"
      fill
      selected={tab}
      onChange={(id) => setTab(id as CatalogTab)}
      tabs={[
        {
          id: "packages",
          label: templates.data ? `Packages · ${templates.data.length}` : "Packages",
          content: (
            <div className="flex flex-col gap-4">
              <PackageGrid
                query={templates}
                onNew={newTemplate}
                onEdit={(t) => {
                  setTemplate(t);
                  setTemplateOpen(true);
                }}
                onSell={(t) => sell(t.id)}
                onToggle={(t, active) => toggleTemplate.mutate({ id: t.id, name: t.name, active })}
              />
              {desktop ? null : <CreditsExplainer />}
            </div>
          ),
        },
        {
          id: "rates",
          label: rates.data ? `Rate card · ${rates.data.length}` : "Rate card",
          content: (
            <RateGroups
              query={rates}
              onNew={newRate}
              onEdit={(r) => {
                setRate(r);
                setRateOpen(true);
              }}
              onToggle={(r, active) => toggleRate.mutate({ id: r.id, name: r.name, active })}
            />
          ),
        },
      ]}
    />
  );

  return (
    <>
      <ShellAside>
        <CatalogPanel
          templates={templates.data}
          rates={rates.data}
          onTab={setTab}
          onSell={() => sell(null)}
        />
      </ShellAside>

      {desktop ? (
        <Page className="flex flex-col gap-5 pb-6">
          <PageHeader
            title="Packages & rates"
            subtitle={counts}
            actions={
              <>
                <ConnectionPill />
                <Button
                  variant="light"
                  icon={<Plus aria-hidden className="size-4.5" />}
                  isDisabled={!online}
                  onPress={createNew}
                >
                  {newLabel}
                </Button>
                <Button
                  variant="dark"
                  icon={<Ticket aria-hidden className="size-4.5" />}
                  isDisabled={!online}
                  onPress={() => sell(null)}
                >
                  Sell a package
                </Button>
              </>
            }
          />
          {tabs}
        </Page>
      ) : (
        <Page className="flex flex-col gap-4">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[2rem] leading-[1.1] font-light tracking-[-0.02em]">
                Packages & rates
              </h1>
              <div className="mt-1.5 text-[0.9375rem] text-ink-2">{shortCounts}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <IconButton label={newLabel} variant="white" isDisabled={!online} onPress={createNew}>
                <Plus aria-hidden className="size-5" />
              </IconButton>
              <IconButton
                label="Sell a package"
                variant="lime"
                isDisabled={!online}
                onPress={() => sell(null)}
              >
                <Ticket aria-hidden className="size-5" />
              </IconButton>
            </div>
          </header>
          <ConnectionPill />
          {tabs}
        </Page>
      )}

      <SellPackageSheet
        isOpen={search.sell === "1" || sellOpen}
        onOpenChange={(open) => {
          if (open) return;
          setSellOpen(false);
          if (search.sell)
            void navigate({
              search: (p: PackagesSearch) => ({ ...p, sell: undefined }),
              replace: true,
            });
        }}
        templateId={sellTemplate}
      />
      <PackageTemplateSheet
        isOpen={templateOpen}
        onOpenChange={setTemplateOpen}
        template={template}
      />
      <RateSheet isOpen={rateOpen} onOpenChange={setRateOpen} rate={rate} defaultKind={rateKind} />
    </>
  );
}
