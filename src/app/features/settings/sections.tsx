import type { MeDto } from "@shared/api-types";
import type { Capability } from "@shared/roles";
import {
  BadgeCheck,
  BellRing,
  Building2,
  CreditCard,
  Database,
  FileSignature,
  Globe,
  KeyRound,
  ListChecks,
  MapPin,
  Scale,
  UserRound,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Avatar } from "../../components/ui/display";
import { plural } from "../../lib/format";
import { useCan } from "../../lib/hooks";
import { scrollToId } from "./scroll";

export const SETTINGS_SECTIONS = [
  { id: "academy", label: "Academy", icon: BadgeCheck },
  { id: "academy-profile", label: "Academy profile", icon: Building2, cap: "settings" },
  { id: "coach-profile", label: "My coach profile", icon: UserRound },
  { id: "workspace", label: "Regional settings", icon: Globe, cap: "settings" },
  { id: "policies", label: "Policies", icon: Scale, cap: "settings" },
  { id: "consents", label: "Consent forms", icon: FileSignature, cap: "settings" },
  { id: "payment-methods", label: "Payment methods", icon: CreditCard, cap: "settings" },
  { id: "venues", label: "Venues", icon: MapPin, cap: "settings" },
  { id: "rubric", label: "Progress rubric", icon: ListChecks, cap: "settings" },
  { id: "security", label: "Sign-in & security", icon: KeyRound },
  { id: "notifications", label: "Notifications", icon: BellRing },
  { id: "app-data", label: "App & data", icon: Database },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: typeof Building2;
  cap?: Capability;
}[];

export type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
type Section = (typeof SETTINGS_SECTIONS)[number];

/** The settings sections this role can use (academy settings are for owners and admins). */
export function useSettingsSections(): readonly Section[] {
  const can = useCan();
  return SETTINGS_SECTIONS.filter((s) => !("cap" in s) || can[s.cap]);
}

/** A settings card: white, with an h2 the nav can move focus to. */
export function SettingsSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: SectionId;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-4 rounded-[28px] bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-[16rem]">
          <h2
            id={`${id}-title`}
            tabIndex={-1}
            className="text-[1.375rem] leading-tight font-light tracking-[-0.01em] outline-none"
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-1.5 max-w-[60ch] text-[0.875rem] text-ink-2">{description}</p>
          ) : null}
        </div>
        {action ? (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{action}</div>
        ) : null}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}

/** Save bar for a settings form (submits it); only shown while there are unsaved changes. */
export function SaveBar({
  dirty,
  onDiscard,
  isPending,
  disabled,
  label = "Save changes",
}: {
  dirty: boolean;
  onDiscard: () => void;
  isPending?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  if (!dirty) return null;
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
      <p className="mr-auto text-[0.8125rem] text-ink-2">Unsaved changes</p>
      <Button variant="ghost" onPress={onDiscard}>
        Discard
      </Button>
      <Button type="submit" variant="dark" isDisabled={disabled} isPending={isPending}>
        {label}
      </Button>
    </div>
  );
}

/**
 * Tracks which section is under a reading line a quarter of the way down the viewport
 * (IntersectionObserver), with the last section winning at the bottom of the page. A jump from
 * the nav holds its highlight until the coach scrolls again.
 */
export function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState<string>(ids[0] ?? "");
  const held = useRef(false);
  const key = ids.join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: ids are tracked through `key`.
  useEffect(() => {
    const onLine = new Set<string>();
    const atBottom = () =>
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    const pick = () => {
      if (held.current) return;
      const next = atBottom() ? ids[ids.length - 1] : ids.find((id) => onLine.has(id));
      if (next) setActive(next);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) onLine.add(e.target.id);
          else onLine.delete(e.target.id);
        }
        pick();
      },
      { rootMargin: "-25% 0px -75% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    const release = () => {
      held.current = false;
    };
    const onScroll = () => {
      if (atBottom()) pick();
    };
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", release);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", release);
      window.removeEventListener("scroll", onScroll);
    };
  }, [key]);

  const jump = (id: string) => {
    held.current = true;
    setActive(id);
    scrollToId(id);
    document.getElementById(`${id}-title`)?.focus({ preventScroll: true });
  };

  return { active, jump };
}

/** Dark command-panel nav: account summary, then one row per section (active row lime). */
export function SettingsNav({
  me,
  active,
  onJump,
}: {
  me?: MeDto;
  active: string;
  onJump: (id: SectionId) => void;
}) {
  const sections = useSettingsSections();
  const [firstName, ...rest] = (me?.user.name ?? "Coach").split(" ");
  const coach = { firstName: firstName ?? "Coach", lastName: rest.join(" ") };
  return (
    <div className="flex flex-col gap-5">
      <div className="px-1">
        <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">Settings</h2>
        <p className="mt-1 truncate text-[0.875rem] text-night-ink-2">
          {me?.workspace.name ?? "Your academy"}
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-[24px] bg-night-2 p-4">
        <Avatar person={coach} size="md" />
        <div className="min-w-0">
          <p className="truncate">{me?.user.name ?? "Coach"}</p>
          <p className="truncate text-[0.8125rem] text-night-ink-2">{me?.user.email}</p>
          <p className="num mt-0.5 text-[0.8125rem] text-night-ink-2">
            Google · {plural(me?.passkeyCount ?? 0, "passkey")}
          </p>
        </div>
      </div>
      <nav aria-label="Settings sections">
        <ul className="flex flex-col gap-2">
          {sections.map((s) => {
            const on = s.id === active;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={on ? "location" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    onJump(s.id);
                  }}
                  className={`flex h-12 items-center gap-3 rounded-full px-4 text-[0.9375rem] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
                    on ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:bg-night-3"
                  }`}
                >
                  <s.icon aria-hidden className="size-4.5 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{s.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** Phone: a scrolling row of section chips under the title. */
export function SectionChips({ onJump }: { onJump: (id: SectionId) => void }) {
  const sections = useSettingsSections();
  return (
    <nav aria-label="Settings sections">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {sections.map((s) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                onJump(s.id);
              }}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-card px-4 text-[0.875rem] font-medium whitespace-nowrap text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <s.icon aria-hidden className="size-4" strokeWidth={1.75} />
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
