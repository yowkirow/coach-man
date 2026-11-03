---
name: CoachMan
description: "A calm, premium CRM for courts: a black command panel beside a soft-gray canvas of white cards, with lime marking what is live."
colors:
  lime: "#daee63"
  lime-strong: "#cbe148"
  lime-soft: "#f2f8cf"
  lavender: "#b3a8f5"
  lavender-soft: "#ebe8fd"
  violet: "#c9befb"
  coral: "#f87171"
  coral-soft: "#fde3e3"
  sky: "#a9dceb"
  sky-soft: "#e2f3f8"
  amber: "#f8d477"
  amber-soft: "#fcf1d2"
  mint: "#bfe9d0"
  sync: "#fb923c"
  danger-text: "#b42318"
  night: "#0e0e0f"
  night-2: "#1c1c1e"
  night-3: "#29292c"
  night-4: "#38383c"
  night-line: "#2e2e32"
  night-ink: "#ffffff"
  night-ink-2: "#a3a3a9"
  canvas: "#e5e5e7"
  panel: "#f3f3f4"
  card: "#ffffff"
  ink: "#111111"
  ink-2: "#5f6066"
  ink-3: "#8a8b91"
  line: "#e4e4e7"
  line-strong: "#cfcfd4"
typography:
  display:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 3.5rem
    fontWeight: 300
    lineHeight: 1
    letterSpacing: -0.03em
    fontFeature: '"tnum" 1, "lnum" 1'
  headline-lg:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 2.75rem
    fontWeight: 300
    lineHeight: 1.08
    letterSpacing: -0.02em
  headline-md:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 2.5rem
    fontWeight: 300
    lineHeight: 1.1
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 2rem
    fontWeight: 300
    lineHeight: 1.1
    letterSpacing: -0.02em
  headline-panel:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 1.75rem
    fontWeight: 300
    lineHeight: 1.25
    letterSpacing: -0.01em
  figure:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 2rem
    fontWeight: 300
    lineHeight: 1
    fontFeature: '"tnum" 1, "lnum" 1'
  title-md:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 1.375rem
    fontWeight: 300
    lineHeight: 1.25
    letterSpacing: -0.01em
  title-sm:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 1.125rem
    fontWeight: 500
    lineHeight: 1.45
  title-dark:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 1.125rem
    fontWeight: 300
    lineHeight: 1.45
  body-lg:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.375
  body-md:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.45
  body-sm:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.45
  label-lg:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 0.9375rem
    fontWeight: 500
  label-md:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 0.875rem
    fontWeight: 500
  label-sm:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 0.8125rem
    fontWeight: 500
  label-xs:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 0.75rem
    fontWeight: 500
rounded:
  glyph: 6px
  item: 12px
  control: 16px
  tab: 20px
  tile: 22px
  list-card: 24px
  card: 28px
  panel: 32px
  full: 9999px
spacing:
  "1": 4px
  "1.5": 6px
  "2": 8px
  "2.5": 10px
  "3": 12px
  "4": 16px
  "5": 20px
  "6": 24px
  shell-gutter: 12px
  rail: 84px
  list-column: 328px
  aside-column: 340px
  page-max: 1240px
components:
  command-panel:
    backgroundColor: "{colors.night}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.panel}"
    padding: "20px 16px"
  rail-link:
    backgroundColor: "{colors.night-2}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.full}"
    size: 48px
  rail-link-hover:
    backgroundColor: "{colors.night-3}"
  rail-link-active:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
  kpi-tile:
    backgroundColor: "{colors.night-2}"
    textColor: "{colors.night-ink}"
    typography: "{typography.figure}"
    rounded: "{rounded.tile}"
    padding: 16px
    height: 104px
  list-tile:
    backgroundColor: "{colors.night-2}"
    textColor: "{colors.night-ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.list-card}"
    padding: 16px
  list-tile-hover:
    backgroundColor: "{colors.night-3}"
  list-tile-selected:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: 20px
  bento-lavender:
    backgroundColor: "{colors.lavender}"
    textColor: "{colors.ink}"
    typography: "{typography.title-md}"
    rounded: "{rounded.card}"
    padding: 20px
  bento-lime:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    typography: "{typography.title-md}"
    rounded: "{rounded.card}"
    padding: 20px
  folder-tab:
    textColor: "{colors.ink-2}"
    typography: "{typography.body-md}"
    rounded: "{rounded.tab}"
    height: 48px
    padding: "0 20px"
  folder-tab-selected:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  folder-panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: 16px
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.night-ink}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 44px
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.night-3}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 44px
    padding: "0 20px"
  button-secondary-hover:
    backgroundColor: "{colors.panel}"
  button-lime:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 44px
    padding: "0 20px"
  button-lime-hover:
    backgroundColor: "{colors.lime-strong}"
  button-ghost:
    textColor: "{colors.ink}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 44px
    padding: "0 20px"
  button-danger:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.ink}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 44px
    padding: "0 20px"
  button-night:
    backgroundColor: "{colors.night-3}"
    textColor: "{colors.night-ink}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 44px
    padding: "0 20px"
  button-night-hover:
    backgroundColor: "{colors.night-4}"
  button-sm:
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 36px
    padding: "0 16px"
  action-circle:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 52px
  action-circle-hover:
    backgroundColor: "{colors.lime-strong}"
  action-circle-white:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 52px
  checkin-toggle:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.full}"
    size: 48px
  checkin-toggle-checked:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
  pill:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label-xs}"
    rounded: "{rounded.full}"
    height: 24px
    padding: "0 10px"
  pill-lime:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
  pill-violet:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.ink}"
  pill-coral:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.ink}"
  pill-sky:
    backgroundColor: "{colors.sky}"
    textColor: "{colors.ink}"
  pill-amber:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.ink}"
  pill-mint:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.ink}"
  pill-white:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
  figure-pill:
    textColor: "{colors.ink}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 44px
    padding: "0 18px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.control}"
    height: 48px
    padding: "0 16px"
  input-dark:
    backgroundColor: "{colors.night-2}"
    textColor: "{colors.night-ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.full}"
    height: 44px
    padding: "0 44px"
  segmented:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.full}"
    padding: 4px
  segmented-selected:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 40px
  tab-bar:
    backgroundColor: "{colors.night}"
    rounded: "{rounded.full}"
    padding: 6px
  tab-bar-item:
    textColor: "{colors.night-ink-2}"
    rounded: "{rounded.full}"
    height: 52px
  tab-bar-item-active:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
  quick-add:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 64px
  sheet:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: 24px
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.tile}"
    padding: "10px 10px 10px 16px"
  sync-pill:
    backgroundColor: "{colors.sync}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    height: 32px
    padding: "0 12px"
  avatar:
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 44px
---

# Design System: CoachMan

## Overview

**Creative North Star: "The Courtside Command Panel"**

CoachMan is a calm, premium CRM for courts. Every screen splits into two zones: a black command panel that holds navigation and the live list (today's sessions, the client worklist, who owes), and a soft-gray daylight canvas where the selected session or client opens as rounded white cards. Lime is the single signal across both zones. It lights whatever is live, selected, or the next action, so a coach glancing at a phone between games finds "now" without reading.

Headings and figures are large and light; everything a coach acts on is regular or medium weight and at least 36px tall, mostly 44px or more. Status speaks in soft pastel pills that always carry ink text. Depth is tonal (gray canvas, a lighter folder panel, white cards), and shadows appear only on things that float. Containers take generous 22–32px corners, and every control is a pill or a circle. People appear as initials on soft tints unless the coach uploads a photo. There is no stock or illustrative imagery, and the lime BallMark is the only sport motif.

The visual authority is a reference the user pinned: the Dribbble shot "Microsoft Dynamics CRM – Lead Relationship Management Platform" by Jack R. for RonDesignLab, translated from sales to coaching. It replaced a themed "Court Lines" build and a plain "clean and light" plan, both rejected; the system refuses flat admin tables and sport-themed costume. Where the reference sets white text on pastel pills, CoachMan sets ink, because task surfaces have to read in outdoor sun.

**Key Characteristics:**
- Two zones: a black command panel (icon rail plus list column) beside a soft-gray canvas of white cards.
- Lime marks live, selected, and primary, and nothing else.
- Figtree throughout: light (300) for headings and figures, tabular numerals for every compared number.
- Pastel status pills with ink text, never white.
- Tonal depth; shadows only on floating layers.
- 22–32px container corners; pills and circles for every control.
- Records open into fused folder tabs over a lighter panel, with lavender and lime bentos beside them.
- Touch-first sizing: 44px controls, 48px check-in circles, 52px action circles.

## Colors

A near-monochrome stage (black panel, gray canvas, white cards, ink type) lit by one lime signal and a set of soft pastels that speak status.

### Primary
- **Signal Lime** (#daee63): what is live, selected, or primary. The active rail circle and phone tab, the selected list tile, a record's action circles, the checked-in toggle, the primary bento, the phone's quick-add, the toast's Undo, the selected day in calendars, "on court now", and the text-selection highlight.
- **Pressed Lime** (#cbe148): the hover state of lime fills, and the current step of the import stepper.
- **Lime Wash** (#f2f8cf): a faint lime surface: the import drop zone while a file hovers, and one of the avatar tints.

### Secondary
- **Bento Lavender** (#b3a8f5): the second bento voice. Credits and packages cards and the Money page's "Received" hero; also the timeline node for payments and the birthday alert circle.
- **Lavender Wash** (#ebe8fd): an avatar tint.

### Tertiary
- **Group Violet** (#c9befb): group membership, upcoming sessions, late arrivals, group blocks in the schedule.
- **Owes Coral** (#f87171): money owed, urgent, no-show, cancelled; the fill of the danger button.
- **Coral Wash** (#fde3e3): alert surfaces: inline errors, the medical-note callout and pills, the check-in toggle of an absent or no-show player, cancelled schedule blocks.
- **Info Sky** (#a9dceb): information and finished things: juniors, per-player notes, credits in good standing, finished sessions, clinic blocks.
- **Sky Wash** (#e2f3f8): an avatar tint.
- **Expiry Amber** (#f8d477): low credits, expiring packages, paused clients, late cancels, events.
- **Amber Wash** (#fcf1d2): advisory surfaces that ask to be read, not feared: offline hints, a full session or group, a possible duplicate client.
- **Paid Mint** (#bfe9d0): paid up, in credit, active clients, semi-private blocks.
- **Sync Orange** (#fb923c): connection state: the offline or syncing pill, the rail's sync circle, the pending dot on a check-in toggle.
- **Alert Red** (#b42318): danger text on white (about 6.6:1): destructive menu items, field errors, out-of-credit figures, the medical flag icon. It has no `@theme` declaration in `src/app/styles.css` yet; the build hard-codes it in ten files, so no utility class exists for it.

### Neutral
- **Command Black** (#0e0e0f): the command panel, the phone's header block and tab bar, and the PWA theme color.
- **Tile Charcoal** (#1c1c1e): dark tiles on the panel: KPI tiles, list tiles, rail circles, the dark search field.
- **Raised Charcoal** (#29292c): hover on dark tiles and rail circles, the fill of night buttons, and the hover of ink buttons.
- **Dark Outline** (#38383c): outlines inside the panel (the status capsule in list tiles, the dashed quick-add circle) and the hover of night buttons.
- **Panel Seam** (#2e2e32): the 1px divider between the rail and the list column, and the dark search field's border.
- **Night White** (#ffffff): text on the dark zone, on ink buttons, and on toasts.
- **Night Mist** (#a3a3a9): secondary text on the dark zone: dates, meta lines, inactive tab-bar labels.
- **Courtside Gray** (#e5e5e7): the app canvas behind everything.
- **Folder Gray** (#f3f3f4): the folder panel behind tab content; hover on white rows and buttons; soft circles; the segmented-control track.
- **Card White** (#ffffff): cards, sheets, fields, popovers, and the white action circle.
- **Ink** (#111111): primary text and icons, the primary pill button, toasts, checked checkboxes and switch tracks.
- **Slate** (#5f6066): secondary text: meta lines, field labels, help text, inactive tabs, placeholders.
- **Pewter** (#8a8b91): tertiary marks: chevrons, the unchecked toggle's check, struck-through times.
- **Hairline** (#e4e4e7): dividers between rows and above sheet footers.
- **Outline Gray** (#cfcfd4): the 1px ring of white buttons, field borders, unchecked toggles and checkboxes, and the switch track when off.

### Named Rules
**The Lime Is Now Rule.** Lime marks what is live, selected, or the primary action: the active rail circle, the selected tile, the action circles, the checked-in toggle, the primary bento. It never labels a category, a tag, or a chart series; categories take the pastels.

**The Ink-on-Pastel Rule.** Every lime and pastel fill carries ink (#111111) text and icons, never white. This is a deliberate accessibility deviation from the reference, whose pills set white on pastel: white on Owes Coral reads at about 2.8:1, ink at about 6.8:1.

**The Connection Color Rule.** Sync Orange speaks only about connection state (offline, syncing, a change waiting to sync), and nothing else wears it.

## Typography

**Display Font:** Figtree Variable (with ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)
**Body Font:** Figtree Variable (same stack)
**Label/Mono Font:** none distinct; figures use Figtree's tabular lining numerals through the `.num` class.

**Character:** One friendly geometric sans at two temperatures. Light and large for anything read from arm's length (titles, figures); regular and medium for everything a coach acts on. The lightness carries the premium feel, and the tabular numerals carry the trust.

### Hierarchy
- **Display** (300, 56px, 1, -0.03em, tabular): hero figures, such as the Money page's received total (48px on phones), and the sign-in statement, which opens to 1.04 leading over its lines.
- **Headline lg** (300, 44px, 1.08, -0.02em): record titles (session, client, group, event) from 1024px.
- **Headline md** (300, 40px, 1.1, -0.02em): page titles from 1024px.
- **Headline sm** (300, 32px, 1.1, -0.02em): page and record titles below 1024px, including the phone header's "Today".
- **Headline panel** (300, 28px, 1.25, -0.01em): the title at the top of the command panel ("Today", "Clients", the month).
- **Figure** (300, 32px, 1, tabular): KPI tile values.
- **Title md** (300, 22px, 1.25, -0.01em): bento, hero-card, and empty-state titles. Sheet titles and the phone's live-session card step up to 24px at the same weight.
- **Title sm** (500, 18px): card headings on the light canvas ("Check-in", "Needs attention"), with a regular-weight Slate count beside them.
- **Title dark** (300, 18px): section headings inside the command panel ("Sessions", "Worklist", "Who owes").
- **Body lg** (400, 16px, 1.375): list-tile names in the command panel, always regular. Roster names use the same size at 500.
- **Body md** (400, 15px, 1.45): default body text. Descriptions cap at 52–65ch.
- **Body sm** (400, 13px, 1.45): meta lines, help text, and secondary lines; the most-used size in the app.
- **Label lg** (500, 15px): default buttons and figure pills.
- **Label md** (500, 14px): small buttons, segmented options, attendance choices.
- **Label sm** (500, 13px): field labels.
- **Label xs** (500, 12px): status pills. The phone tab bar's labels are the one smaller step, at 11px.

Weight 600 appears only as small emphasis: avatar initials and counts, step numbers, the sync pill, the toast's Undo, ledger deltas, and the selected item in a list or chart.

### Named Rules
**The Light Heading Rule.** Every heading and figure from 22px up is set at weight 300 with slight negative tracking (-0.01em to -0.03em). Bold (700) does not exist in this system; the wordmark (22px, 500) is the only large text that isn't light.

**The Tabular Figure Rule.** Every number a coach compares (times, counts, credits, money) is set in tabular lining numerals.

## Layout

The layout is a two-zone shell. From 1024px a 12px gutter frames the screen. On the left, the black command panel (sticky, full height minus the gutters, 32px corners) holds an 84px icon rail and a 328px list column that each page fills with its own content: a panel title, KPI tiles, and a list of dark tiles, divided from the rail by a 1px Panel Seam. To the right, the canvas holds the page in a column capped at 1240px with 24px side padding. A record (session, client, group, event) opens as a header row (title, meta line, pills, and action circles on the right) above folder tabs whose panel stretches to the bottom of the viewport, ending level with the command panel. From 1280px that panel splits into the tab content and a 340px column of bentos.

Below 1024px the command panel becomes a black header block with 32px bottom corners: the page title in 32px light with its date or counts, the sync state and page actions, and the KPI tiles in a 2×2 grid (Today adds the wordmark above). The work follows as stacked white cards with 16px side padding (24px from 640px). Navigation moves to a floating black tab bar 12px above the safe area, with a 64px lime quick-add circle beside it. Content reserves 112px plus the safe area at the bottom so the bar never covers it. Sheets are bottom sheets until 640px, where they become centered dialogs.

Rhythm runs on a 4px base, with 8, 12, 16, and 20px doing most of the work. A label sits 6px above its field; KPI tiles and list tiles sit 10px apart; rows pad 12px vertically between hairline dividers; cards pad 20px; command-panel blocks sit 20px apart; a record's header sits 24px above its tabs. Density stays moderate: one live list in the panel, one record on the canvas.

### Named Rules
**The Two-Zone Rule.** Night tones belong to the command panel and its phone forms (the header block and the tab bar); the canvas, the folder panel, and white cards hold the work. A component that lives in both zones ships two tones, a charcoal tile in the panel and a white card on the canvas, never a dark card on the canvas.

**The Thumb Floor Rule.** Controls start at 44px: buttons and icon circles 44px, fields 48px, check-in toggles and rail circles 48px, a record's action circles 52px. 36px is the one smaller step, for secondary actions inside cards, sheets, bentos, and toasts.

## Elevation & Depth

CoachMan is flat and tonal. On the canvas, depth comes from three light steps: Courtside Gray under the Folder Gray panel under white cards. On the command panel it comes from three dark steps: Command Black under charcoal tiles under the raised hover tone. Cards carry no border and no shadow. Edges that need definition get a single 1px line: Outline Gray on white buttons and fields, Hairline between rows, Dark Outline inside dark tiles. Shadows are reserved for what floats, and sheets sit over a Command Black scrim at 45% with a 2px blur.

### Shadow Vocabulary
- **Pop** (`box-shadow: 0 24px 48px -16px rgb(17 17 17 / 0.28), 0 8px 20px -10px rgb(17 17 17 / 0.14)`): floating layers only: sheets and dialogs, popovers and menus, toasts, the phone tab bar, and the phone's quick-add circle.
- **Lift** (`box-shadow: 0 1px 2px rgb(17 17 17 / 0.06), 0 4px 12px -4px rgb(17 17 17 / 0.08)`): a thumb or segment raised above its own track: the selected segment of a segmented control and the switch thumb.
- **Focus glow** (`box-shadow: 0 0 0 4px rgb(218 238 99 / 0.55)`): a field's focus state, paired with an ink border. It marks state, not elevation.
- **Tile glow** (`background-image: radial-gradient(120% 90% at 0% 0%, var(--tile-tint) 0%, transparent 60%)`): the colored light in a KPI tile's top-left corner, where the tint is the tile's own pastel at about 22%. A background, not a shadow.

### Named Rules
**The Flat Card Rule.** Cards sit flat; tone alone separates white from gray. A resting element declares its edge once, with a 1px line or a shadow, never both.

**The Float-Only Shadow Rule.** Pop means "this floats above the page". Lift is the only other shadow, and only for a thumb or segment raised above its own track. Cards, tiles, and panels never cast one.

## Shapes

The form language is soft and generous: rounded rectangles hold content, full pills hold labels and text buttons, and circles hold icon actions, toggles, and people. Radius steps down as containers nest:

- **Panel** (32px): the command panel, sheets (top corners only as phone bottom sheets), and the phone header block's bottom corners.
- **Card** (28px): white cards, bentos, the phone's live-session card, and the folder panel on desktop.
- **List card** (24px): dark list tiles, the folder panel on phones, link cards on the More page.
- **Tile** (22px): KPI tiles, toasts, inset wells inside cards and sheets, list rows.
- **Tab** (20px): folder-tab top corners and their concave fillets, compact KPI tiles, inset items inside bentos.
- **Control** (16px): fields, popovers, row hover shapes, inline notices, choice rows in sheets.
- **Item** (12px): menu and list-box items, schedule blocks, skeleton bars.
- **Glyph** (6px): the outlined square beside a KPI tile's label.
- **Full** (9999px): buttons, pills, segmented controls, the search field, the phone tab bar, avatars, icon buttons, and toggles.

Two silhouettes recur. The selected folder tab fuses into the panel below through 20px concave fillets cut at both of its feet. And dashed outlines mark a slot waiting to be filled: the rail's quick-add (a 48px circle in a 1px dashed Dark Outline that turns lime on hover), the import drop zone, an empty passkey list.

### Named Rules
**The Step-Down Radius Rule.** A shape nested in a container takes a smaller radius than the container: a 32px panel holds 24px list tiles and 22px KPI tiles; a 28px card holds 22px wells and 16px controls.

## Components

### Buttons
Quietly confident pills: ink for the main move, white for the alternative, lime when the button lives on the dark panel or confirms an Undo.
- **Shape:** full pill (9999px); icon-only buttons are circles.
- **Primary:** Ink fill with white 15px/500 text, 44px tall with 20px side padding. The default text button on the canvas ("Record payment", "Mark complete", "Save note").
- **Secondary:** white fill, ink text, and a 1px Outline Gray ring; it pairs with the primary ("Add charge" beside "Record payment").
- **Lime:** lime fill with ink text; the primary text button inside the dark zone (the command panel and phone header blocks: "New session", "Sell a package") and the toast's Undo.
- **Ghost:** no fill, ink text; hover tints ink at 6%.
- **Danger:** Owes Coral fill with ink text, reserved for the confirming button of a destructive sheet (delete, void, cancel, rain-out), usually beside a white "Keep it".
- **Night:** Raised Charcoal fill with white text inside the dark zone; hover Dark Outline.
- **Sizes:** small 36px (16px padding, 14px text) for secondary actions in cards, sheets, and bentos; default 44px; large 52px (24px padding, 16px text) for the main action of sign-in, onboarding, and long form sheets.
- **Hover / Focus:** 150ms ease-out color transitions; pressing scales to 0.97; disabled drops to 45% opacity; focus shows a 2px ink outline at 2px offset (lime inside the dark zone). A pending button swaps its icon for a spinner.

### Action Circles
- A record's actions sit to the right of its title as 52px lime circles with 20px ink icons (add player, note, complete; sell package, record payment, note, assess), followed by a 52px white circle that opens the overflow menu.
- 44px circles serve phone headers and the dark panel (a night variant on charcoal); a 36px Folder Gray circle closes sheets; the phone's 64px lime quick-add floats beside the tab bar.

### Chips (Pills)
- **Style:** 24px tall, 10px side padding, 12px/500, full pill, ink text on a pastel fill. A 36px size with 15px text exists for summary counts.
- **Tones:** lime for live ("On court now"); violet for groups and upcoming; coral for owes, no-show, and cancelled; sky for info, juniors, and finished; amber for expiring, low credits, late cancels, and events; mint for paid up, in credit, and active; white for a pill sitting on lime or a pastel; Folder Gray with Slate text for neutral counts; a 1px Outline Gray ring with Slate text for tags and quiet states ("Repeats weekly", "Sample", "Excused"). Inside the command panel, pills use charcoal or a Dark Outline ring.
- **Figure pills:** 44px pastel pill buttons that show a figure and open its proof: sky for credits in good standing, amber when low, coral when owed or used up, mint when in credit.

### Cards / Containers
- **Corner Style:** 28px for cards and bentos; 22px for inset wells.
- **Background:** white cards on the canvas or inside the folder panel; inset wells in Folder Gray, or Amber Wash for advisories.
- **Shadow Strategy:** none (see The Flat Card Rule).
- **Border:** none.
- **Internal Padding:** 20px. Card headings sit 20px from the top and sides; rows inside keep 20px side padding and divide with Hairline rules.
- **Bentos:** lavender and lime cards (28px, 20px padding, ink text) in the right column: a 22px light title, a 13px subtitle at 75% ink, then either a checklist of 24px circles (white at 45%) holding a check or an x, or a pair of small buttons (ink and white). Lavender carries credits, packages, and the Money hero; lime carries the session plan, goals, the next session, and the month's charges.

### Inputs / Fields
- **Style:** 48px tall, white, 1px Outline Gray border, 16px radius, 16px side padding, 15px text with a Slate placeholder. The label sits 6px above at 13px/500 Slate; help text sits below at 13px Slate.
- **Focus:** the border turns ink and the 4px lime focus glow rings the field (150ms).
- **Error / Disabled:** the border turns coral and the message below is 13px/500 Alert Red; disabled fields drop to 50% opacity.
- **Search:** a full-pill field with an 18px search icon on the left and a clear circle on the right. On the dark panel it is charcoal with a Panel Seam border that turns lime on focus.
- **Choice controls:** checkboxes are 24px circles (white with an outline, then ink with a white check); switches are 28×48px tracks (Outline Gray, then ink) whose white thumb slides 20px in 200ms and turns lime when on; segmented controls are a Folder Gray pill track of 40px options with radio dots, the selected one white with Lift.
- **Menus and selects:** white popovers with a 16px radius, Pop, and 6px padding; items are 12px-radius rows that highlight Folder Gray, and the selected option goes 600 with a check.

### Navigation
- **Desktop rail:** an 84px column inside the command panel. The 40px BallMark sits at the top, then 48px charcoal circles with 20px white icons at a 1.75 stroke (hover Raised Charcoal). The current page is a lime circle with an ink icon. Below the links sits the dashed quick-add circle; Settings and the coach's avatar sit at the foot, joined by a Sync Orange circle only while offline or syncing.
- **Phone tab bar:** a floating Command Black pill (6px padding, Pop) 12px above the safe area with five 52px items (Today, Schedule, Clients, Money, More; coaches, who never see money, get Groups in place of Money): a 20px icon over an 11px/500 Night Mist label. The current item fills lime with ink. The 64px lime quick-add floats beside the bar, never over content.
- **Focus:** a 2px lime outline everywhere in the dark zone.

### Folder Tabs (signature)
Record sections are folder tabs, not pills. Tabs are 48px tall with 20px padding, 20px apart, inset 40px (48px on desktop) from the panel's left edge, in 15px Slate type that turns ink on hover. The selected tab takes the Folder Gray of the panel, with 20px top corners and concave fillets at both feet, so it reads as one piece with the panel below. The panel (28px on desktop, 24px on phones; 16px padding, 10px on phones) holds the tab's white cards, and from 1280px a 340px aside column of bentos. On full-page records the panel stretches to the bottom of the viewport.

### Command Panel Tiles (signature)
- **KPI tiles:** 104px tall, Tile Charcoal, 22px radius, 16px padding, in a two-column grid with 10px gaps. An 18px outlined square (6px radius, 1.5px border in the tile's pastel) sits beside a 13px label in white at 85%; the value is 32px light and tabular, bottom right. The tile glow in the same pastel lights the top-left corner. Tiles that open something brighten on hover.
- **List tiles:** Tile Charcoal, 24px radius, 16px padding. An avatar stack (36px initials ringed to match the tile), a 16px regular name with a 12px tabular Night Mist meta line, and an up-right arrow; below, a 44px capsule outlined in Dark Outline holds a status icon, the status, and a count pill. Hover raises to Raised Charcoal. The selected tile turns lime with ink text, an ink-at-15% capsule outline, and a white count pill.

### Check-in Toggle (signature)
- A 48px circle at the end of every roster row. Unchecked, it is white with a 1px Outline Gray ring and a faint Pewter check (hover Folder Gray, Slate check).
- Tapped, it fills lime with an ink check at a 2.75 stroke and settles in 220ms (scale 0.8 to 1.08 to 1 on the ease-out-expo curve); a late arrival shows a clock instead. An absent or no-show player shows an x on Coral Wash. A change waiting to sync adds a 14px Sync Orange dot at the top right, cut out with a 2px white ring.
- The count pill and the credit line update at once, and an ink toast reports "Name checked in" and the credits left, with a lime Undo. Reduced motion collapses the settle to an instant change; the toast stays.

### Sheets and Toasts
- **Sheets:** focused tasks only. Bottom sheets on phones (32px top corners, up to 92% of the viewport), centered dialogs from 640px (32px all round, 512px wide or 672px for large forms). White with Pop over the scrim; a 24px light title and a 36px close circle; 24px padding; footer actions right-aligned above a Hairline. They slide up over 240ms on ease-out-expo.
- **Toasts:** ink, with a 22px radius and Pop, white text with a 13px Night Mist body, an optional lime action, and a dismiss circle. A lime check marks success; a coral triangle marks danger. They slide up over 220ms and stack above the phone tab bar, or at the bottom right on desktop.
- **Sync pill:** a 32px Sync Orange pill with 13px/600 ink text and a wifi-off icon or a pulsing dot ("Offline · 2 to sync"), shown only while offline or syncing.

### Schedule Blocks and Charts
- **Schedule:** blocks are duration-true and carry a 12px radius with ink text on the session type's fill: white with an Outline Gray ring for private, mint for semi-private, violet for group, sky for clinic, amber for event. The session on court now is lime; cancelled blocks are Coral Wash with Slate text.
- **Charts and meters:** ink only, on fixed scales: assessment scores on the rubric's scale, ratings on 2.0–8.0, six months of money on one shared scale. Received money is a solid ink bar and charged money an outlined ink bar; meters are 6px ink bars on an ink-at-10% track, turning coral when credits run low. Lime never colors a series.

### Brand Mark (BallMark)
- A lime pickleball: a 15-unit lime circle in a 32-unit box with eight 1.9-unit perforations in Command Black. 40px at the top of the rail, 32px in the phone header, 36px in the wordmark beside "CoachMan" at 22px/500 with -0.02em tracking.
- **Raster provenance:** `public/favicon.svg` is the BallMark vector itself. `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (mark at 56% to stay inside the maskable safe zone), and `apple-touch-icon-180.png` (all on Command Black), plus the transparent white cut-out `badge-72.png`, are rendered from the same geometry by `scripts/generate-icons.mjs` (Playwright screenshots; `npm run icons`). The app ships no other rasters: people are initials (600, ink) on a soft wash unless a coach uploads a photo, which the app crops to JPEG.

### Named Rules
**The Proof Rule.** A credit count or a balance is a button that opens its proof: the credit ledger or the client's statement.

## Do's and Don'ts

### Do:
- **Do** split every screen into the two zones: the night command panel (84px rail and 328px list column on desktop, a black header block on phones) and the gray canvas of white cards.
- **Do** reserve lime (#daee63) for live, selected, and primary: current navigation, the selected tile, action circles, the checked-in toggle, the primary bento.
- **Do** set every pastel and lime fill with ink (#111111) text and icons.
- **Do** set headings and figures from 22px up at weight 300: record titles 44px and page titles 40px from 1024px, both 32px on phones.
- **Do** give every compared number tabular lining numerals (`.num`).
- **Do** open records into folder tabs that fuse into the Folder Gray panel, with the lavender and lime bentos in a 340px column from 1280px.
- **Do** keep controls at 44px or more (fields and check-in toggles 48px, action circles 52px), and use the 36px small button only for secondary actions inside cards, sheets, bentos, and toasts.
- **Do** confirm a check-in with the lime fill, the 220ms settle, and an ink toast that offers Undo.
- **Do** use Lucide icons at 16–24px, with a 1.75 stroke in navigation.
- **Do** show people as initials on a soft wash unless the coach has uploaded a photo.

### Don't:
- **Don't** use lime to mark a category, a tag, or a chart series; categories take the pastels.
- **Don't** put white text on lime or on any pastel, even though the reference does.
- **Don't** set any text at weight 700, or a heading of 22px or more above weight 300.
- **Don't** put an eyebrow or kicker above a heading, and don't uppercase labels. A field label above its value is data, not a kicker.
- **Don't** add a colored side stripe to a card, row, or alert.
- **Don't** use gradient text; the KPI tile's corner glow is the system's one decorative gradient.
- **Don't** shadow a card, tile, or panel, and don't give a resting element both a 1px line and a shadow.
- **Don't** use icons from any set but Lucide, or glyphs and emoji as icons.
- **Don't** put a dark card on the canvas or a white card in the command panel.
- **Don't** introduce a hex outside the `@theme` tokens in `src/app/styles.css`; declare a new color there first.
- **Don't** use stock or illustrative images of people.
- **Don't** reintroduce the rejected themed costume ("Court Lines") or flat admin tables; the BallMark is the only sport motif.
