import type { PublicAcademyDto } from "@shared/api-types";
import { ACADEMY_SOCIAL_LABELS, ACADEMY_SOCIALS } from "@shared/domain";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Mail, Menu, MessageCircle, Phone, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { BallMark } from "../../components/brand";
import { tapArea } from "../../components/ui/button";
import { LegalLinks } from "../public-info/legal-links";
import { AcademyLogo, PreviewBanner } from "./public-ui";
import { Panel, pillClass, SkewLabel, skewClass, WRAP } from "./pubmat";
import type { PublicPage } from "./queries";
import { type ContactAction, contactActions } from "./text";

/** Which page of the academy's website is open (its nav marks it). */
export type SiteSection = "home" | "team" | "enroll";

/** `?preview=1` rides every link while staff look at their own site (families never see it). */
export function previewSearch(preview: boolean): { preview?: 1 } {
  return preview ? { preview: 1 } : {};
}

/** Whether a family can start enrolling from the website right now. */
export function canEnroll(a: PublicAcademyDto) {
  return a.enrollmentOpen && a.packages.length > 0;
}

export const CONTACT_ICON: Record<ContactAction["id"], ReactNode> = {
  messenger: <MessageCircle aria-hidden className="size-5" />,
  text: <MessageCircle aria-hidden className="size-5" />,
  call: <Phone aria-hidden className="size-5" />,
  email: <Mail aria-hidden className="size-5" />,
};

/** What a way to reach the academy says on its website (a call shows the number). */
export function contactLabel(a: ContactAction, phone: string | null): string {
  if (a.id === "messenger") return "Message us";
  if (a.id === "text") return "Send a text";
  if (a.id === "call") return phone ? `Call ${phone}` : "Call";
  return "Email us";
}

/** Whether the website has a way to reach the academy, or its policies, to show at "Contact". */
export function hasContact(a: PublicAcademyDto) {
  return contactActions(a).length > 0 || Boolean(a.policies);
}

/**
 * Keeps a sideways-scrolling row's current item in view, on arrival and whenever it changes (the
 * row needs `position: relative`, so the item's offset is measured from it).
 */
export function useCurrentInView<C extends HTMLElement>(currentKey: string | null | undefined) {
  const list = useRef<HTMLUListElement>(null);
  const current = useRef<C>(null);
  useEffect(() => {
    const row = list.current;
    const item = current.current;
    if (!row || !item || !currentKey || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: Math.max(0, item.offsetLeft - (row.clientWidth - item.offsetWidth) / 2) });
  }, [currentKey]);
  return { list, current };
}

/**
 * The website's nav: a slim deep-green bar with the academy's name, its programs, coaches,
 * packages, and contact, and the slanted Enroll now while it takes requests (else Message us).
 * Phones fold the links into a menu.
 */
export function SiteNav({
  academy,
  slug,
  preview,
}: {
  academy: PublicAcademyDto;
  slug: string;
  preview: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const search = previewSearch(preview);
  const message = contactActions(academy)[0] ?? null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // "Contact" is a jump within the page: the menu folds away as the page moves to it.
    const onHash = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHash);
    };
  }, [open]);

  const links = (inMenu: boolean) => {
    const cls = inMenu
      ? "pm-d2 flex min-h-12 items-center border-t border-white/15 px-1 text-[1.375rem] outline-none hover:text-club-ball aria-[current=page]:text-club-ball"
      : `${tapArea} rounded-sm text-[1rem] font-semibold underline-offset-[6px] outline-none hover:underline aria-[current=page]:underline aria-[current=page]:decoration-club-ball aria-[current=page]:decoration-[3px]`;
    const close = () => setOpen(false);
    return (
      <>
        {academy.programs.length ? (
          <Link
            to="/a/$slug"
            params={{ slug }}
            search={search}
            hash="programs"
            // Marked current only once the page is at its programs, not on every academy page.
            activeOptions={{ exact: true, includeHash: true, includeSearch: false }}
            className={cls}
            onClick={close}
          >
            Programs
          </Link>
        ) : null}
        {academy.coaches.length ? (
          <Link
            to="/a/$slug/team"
            params={{ slug }}
            search={search}
            activeOptions={{ includeSearch: false }}
            className={cls}
            onClick={close}
          >
            Coaches
          </Link>
        ) : null}
        {academy.packages.length ? (
          <Link
            to="/a/$slug/enroll"
            params={{ slug }}
            search={search}
            activeOptions={{ includeSearch: false }}
            className={cls}
            onClick={close}
          >
            Packages
          </Link>
        ) : null}
        {hasContact(academy) ? (
          <a href="#contact" className={cls}>
            Contact
          </a>
        ) : null}
      </>
    );
  };

  return (
    <header className="pm-dark sticky top-0 z-50 bg-club-deep text-white">
      <nav
        aria-label={academy.name}
        className="relative mx-auto flex h-14 max-w-[1440px] items-center gap-2 pr-1.5 pl-3.5 lg:h-16 lg:gap-7 lg:px-16"
      >
        <Link
          to="/a/$slug"
          params={{ slug }}
          search={search}
          activeOptions={{ exact: true, includeSearch: false }}
          className="mr-auto flex min-w-0 items-center gap-2.5 rounded-sm outline-none"
        >
          {academy.logoKey ? (
            <AcademyLogo name={academy.name} logoKey={academy.logoKey} size={40} />
          ) : null}
          <span className="pm-d2 truncate text-[0.9375rem] font-extrabold lg:text-[1.1875rem]">
            {academy.name}
          </span>
        </Link>
        <div className="hidden items-center gap-7 lg:flex">{links(false)}</div>
        {canEnroll(academy) ? (
          <Link
            to="/a/$slug/enroll"
            params={{ slug }}
            search={search}
            className={`${skewClass("lime", "sm")} relative before:absolute before:-inset-y-[3px] before:inset-x-0`}
          >
            <SkewLabel>Enroll now</SkewLabel>
          </Link>
        ) : message ? (
          <a href={message.href} className={pillClass("outline", "min-h-11 text-[0.9375rem]")}>
            {message.id === "messenger" ? "Message us" : contactLabel(message, null)}
          </a>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
          className="flex size-11 shrink-0 items-center justify-center rounded-[10px] outline-none hover:bg-white/10 lg:hidden"
        >
          {open ? <X aria-hidden className="size-6" /> : <Menu aria-hidden className="size-6" />}
          <span className="sr-only">{open ? "Close the menu" : "Menu"}</span>
        </button>
        <div
          id={menuId}
          hidden={!open}
          className="absolute inset-x-0 top-full border-t border-white/15 bg-club-deep px-4 pb-4 lg:hidden"
        >
          <div className="flex flex-col">{links(true)}</div>
        </div>
      </nav>
    </header>
  );
}

/**
 * "Questions before you enroll?": the academy's ways to reach it and its policies, on a blue
 * field. Nothing to show, no panel. The landing page says this in its Find us panel instead.
 */
export function ContactPanel({ academy }: { academy: PublicAcademyDto }) {
  const actions = contactActions(academy);
  if (!actions.length && !academy.policies) return null;
  return (
    <Panel field="blue" id="contact" labelledBy="contact-title">
      <div
        className={`${WRAP} py-14 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-x-20 lg:py-24`}
      >
        <div>
          <h2 id="contact-title" className="pm-d1 max-w-[12ch] text-[3.5rem] lg:text-[6rem]">
            {canEnroll(academy) ? "Questions before you enroll?" : "Questions?"}
          </h2>
          {actions.length ? (
            <p className="mt-5 text-[1.25rem] font-semibold">Message or call {academy.name}.</p>
          ) : null}
        </div>
        <div>
          {actions.length ? (
            <ul className="mt-7 flex flex-wrap gap-3 lg:mt-0 lg:flex-col">
              {actions.map((a, i) => (
                <li key={a.id}>
                  <a
                    href={a.href}
                    className={pillClass(i === 0 ? "white" : "outline", "lg:w-full")}
                  >
                    {CONTACT_ICON[a.id]}
                    {contactLabel(a, academy.contactPhone)}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {academy.policies ? <Policies text={academy.policies} /> : null}
        </div>
      </div>
    </Panel>
  );
}

/** The academy's policies, folded behind "Read the policies". */
export function Policies({ text }: { text: string }) {
  return (
    <details className="group mt-8 max-w-[65ch]">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-sm py-2 text-[1.0625rem] font-bold underline decoration-2 underline-offset-[6px] outline-none [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Read the policies</span>
        <span className="hidden group-open:inline">Hide the policies</span>
      </summary>
      <p className="mt-3 text-[1rem] whitespace-pre-line">{text}</p>
    </details>
  );
}

const footLink = `${tapArea} rounded-sm text-[1rem] font-semibold underline-offset-4 outline-none hover:underline`;

/**
 * The website's foot, on ink: the academy's name and where it is, its pages and socials, then
 * CoachMan's small credit with its policies.
 */
export function SiteFooter({
  academy,
  slug,
  preview,
}: {
  academy: PublicAcademyDto;
  slug: string;
  preview: boolean;
}) {
  const search = previewSearch(preview);
  const socials = ACADEMY_SOCIALS.filter((k) => academy.socials[k]);
  return (
    <footer className="pm-dark bg-club-ink text-white">
      <div className={`${WRAP} py-10 lg:py-12`}>
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-x-12">
          <div className="min-w-0">
            <p className="pm-d2 text-[1.5rem] break-words">{academy.name}</p>
            {academy.contactPhone || academy.contactEmail || academy.address ? (
              <ul className="mt-2 flex flex-col items-start gap-1.5 text-[1rem] text-club-mist">
                {academy.contactPhone ? (
                  <li>
                    <a
                      href={`tel:${academy.contactPhone.replace(/[^\d+]/g, "")}`}
                      className={`${footLink} num font-medium text-club-mist hover:text-white`}
                    >
                      {academy.contactPhone}
                    </a>
                  </li>
                ) : null}
                {academy.contactEmail ? (
                  <li>
                    <a
                      href={`mailto:${academy.contactEmail}`}
                      className={`${footLink} font-medium break-all text-club-mist hover:text-white`}
                    >
                      {academy.contactEmail}
                    </a>
                  </li>
                ) : null}
                {academy.address ? (
                  <li>
                    {academy.mapUrl ? (
                      <a
                        href={academy.mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${footLink} inline-flex items-start gap-1 font-medium text-club-mist hover:text-white`}
                      >
                        {academy.address}
                        <ArrowUpRight aria-hidden className="mt-0.5 size-4 shrink-0" />
                      </a>
                    ) : (
                      academy.address
                    )}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
          <nav aria-label="Website pages">
            <ul className="flex flex-wrap gap-x-6 gap-y-3">
              <li>
                <Link to="/a/$slug" params={{ slug }} search={search} className={footLink}>
                  Home
                </Link>
              </li>
              {academy.coaches.length ? (
                <li>
                  <Link to="/a/$slug/team" params={{ slug }} search={search} className={footLink}>
                    Meet the team
                  </Link>
                </li>
              ) : null}
              {academy.packages.length ? (
                <>
                  <li>
                    <Link
                      to="/a/$slug/enroll"
                      params={{ slug }}
                      search={search}
                      className={footLink}
                    >
                      {academy.enrollmentOpen ? "Enroll now" : "Packages"}
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/a/$slug/rates"
                      params={{ slug }}
                      search={search}
                      className={footLink}
                    >
                      Printable rates
                    </Link>
                  </li>
                </>
              ) : null}
              {socials.map((k) => (
                <li key={k}>
                  <a
                    href={academy.socials[k]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${footLink} inline-flex items-center gap-1`}
                  >
                    {ACADEMY_SOCIAL_LABELS[k]}
                    <ArrowUpRight aria-hidden className="size-4" />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-9 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-white/15 pt-6">
          <p className="text-[0.875rem] text-club-mist">
            © {academy.today.slice(0, 4)} {academy.name}
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link
              to="/about"
              className={`${tapArea} inline-flex items-center gap-2 rounded-sm text-[0.875rem] text-club-mist outline-none hover:text-white`}
            >
              <BallMark className="size-5" holes="#0d1311" />
              Made with CoachMan
            </Link>
            <LegalLinks tone="dark" about={false} label="CoachMan policies" />
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Every page of the academy's website: the nav, the staff preview's note, the page's panels, and
 * the footer.
 */
export function SiteFrame({
  page,
  slug,
  current,
  bar,
  children,
}: {
  page: PublicPage;
  slug: string;
  current: SiteSection;
  /** A phone's floating bar (the team page's contact bar); the page leaves room for it. */
  bar?: ReactNode;
  children: ReactNode;
}) {
  const academy = page.academy;
  const preview = page.kind === "preview";
  return (
    <div
      className={`site-root min-h-dvh bg-club-ink text-club-ink ${bar ? "pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-0" : ""}`}
    >
      <a
        href="#main"
        className="sr-only [--focus:#fff] focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:rounded-full focus:bg-club-ball focus:px-5 focus:py-2.5 focus:font-bold focus:text-club-ink"
      >
        Skip to the page
      </a>
      <SiteNav academy={academy} slug={slug} preview={preview} />
      {page.kind === "preview" ? (
        <div className="bg-club-deep px-3 pt-1 pb-3 lg:px-16">
          <div className="mx-auto max-w-[1312px]">
            <PreviewBanner
              page={current === "team" ? "team" : "academy"}
              listed={page.academy.listed}
              publicUrl={page.academy.publicUrl}
            />
          </div>
        </div>
      ) : null}
      <main id="main">{children}</main>
      <SiteFooter academy={academy} slug={slug} preview={preview} />
      {bar}
    </div>
  );
}
