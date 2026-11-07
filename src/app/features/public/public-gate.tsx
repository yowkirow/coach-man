import type { PublicAcademyDto } from "@shared/api-types";
import { type ReactNode, useEffect } from "react";
import { ErrorState, Skeleton } from "../../components/ui/feedback";
import { ApiRequestError, errorMessage } from "../../lib/api";
import type { Format } from "../../lib/format";
import { NotFoundPage } from "./public-ui";
import { type PublicPage, usePublicAcademy, usePublicFormat } from "./queries";

/** The tab title while the page is open (the Worker already wrote it into the HTML). */
function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
}

function Loading() {
  return (
    <div
      aria-busy="true"
      className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-3 lg:p-3 xl:grid-cols-[440px_minmax(0,1fr)]"
    >
      <span className="sr-only">Loading the academy page…</span>
      <div className="flex flex-col gap-5 rounded-b-[32px] bg-night px-4 pt-6 pb-7 sm:px-6 lg:rounded-[32px] lg:p-6">
        <Skeleton dark className="size-16 rounded-[22px]" />
        <Skeleton dark className="h-9 w-3/4" />
        <Skeleton dark className="h-12 w-full rounded-[14px]" />
        <Skeleton dark className="h-8 w-2/3" />
      </div>
      <div className="flex flex-col gap-3 px-3 pt-4 sm:px-6 lg:px-1 lg:pt-1">
        <Skeleton className="h-10 w-40" />
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-80 rounded-[28px]" />
          <Skeleton className="h-80 rounded-[28px]" />
        </div>
      </div>
    </div>
  );
}

/**
 * Loads a public academy page (or the staff preview) and shows its loading, not-found, and error
 * states; renders `children` once the academy is here.
 */
export function PublicGate({
  slug,
  preview,
  titleOf,
  children,
}: {
  slug: string;
  preview: boolean;
  titleOf: (a: PublicAcademyDto) => string;
  children: (page: PublicPage, fmt: Format) => ReactNode;
}) {
  const { page, isPending, error, refetch } = usePublicAcademy(slug, preview);
  const fmt = usePublicFormat(page?.academy);
  useDocumentTitle(page ? titleOf(page.academy) : null);
  if (page) return <>{children(page, fmt)}</>;
  if (isPending) return <Loading />;
  if (error instanceof ApiRequestError && preview && (error.status === 401 || error.status === 403))
    return (
      <NotFoundPage title="Previews are for the academy's owner and admins">
        Sign in as the academy's owner or an admin to see its page before families do.
      </NotFoundPage>
    );
  if (error instanceof ApiRequestError && error.status === 404) return <NotFoundPage />;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md rounded-[32px] bg-card px-6 sm:px-8">
        <ErrorState
          title="Couldn't load this page"
          message={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      </div>
    </main>
  );
}

/**
 * `?preview=1` (staff only) and `?program=<id>`, as the public routes read them. The flag is the
 * number 1, so the router writes it as `preview=1` (a string would come out quoted).
 */
export function publicSearch(s: Record<string, unknown>): { program?: string; preview?: 1 } {
  const out: { program?: string; preview?: 1 } = {};
  if (typeof s.program === "string" && s.program) out.program = s.program;
  if (s.preview === 1 || s.preview === "1") out.preview = 1;
  return out;
}
