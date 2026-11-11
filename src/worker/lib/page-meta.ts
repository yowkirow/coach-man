// Link previews for the public academy page. Messenger, Viber, and Facebook read the HTML of a
// shared link (they never run the app), so the Worker answers /a/* with the app's index.html plus
// these tags. Everything here is pure and escapes every value it writes.

import type { PublicAcademyDto, PublicCoachDto, PublicConfigDto } from "../../shared/api-types";

/** The app shell's own tags (index.html), used for unknown and unlisted academies. */
export const DEFAULT_TITLE = "CoachMan";
export const DEFAULT_DESCRIPTION =
  "CoachMan: clients, packages, schedule, and money for pickleball coaches.";

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute URL of the preview image. */
  image: string;
  /** "summary" for a square logo, "summary_large_image" for a wide cover. */
  twitterCard: "summary" | "summary_large_image";
  /** The page's canonical, absolute URL. */
  url: string;
}

/** Text safe inside an HTML element or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One line of at most `max` characters, cut at a word with an ellipsis. */
export function summarize(text: string, max = 160): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.4 ? cut.slice(0, space) : cut).replace(/[\s.,;:!-]+$/, "")}…`;
}

const origin = (appUrl: string) => appUrl.replace(/\/+$/, "");

/** The app's own origin (APP_URL without a trailing slash), for absolute links. */
export const appOrigin = (env: { APP_URL: string }) => origin(env.APP_URL);

/** An absolute link to a public R2 image (each path segment encoded, as the app does). */
export function publicImageUrl(appUrl: string, key: string): string {
  return `${origin(appUrl)}/api/public/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export type PublicPageKind = "home" | "rates" | "enroll" | "team";

/** The page of /a/<slug>[/<rest>] a request is for, or null when the path isn't an academy page. */
export function parseAcademyPath(pathname: string): { slug: string; page: PublicPageKind } | null {
  const match = /^\/a\/([^/]+)(?:\/([^/]*))?\/?$/.exec(pathname);
  if (!match?.[1]) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const rest = match[2];
  const page = rest === "rates" || rest === "enroll" || rest === "team" ? rest : "home";
  return { slug, page };
}

/** "Ana Cruz, Ben Reyes, and 3 more": the first names on the team, for a preview line. */
function teamNames(people: { name: string }[], shown = 3): string {
  const names = people.slice(0, shown).map((p) => p.name);
  const more = people.length - names.length;
  if (more > 0) return `${names.join(", ")}, and ${more} more`;
  if (names.length < 3) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/**
 * The preview of a page: the academy's name, tagline (or the start of its about text), and logo
 * (or cover) when it's listed; CoachMan's own tags otherwise, so an unlisted academy's name never
 * shows up in a preview. The team page names its first people and shows the first one's photo.
 */
export function academyPageMeta(input: {
  academy:
    | (Pick<PublicAcademyDto, "name" | "slug" | "tagline" | "about" | "logoKey" | "coverKey"> & {
        coaches?: Pick<PublicCoachDto, "name" | "portraitKey" | "photoKey">[];
      })
    | null;
  page: PublicPageKind;
  appUrl: string;
}): PageMeta {
  const base = origin(input.appUrl);
  const a = input.academy;
  if (!a) {
    return {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      image: `${base}/icons/icon-512.png`,
      twitterCard: "summary",
      url: `${base}/`,
    };
  }
  const path = `/a/${encodeURIComponent(a.slug)}${input.page === "home" ? "" : `/${input.page}`}`;
  const about = a.tagline?.trim() || (a.about ? summarize(a.about) : "");
  if (input.page === "team") {
    const people = a.coaches ?? [];
    const face = people.map((p) => p.portraitKey ?? p.photoKey).find((k): k is string => !!k);
    const imageKey = face ?? a.coverKey ?? a.logoKey;
    return {
      title: `Meet the team · ${a.name}`,
      description: summarize(
        people.length
          ? `Meet the team at ${a.name}: ${teamNames(people)}.`
          : `Meet the team at ${a.name}.`,
      ),
      image: imageKey ? publicImageUrl(base, imageKey) : `${base}/icons/icon-512.png`,
      twitterCard: !face && a.coverKey ? "summary_large_image" : "summary",
      url: `${base}${path}`,
    };
  }
  const description =
    input.page === "rates"
      ? summarize(`Rates and packages at ${a.name}${about ? `. ${about}` : "."}`)
      : input.page === "enroll"
        ? summarize(`Packages and enrollment at ${a.name}${about ? `. ${about}` : "."}`)
        : about || `Programs, schedule, rates, and coaches at ${a.name}.`;
  const imageKey = a.coverKey ?? a.logoKey;
  return {
    title:
      input.page === "rates"
        ? `Rates and packages · ${a.name}`
        : input.page === "enroll"
          ? `Enroll now · ${a.name}`
          : a.name,
    description,
    image: imageKey ? publicImageUrl(base, imageKey) : `${base}/icons/icon-512.png`,
    twitterCard: a.coverKey ? "summary_large_image" : "summary",
    url: `${base}${path}`,
  };
}

/** The tags written into <head>: title, description, Open Graph, and Twitter card. */
export function renderMetaTags(meta: PageMeta): string {
  const tag = (attr: "name" | "property", key: string, value: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
  return [
    `<title>${escapeHtml(meta.title)}</title>`,
    tag("name", "description", meta.description),
    `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
    tag("property", "og:type", "website"),
    tag("property", "og:site_name", "CoachMan"),
    tag("property", "og:title", meta.title),
    tag("property", "og:description", meta.description),
    tag("property", "og:image", meta.image),
    tag("property", "og:url", meta.url),
    tag("name", "twitter:card", meta.twitterCard),
    tag("name", "twitter:title", meta.title),
    tag("name", "twitter:description", meta.description),
    tag("name", "twitter:image", meta.image),
  ].join("");
}

/** The id of the JSON block holding a page's data, which the app reads instead of refetching. */
export const PUBLIC_DATA_ID = "cm-public-academy";
/** The id of the JSON block with the public pages' settings (`PublicConfigDto`). */
export const PUBLIC_CONFIG_ID = "cm-public-config";

/**
 * A JSON data block (never executed, so the page's script policy allows it). `<`, `>`, `&`, and
 * the line separators are escaped, so no value can close the tag or start markup.
 */
export function renderDataIsland(data: unknown, id = PUBLIC_DATA_ID): string {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script type="application/json" id="${escapeHtml(id)}">${json}</script>`;
}

// --- CoachMan's own public pages: /about, /privacy, /terms -----------------------------------------

/** Where people write about privacy, their data, or the terms, unless the Worker says otherwise. */
export const DEFAULT_CONTACT_EMAIL = "privacy@coachman.cloud";

/** The public pages' settings (`GET /api/public/config`, and the pages' data block). */
export function publicConfig(env: { PUBLIC_CONTACT_EMAIL?: string }): PublicConfigDto {
  return { contactEmail: env.PUBLIC_CONTACT_EMAIL?.trim() || DEFAULT_CONTACT_EMAIL };
}

export type InfoPageKind = "about" | "privacy" | "terms";

/** Which of CoachMan's own public pages a path is (exactly /about, /privacy, or /terms). */
export function infoPageOf(pathname: string): InfoPageKind | null {
  const match = /^\/(about|privacy|terms)\/?$/.exec(pathname);
  return (match?.[1] as InfoPageKind | undefined) ?? null;
}

const INFO_PAGES: Record<InfoPageKind, { title: string; description: string }> = {
  about: {
    title: "CoachMan: for pickleball academies, coaches, students, and parents",
    description:
      "CoachMan is an app for pickleball academies and coaches: a schedule and check-in that work offline, packages and credits, progress and coach comments, a family portal, and enrollment with payment proofs.",
  },
  privacy: {
    title: "Privacy policy · CoachMan",
    description:
      "What CoachMan collects, why, who it shares it with, how long it keeps it, and your rights under the Philippine Data Privacy Act of 2012.",
  },
  terms: {
    title: "Terms of use · CoachMan",
    description:
      "The terms for using CoachMan, for academies and coaches, and for students and parents.",
  },
};

/** The link-preview tags of /about, /privacy, and /terms. */
export function infoPageMeta(kind: InfoPageKind, appUrl: string): PageMeta {
  const base = origin(appUrl);
  const page = INFO_PAGES[kind];
  return {
    title: page.title,
    description: page.description,
    image: `${base}/icons/icon-512.png`,
    twitterCard: "summary",
    url: `${base}/${kind}`,
  };
}
