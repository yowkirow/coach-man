import { Check, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Tabs as RACTabs, Tab, TabList, TabPanel } from "react-aria-components";
import { fileUrl } from "../../lib/api";
import { initials } from "../../lib/format";

export type PillTone =
  | "lime"
  | "lavender"
  | "violet"
  | "coral"
  | "sky"
  | "amber"
  | "mint"
  | "white"
  | "panel"
  | "night"
  | "outline"
  | "outline-dark";

const pillTones: Record<PillTone, string> = {
  lime: "bg-lime text-ink",
  lavender: "bg-lavender text-ink",
  violet: "bg-violet text-ink",
  coral: "bg-coral text-ink",
  sky: "bg-sky text-ink",
  amber: "bg-amber text-ink",
  mint: "bg-mint text-ink",
  white: "bg-card text-ink",
  panel: "bg-panel text-ink-2",
  night: "bg-night-3 text-night-ink",
  outline: "ring-1 ring-line-strong text-ink-2",
  "outline-dark": "ring-1 ring-night-4 text-night-ink-2",
};

export function Pill({
  tone = "panel",
  children,
  className = "",
  size = "sm",
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap ${size === "md" ? "h-9 px-4 text-[0.9375rem]" : "h-6 px-2.5 text-[0.75rem]"} ${pillTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

const AVATAR_TINTS = [
  "#f2f8cf",
  "#ebe8fd",
  "#e2f3f8",
  "#fcf1d2",
  "#fde3e3",
  "#d9f2e3",
  "#ffe4d3",
  "#ececef",
];

function tintFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

export function Avatar({
  person,
  size = "md",
  ring = false,
  src: srcOverride,
}: {
  person: { firstName: string; lastName: string; photoKey?: string | null };
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  ring?: boolean;
  /** A ready photo URL (the family portal's files); otherwise `photoKey` via the staff API. */
  src?: string | null;
}) {
  const dims = {
    xs: "size-7 text-[0.6875rem]",
    sm: "size-9 text-[0.75rem]",
    md: "size-11 text-[0.875rem]",
    lg: "size-16 text-[1.25rem]",
    xl: "size-28 text-[2.25rem]",
  }[size];
  // Ring colour comes from --avatar-ring so stacks can match whatever surface they sit on.
  const ringCls = ring ? "ring-2 ring-[var(--avatar-ring,var(--color-card))]" : "";
  const src = srcOverride !== undefined ? srcOverride : fileUrl(person.photoKey);
  if (src)
    return (
      <img
        src={src}
        alt=""
        className={`${dims} ${ringCls} shrink-0 rounded-full object-cover`}
        loading="lazy"
      />
    );
  return (
    <span
      aria-hidden
      style={{ backgroundColor: tintFor(`${person.firstName}${person.lastName}`) }}
      className={`${dims} ${ringCls} flex shrink-0 items-center justify-center rounded-full font-semibold text-ink`}
    >
      {initials(person)}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 3,
  dark = false,
}: {
  people: { firstName: string; lastName: string; photoKey?: string | null }[];
  max?: number;
  /** Dark "+N" bubble for the black panel. Set --avatar-ring on a parent to match the surface. */
  dark?: boolean;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two players can share a name; the stack order is stable.
        <span key={`${p.firstName}-${p.lastName}-${i}`} className={i ? "-ml-1.5" : ""}>
          <Avatar person={p} size="sm" ring />
        </span>
      ))}
      {extra > 0 ? (
        <span
          className={`-ml-1.5 flex size-9 items-center justify-center rounded-full text-[0.75rem] font-semibold ring-2 ring-[var(--avatar-ring,var(--color-card))] ${dark ? "bg-night-3 text-night-ink" : "bg-panel text-ink"}`}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`flex flex-wrap items-end justify-between gap-x-4 gap-y-4 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-[2rem] leading-[1.1] font-light tracking-[-0.02em] lg:text-[2.5rem]">
          {title}
        </h1>
        {subtitle ? <div className="mt-2 text-[0.9375rem] text-ink-2">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className = "",
  as: As = "section",
  label,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
  label?: string;
}) {
  return (
    <As aria-label={label} className={`rounded-[28px] bg-card ${className}`}>
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  action,
  className = "",
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-5 pt-5 pb-3 ${className}`}>
      <h2 className="text-[1.125rem] font-medium">{title}</h2>
      {action}
    </div>
  );
}

/** Lavender or lime bento card from the reference's right column. */
export function Bento({
  tone,
  title,
  subtitle,
  children,
  className = "",
}: {
  tone: "lavender" | "lime";
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[28px] p-5 text-ink ${tone === "lavender" ? "bg-lavender" : "bg-lime"} ${className}`}
    >
      <h2 className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">{title}</h2>
      {subtitle ? <p className="mt-1 text-[0.8125rem] text-ink/75">{subtitle}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

export function CheckItem({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-1.5 text-[0.875rem]">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/45"
      >
        {ok ? (
          <Check className="size-3.5" strokeWidth={2.5} />
        ) : (
          <X className="size-3.5" strokeWidth={2.5} />
        )}
      </span>
      <span className="sr-only">{ok ? "Yes:" : "No:"}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

const tileTints: Record<
  "lime" | "coral" | "sky" | "violet" | "amber",
  { tint: string; border: string }
> = {
  lime: { tint: "rgb(218 238 99 / 0.22)", border: "border-lime" },
  coral: { tint: "rgb(248 113 113 / 0.22)", border: "border-coral" },
  sky: { tint: "rgb(110 168 255 / 0.22)", border: "border-sky" },
  violet: { tint: "rgb(201 190 251 / 0.22)", border: "border-violet" },
  amber: { tint: "rgb(248 212 119 / 0.2)", border: "border-amber" },
};

/** Dark KPI tile with a tinted glow and an outlined square, as in the reference's worklist tiles. */
export function KpiTile({
  label,
  value,
  tint,
  onPress,
  hint,
}: {
  label: string;
  value: ReactNode;
  tint: keyof typeof tileTints;
  onPress?: () => void;
  hint?: string;
}) {
  const t = tileTints[tint];
  const content = (
    <>
      <span className="flex items-center gap-2">
        <span aria-hidden className={`size-4.5 rounded-[6px] border-[1.5px] ${t.border}`} />
        <span className="text-[0.8125rem] text-night-ink/85">{label}</span>
      </span>
      <span className="num mt-auto self-end text-[2rem] leading-none font-light text-night-ink">
        {value}
      </span>
    </>
  );
  const cls = "tile-glow flex h-[104px] w-full flex-col rounded-[22px] bg-night-2 p-4 text-left";
  if (onPress) {
    return (
      <button
        type="button"
        onClick={onPress}
        title={hint}
        style={{ ["--tile-tint" as string]: t.tint }}
        className={`${cls} cursor-pointer outline-none transition-transform hover:brightness-110 focus-visible:outline-2 focus-visible:outline-lime active:scale-[0.98]`}
      >
        {content}
      </button>
    );
  }
  return (
    <div style={{ ["--tile-tint" as string]: t.tint }} className={cls} title={hint}>
      {content}
    </div>
  );
}

export interface TabDef {
  id: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
}

/** Measures an element's document offset so a panel can stretch to the viewport's bottom edge. */
function useDocumentTop(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const measure = () => setTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [enabled]);
  return { ref, top };
}

/**
 * Folder tabs, as in the reference: the selected tab takes the panel tone and fuses into a lighter
 * panel (concave fillets at its feet). The panel holds the tab content and, optionally, an aside
 * column of bento cards. `fill` stretches the panel to the bottom of the viewport on desktop,
 * level with the black command panel.
 */
export function PillTabs({
  label,
  tabs,
  selected,
  onChange,
  aside,
  fill = false,
  className = "",
}: {
  label: string;
  tabs: TabDef[];
  selected?: string;
  onChange?: (id: string) => void;
  aside?: ReactNode;
  fill?: boolean;
  className?: string;
}) {
  const panel = useDocumentTop(fill);
  const panels = tabs.map((t) => (
    <TabPanel
      key={t.id}
      id={t.id}
      className="rounded-[22px] outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink"
    >
      {t.content}
    </TabPanel>
  ));
  return (
    <RACTabs
      selectedKey={selected}
      onSelectionChange={(k) => onChange?.(String(k))}
      className={`flex flex-col ${className}`}
    >
      <TabList
        aria-label={label}
        className="flex gap-5 overflow-x-auto pr-6 pl-10 [scrollbar-width:none] lg:pl-12"
      >
        {tabs.map((t) => (
          <Tab
            key={t.id}
            id={t.id}
            className={
              "relative flex h-12 shrink-0 cursor-pointer items-center gap-2 rounded-t-[20px] px-5 text-[0.9375rem] text-ink-2 outline-none transition-colors " +
              "data-[hovered]:text-ink data-[selected]:bg-panel data-[selected]:text-ink " +
              "data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-4 data-[focus-visible]:outline-ink " +
              "before:pointer-events-none before:absolute before:bottom-0 before:-left-5 before:hidden before:size-5 before:bg-[radial-gradient(circle_at_0_0,transparent_19.5px,var(--color-panel)_20px)] data-[selected]:before:block " +
              "after:pointer-events-none after:absolute after:-right-5 after:bottom-0 after:hidden after:size-5 after:bg-[radial-gradient(circle_at_100%_0,transparent_19.5px,var(--color-panel)_20px)] data-[selected]:after:block"
            }
          >
            {t.icon}
            {t.label}
          </Tab>
        ))}
      </TabList>
      <div
        ref={panel.ref}
        style={
          fill && panel.top !== null
            ? ({ "--fill-top": `${panel.top}px` } as CSSProperties)
            : undefined
        }
        className={`rounded-[24px] bg-panel p-2.5 sm:p-3 lg:rounded-[28px] lg:p-4 ${fill ? "lg:min-h-[calc(100dvh-var(--fill-top)-12px)]" : ""}`}
      >
        {aside ? (
          <div className="grid grid-cols-1 gap-3 lg:gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
            <div className="min-w-0">{panels}</div>
            <div className="flex flex-col gap-3 lg:gap-4">{aside}</div>
          </div>
        ) : (
          panels
        )}
      </div>
    </RACTabs>
  );
}

export interface TimelineEntry {
  id: string;
  date: string;
  icon: ReactNode;
  tone: "sky" | "lavender" | "lime" | "coral" | "amber";
  content: ReactNode;
}

const nodeTones = {
  sky: "bg-sky",
  lavender: "bg-lavender",
  lime: "bg-lime",
  coral: "bg-coral",
  amber: "bg-amber",
};

/** Vertical timeline with soft-coloured icon nodes (reference: activity history). */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="flex flex-col">
      {entries.map((e, i) => (
        <li key={e.id} className="grid grid-cols-[56px_1fr] gap-3">
          <div className="relative flex flex-col items-center">
            {i < entries.length - 1 ? (
              <span aria-hidden className="absolute top-12 bottom-0 w-px bg-line-strong" />
            ) : null}
            <span
              aria-hidden
              className={`relative mt-3 flex size-10 items-center justify-center rounded-full text-ink ${nodeTones[e.tone]}`}
            >
              {e.icon}
            </span>
            <span className="relative mt-1.5 text-center text-[0.75rem] text-ink-2">{e.date}</span>
          </div>
          <div className="pb-3">{e.content}</div>
        </li>
      ))}
    </ol>
  );
}

export function KeyValue({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <dt className="text-[0.8125rem] text-ink-2">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

export function Meter({
  value,
  max,
  tone = "ink",
}: {
  value: number;
  max: number;
  tone?: "ink" | "coral" | "lime";
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill = tone === "coral" ? "bg-coral" : tone === "lime" ? "bg-lime" : "bg-ink";
  return (
    <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
      <span
        className={`block h-full rounded-full ${fill} transition-[width] duration-300 ease-out`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}
