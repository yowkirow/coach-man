---
version: 1
slug: "src-app-routes-a-slug-team-tsx"
primary_target: "src/app/routes/a.$slug.team.tsx"
related_targets: ["src/app/features/public/team-page.tsx"]
---

# Surface brief: Public team page ("Meet the team")

## Scope and mode
- Surface: `/a/$slug/team`, linked from the academy page (its team section and each program pass's coaches). Staff preview at `?preview=1`.
- Visitor mode: **Persuade**, inside the pinned CoachMan world (DESIGN.md). Phone-first: links arrive through Messenger, Viber, and SMS, and their previews come from the Worker's injected meta tags.

## Audience, job, constraints
- Parents and players deciding whether to train with an academy, and returning families meeting a coach.
- Job: meet the coaches of the program they're considering (half-body photo, title, credentials, highlights, about), then enroll or get in touch.
- Proof is only the academy's own data: public coach profiles, the display-only people it adds, and its public programs. No invented claims, testimonials, or metrics.
- People without a photo get initials on a soft wash; the CoachMan palette is never recolored.

## Direction contract
THESIS: Parents meet coaches the way they choose a class, through the program their child will join; the program pass's selection turns toward people. It refuses the category's team page: a centered "Our Team" heading over a uniform grid of circle headshots.

OWN-WORLD: CoachMan's pinned world. A Command Black block (phones) or sticky panel (desktop) holds the academy, "Meet the team", and the programs as pills or tiles (the selected one lime); the gray canvas carries each coach's space as a white 28px card led by a 4:5 half-body portrait; credentials in sky pills with ink, highlights as a medal list, facts in tabular Figtree.

STORY: A parent sees whose team it is, picks the program (or arrives on it), meets its lead coach and assistants in tall portraits with what qualifies them, glances at the rest of the team, then enrolls in that program or messages the academy.

FIRST VIEWPORT: Phone 390: black block with the academy's logo tile and name as a back link, "Meet the team" at 32px light, program pills (selected lime), the program's days and times at 28px light, a lime Enroll (or Message) and a charcoal Call; the first portrait starts at the fold, full width at 4:5. Desktop 1440: sticky black panel (identity, title, program tiles, times, actions) beside the canvas; each coach a wide card, portrait left, credentials right; "Also on the team" compact after.

FORM: Coaches by program, position 5 of my ordered seven (coach passes, team panel, portrait roster, spotlight reel, coaches by program, flip cards, feature profiles); dealt lead of seed e5a108aa (dealt 5, 3, 6); locked by the user. Raise from the competitive coach-reel challenger: on phones every portrait owns the full width at 4:5, never a thumbnail grid.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction
Choosing a program (a pill on phones, a dark tile on desktop, or a program chip on a coach's card) swaps the canvas to that program's coaching team in a view transition: people who coach both glide to their new places, the rest cross-fade. "Everyone" shows the whole team, each with the programs they coach. Reduced motion: an instant swap.

## Unresolved
- Code-led: no image generation in this run, so no decision comps; the locked wireframe card is the approval.
- Photos come only from the academy; initials stand in until one is uploaded.
