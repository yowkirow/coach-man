/** Public academy pages (/a/…): for families opening a shared link, not the installed app. */
export function isPublicPath(path: string): boolean {
  return path === "/a" || path.startsWith("/a/");
}

/** The enrollment wizard (/a/<slug>/enroll): it signs people in itself. */
export function isEnrollPath(path: string): boolean {
  return /^\/a\/[^/]+\/enroll\/?$/.test(path);
}
