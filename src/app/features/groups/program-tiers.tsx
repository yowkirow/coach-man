import type { GroupDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { buttonClass } from "../../components/ui/button";
import { Card, CardHeader } from "../../components/ui/display";
import { useFormat } from "../../lib/format";
import { useCan, useCoachMap, usePackageTemplates } from "../../lib/hooks";
import { tierPreview } from "../packages/catalog";
import { TierCard } from "../public/tier-card";

/**
 * The program's package tiers as families see them. Coaches see the tiers without prices (the
 * staff API leaves money out for them); roles with money see prices, and owners and admins edit
 * them in Packages.
 */
export function ProgramTiersCard({ group }: { group: GroupDto }) {
  const fmt = useFormat();
  const can = useCan();
  const coachMap = useCoachMap();
  const templates = usePackageTemplates();
  const tiers = (templates.data ?? []).filter((t) => t.programId === group.id && t.active);
  if (!templates.data) return null;
  return (
    <Card label={`${group.name} tiers`}>
      <CardHeader
        title="Tiers"
        action={
          can.catalog ? (
            <Link to="/packages" search={{ tab: "public" }} className={buttonClass("light", "sm")}>
              Academy page
            </Link>
          ) : null
        }
      />
      {tiers.length ? (
        <div className="grid items-start gap-3 px-3 pb-3 md:grid-cols-2">
          {tiers.map((t) => {
            const coach = t.coachUserId ? coachMap.get(t.coachUserId) : undefined;
            return (
              <TierCard
                key={t.id}
                tier={tierPreview(
                  t,
                  coach
                    ? {
                        id: coach.userId,
                        name: coach.name,
                        title: coach.title,
                        photoKey: null,
                        lead: false,
                      }
                    : null,
                )}
                fmt={fmt}
                surface="panel"
              />
            );
          })}
        </div>
      ) : (
        <p className="px-5 pb-5 text-[0.875rem] text-ink-2">
          {can.catalog
            ? "No packages in this program yet. Pick it as the program when you edit a package."
            : "No packages in this program yet."}
        </p>
      )}
    </Card>
  );
}
