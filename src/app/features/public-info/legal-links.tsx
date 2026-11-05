import { Link } from "@tanstack/react-router";
import { usePublicConfig } from "./config";

const tones = {
  light:
    "text-ink-2 decoration-line-strong hover:text-ink hover:decoration-ink focus-visible:outline-ink",
  dark: "text-night-ink-2 decoration-night-4 hover:text-night-ink hover:decoration-night-ink focus-visible:outline-lime",
};

/**
 * "About CoachMan · Privacy policy · Terms of use": CoachMan's own public pages, linked from every
 * place someone signs in, enrolls, or reads their settings.
 */
export function LegalLinks({
  tone = "light",
  about = true,
  className = "",
  label = "About CoachMan",
}: {
  tone?: "light" | "dark";
  /** Include the About link (left out on /about itself). */
  about?: boolean;
  className?: string;
  /** The nav's accessible name (unique when a page has more than one). */
  label?: string;
}) {
  const link = `rounded-sm underline underline-offset-4 outline-none focus-visible:outline-2 ${tones[tone]}`;
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem]">
        {about ? (
          <li>
            <Link to="/about" className={link}>
              About CoachMan
            </Link>
          </li>
        ) : null}
        <li>
          <Link to="/privacy" className={link}>
            Privacy policy
          </Link>
        </li>
        <li>
          <Link to="/terms" className={link}>
            Terms of use
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/** The CoachMan team's address as a mailto link (or plain words until it's known, e.g. offline). */
export function ContactEmail({ className = "" }: { className?: string }) {
  const email = usePublicConfig().data?.contactEmail;
  if (!email) return <span className={className}>the CoachMan team</span>;
  return (
    <a
      href={`mailto:${email}`}
      className={`rounded-sm font-medium underline decoration-line-strong underline-offset-4 [overflow-wrap:anywhere] outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink ${className}`}
    >
      {email}
    </a>
  );
}

const inline =
  "rounded-sm font-medium text-ink underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink";

/**
 * A policy link that opens in a new tab, for pages that hold work in progress (the enrollment
 * wizard): reading the policy never loses the form.
 */
export function PolicyLink({ to, children }: { to: "/privacy" | "/terms"; children: string }) {
  return (
    <a href={to} target="_blank" rel="noopener" className={inline}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** "By continuing, you agree to …": under sign-in choices that create or use an account. */
export function AgreeNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[0.8125rem] text-ink-2 ${className}`}>
      By continuing, you agree to CoachMan's <PolicyLink to="/terms">terms of use</PolicyLink> and{" "}
      <PolicyLink to="/privacy">privacy policy</PolicyLink>.
    </p>
  );
}
