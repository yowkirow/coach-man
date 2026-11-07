import { announcementParagraphs, linkify } from "@shared/announcements";

/**
 * An announcement's plain-text body, as written: a blank line starts a paragraph, single line
 * breaks stay, and web addresses become links (opened in a new tab). Never read as HTML.
 */
export function AnnouncementBody({ body, className = "" }: { body: string; className?: string }) {
  return (
    <div className={`flex max-w-[65ch] flex-col gap-2.5 ${className}`}>
      {announcementParagraphs(body).map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of a fixed text, in order.
        <p key={i} className="whitespace-pre-line [overflow-wrap:anywhere]">
          {linkify(p).map((s, j) =>
            s.kind === "link" ? (
              <a
                // biome-ignore lint/suspicious/noArrayIndexKey: segments of a fixed text, in order.
                key={j}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="rounded-sm font-medium underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
              >
                {s.text}
              </a>
            ) : (
              s.text
            ),
          )}
        </p>
      ))}
    </div>
  );
}
