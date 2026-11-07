import type { PublicProgramDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarClock,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  SearchX,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BallMark } from "../../components/brand";
import { tapArea } from "../../components/ui/button";
import { publicFileUrl } from "../../lib/api";
import { type Format, initials } from "../../lib/format";
import { LegalLinks } from "../public-info/legal-links";
import { type ContactAction, directionsUrl, programVenue } from "./text";

// The pieces the academy's public pages share: its logo tile, where a program meets, the staff
// preview's note, the not-found page, the phone's contact bar, and CoachMan's credit.
/** The academy's own logo on a white tile (never recolored), else its initials. */
export function AcademyLogo({
  name,
  logoKey,
  size = 64,
  onLight = false,
}: {
  name: string;
  logoKey: string | null;
  size?: 40 | 48 | 64 | 80;
  /** On a white surface (the rates sheet): a hairline keeps the white tile visible. */
  onLight?: boolean;
}) {
  const src = publicFileUrl(logoKey);
  const box = `${
    size === 80
      ? "size-20 rounded-[24px]"
      : size === 64
        ? "size-16 rounded-[22px]"
        : size === 48
          ? "size-12 rounded-[16px]"
          : "size-10 rounded-[13px]"
  }${onLight ? " ring-1 ring-line-strong" : ""}`;
  const [first = "", second = ""] = name.trim().split(/\s+/);
  return src ? (
    <img
      src={src}
      alt={`${name} logo`}
      width={size}
      height={size}
      className={`${box} shrink-0 bg-card object-contain p-1.5`}
    />
  ) : (
    <span
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center bg-card font-semibold text-ink ${size === 40 ? "text-[0.875rem]" : "text-[1.125rem]"}`}
    >
      {initials({ firstName: first, lastName: second })}
    </span>
  );
}

const actionIcon: Record<ContactAction["id"], ReactNode> = {
  messenger: <MessageCircle aria-hidden className="size-4.5" />,
  text: <MessageCircle aria-hidden className="size-4.5" />,
  call: <Phone aria-hidden className="size-4.5" />,
  email: <Mail aria-hidden className="size-4.5" />,
};

/** The most direct way to reach the academy, and a call when it has a phone (else the next way). */
function contactPair(actions: ContactAction[]): ContactAction[] {
  const primary = actions[0];
  if (!primary) return [];
  const second = actions.find((a) => a.id === "call" && a !== primary) ?? actions[1];
  return second ? [primary, second] : [primary];
}

/**
 * Where a program meets (with directions) and when it next meets, as rows of a `dl` on the team
 * page's deep-green panel.
 */
export function ProgramPlaceRows({ program, fmt }: { program: PublicProgramDto; fmt: Format }) {
  const venue = programVenue(program);
  return (
    <>
      {venue ? (
        <div className="flex items-start gap-3">
          <dt className="sr-only">Where</dt>
          <MapPin aria-hidden className="mt-0.5 size-5 shrink-0 text-club-ball" />
          <dd className="min-w-0">
            <span className="block">{venue.name}</span>
            {venue.address ? <span className="block text-club-mist">{venue.address}</span> : null}
            <a
              href={directionsUrl(venue)}
              target="_blank"
              rel="noopener noreferrer"
              className={`${tapArea} mt-1 inline-flex items-center gap-1.5 rounded-sm text-[0.9375rem] font-semibold underline decoration-2 underline-offset-4 outline-none hover:decoration-club-ball`}
            >
              Directions
              <ArrowUpRight aria-hidden className="size-4" />
            </a>
          </dd>
        </div>
      ) : null}
      {program.nextSessionAt ? (
        <div className="flex items-start gap-3">
          <dt className="sr-only">Next session</dt>
          <CalendarClock aria-hidden className="mt-0.5 size-5 shrink-0 text-club-ball" />
          <dd className="num">
            Next session {fmt.day(fmt.dayOf(program.nextSessionAt))} ·{" "}
            {fmt.time(program.nextSessionAt)}
          </dd>
        </div>
      ) : null}
    </>
  );
}

/** Shown to staff looking at their own page through Settings or Team (never to families). */
export function PreviewBanner({
  listed,
  publicUrl,
  page = "academy",
}: {
  listed: boolean;
  publicUrl: string | null;
  page?: "academy" | "team";
}) {
  const team = page === "team";
  return (
    <div
      role="note"
      className="mb-3 rounded-[22px] bg-amber-soft px-4 py-3 text-[0.875rem] text-ink lg:mb-0"
    >
      <p className="font-medium">Preview of your {team ? "team page" : "academy page"}</p>
      <p className="mt-0.5 text-ink/80">
        {listed && publicUrl
          ? team
            ? `Families see this page at ${publicUrl}/team. It shows only the people set to appear on it.`
            : `Families see this page at ${publicUrl}. It shows only published programs and tiers.`
          : "Only your team can see this. Turn on “Show the academy page” in Settings, Academy profile, to share it."}{" "}
        {team ? (
          <Link to="/team" className="font-medium underline underline-offset-4">
            Team
          </Link>
        ) : (
          <Link
            to="/settings"
            hash="academy-profile"
            className="font-medium underline underline-offset-4"
          >
            Academy profile
          </Link>
        )}
      </p>
    </div>
  );
}

export function NotFoundPage({
  title = "This academy page isn't available",
  children = "The address may be mistyped, or the academy hasn't published its page. Ask the academy for its link.",
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md rounded-[32px] bg-card p-6 sm:p-8">
        <div className="flex size-12 items-center justify-center rounded-full bg-lime text-ink">
          <SearchX aria-hidden className="size-5" />
        </div>
        <h1 className="mt-4 text-[2rem] leading-tight font-light tracking-[-0.02em]">{title}</h1>
        <p className="mt-3 text-ink-2">{children}</p>
        <p className="mt-6 inline-flex items-center gap-2 text-[0.8125rem] text-ink-2">
          <BallMark className="size-5" holes="#111111" />
          CoachMan
        </p>
      </div>
    </main>
  );
}

/**
 * Tracks whether an element (the dark block's own contact buttons) has scrolled up out of view, so
 * the phone's contact bar can join only then: the first screen keeps one set of actions.
 */
export function useScrolledPast(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry) setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return [ref, past] as const;
}

/** The phone's floating contact bar: the most direct way to reach the academy, and a call. */
export function ContactBar({
  academyName,
  actions,
  shown,
}: {
  academyName: string;
  actions: ContactAction[];
  shown: boolean;
}) {
  return (
    <nav
      aria-label={`Contact ${academyName}`}
      inert={!shown}
      className={`pm-dark fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 rounded-[18px] bg-club-deep p-1.5 ring-2 ring-white transition-[translate,opacity] duration-200 ease-out lg:hidden ${
        shown ? "" : "pointer-events-none translate-y-[calc(100%+24px)] opacity-0"
      }`}
    >
      <ul className="flex gap-1.5">
        {contactPair(actions).map((a, i) => (
          <li key={a.id} className="min-w-0 flex-1">
            <a
              href={a.href}
              className={`flex h-12 w-full items-center justify-center gap-2 rounded-[12px] text-[1rem] font-bold outline-none focus-visible:outline-[3px] ${
                i === 0 ? "bg-club-ball text-club-ink" : "bg-white/12 text-white"
              }`}
            >
              {actionIcon[a.id]}
              {a.id === "messenger"
                ? "Message"
                : a.id === "text"
                  ? "Text"
                  : a.id === "call"
                    ? "Call"
                    : "Email"}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The foot of every public academy page: CoachMan's mark and its policies. */
export function MadeWithCoachMan() {
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Link
        to="/about"
        className="inline-flex items-center gap-2 rounded-full text-[0.8125rem] text-ink-2 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <BallMark className="size-5" holes="#111111" />
        Made with CoachMan
      </Link>
      <LegalLinks about={false} label="CoachMan policies" />
    </div>
  );
}
