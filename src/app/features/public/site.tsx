import type { PublicAcademyDto } from "@shared/api-types";
import { ACADEMY_SOCIAL_LABELS, ACADEMY_SOCIALS } from "@shared/domain";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Mail, Menu, MessageCircle, Phone, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { BallMark } from "../../components/brand";
import { buttonClass, tapArea } from "../../components/ui/button";
import { LegalLinks } from "../public-info/legal-links";
import { AcademyLogo, PreviewBanner } from "./public-ui";
import type { PublicPage } from "./queries";
import { scheduleLineParts } from "./site-data";
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
  messenger: <MessageCircle aria-hidden className="size-4.5" />,
  text: <MessageCircle aria-hidden className="size-4.5" />,
  call: <Phone aria-hidden className="size-4.5" />,
  email: <Mail aria-hidden className="size-4.5" />,
};

/** What a way to reach the academy says on its website (a call shows the number). */
export function contactLabel(a: ContactAction, phone: string | null): string {
  if (a.id === "messenger") return "Message us";
  if (a.id === "text") return "Send a text";
  if (a.id === "call") return phone ? `Call ${phone}` : "Call";
  return "Email us";
}

/** A schedule line set large, its time range kept on one line. */
export function ScheduleText({ line }: { line: string }) {
  const { lead, time } = scheduleLineParts(line);
  return (
    <>
      {lead}
      {time ? <span className="whitespace-nowrap">{time}</span> : null}
    </>
  );
}

/** Whether the website has a way to reach the academy, or its policies, to show at "Contact". */
function hasContact(a: PublicAcademyDto) {
  return contactActions(a).length > 0 || Boolean(a.policies);
}

/** Grows the phone nav's 36px pill to a 44px tap area without making the bar any taller. */
const navTap = "before:absolute before:-inset-y-1 before:inset-x-0";

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
 * The website's floating nav: the academy (home), its programs, coaches, and packages, a way to
 * reach it, and Enroll now in lime while it takes requests. Phones fold the links into a menu.
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
      ? "flex h-12 items-center rounded-[12px] px-3 text-[1rem] font-medium outline-none hover:bg-ink/6 focus-visible:outline-2 focus-visible:outline-ink aria-[current=page]:bg-ink/8"
      : "rounded-full px-3.5 py-2 text-[0.9375rem] font-medium outline-none hover:bg-ink/6 focus-visible:outline-2 focus-visible:outline-ink aria-[current=page]:bg-ink/8";
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
    <header className="sticky top-0 z-50 px-3 pt-2 sm:px-6 sm:pt-4">
      <nav
        aria-label={academy.name}
        className="relative mx-auto flex h-14 max-w-[1100px] items-center gap-2 rounded-[18px] border border-ivory-line bg-ivory px-2 sm:h-16 sm:gap-4 sm:px-2.5"
      >
        <Link
          to="/a/$slug"
          params={{ slug }}
          search={search}
          activeOptions={{ exact: true, includeSearch: false }}
          className="flex min-w-0 items-center gap-2.5 rounded-[14px] pr-1 outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          <AcademyLogo name={academy.name} logoKey={academy.logoKey} size={40} onLight />
          <span className="line-clamp-2 text-[0.875rem] leading-[1.15] font-semibold sm:text-[1rem] md:line-clamp-1">
            {academy.name}
          </span>
        </Link>
        <div className="ml-auto hidden items-center gap-0.5 md:flex">{links(false)}</div>
        <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-1">
          {canEnroll(academy) ? (
            <Link
              to="/a/$slug/enroll"
              params={{ slug }}
              search={search}
              className={buttonClass(
                "lime",
                "sm",
                `px-3.5 ${navTap} sm:h-11 sm:px-5 sm:text-[0.9375rem]`,
              )}
            >
              Enroll now
            </Link>
          ) : message ? (
            <a
              href={message.href}
              className={buttonClass("outline", "sm", `${navTap} sm:h-11 sm:px-5`)}
            >
              {message.id === "messenger" ? "Message us" : contactLabel(message, null)}
            </a>
          ) : null}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
            className="relative flex size-10 items-center justify-center rounded-full outline-none before:absolute before:-inset-0.5 hover:bg-ink/6 focus-visible:outline-2 focus-visible:outline-ink md:hidden"
          >
            {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
            <span className="sr-only">{open ? "Close the menu" : "Menu"}</span>
          </button>
        </div>
        <div
          id={menuId}
          hidden={!open}
          className="absolute inset-x-0 top-[calc(100%+8px)] rounded-[18px] bg-ivory p-2 shadow-pop md:hidden"
        >
          <div className="flex flex-col gap-0.5">{links(true)}</div>
        </div>
      </nav>
    </header>
  );
}

/**
 * "Questions before you enroll?": the academy's ways to reach it as violet pills in an ink-ruled
 * box, and its policies to read. Nothing to show, no box.
 */
export function QuestionsBox({ academy }: { academy: PublicAcademyDto }) {
  const actions = contactActions(academy);
  if (!actions.length && !academy.policies) return null;
  return (
    <section
      id="contact"
      aria-labelledby="contact-title"
      className="mx-auto max-w-[1100px] scroll-mt-28 px-4 sm:px-6"
    >
      <div className="rounded-[28px] border-2 border-ink px-5 py-10 text-center sm:px-10 sm:py-14">
        <h2
          id="contact-title"
          className="font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] sm:text-[3rem]"
        >
          {canEnroll(academy) ? "Questions before you enroll?" : "Questions?"}
        </h2>
        {actions.length ? (
          <>
            <p className="mx-auto mt-3 max-w-[40ch] text-[1rem] text-ink-2">
              Message or call {academy.name}.
            </p>
            <ul className="mt-7 flex flex-wrap justify-center gap-2.5">
              {actions.map((a) => (
                <li key={a.id}>
                  <a href={a.href} className={buttonClass("violet", "md")}>
                    {CONTACT_ICON[a.id]}
                    {contactLabel(a, academy.contactPhone)}
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {academy.policies ? (
          <details className="group mx-auto mt-8 max-w-[65ch] text-left">
            <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-2 rounded-full px-3 py-2 text-[0.9375rem] font-medium underline decoration-ink/40 underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Read the policies</span>
              <span className="hidden group-open:inline">Hide the policies</span>
            </summary>
            <p className="mt-4 text-[0.9375rem] whitespace-pre-line">{academy.policies}</p>
          </details>
        ) : null}
      </div>
    </section>
  );
}

const footLink = `${tapArea} rounded-sm text-[0.9375rem] outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink`;

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-[1.75rem] leading-none tracking-[-0.01em] text-ink-3">
        {title}
      </h2>
      <ul className="mt-5 flex flex-col items-start gap-3">{children}</ul>
    </div>
  );
}

/**
 * The website's foot: the programs, the academy's pages, and how to reach it, then its name set
 * huge, and CoachMan's small credit with its policies.
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
  const phone = academy.contactPhone;
  const contact = Boolean(phone || academy.contactEmail || academy.address || socials.length);
  return (
    <footer className="mx-auto max-w-[1100px] px-4 pt-24 pb-8 sm:px-6 sm:pt-32">
      <div className="grid gap-12 sm:grid-cols-3">
        {academy.programs.length ? (
          <FooterColumn title="Programs">
            {academy.programs.map((p) => (
              <li key={p.id}>
                <Link
                  to="/a/$slug"
                  params={{ slug }}
                  search={{ ...search, program: p.id }}
                  hash="programs"
                  className={footLink}
                >
                  {p.name}
                </Link>
              </li>
            ))}
          </FooterColumn>
        ) : null}
        <FooterColumn title="The academy">
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
                <Link to="/a/$slug/enroll" params={{ slug }} search={search} className={footLink}>
                  {academy.enrollmentOpen ? "Enroll now" : "Packages"}
                </Link>
              </li>
              <li>
                <Link to="/a/$slug/rates" params={{ slug }} search={search} className={footLink}>
                  Printable rates
                </Link>
              </li>
            </>
          ) : null}
        </FooterColumn>
        {contact ? (
          <FooterColumn title="Contact">
            {phone ? (
              <li>
                <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={`${footLink} num`}>
                  {phone}
                </a>
              </li>
            ) : null}
            {academy.contactEmail ? (
              <li>
                <a href={`mailto:${academy.contactEmail}`} className={`${footLink} break-all`}>
                  {academy.contactEmail}
                </a>
              </li>
            ) : null}
            {academy.address ? (
              <li className="text-[0.9375rem]">
                {academy.mapUrl ? (
                  <a
                    href={academy.mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${footLink} inline-flex items-start gap-1`}
                  >
                    {academy.address}
                    <ArrowUpRight aria-hidden className="mt-0.5 size-4 shrink-0" />
                  </a>
                ) : (
                  academy.address
                )}
              </li>
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
          </FooterColumn>
        ) : null}
      </div>
      <p
        aria-hidden
        className="mt-20 text-[clamp(3rem,10.5vw,9.5rem)] leading-[0.92] font-extrabold tracking-[-0.04em] break-words text-balance"
      >
        {academy.name}
      </p>
      <div className="mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-ivory-line pt-6">
        <p className="text-[0.8125rem] text-ink-2">
          © {academy.today.slice(0, 4)} {academy.name}
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            to="/about"
            className={`${tapArea} inline-flex items-center gap-2 rounded-full text-[0.8125rem] text-ink-2 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink`}
          >
            <BallMark className="size-5" holes="#111111" />
            Made with CoachMan
          </Link>
          <LegalLinks about={false} label="CoachMan policies" />
        </div>
      </div>
    </footer>
  );
}

/**
 * Every page of the academy's website: the ivory ground, the floating nav, the staff preview's
 * note, the page itself, and the footer.
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
      className={`site-root min-h-dvh bg-ivory text-ink ${bar ? "pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-0" : ""}`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:rounded-full focus:bg-lime focus:px-5 focus:py-2.5 focus:font-semibold focus:text-ink"
      >
        Skip to the page
      </a>
      <SiteNav academy={academy} slug={slug} preview={preview} />
      {page.kind === "preview" ? (
        <div className="mx-auto mt-3 max-w-[1100px] px-3 sm:px-6">
          <PreviewBanner
            page={current === "team" ? "team" : "academy"}
            listed={page.academy.listed}
            publicUrl={page.academy.publicUrl}
          />
        </div>
      ) : null}
      <main id="main">{children}</main>
      <SiteFooter academy={academy} slug={slug} preview={preview} />
      {bar}
    </div>
  );
}
