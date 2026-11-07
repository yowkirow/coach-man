/** Scrolls an element into view, smoothly unless the coach prefers reduced motion. */
export function scrollToId(id: string, block: ScrollLogicalPosition = "start") {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block });
}

/** Same as scrollToId, after the next paint (for content that is about to render). */
export function scrollToIdSoon(id: string, block: ScrollLogicalPosition = "start") {
  requestAnimationFrame(() => requestAnimationFrame(() => scrollToId(id, block)));
}
