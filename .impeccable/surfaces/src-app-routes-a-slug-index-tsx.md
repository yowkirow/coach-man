---
version: 1
slug: "src-app-routes-a-slug-index-tsx"
primary_target: "src/app/routes/a.$slug.index.tsx"
related_targets: ["src/app/routes/a.$slug.enroll.tsx","src/app/routes/a.$slug.rates.tsx","src/app/features/public/landing-page.tsx","src/app/features/public/enroll-page.tsx","src/app/features/public/site.tsx"]
---

# Surface brief: Academy website (landing page, Enroll now, and the shared site frame)

## Scope and mode
- Surfaces: the academy's public website.
  - The landing page (`/a/$slug`).
  - **Enroll now** (`/a/$slug/enroll` with no `package`). It chooses a program and a package, then opens the existing wizard at `?package=`.
  - The site frame shared with **Meet the team** (`/a/$slug/team`): the nav and the footer.
  - The printable rates sheet (`/a/$slug/rates`) stays as it is.
- Visitor mode: **Persuade**. Phone-first: links arrive through Messenger, Viber, and SMS.
- The CoachMan app is for coaches and staff; this website is for families and players. It stays in CoachMan's family on purpose.

## Audience, job, constraints
- Parents and players deciding whether to train with an academy, and families coming back to enroll again.
- Job:
  - see whose academy it is and what it offers;
  - pick a program (when, where, who coaches, price from);
  - see the courts and sessions, and meet the coaches through their real highlights;
  - read what the packages include;
  - enroll, or message the academy.
- Proof comes only from the academy's own data:
  - profile, cover photo, and website photos;
  - programs with their real weekly series and next session;
  - published packages (defined in the admin site, Packages & rates);
  - public coach profiles and highlights.
- No invented claims, testimonials, metrics, logos, or slogans.
- Photos come only from the academy. Synthetic stand-ins appear in review captures only, labeled as such.

## Direction contract
THESIS: The academy's site as a calm, generous landing page in CoachMan's family. A pickleball's arc carries the academy's own words (its programs, days, and times) across the first screen, and each section moves a family from "whose academy is this" to Enroll now. It refuses the sports-academy template: a dark full-bleed hero photo with a centered slogan, three icon features, plan columns, and a testimonial carousel.

OWN-WORLD:
- Ground and slabs: a pale ball-tinted ivory ground. Command Black slabs with 64px top corners (32px on phones) rise over the section before them. One deep court-green slab carries the proof.
- Accents: CoachMan Violet for the visit card. Signal Lime marks the one primary action (Enroll now) and the ball.
- Type: an elegant serif display for headlines (two-tone opening clause, Pewter then ink); Figtree for every control, body, and number.
- Components: a floating outlined nav bar; outlined ink pills for secondary actions, and outlined pills as selectors on the slabs; large rounded photo frames.

STORY: A parent opens the link and sees:
1. the academy's promise in a big serif line, its programs and times riding the ball's arc, Enroll now and Message us;
2. a program to choose, with its schedule, venue, coaches, and starting price;
3. the courts and sessions in photos;
4. the coaches through their real highlights;
5. what the packages include and where they play.

They enroll (Enroll now, then the wizard) or message the academy.

FIRST VIEWPORT:
- **Phone 390:**
  - the floating outlined nav: logo tile and name, and a lime Enroll now pill;
  - a serif headline at about 44px, its first clause in Pewter, and a one-line subhead;
  - a lime Enroll now and an outlined Message us;
  - the next-session line;
  - the ball's arc ribbon crossing the lower screen through a ball pill;
  - the black Programs slab's rounded top edge at the fold.
- **Desktop 1440:**
  - the same centered composition under an 1100px nav bar, headline about 96px;
  - the ribbon sweeping edge to edge;
  - the Programs slab's top edge in view.

FORM: Pinned by the user: the Wispr Flow landing page (landingfolio.com/inspiration/post/wispr-flow), carried in CoachMan's materials so the academy's site stays in CoachMan's family. It sits outside my ordered seven: seed 44ab8519 had assigned The Academy Annual, and the user's pin replaced it before any choice.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction
The ball's arc. A ribbon of the academy's real words runs along a pickleball's lob through a ball pill, and it advances as the visitor scrolls: before the pill in Pewter, after it in ink on a black band. With reduced motion, or without support, the ribbon holds still.

The site's other movement is structural:
- the Programs slab's pills swap the program in place;
- on laptops, the photo reel travels sideways while the page scrolls down; on phones, it's a swipe reel.

## Pages
- **Landing:**
  1. nav;
  2. hero and ribbon;
  3. Programs slab (black);
  4. On court (photos);
  5. coaches' highlights slab (court green);
  6. about and what's included;
  7. Where we play (violet card);
  8. closing call to enroll over the cover photo;
  9. questions box (contact);
  10. footer with the academy's giant wordmark.
- **Enroll now:** nav, a serif title, program pills, the program's packages as tier cards (each opening the wizard), then policies, questions, and the footer.
- **Meet the team:** keeps its "Coaches by program" structure (its own brief), wearing the site's nav, footer, ground, and serif headings.

## Unresolved
- Code-led: no image generation in this harness, so no comps. The Landingfolio capture of the reference is the critique reference.
- A domain of the academy's own can come later; the address stays `coachman.cloud/a/<slug>`.
