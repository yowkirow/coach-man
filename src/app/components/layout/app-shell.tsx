import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  CalendarDays,
  CircleDollarSign,
  Contact,
  Ellipsis,
  Home,
  Plus,
  Settings,
  Tent,
  Ticket,
  UserPlus,
  UsersRound,
  WifiOff,
} from "lucide-react";
import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { fullName } from "../../lib/format";
import { useMe } from "../../lib/hooks";
import { useOnline, usePendingChanges } from "../../lib/offline";
import { BallMark } from "../brand";
import { Avatar } from "../ui/display";
import { Sheet } from "../ui/overlay";

export const NAV = [
  { to: "/", label: "Today", icon: Home },
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/clients", label: "Clients", icon: Contact },
  { to: "/groups", label: "Groups", icon: UsersRound },
  { to: "/events", label: "Events", icon: Tent },
  { to: "/money", label: "Money", icon: CircleDollarSign },
  { to: "/packages", label: "Packages & rates", icon: Ticket },
] as const;

const TABS = ["/", "/schedule", "/clients", "/money"] as const;

export function isActivePath(pathname: string, to: string) {
  if (to === "/") return pathname === "/" || pathname.startsWith("/sessions");
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

/** Same breakpoint as useIsDesktop, for non-React code such as route loaders. */
export const isDesktopViewport = () =>
  typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

const AsideSlot = createContext<HTMLElement | null>(null);

/**
 * Renders page content into the black command panel next to the icon rail (desktop only).
 * On smaller screens it renders nothing; pages show a mobile layout instead.
 */
export function ShellAside({ children }: { children: ReactNode }) {
  const slot = useContext(AsideSlot);
  const desktop = useIsDesktop();
  if (!slot || !desktop) return null;
  return createPortal(children, slot);
}

export function SyncStatus({ dark = false }: { dark?: boolean }) {
  const online = useOnline();
  const pending = usePendingChanges();
  if (online && pending === 0) return null;
  const text = !online
    ? pending
      ? `Offline · ${pending} to sync`
      : "Offline"
    : `Syncing ${pending}…`;
  return (
    <span
      role="status"
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold ${dark ? "bg-sync text-ink" : "bg-sync text-ink"}`}
    >
      {!online ? (
        <WifiOff aria-hidden className="size-3.5" />
      ) : (
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-ink" />
      )}
      {text}
    </span>
  );
}

function QuickActions({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const go = (to: string, search?: Record<string, string>) => {
    onOpenChange(false);
    void navigate({ to, search: search as never });
  };
  const items = [
    {
      label: "New session",
      body: "Private lesson, group class, or clinic",
      icon: CalendarDays,
      onPress: () => go("/schedule", { new: "1" }),
    },
    {
      label: "Add client",
      body: "Name and contact; the rest can wait",
      icon: UserPlus,
      onPress: () => go("/clients/new"),
    },
    {
      label: "Record payment",
      body: "Cash, transfer, card, or e-wallet",
      icon: CircleDollarSign,
      onPress: () => go("/money", { record: "1" }),
    },
    {
      label: "Sell a package",
      body: "Credits for lessons or classes",
      icon: Ticket,
      onPress: () => go("/packages", { sell: "1" }),
    },
  ];
  return (
    <Sheet isOpen={isOpen} onOpenChange={onOpenChange} title="Quick add">
      <ul className="-mx-2 flex flex-col">
        {items.map((it) => (
          <li key={it.label}>
            <button
              type="button"
              onClick={it.onPress}
              className="flex w-full cursor-pointer items-center gap-4 rounded-2xl px-2 py-3 text-left outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-lime text-ink">
                <it.icon aria-hidden className="size-5" />
              </span>
              <span className="flex flex-col">
                <span className="text-[1.0625rem] font-medium">{it.label}</span>
                <span className="text-[0.875rem] text-ink-2">{it.body}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function RailLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex size-12 items-center justify-center rounded-full outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
        active ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:bg-night-3"
      }`}
    >
      <Icon aria-hidden className="size-5" strokeWidth={1.75} />
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const me = useMe();
  const [quickOpen, setQuickOpen] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const moreActive = !TABS.some((t) => isActivePath(pathname, t));
  const [firstName, ...rest] = (me.data?.user.name ?? "Coach").split(" ");
  const coach = { firstName: firstName ?? "Coach", lastName: rest.join(" ") };

  return (
    <AsideSlot.Provider value={slot}>
      <div className="min-h-dvh lg:flex lg:gap-3 lg:p-3">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:rounded-full focus:bg-lime focus:px-5 focus:py-2.5 focus:font-semibold focus:text-ink"
        >
          Skip to content
        </a>

        {/* Desktop: black command panel = icon rail + page-provided list column */}
        <aside className="dark-zone sticky top-3 hidden h-[calc(100dvh-24px)] shrink-0 rounded-[32px] bg-night text-night-ink lg:flex">
          <div className="flex w-[84px] flex-col items-center gap-3 py-5">
            <Link
              to="/"
              aria-label="CoachMan home"
              className="mb-4 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-lime"
            >
              <BallMark className="size-10" />
            </Link>
            <nav aria-label="Main" className="flex flex-col items-center gap-2.5">
              {NAV.map((n) => (
                <RailLink
                  key={n.to}
                  to={n.to}
                  label={n.label}
                  icon={n.icon}
                  active={isActivePath(pathname, n.to)}
                />
              ))}
            </nav>
            <button
              type="button"
              title="Quick add"
              aria-label="Quick add"
              onClick={() => setQuickOpen(true)}
              className="mt-2 flex size-12 cursor-pointer items-center justify-center rounded-full border border-dashed border-night-4 text-night-ink outline-none hover:border-lime hover:text-lime focus-visible:outline-2 focus-visible:outline-lime"
            >
              <Plus aria-hidden className="size-5" />
            </button>
            <div className="mt-auto flex flex-col items-center gap-3">
              <SyncDot />
              <RailLink
                to="/settings"
                label="Settings"
                icon={Settings}
                active={isActivePath(pathname, "/settings")}
              />
              <Link
                to="/settings"
                aria-label={`${fullName(coach)}: account and settings`}
                className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-lime"
              >
                <Avatar person={coach} size="md" />
              </Link>
            </div>
          </div>
          <div
            ref={setSlot}
            className="w-[328px] overflow-y-auto border-l border-night-line px-4 py-5 empty:hidden"
          />
        </aside>

        <main
          id="main"
          className="min-w-0 flex-1 pb-[calc(112px+env(safe-area-inset-bottom))] lg:pb-6"
        >
          {children}
        </main>

        {/* Phone: floating black tab bar with quick add beside it (never over content) */}
        <div className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 flex items-center gap-2 lg:hidden">
          <nav
            aria-label="Main"
            className="dark-zone min-w-0 flex-1 rounded-full bg-night p-1.5 shadow-pop"
          >
            <ul className="grid grid-cols-5">
              {TABS.map((to) => {
                const item = NAV.find((n) => n.to === to);
                if (!item) return null;
                const active = isActivePath(pathname, to);
                return (
                  <li key={to} className="flex justify-center">
                    <Link
                      to={to}
                      aria-current={active ? "page" : undefined}
                      className={`flex h-13 w-full flex-col items-center justify-center gap-0.5 rounded-full text-[0.6875rem] font-medium outline-none focus-visible:outline-2 focus-visible:outline-lime ${active ? "bg-lime text-ink" : "text-night-ink-2"}`}
                    >
                      <item.icon aria-hidden className="size-5" strokeWidth={1.75} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
              <li className="flex justify-center">
                <Link
                  to="/more"
                  aria-current={moreActive ? "page" : undefined}
                  className={`flex h-13 w-full flex-col items-center justify-center gap-0.5 rounded-full text-[0.6875rem] font-medium outline-none focus-visible:outline-2 focus-visible:outline-lime ${moreActive ? "bg-lime text-ink" : "text-night-ink-2"}`}
                >
                  <Ellipsis aria-hidden className="size-5" strokeWidth={1.75} />
                  More
                </Link>
              </li>
            </ul>
          </nav>
          <button
            type="button"
            aria-label="Quick add"
            onClick={() => setQuickOpen(true)}
            className="flex size-16 shrink-0 cursor-pointer items-center justify-center rounded-full bg-lime text-ink shadow-pop outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:scale-95"
          >
            <Plus aria-hidden className="size-6" strokeWidth={2.25} />
          </button>
        </div>

        <QuickActions isOpen={quickOpen} onOpenChange={setQuickOpen} />
      </div>
    </AsideSlot.Provider>
  );
}

function SyncDot() {
  const online = useOnline();
  const pending = usePendingChanges();
  if (online && pending === 0) return null;
  const label = !online
    ? `Offline${pending ? `, ${pending} changes waiting to sync` : ""}`
    : `Syncing ${pending} changes`;
  return (
    <span
      role="status"
      title={label}
      aria-label={label}
      className="flex size-12 items-center justify-center rounded-full bg-sync text-ink"
    >
      {!online ? (
        <WifiOff aria-hidden className="size-5" />
      ) : (
        <span aria-hidden className="num text-[0.875rem] font-semibold">
          {pending}
        </span>
      )}
    </span>
  );
}

export const MORE_LINKS = [
  ...NAV.filter((n) => !TABS.includes(n.to as (typeof TABS)[number])),
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

/** Standard page padding inside the canvas. */
export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-[1240px] px-4 pt-6 sm:px-6 lg:px-6 lg:pt-4 ${className}`}>
      {children}
    </div>
  );
}
