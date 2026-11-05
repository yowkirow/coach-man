import type { PublicAcademyDto, PublicPackageDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowRight } from "lucide-react";
import { buttonClass } from "../../components/ui/button";
import { contactActions } from "../public/text";

/**
 * The academy page's first action on phones while it takes enrollment requests: down to the
 * rates, where each package has its own Enroll.
 */
export function EnrollJump() {
  return (
    <a href="#rates-title" className={buttonClass("lime", "md")}>
      Enroll
      <ArrowDown aria-hidden className="size-4.5" />
    </a>
  );
}

/**
 * The foot of a tier card on the academy page: Enroll (to the wizard), or, while the academy isn't
 * taking new students, a plain note with the ways to reach it.
 */
export function EnrollSlot({
  academy,
  tier,
}: {
  academy: PublicAcademyDto;
  tier: PublicPackageDto;
}) {
  if (academy.enrollmentOpen) {
    return (
      <Link
        to="/a/$slug/enroll"
        params={{ slug: academy.slug }}
        search={{ package: tier.id }}
        className={buttonClass("dark", "lg", "w-full")}
      >
        Enroll<span className="sr-only"> in {tier.name}</span>
        <ArrowRight aria-hidden className="size-5" />
      </Link>
    );
  }
  const actions = contactActions(academy).slice(0, 2);
  return (
    <div className="rounded-[18px] px-4 py-3 ring-1 ring-ink/15">
      <p className="font-medium">Enrollment is closed for now</p>
      {actions.length ? (
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.875rem]">
          {actions.map((a) => (
            <a
              key={a.id}
              href={a.href}
              className="rounded-sm font-medium underline decoration-ink/40 underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
            >
              {a.label}
            </a>
          ))}
        </p>
      ) : (
        <p className="mt-1 text-[0.875rem]">Ask the academy when it opens again.</p>
      )}
    </div>
  );
}
