// Link previews for the public academy page. Messenger, Viber, and Facebook read the HTML of a
// shared link (they never run the app), so the Worker answers /a/* with the app's index.html plus
// these tags. Everything here is pure and escapes every value it writes.

import type { PublicAcademyDto } from "../../shared/api-types";

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

/** An absolute link to a public R2 image (each path segment encoded, as the app does). */
export function publicImageUrl(appUrl: string, key: string): string {
  return `${origin(appUrl)}/api/public/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export type PublicPageKind = "home" | "rates";

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
  return { slug, page: match[2] === "rates" ? "rates" : "home" };
}

/**
 * The preview of a page: the academy's name, tagline (or the start of its about text), and logo
 * (or cover) when it's listed; CoachMan's own tags otherwise, so an unlisted academy's name never
 * shows up in a preview.
 */
export function academyPageMeta(input: {
  academy: Pick<
    PublicAcademyDto,
    "name" | "slug" | "tagline" | "about" | "logoKey" | "coverKey"
  > | null;
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
  const path = `/a/${encodeURIComponent(a.slug)}${input.page === "rates" ? "/rates" : ""}`;
  const about = a.tagline?.trim() || (a.about ? summarize(a.about) : "");
  const description =
    input.page === "rates"
      ? summarize(`Rates and packages at ${a.name}${about ? `. ${about}` : "."}`)
      : about || `Programs, schedule, rates, and coaches at ${a.name}.`;
  const imageKey = a.coverKey ?? a.logoKey;
  return {
    title: input.page === "rates" ? `Rates and packages · ${a.name}` : a.name,
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

/**
 * A JSON data block (never executed, so the page's script policy allows it). `<`, `>`, `&`, and
 * the line separators are escaped, so no value can close the tag or start markup.
 */
export function renderDataIsland(data: unknown): string {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script type="application/json" id="${PUBLIC_DATA_ID}">${json}</script>`;
}
