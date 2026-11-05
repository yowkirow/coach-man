---
version: 1
slug: "src-app-routes-a-slug-index-tsx"
primary_target: "src/app/routes/a.$slug.index.tsx"
related_targets: ["src/app/routes/a.$slug.rates.tsx","src/app/features/public/academy-page.tsx","src/app/features/public/rates-sheet.tsx"]
---

# Surface brief: Public academy page and rates sheet

## Scope and mode
- Surfaces: the public academy page (`/a/$slug`) and its printable rates sheet (`/a/$slug/rates`). WS4b adds `/a/$slug/enroll`, started from this page.
- Visitor mode: **Persuade**, inside the pinned CoachMan world (DESIGN.md). Phone-first: links arrive through Messenger, Viber, and SMS, and their previews come from the Worker's injected meta tags.

## Audience, job, constraints
- Parents and players deciding whether to train with an academy; returning families checking the schedule and the rates.
- Job: understand each program (when, where, who coaches), compare its tiers (price per head, sessions, validity, inclusions, who it's for), and get in touch. Enroll arrives in WS4b through a named slot.
- Proof is only the academy's own data: profile, programs with their real weekly series and next session, published tiers, public coach profiles. No invented claims, testimonials, or metrics; no "most popular".
- The academy's logo is shown as uploaded, on a white tile; the CoachMan system is never recolored.

## Direction contract
THESIS: The academy's command panel turned outward: a family picks a program the way a coach picks a session, and the page answers with that program's pass (days, time, venue, coaches, next session) and the tiers that join it. It refuses the category's pricing landing page: a hero over three equal plan columns and a testimonial strip.

OWN-WORLD: CoachMan's pinned world. A Command Black header block (phones) or sticky panel (desktop) with charcoal tiles; lime only for the selected program, its training days, and the primary action. Soft-gray canvas with white 28px cards for tiers, about, coaches, and policies; the featured tier is the lime bento. Prices in large light tabular Figtree; inclusions as round check circles; pastel pills with ink text (violet level, sky ages, amber month-end validity, mint uniform).

STORY: A parent opening a shared link sees whose page it is, then when and where the program trains and when it next meets, then the tiers priced per head with what each includes and who it suits. They call or message (enroll later), meet the coaches, read the policies, and can print the rates.

FIRST VIEWPORT: Phone 390: black block with the logo tile and the academy name at 32px light, tagline under it; inside it the program pass: name, a seven-tile weekday strip with training days lit lime, the time range at 28px light tabular, venue with Directions, next session date; a lime Message and a charcoal Call button, the Enroll slot first in that row once WS4b lands. The first tier card starts at the fold. Desktop 1440: sticky black panel (identity, program tiles with the selected one lime, pass tiles, contact) beside the canvas: tier cards three across with the featured one lime, then about and coaches, policies, and the printable rates link.

FORM: Program pass, structure 3 of my ordered seven (tier ladder, week board, program pass, comparison table, coaches first, contact card with sticky bar, printed rate sheet on screen); dealt lead of seed 788a1025 (dealt 3, 1, 7). Chosen unattended: no structured-question tool in this run, and the brief said to proceed.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction
Choosing a program (a lime list tile on the desktop panel, a pill in the phone header) swaps the pass and the canvas to that program's tiers. One program: it is simply selected.

## Rates sheet
A formal rate document generated from the live catalog: letterhead (logo, name, tagline), "Rates and packages", then per program its schedule and venue and per tier: rates and schedule, validity, inclusions, notes. A4/Letter print stylesheet with no app chrome and page breaks between tiers when needed; "Print or save as PDF" calls `window.print()`.

## Unresolved
- Code-led: no image generation in this run, so no decision comps.
- Cover images: the profile has `coverKey` but no upload yet; the page uses the logo.
