import type { PortalEnrollAcademyDto, PublicPackageDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Mail, Phone } from "lucide-react";
import { buttonClass } from "../../components/ui/button";
import { Card } from "../../components/ui/display";
import { EmptyState } from "../../components/ui/feedback";
import { PortalCard, QueryGate } from "../portal/bits";
import { PortalPage } from "../portal/shell";
import { usePublicFormat } from "../public/queries";
import { scheduleLines, tiersOf } from "../public/text";
import { TierCard } from "../public/tier-card";
import { usePortalEnroll } from "./queries";
import { Note } from "./wizard-ui";

function EnrollLink({ slug, tier }: { slug: string; tier: PublicPackageDto }) {
  return (
    <Link
      to="/a/$slug/enroll"
      params={{ slug }}
      search={{ package: tier.id }}
      className={buttonClass("dark", "lg", "w-full")}
    >
      Enroll<span className="sr-only"> in {tier.name}</span>
      <ArrowRight aria-hidden className="size-5" />
    </Link>
  );
}

/** One academy's programs and tiers, each with Enroll (the same wizard as its public page). */
function AcademyTiers({ a }: { a: PortalEnrollAcademyDto }) {
  const page = a.page;
  const fmt = usePublicFormat(page ?? undefined);
  if (!page) {
    return (
      <PortalCard title={a.name}>
        <p className="text-[0.9375rem] text-ink-2">
          {a.name} doesn't take enrollment requests online. Get in touch to enroll or change a
          package.
        </p>
        {a.contactPhone || a.contactEmail ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {a.contactPhone ? (
              <a
                href={`tel:${a.contactPhone.replace(/[^\d+]/g, "")}`}
                className={buttonClass("light", "sm")}
              >
                <Phone aria-hidden className="size-4" />
                Call
              </a>
            ) : null}
            {a.contactEmail ? (
              <a href={`mailto:${a.contactEmail}`} className={buttonClass("light", "sm")}>
                <Mail aria-hidden className="size-4" />
                Email
              </a>
            ) : null}
          </div>
        ) : null}
      </PortalCard>
    );
  }
  const loose = tiersOf(page.packages, null);
  return (
    <section aria-labelledby={`enroll-${a.workspaceId}`} className="flex flex-col gap-4">
      <h2
        id={`enroll-${a.workspaceId}`}
        className="px-1 text-[1.375rem] leading-tight font-light tracking-[-0.01em]"
      >
        {a.name}
      </h2>
      {!a.enrollmentOpen ? (
        <Note tone="sky" title="Enrollment for new students is closed for now">
          Students already training at {a.name} can still enroll and renew.
        </Note>
      ) : null}
      {page.programs.map((p) => {
        const tiers = tiersOf(page.packages, p.id);
        if (!tiers.length) return null;
        const schedule = scheduleLines(p, fmt);
        return (
          <div key={p.id} className="flex flex-col gap-3">
            <div className="px-1">
              <h3 className="text-[1.125rem] font-medium">{p.name}</h3>
              {schedule.length ? (
                <p className="num text-[0.875rem] text-ink-2">{schedule.join(" · ")}</p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {tiers.map((t) => (
                <TierCard
                  key={t.id}
                  tier={t}
                  fmt={fmt}
                  headingLevel={4}
                  enroll={<EnrollLink slug={page.slug} tier={t} />}
                />
              ))}
            </div>
          </div>
        );
      })}
      {loose.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {loose.map((t) => (
            <TierCard
              key={t.id}
              tier={t}
              fmt={fmt}
              headingLevel={3}
              enroll={<EnrollLink slug={page.slug} tier={t} />}
            />
          ))}
        </div>
      ) : null}
      {!page.packages.length ? (
        <p className="px-1 text-[0.9375rem] text-ink-2">
          {a.name} hasn't published its packages yet.
        </p>
      ) : null}
    </section>
  );
}

/** /my/enroll: the programs and packages of the academies the family trains at. */
export function PortalEnroll() {
  const q = usePortalEnroll();
  return (
    <PortalPage title="Enroll" subtitle="Programs and packages, for you or a child">
      <QueryGate query={q}>
        {(academies) =>
          academies.length ? (
            <div className="flex flex-col gap-8">
              {academies.map((a) => (
                <AcademyTiers key={a.workspaceId} a={a} />
              ))}
            </div>
          ) : (
            <Card className="px-6 py-2">
              <EmptyState
                title="No academy linked yet"
                body="Open your academy's page from the link they shared, and enroll from there."
              />
            </Card>
          )
        }
      </QueryGate>
    </PortalPage>
  );
}
