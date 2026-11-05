import type { PortalAcademyDto } from "@shared/api-types";
import { ACADEMY_SOCIAL_LABELS, ACADEMY_SOCIALS } from "@shared/domain";
import { ChevronDown, Globe, Mail, MapPin, Phone } from "lucide-react";
import { useState } from "react";
import { PortalCard } from "./bits";
import { AcademyTile } from "./shell";

const linkCls =
  "rounded-sm font-medium underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

const tel = (v: string) => `tel:${v.replace(/[^\d+]/g, "")}`;

/** How to reach the academy: phone, email, address and map, social pages, and its policies. */
export function AcademyCard({ academy }: { academy: PortalAcademyDto }) {
  const [policiesOpen, setPoliciesOpen] = useState(false);
  const socials = ACADEMY_SOCIALS.filter((k) => academy.socials[k]);
  const hasContact =
    academy.contactPhone || academy.contactEmail || academy.address || academy.mapUrl;
  return (
    <PortalCard title="Your academy">
      <div className="flex items-center gap-4">
        <AcademyTile name={academy.name} logoKey={academy.logoKey} size="lg" />
        <div className="min-w-0">
          <p className="text-[1.375rem] leading-tight font-light tracking-[-0.01em] break-words">
            {academy.name}
          </p>
          {academy.tagline ? (
            <p className="mt-0.5 text-[0.875rem] text-ink-2">{academy.tagline}</p>
          ) : null}
        </div>
      </div>
      {hasContact || socials.length ? (
        <ul className="mt-4 flex flex-col gap-3 text-[0.9375rem]">
          {academy.contactPhone ? (
            <li className="flex items-center gap-3">
              <Phone aria-hidden className="size-4.5 shrink-0 text-ink-2" />
              <a href={tel(academy.contactPhone)} className={linkCls}>
                {academy.contactPhone}
              </a>
            </li>
          ) : null}
          {academy.contactEmail ? (
            <li className="flex items-center gap-3">
              <Mail aria-hidden className="size-4.5 shrink-0 text-ink-2" />
              <a href={`mailto:${academy.contactEmail}`} className={`${linkCls} break-all`}>
                {academy.contactEmail}
              </a>
            </li>
          ) : null}
          {academy.address || academy.mapUrl ? (
            <li className="flex items-start gap-3">
              <MapPin aria-hidden className="mt-0.5 size-4.5 shrink-0 text-ink-2" />
              <span className="flex flex-col gap-0.5">
                {academy.address ? <span>{academy.address}</span> : null}
                {academy.mapUrl ? (
                  <a href={academy.mapUrl} target="_blank" rel="noreferrer" className={linkCls}>
                    Open the map
                  </a>
                ) : null}
              </span>
            </li>
          ) : null}
          {socials.length ? (
            <li className="flex items-start gap-3">
              <Globe aria-hidden className="mt-0.5 size-4.5 shrink-0 text-ink-2" />
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                {socials.map((k) => (
                  <a
                    key={k}
                    href={academy.socials[k]}
                    target="_blank"
                    rel="noreferrer"
                    className={linkCls}
                  >
                    {ACADEMY_SOCIAL_LABELS[k]}
                  </a>
                ))}
              </span>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-4 text-[0.9375rem] text-ink-2">
          {academy.name} hasn't added contact details here yet. Reach them the way you usually do.
        </p>
      )}
      {academy.policies ? (
        <div className="mt-4 border-t border-line pt-3">
          <button
            type="button"
            aria-expanded={policiesOpen}
            aria-controls={`policies-${academy.workspaceId}`}
            onClick={() => setPoliciesOpen((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl py-2 text-left font-medium outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            Policies
            <ChevronDown
              aria-hidden
              className={`size-4.5 text-ink-2 transition-transform duration-200 ${policiesOpen ? "rotate-180" : ""}`}
            />
          </button>
          {policiesOpen ? (
            <p
              id={`policies-${academy.workspaceId}`}
              className="mt-1 max-w-[65ch] text-[0.9375rem] whitespace-pre-line text-ink-2"
            >
              {academy.policies}
            </p>
          ) : null}
        </div>
      ) : null}
    </PortalCard>
  );
}
