import { createFileRoute } from "@tanstack/react-router";
import { EnrollJump, EnrollSlot } from "../features/enrollment/enroll-slot";
import { AcademyPage } from "../features/public/academy-page";
import { PublicGate, publicSearch } from "../features/public/public-gate";

export const Route = createFileRoute("/a/$slug/")({
  validateSearch: publicSearch,
  component: PublicAcademyRoute,
});

function PublicAcademyRoute() {
  const { slug } = Route.useParams();
  const { program, preview } = Route.useSearch();
  return (
    <PublicGate
      slug={slug}
      preview={preview === 1}
      titleOf={(a) => (a.tagline ? `${a.name} · ${a.tagline}` : a.name)}
    >
      {(page, fmt) => (
        <AcademyPage
          page={page}
          slug={slug}
          programId={program}
          fmt={fmt}
          // Families enroll from each tier; a staff preview shows the page as it is.
          renderEnroll={
            page.kind === "public"
              ? ({ academy, tier }) => <EnrollSlot academy={academy} tier={tier} />
              : undefined
          }
          // On phones the dark block leads with Enroll (down to the rates) while it's open.
          enroll={
            page.kind === "public" &&
            page.academy.enrollmentOpen &&
            page.academy.packages.length ? (
              <EnrollJump />
            ) : undefined
          }
        />
      )}
    </PublicGate>
  );
}
