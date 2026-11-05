/** Public academy pages (/a/…): for families opening a shared link, not the installed app. */
export function isPublicPath(path: string): boolean {
  return path === "/a" || path.startsWith("/a/");
}

/** The enrollment wizard (/a/<slug>/enroll): it signs people in itself. */
export function isEnrollPath(path: string): boolean {
  return /^\/a\/[^/]+\/enroll\/?$/.test(path);
}

/**
 * CoachMan's own public pages (/about, /privacy, /terms): readable signed out, by anyone. They
 * don't register the service worker or ask for storage, but an installed app's cached shell still
 * renders them offline.
 */
export function isInfoPath(path: string): boolean {
  return /^\/(about|privacy|terms)\/?$/.test(path);
}

/** Running as the installed app (home-screen icon), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
