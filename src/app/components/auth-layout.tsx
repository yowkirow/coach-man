import type { ReactNode } from "react";
import { LegalLinks } from "../features/public-info/legal-links";
import { Wordmark } from "./brand";

export function GoogleG({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

/** Black brand panel + white task card, shared by sign-in and onboarding. */
export function AuthLayout({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh p-3 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-3">
      <section className="dark-zone flex flex-col rounded-[32px] bg-night p-6 text-night-ink sm:p-8 lg:p-10">
        <Wordmark dark />
        {panel}
      </section>
      <main className="flex flex-col items-center justify-center gap-4 py-6 lg:py-0">
        <div className="w-full max-w-md rounded-[32px] bg-card p-6 sm:p-8">{children}</div>
        <LegalLinks className="w-full max-w-md px-2" />
      </main>
    </div>
  );
}
