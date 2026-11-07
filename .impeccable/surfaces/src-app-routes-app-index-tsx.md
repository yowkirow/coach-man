---
version: 1
slug: "src-app-routes-app-index-tsx"
primary_target: "src/app/routes/_app/index.tsx"
related_targets: ["src/app/routes/_app/sessions.$lessonId.tsx"]
---

# Surface brief: Today (on-court) — CoachMan app shell

## Scope and mode
- Surface: the authenticated app, led by **Today** (`/`) and **Session** (`/sessions/$lessonId`); the same system carries Schedule, Clients (list + profile), Groups, Events, Money, Packages & Rates, Settings, sign-in, and onboarding.
- Visitor mode: **Operate**. Phone-first on court (one hand, often offline); desktop master–detail for admin.

## Audience, job, constraints
- Independent pickleball coaches (PRODUCT.md). Job: see what's on court now, tap players in, trust credits and balances, note, see what's next.
- Constraints: outdoor sun (light canvas for task areas, near-black text), 44px+ targets, offline-first with a calm sync state, undo over confirm.
- Demo data synthetic and labelled; no stock photos of real people (avatars use initials unless the coach uploads a photo).

## Direction history
- Court Lines (themed) → rejected ("make it modern"). Clean-and-light plan → superseded by a user-pinned reference.
- **Pinned reference (binding):** Dribbble "Microsoft Dynamics CRM – Lead Relationship Management Platform", Jack R. for RonDesignLab. Code-led.

## Direction contract
THESIS: CoachMan as a calm, premium CRM for courts: a black command panel (icon rail plus a live list of today's sessions or clients) beside a soft-gray canvas where the selected session or client opens as rounded white cards, with lime marking what is live right now. It refuses flat admin tables and themed costume.

OWN-WORLD: Black panel `#0E0E0F` with dark cards `#1C1C1E` and tinted KPI tiles; canvas `#E5E5E7`, panel `#F3F3F4`, white cards `#FFFFFF`, ink `#111111`/`#5F6066`. Lime `#DAEE63` (active nav circle, selected/live card, circular action buttons, checked-in toggle, primary actions); lavender `#B3A8F5` and lime bento cards with checklists in the right column; pastel pills: coral `#F87171` (owes/urgent), violet `#C9BEFB` (group), sky `#A9DCEB` (info), amber `#F8D477` (expiring). Figtree throughout, light weights for big headings and numbers; radii 24–32px for panels and cards, full pills for chips, tabs, and buttons.

STORY: The coach opens Today: the black panel lists today's sessions with the one on court now in lime and four KPI tiles above (sessions, checked in, low credits, balances due). The detail shows the live session's title in large light type, lime action circles (add player, note, complete), the roster with check-in toggles, a lavender credits card and a lime session-plan card. On the phone the same pieces stack: dark header with tiles, the lime live session, roster rows, then later sessions and alerts; a floating black tab bar with a lime active circle.

FIRST VIEWPORT: Desktop 1440: black panel (rail 84px + list 320px) with KPI tiles and the session list; canvas with the session header (title 40px light, meta, tags, action circles, pill tabs), roster card, right column of lavender and lime cards. Phone 390: black header block (date title in light 32px, 2×2 KPI tiles), lime live-session card, white roster card with avatars and toggles; floating black tab bar with lime active circle and a lime quick-add circle.

FORM: User-pinned reference (Microsoft Dynamics CRM by Jack R./RonDesignLab) translated to coaching; supersedes seed 3bd6df94 and the canon fallback.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction
Check-in toggle: tap fills the circle lime with a black check (≤200ms ease-out settle); the count pill and credit line update; a black pill toast offers Undo. Reduced motion: instant change, same toast.

## Carried disciplines
- Every figure carries its proof (credit counts and balances open ledger lines).
- Fixed-scale progress charts across assessments; duration-true schedule blocks.
