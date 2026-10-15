import type { PackageTemplateDto, RateDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Hourglass, Layers, Ticket, Undo2, UserX } from "lucide-react";
import { Button } from "../../components/ui/button";
import { KpiTile } from "../../components/ui/display";
import { plural } from "../../lib/format";
import { useOnline } from "../../lib/offline";
import type { CatalogTab } from "./catalog";

const RULES = [
  { icon: Hourglass, text: "Check-ins use the credit that expires first." },
  { icon: Undo2, text: "Cancel a session or undo a check-in and the credit comes back." },
  {
    icon: UserX,
    text: "No-shows and late cancels use a credit only when your policies say so.",
  },
  {
    icon: Layers,
    text: "A package covers the session types you pick, or any session when you pick none.",
  },
] as const;

/** The credit rules in four lines, on the dark panel or as a light card on phones. */
export function CreditsExplainer({ dark = false }: { dark?: boolean }) {
  const Heading = dark ? "h3" : "h2";
  return (
    <section
      aria-labelledby="credits-how"
      className={dark ? "rounded-[24px] bg-night-2 p-5" : "rounded-[28px] bg-card p-5"}
    >
      <Heading id="credits-how" className="text-[1.125rem] font-light">
        How credits work
      </Heading>
      <ul className="mt-4 flex flex-col gap-3.5">
        {RULES.map((r) => (
          <li key={r.text} className="flex items-start gap-3">
            <span
              aria-hidden
              className={`flex size-8 shrink-0 items-center justify-center rounded-full ${dark ? "bg-night-3 text-lime" : "bg-lime text-ink"}`}
            >
              <r.icon className="size-4" />
            </span>
            <span
              className={`pt-1.5 text-[0.875rem] leading-snug ${dark ? "text-night-ink-2" : "text-ink-2"}`}
            >
              {r.text}
            </span>
          </li>
        ))}
      </ul>
      <Link
        to="/settings"
        hash="policies"
        className={`mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full text-[0.875rem] font-medium underline underline-offset-4 outline-none focus-visible:outline-2 ${dark ? "text-night-ink focus-visible:outline-lime" : "text-ink focus-visible:outline-ink"}`}
      >
        No-show and late-cancel policies
        <ArrowUpRight aria-hidden className="size-4" />
      </Link>
    </section>
  );
}

export function CatalogPanel({
  templates,
  rates,
  onTab,
  onSell,
}: {
  templates?: PackageTemplateDto[];
  rates?: RateDto[];
  onTab: (tab: CatalogTab) => void;
  onSell: () => void;
}) {
  const online = useOnline();
  const dash = "–";
  const forSale = templates?.filter((t) => t.active).length;
  const sold = templates?.reduce((s, t) => s + t.soldCount, 0);
  const onCard = rates?.filter((r) => r.active).length;
  return (
    <div className="flex flex-col gap-5">
      <div className="px-1">
        <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">Price list</h2>
        <p className="num mt-1 text-[0.875rem] text-night-ink-2">
          {templates && rates
            ? `${plural(templates.length, "package")} · ${plural(rates.length, "rate")}`
            : "Loading…"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {/* Wide first tile so its longer label stays on one line. */}
        <div className="col-span-2 grid">
          <KpiTile
            label="Active packages"
            tint="lime"
            value={forSale ?? dash}
            hint="Show packages"
            onPress={() => onTab("packages")}
          />
        </div>
        <KpiTile
          label="Packages sold"
          tint="violet"
          value={sold ?? dash}
          hint="Show packages"
          onPress={() => onTab("packages")}
        />
        <KpiTile
          label="Rates"
          tint="sky"
          value={onCard ?? dash}
          hint="Show the rate card"
          onPress={() => onTab("rates")}
        />
      </div>
      <Button
        variant="lime"
        size="lg"
        className="w-full data-[focus-visible]:outline-lime"
        icon={<Ticket aria-hidden className="size-5" />}
        isDisabled={!online}
        onPress={onSell}
      >
        Sell a package
      </Button>
      <CreditsExplainer dark />
    </div>
  );
}
