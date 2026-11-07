---
version: 1
slug: "src-app-routes-a-slug-team-tsx"
primary_target: "src/app/routes/a.$slug.team.tsx"
related_targets: ["src/app/features/public/team-page.tsx"]
---

# Surface brief: Public team page ("Meet the team")

## Scope and mode
- Surface: `/a/$slug/team`, linked from the academy page (its team section, each program's coaches, and the nav's Coaches). Staff preview at `?preview=1`.
- Visitor mode: **Persuade**, inside the academy website's own world, Pubmat (DESIGN.md's academy website section; the world's contract lives in the academy page's brief, `src-app-routes-a-slug-index-tsx`). Phone-first: links arrive through Messenger, Viber, and SMS, and their previews come from the Worker's injected meta tags.

## Audience, job, constraints
- Parents and players deciding whether to train with an academy, and returning families meeting a coach.
- Job: meet the coaches of the program they're considering (half-body photo, title, credentials, highlights, about), then enroll or get in touch.
- Proof is only the academy's own data: public coach profiles, the display-only people it adds, and its public programs. No invented claims, testimonials, or metrics.
- People without a photo get initials on a soft wash. Color comes only from the website's club palette.

## Direction contract
THESIS: Parents meet coaches the way they choose a class, through the program their child will join; the program pass's selection turns toward people. It refuses the category's team page: a centered "Our Team" heading over a uniform grid of circle headshots.

OWN-WORLD: The academy website's Pubmat world, which replaced CoachMan's pinned world here on 2026-11-07 when the owner chose Pubmat for the whole website. The page stands on the club-green field with halftone dots. A deep-green panel (sticky on desktop) holds "Meet the team" in display caps, the programs as tabs (the selected one lime), and the chosen program's days and times in lime numerals. Each coach's space is a white card: the 4:5 half-body portrait stuck on with a white edge and a slight turn, their DUPR rating as a round sticker, their name in display caps, certifications as stickers, highlights as a list, facts in tabular Archivo.

STORY: A parent sees whose team it is, picks the program (or arrives on it), meets its lead coach and assistants in tall portraits with what qualifies them, glances at the rest of the team, then enrolls in that program or messages the academy.

FIRST VIEWPORT: Phone 390: the deep-green panel with "Meet the team" at 60px display caps, the program tabs in a row (selected lime), the program's days and times in 52px lime numerals, the slanted lime Enroll (else a white See packages) with outlined Message and Call; the first coach card starts at the fold, its portrait full width at 4:5. Desktop 1440: the sticky deep-green panel (title, program tabs with times and faces, where, actions, Printable rates) beside the column of coach cards, each a wide card with the portrait left and credentials right; "Also on the team" compact after; the blue questions panel and the ink footer close.

FORM: Coaches by program, position 5 of my ordered seven (coach passes, team panel, portrait roster, spotlight reel, coaches by program, flip cards, feature profiles); dealt lead of seed e5a108aa (dealt 5, 3, 6); locked by the user. Raise from the competitive coach-reel challenger: on phones every portrait owns the full width at 4:5, never a thumbnail grid.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction
Choosing a program (a tab in the panel, or a program chip on a coach's card) swaps the roster to that program's coaching team in a view transition: people who coach both glide to their new places, the rest cross-fade. "Everyone" shows the whole team, each with the programs they coach. Reduced motion: an instant swap.

## World change (2026-11-07)
The website revamp replaced the world, not the page: the thesis, story, form, and signature interaction carry over unchanged, and OWN-WORLD and FIRST VIEWPORT are rewritten in Pubmat. Don't restyle this page back toward the staff app's black panel and gray canvas.

## Unresolved
- Code-led: no image generation in this run, so no decision comps; the locked wireframe card is the approval.
- Photos come only from the academy; initials stand in until one is uploaded.
