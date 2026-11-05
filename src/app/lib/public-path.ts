/** Public academy pages (/a/…): for families opening a shared link, not the installed app. */
export function isPublicPath(path: string): boolean {
  return path === "/a" || path.startsWith("/a/");
}
