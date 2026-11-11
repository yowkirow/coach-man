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
  - The site frame shared with **Meet the team** (`/a/$slug/team`): the nav, the contact panel, and the footer. Meet the team keeps its own brief's "Coaches by program" structure and wears this world.
  - The printable rates sheet (`/a/$slug/rates`) and the enrollment wizard stay as they are.
- Visitor mode: **Persuade**. Phone-first: links arrive through Messenger, Viber, Facebook, and SMS.
- The CoachMan app is for coaches and staff. This website is the academy's own: its own identity, with CoachMan only as a small "Made with CoachMan" in the footer (the owner's choice, 2026-11-07).

## Audience, job, constraints
- Parents of junior players and adult players in Metro Manila, deciding whether to train with an academy, and families coming back to enroll again.
- Job:
  - see whose academy it is and what it offers;
  - pick a program (when, where, who coaches, price from);
  - meet the coaches;
  - read what the packages include;
  - enroll, or message the academy.
- Proof comes only from the academy's own data:
  - profile and logo;
  - cover and website photos;
  - programs with their real weekly series and next session;
  - published packages;
  - public coach profiles: photo, certifications, highlights, DUPR, years, languages, specialties.
- No invented claims, testimonials, metrics, logos, slogans, or hashtags.
- The site must look full on sparse data. Today The Pickle Spot Academy has published its name and one coach. Every section designs its own empty state in the world's grammar ("Programs drop soon"), and the three enrollment steps (true for every academy) always show.
- Photos come only from the academy. Synthetic stand-ins appear in review captures only, labeled as such.

## Direction contract
THESIS: The academy's site as the enrollment pubmat Filipino families already stop scrolling for:
- the academy's name in heavy italic condensed caps on a club-green field;
- coaches framed like stickers;
- the schedule and the "from" price slapped on as stickers;
- Enroll now impossible to miss.

It refuses the sports-academy template (a dark hero photo, a slogan, icon cards, testimonials) and the quiet cream-and-serif page it replaces.

OWN-WORLD:
- Fields: drenched, full-bleed color fields, one per panel, in the club colors from the academy's own banner and jersey:
  - Club Green with Deep Green halftone dots;
  - Jersey Blue;
  - Deep Green;
  - Ball Lime;
  - White;
  - an Ink footer.
- Type: Archivo variable throughout. Display is wdth 62, weight 900, italic caps, at a line height of about 0.86. Body is wdth 100.
- Components:
  - stickers (flat fill, 3px white die-cut outline, turned between -6° and 6°);
  - photo stickers (8px white border, a slight turn);
  - skewed strips carrying schedules;
  - chunky skewed lime Enroll buttons;
  - tarp grommets on the desktop hero.
- No gradients, no blur shadows.

STORY: A parent opens the link and sees, in order:
1. the academy's name huge, "Now enrolling", a photo sticker, every program's days and times on a strip, the lowest "from" price, and Enroll now;
2. each program as its own panel, its schedule in giant numerals, with its own Enroll;
3. the courts in photo stickers;
4. the coaches, with their real certifications and DUPR as stickers;
5. the packages as price stickers;
6. how enrolling works, in three steps;
7. where to find the academy and how to message it.

They enroll (Enroll now, then the wizard) or message the academy.

FIRST VIEWPORT:
- **Phone 390:**
  - a slim nav: the name in small italic caps, a lime Enroll now, a menu;
  - the green hero panel with halftone:
    - THE / PICKLE SPOT / ACADEMY in giant white italic condensed caps filling the width;
    - a lime "Now enrolling" sticker;
    - a photo sticker at the lower right (the cover, else the first website photo, else a coach's portrait);
    - a strip with each program's days and times;
    - a white "from ₱… / head" sticker;
    - the lime ENROLL NOW and a white Message us;
    - the next-session line;
  - the next panel's color at the fold.
- **Desktop 1440:**
  - the same panel as a tarp banner with grommets: the name huge across the left 60% in two lines, a large photo sticker on the right, the strip across the lower part, the stickers, ENROLL NOW, and Message us;
  - the nav above;
  - the next panel at the fold.

FORM: Pubmat (Filipino enrollment pubmats and covered-court tarpaulins). It is my top-ranked grounded candidate (#1 of seven), chosen by the owner from the hand as IMPECCABLE'S PICK. Seed d72f7b2e had assigned candidate 5 (Route Board). The approved mock is `.impeccable/mocks/decision/model-pick/index.html` (board: `.impeccable/mocks/decision/model-pick.png`), and it is the critique reference.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction
The stickers slap on. When the page opens, the hero's stickers land on the tarp in turn: Now enrolling, the price, the photo. Each scales down from slightly larger to its resting turn, with an exponential ease-out from an already-visible default. With reduced motion they are simply there. Everywhere else the stickers sit still at their angles.

## Pages
- **Landing:**
  1. nav;
  2. tarp hero;
  3. program panels, alternating Jersey Blue and Deep Green; a full program wears a "Full" sticker;
  4. on court: the academy's website photos as photo stickers (the panel is skipped when there are none);
  5. coaches: a White field. An academy's only coach is featured the pubmat way; two or more ride a reel of coach cards (three in view from 1024px, one on phones with the next peeking; swipe or arrows, never autoplay; the owner's choice, 2026-11-11). Then Meet the team;
  6. packages: a Lime field with price sticker cards grouped by program, the featured one in Jersey Blue;
  7. how to enroll: Deep Green, 1-2-3;
  8. find us: Jersey Blue, with the academy's about, the venue, directions, and contact;
  9. footer: Ink.
- **Enroll now:**
  1. nav;
  2. a green title panel with program tabs;
  3. the chosen program's panel;
  4. its packages as sticker cards, each opening the wizard;
  5. the consents note;
  6. printable rates;
  7. contact;
  8. footer.
- **Meet the team:** keeps "Coaches by program" (its own brief), restyled into this world.

## Unresolved
- Code-led: no image generation in this harness. The approved mock is the critique reference.
- Per-academy club colors: the palette is the first academy's. A "club colors" setting for other academies is a follow-up; the tokens are CSS custom properties, so a setting can drive them.
