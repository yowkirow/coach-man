import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  Check,
  ClipboardList,
  FileUp,
  HeartPulse,
  IdCardLanyard,
  type LucideIcon,
  Megaphone,
  Smartphone,
  Ticket,
  TrendingUp,
  WifiOff,
} from "lucide-react";
import { buttonClass } from "../../components/ui/button";
import { AvatarStack, KpiTile, Pill } from "../../components/ui/display";
import { InfoFooter, InfoMasthead, useDocumentTitle } from "./shell";

const link =
  "rounded-sm font-medium underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink";

/** What CoachMan does for an academy: only what the app really does today. */
const CAPABILITIES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: CalendarDays,
    title: "Schedule",
    body: "One-off and weekly sessions, programs and events with their own sessions, a lead coach on each, and rain-outs for a whole day.",
  },
  {
    icon: Ticket,
    title: "Packages and credits",
    body: "Credit packages that last a number of days or to the end of the month, used earliest expiry first, with a ledger that explains every credit.",
  },
  {
    icon: TrendingUp,
    title: "Progress and comments",
    body: "Skill assessments, goals, ratings, and coaches' comments with who wrote them, so any coach can pick up where another left off.",
  },
  {
    icon: IdCardLanyard,
    title: "Roles for your team",
    body: "Owners, admins, and coaches. Coaches see every student's progress and credits, and never prices, payments, or balances.",
  },
  {
    icon: ClipboardList,
    title: "Enrollment and payment proofs",
    body: "A public page with your programs and rates, enrollment requests you approve, and payment screenshots you confirm. Payments happen outside CoachMan.",
  },
  {
    icon: HeartPulse,
    title: "Kids' safety",
    body: "Medical notes and the people allowed to pick a junior up, kept current by parents and shown at check-in.",
  },
  {
    icon: Megaphone,
    title: "Announcements",
    body: "News for everyone, for one program, or for one event's players, pinned or scheduled ahead.",
  },
  {
    icon: FileUp,
    title: "Your data stays yours",
    body: "Bring clients over from a spreadsheet, and export your records as CSV files or one full backup file.",
  },
];

/** A coach's Today, drawn with the app's own pieces and made-up content. */
function TodaySample() {
  return (
    <div className="flex flex-col gap-2.5">
      <div aria-hidden className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">Today</p>
          <span className="inline-flex h-8 items-center gap-2 rounded-full bg-sync px-3 text-[0.8125rem] font-semibold text-ink">
            <WifiOff className="size-4" />
            Offline · 2 to sync
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <KpiTile label="Sessions" value="3" tint="lime" />
          <KpiTile label="Checked in" value="9/12" tint="sky" />
        </div>
        <div className="rounded-[24px] bg-lime p-4 text-ink [--avatar-ring:var(--color-lime)]">
          <div className="flex items-start gap-3">
            <AvatarStack
              people={[
                { firstName: "Ana", lastName: "Reyes" },
                { firstName: "Ben", lastName: "Ocampo" },
                { firstName: "Carla", lastName: "Tan" },
              ]}
              max={2}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[1rem] font-medium">Beginner clinic</p>
              <p className="num text-[0.75rem] text-ink/70">9:00–10:30 · Court 3</p>
            </div>
          </div>
          <div className="mt-3 flex h-11 items-center gap-2 rounded-full border border-ink/15 px-3">
            <span className="flex-1 text-[0.8125rem]">On court now</span>
            <Pill tone="white">
              <span className="num">6/8</span> in
            </Pill>
          </div>
        </div>
        <div className="rounded-[24px] bg-night-2 p-4">
          <p className="text-[1rem]">Junior program</p>
          <p className="num text-[0.75rem] text-night-ink-2">4:00–6:00 · Courts 1 and 2</p>
        </div>
      </div>
      <p className="px-1 text-[0.8125rem] text-night-ink-2">
        Example of a coach's Today, with made-up players and numbers.
      </p>
    </div>
  );
}

/** Three check-in rows on the lime bento (made-up players). */
function CheckInSample() {
  const rows = [
    { name: "Ana Reyes", line: "4 of 6 left · Monthly", done: true },
    { name: "Ben Ocampo", line: "Junior · Pickup: 2 people", done: true },
    { name: "Carla Tan", line: "Pays per session", done: false },
  ];
  return (
    <div className="mt-5">
      <ul
        aria-hidden
        className="flex flex-col divide-y divide-ink/10 rounded-[22px] bg-white/45 px-4"
      >
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.name}</span>
              <span className="block truncate text-[0.8125rem] text-ink/70">{r.line}</span>
            </span>
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-full ${r.done ? "bg-card text-ink" : "text-ink/45 ring-1 ring-ink/20"}`}
            >
              <Check className="size-5" strokeWidth={r.done ? 2.75 : 2} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 px-1 text-[0.8125rem] text-ink/75">Made-up players.</p>
    </div>
  );
}

export function AboutPage() {
  useDocumentTitle("CoachMan: for pickleball academies, coaches, students, and parents");
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:rounded-full focus:bg-lime focus:px-5 focus:py-2.5 focus:font-semibold focus:text-ink"
      >
        Skip to content
      </a>
      <header className="dark-zone mx-3 mt-3 rounded-[32px] bg-night px-5 pt-5 pb-8 text-night-ink sm:px-8 lg:px-10 lg:pt-6 lg:pb-10">
        <InfoMasthead current="about" />
        <div className="mx-auto mt-10 grid max-w-[1240px] grid-cols-1 gap-10 lg:mt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end">
          <div>
            <h1 className="max-w-[16ch] text-[2.5rem] leading-[1.04] font-light tracking-[-0.025em] lg:text-[3.5rem]">
              One calm place for an academy's courts, players, and families.
            </h1>
            <p className="mt-5 max-w-[54ch] text-[1rem] leading-relaxed text-night-ink-2">
              CoachMan is for pickleball academies and their coaches, and for the students and
              parents they train. Coaches run sessions and check players in from a phone, even
              without signal. Students and parents follow their own training in a family portal.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/sign-in"
                search={{ next: "/welcome" }}
                className={buttonClass("lime", "lg")}
              >
                Set up your academy
              </Link>
              <Link to="/sign-in" className={buttonClass("night", "lg")}>
                Sign in
              </Link>
            </div>
            <p className="mt-4 max-w-[50ch] text-[0.875rem] text-night-ink-2">
              Students and parents: start from the invite link your academy sent you, or from its
              CoachMan page.
            </p>
          </div>
          <div className="hidden max-w-[520px] sm:block lg:justify-self-end">
            <TodaySample />
          </div>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto flex w-full max-w-[1240px] flex-col gap-10 px-3 pt-10 pb-8 sm:px-6 lg:gap-14 lg:pt-14"
      >
        <section aria-labelledby="academies-title" className="flex flex-col gap-4">
          <div className="px-1">
            <h2
              id="academies-title"
              className="text-[2rem] leading-[1.1] font-light tracking-[-0.02em] lg:text-[2.5rem]"
            >
              For academies and coaches
            </h2>
            <p className="mt-2 max-w-[60ch] text-ink-2">
              Owners and admins run the academy at a desk; coaches run sessions from a phone. Both
              work from the same records.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:gap-4">
            <section
              aria-labelledby="court-title"
              className="flex flex-col rounded-[28px] bg-lime p-5 text-ink sm:p-6 lg:col-span-5"
            >
              <h3
                id="court-title"
                className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]"
              >
                On court, even offline
              </h3>
              <p className="mt-2 max-w-[48ch] text-[0.9375rem] text-ink/80">
                Today's sessions, one-tap check-in with undo, and credits that count themselves
                down. Check-ins and notes made without signal are kept on the phone and sync once
                it's back.
              </p>
              <CheckInSample />
              <p className="mt-auto flex items-start gap-3 pt-6 text-[0.9375rem]">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-lime">
                  <Smartphone aria-hidden className="size-4.5" />
                </span>
                <span className="pt-0.5">
                  Installs from the browser on phones and laptops, with no app store, and sends
                  session reminders if you turn them on.
                </span>
              </p>
            </section>
            <ul className="grid grid-cols-1 gap-x-8 gap-y-6 rounded-[28px] bg-card p-5 sm:grid-cols-2 sm:p-6 lg:col-span-7">
              {CAPABILITIES.map((c) => (
                <li key={c.title} className="flex items-start gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-panel text-ink">
                    <c.icon aria-hidden className="size-4.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{c.title}</span>
                    <span className="mt-0.5 block text-[0.9375rem] text-ink-2">{c.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="families-title" className="flex flex-col gap-4">
          <div className="px-1">
            <h2
              id="families-title"
              className="text-[2rem] leading-[1.1] font-light tracking-[-0.02em] lg:text-[2.5rem]"
            >
              For students and parents
            </h2>
            <p className="mt-2 max-w-[60ch] text-ink-2">
              The family portal shows each family their own training, on a phone or a laptop, under
              their academy's name and logo.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:gap-4">
            <div className="rounded-[28px] bg-card p-5 sm:p-6 lg:col-span-7">
              <ul className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                {[
                  "Next sessions and attendance",
                  "Credits, the balance, and payment proofs",
                  "Progress and coaches' shared comments",
                  "Consent forms to read and sign",
                  "Health details and pickup people, kept current by parents",
                  "Announcements from the academy",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-panel">
                      <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 max-w-[60ch] text-[0.9375rem] text-ink-2">
                Families see only their own students. Children under 13 never get their own login,
                and teens get one only once a parent is linked. Coaches' comments stay among coaches
                unless a coach shares one. More in the{" "}
                <Link to="/privacy" className={link}>
                  privacy policy
                </Link>
                .
              </p>
            </div>
            <div className="rounded-[28px] bg-lavender p-5 text-ink sm:p-6 lg:col-span-5">
              <div aria-hidden>
                <p className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">
                  Credits
                </p>
                <p className="num mt-3 text-[2rem] leading-none font-light">
                  4<span className="text-[1rem] text-ink/70"> of 6 left</span>
                </p>
                <span className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
                  <span className="block h-full w-2/3 rounded-full bg-ink" />
                </span>
                <p className="num mt-2 text-[0.8125rem] text-ink/75">Use by Nov 30</p>
                <div className="mt-5 rounded-[22px] bg-white/45 p-4">
                  <p className="text-[0.8125rem] text-ink/75">Next session</p>
                  <p className="num mt-1 text-[1.375rem] leading-tight font-light">
                    Tomorrow, 4:00–6:00
                  </p>
                  <p className="mt-1 text-[0.875rem]">Junior program · Court 2</p>
                </div>
              </div>
              <p className="mt-3 px-1 text-[0.8125rem] text-ink/75">
                Example of a family's home page, with made-up numbers.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="start-title" className="flex flex-col gap-4">
          <h2
            id="start-title"
            className="px-1 text-[2rem] leading-[1.1] font-light tracking-[-0.02em] lg:text-[2.5rem]"
          >
            How to start
          </h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
            <section aria-labelledby="start-academy" className="rounded-[28px] bg-card p-5 sm:p-6">
              <h3
                id="start-academy"
                className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]"
              >
                Academies and coaches
              </h3>
              <ol className="mt-4 flex flex-col gap-3">
                {[
                  "Sign in with Google, then add a passkey so signing in on court takes one tap.",
                  "Set up your academy: its name, currency, and time zone. A solo coach is a one-person academy.",
                  "Invite your coaches, add your players, and publish your programs and rates.",
                ].map((step, i) => (
                  <li key={step} className="flex items-start gap-3">
                    <span className="num flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[0.8125rem] font-semibold text-white">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
              <Link
                to="/sign-in"
                search={{ next: "/welcome" }}
                className={buttonClass("dark", "md", "mt-6")}
              >
                Set up your academy
              </Link>
            </section>
            <section aria-labelledby="start-family" className="rounded-[28px] bg-card p-5 sm:p-6">
              <h3
                id="start-family"
                className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]"
              >
                Students and parents
              </h3>
              <p className="mt-4 max-w-[52ch]">
                Your academy sends you an invite link on Messenger, Viber, or by text, or you enroll
                from its CoachMan page. Sign in with Google, or create a passkey on your phone:
                there's no password.
              </p>
              <p className="mt-3 max-w-[52ch] text-ink-2">
                Already have an account? Sign in, and CoachMan opens your family portal.
              </p>
              <Link to="/sign-in" className={buttonClass("light", "md", "mt-6")}>
                Sign in
              </Link>
            </section>
          </div>
        </section>
      </main>
      <InfoFooter current="about" />
    </div>
  );
}
