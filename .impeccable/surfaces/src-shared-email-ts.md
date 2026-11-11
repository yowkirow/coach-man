---
version: 1
slug: "src-shared-email-ts"
primary_target: "src/shared/email.ts"
related_targets: ["src/worker/services/email.ts"]
---

# Surface brief: CoachMan's emails

Scope: every transactional email (src/shared/email.ts renders them; src/worker/services/email.ts sends them). Mode: read. A short message opened on a phone between sessions, often in a dark-mode mail app that darkens it on its own.

Audience and job: invited staff and families, people who sent an enrollment request or a payment proof, and staff with alerts on. They need to know who it's from, what happened, where things stand, and the one thing to do now, then open CoachMan.

Constraints: no web fonts, scripts, or tracking; the academy's logo is the only image (the public one its website shows, the same URL for every reader). Never amounts, the academy's reasons, or health details. One small footer line. Reply-To headers carry who replies reach.

## Direction contract

THESIS: An email is a short progress line: what already happened (ink), where things stand now (the lime step, which holds the one button), and what follows (outlined). It refuses the generic transactional template: a logo bar, a wall of paragraphs, a centered button, a legal footer.

OWN-WORLD: CoachMan's calm register on white. The academy's tile (logo on white, else initials on Folder Gray) beside its name and "via CoachMan"; a 32px light heading; 32px numbered circles (Ink done, Signal Lime now, an Outline Gray ring next) joined by a 2px line, Ink below done steps and Outline Gray after; an Ink pill inside the now step; Slate text; one 13px footer line. In a dark color scheme: Command Black, white done circles, Dark Outline, a lime button.

STORY: The reader sees who sent it, the heading names what it is, the line shows how far things have come, the lime step says what to do, the button does it.

FIRST VIEWPORT: On a 390px phone: the tile and name at top left, the heading at 28px, then the steps, with the now step's button inside the first screen; the written-out link and the footer below.

FORM: The progress line, the seventh of seven structures on my ordered list, dealt as the lead by seed 792f926f and chosen by the owner from rendered mocks.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
