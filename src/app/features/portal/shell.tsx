import { Link, useParams, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  CalendarDays,
  Ellipsis,
  Home,
  type LucideIcon,
  Settings,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { SyncStatus } from "../../components/layout/app-shell";
import { portalFileUrl } from "../../lib/api";
import { initials } from "../../lib/format";
import {
  type FamilyStudent,
  familyStudents,
  rememberedStudent,
  rememberStudent,
  usePortalAccount,
} from "./queries";

/** Student pages, in tab order. */
export const STUDENT_SECTIONS = [
  "progress",
  "schedule",
  "coaches",
  "payments",
  "consents",
  "profile",
] as const;
export type StudentSection = (typeof STUDENT_SECTIONS)[number];

const SECTION_LABELS: Record<StudentSection, string> = {
  progress: "Progress",
  schedule: "Schedule",
  coaches: "Coaches",
  payments: "Payments",
  consents: "Consents",
  profile: "Profile",
};

/** The academy's own logo (never recoloured) on a white tile, or its initials. */
export function AcademyTile({
  name,
  logoKey,
  size = "md",
}: {
  name: string;
  logoKey: string | null;
  size?: "md" | "lg";
}) {
  const src = portalFileUrl(logoKey);
  const dims = size === "lg" ? "size-16 rounded-[22px]" : "size-11 rounded-[14px]";
  const [first = "", second = ""] = name.trim().split(/\s+/);
  return src ? (
    <img src={src} alt="" className={`${dims} shrink-0 bg-card object-contain p-1`} />
  ) : (
    <span
      aria-hidden
      className={`${dims} flex shrink-0 items-center justify-center bg-card text-[0.875rem] font-semibold text-ink`}
    >
      {initials({ firstName: first, lastName: second })}
    </span>
  );
}

/**
 * The student the student pages and tabs are about: the one in the address, else the one last
 * opened on this device, else the first linked student.
 */
export function useCurrentStudent(): {
  students: FamilyStudent[];
  current: FamilyStudent | null;
} {
  const account = usePortalAccount().data;
  const params = useParams({ strict: false }) as { clientId?: string };
  const students = familyStudents(account);
  const userId = account?.user.id;
  const wanted = params.clientId ?? rememberedStudent(userId);
  const current = students.find((s) => s.clientId === wanted) ?? students[0] ?? null;
  useEffect(() => {
    if (params.clientId && students.some((s) => s.clientId === params.clientId)) {
      rememberStudent(userId, params.clientId);
    }
  }, [params.clientId, userId, students]);
  return { students, current };
}

function useSection(): StudentSection | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const last = pathname.split("/").filter(Boolean).at(-1);
  // The Pay screen belongs to Payments (its tab stays lit, and switching students opens Payments).
  if (last === "pay") return "payments";
  return (STUDENT_SECTIONS as readonly string[]).includes(last ?? "")
    ? (last as StudentSection)
    : null;
}

interface NavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  params?: { clientId: string };
  active: boolean;
}

function useNavItems(): NavItem[] {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = useSection();
  const { current } = useCurrentStudent();
  const student = (s: StudentSection, label: string, icon: LucideIcon): NavItem[] =>
    current
      ? [
          {
            label,
            icon,
            to: `/my/$clientId/${s}`,
            params: { clientId: current.clientId },
            active: section === s,
          },
        ]
      : [];
  return [
    { label: "Home", icon: Home, to: "/my", active: pathname === "/my" || pathname === "/my/" },
    ...student("progress", "Progress", TrendingUp),
    ...student("schedule", "Schedule", CalendarDays),
    ...student("payments", "Payments", Wallet),
    {
      label: "More",
      icon: Ellipsis,
      to: "/my/more",
      active:
        pathname.startsWith("/my/more") ||
        pathname.startsWith("/my/settings") ||
        pathname.startsWith("/my/enroll") ||
        pathname.startsWith("/my/announcements") ||
        section === "coaches" ||
        section === "consents" ||
        section === "profile",
    },
  ];
}

/** Phone: the floating black tab bar (Home, Progress, Schedule, Payments, More). */
export function PortalTabBar() {
  const items = useNavItems();
  return (
    <nav
      aria-label="Family portal"
      className="dark-zone fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 rounded-full bg-night p-1.5 shadow-pop lg:hidden"
    >
      <ul className="flex">
        {items.map((item) => (
          <li key={item.label} className="flex min-w-0 flex-1 justify-center">
            <Link
              to={item.to}
              params={item.params as never}
              aria-current={item.active ? "page" : undefined}
              className={`flex h-13 w-full flex-col items-center justify-center gap-0.5 rounded-full text-[0.6875rem] font-medium outline-none focus-visible:outline-2 focus-visible:outline-lime ${item.active ? "bg-lime text-ink" : "text-night-ink-2"}`}
            >
              <item.icon aria-hidden className="size-5" strokeWidth={1.75} />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Desktop: the same places as pills in the header, with Coaches, Profile, and Settings. */
function DesktopNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = useSection();
  const { current } = useCurrentStudent();
  const pill = (active: boolean) =>
    `inline-flex h-11 items-center gap-2 rounded-full px-4 text-[0.9375rem] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
      active ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:bg-night-3"
    }`;
  return (
    <nav aria-label="Family portal" className="hidden lg:block">
      <ul className="flex flex-wrap items-center gap-2">
        <li>
          <Link
            to="/my"
            aria-current={pathname === "/my" || pathname === "/my/" ? "page" : undefined}
            className={pill(pathname === "/my" || pathname === "/my/")}
          >
            Home
          </Link>
        </li>
        {current
          ? STUDENT_SECTIONS.map((s) => (
              <li key={s}>
                <Link
                  to={`/my/$clientId/${s}`}
                  params={{ clientId: current.clientId } as never}
                  aria-current={section === s ? "page" : undefined}
                  className={pill(section === s)}
                >
                  {SECTION_LABELS[s]}
                </Link>
              </li>
            ))
          : null}
        <li>
          <Link
            to="/my/enroll"
            aria-current={pathname.startsWith("/my/enroll") ? "page" : undefined}
            className={pill(pathname.startsWith("/my/enroll"))}
          >
            Enroll
          </Link>
        </li>
        <li>
          <Link
            to="/my/settings"
            aria-current={pathname.startsWith("/my/settings") ? "page" : undefined}
            className={pill(pathname.startsWith("/my/settings"))}
          >
            <Settings aria-hidden className="size-4.5" strokeWidth={1.75} />
            Settings
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/** Switches the student pages between linked students (only when there's more than one). */
function StudentSwitcher() {
  const { students, current } = useCurrentStudent();
  const section = useSection() ?? "progress";
  if (students.length < 2 || !current) return null;
  const academies = new Set(students.map((s) => s.workspaceId)).size;
  return (
    <nav aria-label="Students" className="mt-5">
      <ul className="-mx-1 flex flex-wrap gap-2 px-1">
        {students.map((s) => {
          const on = s.clientId === current.clientId;
          return (
            <li key={s.clientId}>
              <Link
                to={`/my/$clientId/${section}`}
                params={{ clientId: s.clientId } as never}
                aria-current={on ? "page" : undefined}
                className={`inline-flex h-11 items-center gap-2 rounded-full px-4 text-[0.9375rem] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
                  on ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:bg-night-3"
                }`}
              >
                {s.relation === "self" ? "You" : s.firstName}
                {academies > 1 ? (
                  <span className={on ? "text-ink/70" : "text-night-ink-2"}>
                    {" "}
                    · {s.academyName}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * A portal page: the black header block (the academy's logo and name, the page title, and on
 * student pages the student switcher), then the page on the gray canvas. Phone-first: on a
 * laptop the header holds the navigation and the page widens to two columns where it helps.
 */
export function PortalPage({
  title,
  subtitle,
  academy,
  students = false,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Whose logo and name the header shows; defaults to the current student's academy. */
  academy?: { name: string; logoKey: string | null } | null;
  /** Show the student switcher (student pages). */
  students?: boolean;
  children: ReactNode;
}) {
  const account = usePortalAccount().data;
  const { current } = useCurrentStudent();
  const brand =
    academy ??
    (current ? { name: current.academyName, logoKey: current.logoKey } : null) ??
    (account?.family[0]
      ? { name: account.family[0].academyName, logoKey: account.family[0].logoKey }
      : null);
  const isStaff = Boolean(account?.staff.length);
  return (
    <>
      <header className="dark-zone rounded-b-[32px] bg-night px-4 pt-[calc(env(safe-area-inset-top)+14px)] pb-6 text-night-ink sm:px-6 lg:mt-3 lg:rounded-[32px] lg:px-8 lg:pt-6 lg:pb-8">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/my"
            className="flex min-w-0 items-center gap-3 rounded-[16px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
          >
            <AcademyTile name={brand?.name ?? "CoachMan"} logoKey={brand?.logoKey ?? null} />
            <span className="min-w-0 truncate text-[1rem] font-medium">
              {brand?.name ?? "Your academy"}
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <SyncStatus dark />
            {isStaff ? (
              <Link
                to="/"
                className="inline-flex h-9 items-center gap-2 rounded-full bg-night-3 px-4 text-[0.875rem] font-medium text-night-ink outline-none hover:bg-night-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
              >
                <ArrowLeftRight aria-hidden className="size-4" />
                Coach view
              </Link>
            ) : null}
          </div>
        </div>
        <div className="mt-5 hidden lg:block">
          <DesktopNav />
        </div>
        <div className="mt-6 lg:mt-8">
          <h1 className="text-[2rem] leading-[1.1] font-light tracking-[-0.02em] lg:text-[2.5rem]">
            {title}
          </h1>
          {subtitle ? (
            <div className="mt-1.5 text-[0.9375rem] text-night-ink-2">{subtitle}</div>
          ) : null}
          {students ? <StudentSwitcher /> : null}
        </div>
      </header>
      <main
        id="main"
        className="px-4 pt-5 pb-[calc(112px+env(safe-area-inset-bottom))] sm:px-6 lg:px-0 lg:pt-6 lg:pb-12"
      >
        {children}
      </main>
    </>
  );
}
