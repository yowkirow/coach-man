import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { Wordmark } from "../../components/brand";
import { buttonClass } from "../../components/ui/button";
import { ContactEmail, LegalLinks } from "./legal-links";

export type InfoPage = "about" | "privacy" | "terms";

const PAGES: { id: InfoPage; to: "/about" | "/privacy" | "/terms"; label: string }[] = [
  { id: "about", to: "/about", label: "About" },
  { id: "privacy", to: "/privacy", label: "Privacy" },
  { id: "terms", to: "/terms", label: "Terms" },
];

/** Sets the tab's title (the Worker writes the same into the HTML for link previews). */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** The dark masthead of CoachMan's public pages: the wordmark, the three pages, and Sign in. */
export function InfoMasthead({ current }: { current: InfoPage }) {
  return (
    // On a phone: the wordmark and Sign in on one line, the pages below; in a row from `sm` up.
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-4">
      <Link
        to="/about"
        aria-label="CoachMan, about"
        className="mr-4 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
      >
        <Wordmark dark />
      </Link>
      <nav aria-label="CoachMan" className="order-last w-full sm:order-none sm:ml-auto sm:w-auto">
        <ul className="flex items-center gap-1">
          {PAGES.map((p) => {
            const on = p.id === current;
            return (
              <li key={p.id}>
                <Link
                  to={p.to}
                  aria-current={on ? "page" : undefined}
                  className={`inline-flex h-11 items-center rounded-full px-4 text-[0.9375rem] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
                    on ? "bg-night-3 text-night-ink" : "text-night-ink-2 hover:text-night-ink"
                  }`}
                >
                  {p.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Link to="/sign-in" className={buttonClass("lime", "md")}>
        Sign in
      </Link>
    </div>
  );
}

/** The quiet footer every public page ends with: the pages, and who to write to. */
export function InfoFooter({ current }: { current: InfoPage }) {
  return (
    <footer className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 pt-2 pb-10 sm:px-6">
      <LegalLinks about={current !== "about"} label="CoachMan pages" />
      <p className="text-[0.8125rem] text-ink-2">
        Questions about privacy or these pages: <ContactEmail />
      </p>
    </footer>
  );
}

export interface DocSection {
  id: string;
  title: string;
  body: ReactNode;
}

/**
 * A Read page (the privacy policy, the terms): the dark masthead with the title and its date,
 * then a calm reading column on a white card, with the sections listed beside it on a laptop and
 * above it on a phone.
 */
export function DocumentPage({
  page,
  title,
  updated,
  intro,
  sections,
}: {
  page: InfoPage;
  title: string;
  /** "5 November 2026": the date the text last changed. */
  updated: string;
  intro: ReactNode;
  sections: DocSection[];
}) {
  useDocumentTitle(`${title} · CoachMan`);
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:rounded-full focus:bg-lime focus:px-5 focus:py-2.5 focus:font-semibold focus:text-ink"
      >
        Skip to content
      </a>
      <header className="dark-zone mx-3 mt-3 rounded-[32px] bg-night px-5 pt-5 pb-8 text-night-ink sm:px-8 lg:px-10 lg:pt-6 lg:pb-10">
        <InfoMasthead current={page} />
        <div className="mx-auto mt-10 max-w-[1240px] lg:mt-14">
          <h1 className="text-[2rem] leading-[1.1] font-light tracking-[-0.02em] lg:text-[2.75rem] lg:leading-[1.08]">
            {title}
          </h1>
          <p className="num mt-3 text-[0.9375rem] text-night-ink-2">Last updated {updated}</p>
          <div className="mt-5 max-w-[62ch] text-[1rem] leading-relaxed text-night-ink/85">
            {intro}
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6 lg:py-6">
        <nav
          aria-label="On this page"
          className="self-start rounded-[28px] bg-card p-5 lg:sticky lg:top-3"
        >
          <h2 className="text-[0.8125rem] font-medium text-ink-2">On this page</h2>
          <ol className="mt-2 flex flex-col">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block rounded-[12px] px-2 py-1.5 text-[0.9375rem] text-ink outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <main id="main" className="min-w-0 rounded-[28px] bg-card px-5 py-7 sm:px-10 sm:py-10">
          <div className="mx-auto flex max-w-[70ch] flex-col gap-10">
            {sections.map((s) => (
              <section
                key={s.id}
                id={s.id}
                aria-labelledby={`${s.id}-title`}
                className="scroll-mt-4"
              >
                <h2
                  id={`${s.id}-title`}
                  className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]"
                >
                  {s.title}
                </h2>
                <div className="mt-3 flex flex-col gap-3 text-[1rem] leading-[1.65]">{s.body}</div>
              </section>
            ))}
          </div>
        </main>
      </div>
      <InfoFooter current={page} />
    </div>
  );
}

/** A bulleted list in a document section. */
export function Bullets({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-ink-3">{children}</ul>;
}

/** A small heading inside a section ("Account data", "What academies enter"). */
export function Sub({ children }: { children: ReactNode }) {
  return <h3 className="mt-2 text-[1.125rem] font-medium">{children}</h3>;
}
