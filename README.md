# CoachMan

CoachMan (short for *coach manager*) is an installable web app for pickleball academies and independent coaches: clients, progress, rates and packages, groups, events like summer camps and academies, the schedule, and the money. Each academy is a private workspace with its own team of owners, admins, and coaches; a solo coach is a one-person academy. Students and parents get their own family portal. It works on court from a phone (even offline) and at a desk on a laptop.

## What's in v1

- **Today**: the session on court now, one-tap check-in with undo, credits that count themselves down, and what needs attention (low credits, expiring packages, balances due, birthdays).
- **Schedule**: one-off and weekly recurring sessions (private, semi-private, group, clinic, event), edit "this" or "this and following", cancel with automatic credit returns, rain-outs for a whole day.
- **Clients**: profiles with contact, guardian and emergency details for juniors, groups, tags, photos, and a full activity timeline.
- **Progress**: a skill rubric per sport (pickleball built in), fixed-scale assessments, goals, DUPR/coach ratings, and notes.
- **Packages and rates**: a rate card, credit packages with validity (a number of days, or to the end of a chosen month), earliest-expiry-first usage, an auditable credit ledger, and manual adjustments. Packages double as the tiers of the academy's rates sheet: inclusions, "who it's for", sessions labels, uniforms, and a featured tier.
- **Academy page**: a public, shareable page for each academy (`/a/<slug>`) with its programs, tiers, coaches, and contact details, an **Enroll** button on every tier, a printable rates sheet, and link previews for Messenger, Viber, and Facebook.
- **Enrollment**: a phone-first wizard from the academy page or the portal (who's training, level and uniform, contact and safety, the month or trial session, consents, check and send); an **Enrollments** inbox where owners and admins approve (selling the tier in one step), waitlist, or decline; one-tap monthly renewal, and a "Not yet renewed" list with a reminder to paste.
- **Payment proofs**: families pay outside CoachMan (GCash, a bank transfer, cash) and send the screenshot from the portal's **Pay** screen (big photos are shrunk on the phone), or say they'll pay cash at the court; owners and admins confirm it from **Payments to review** on Money (a real payment is recorded) or don't accept it with a reason the family reads. Duplicate references are flagged.
- **Consents**: versioned waivers and consent forms (starter templates included), signed by typing a name in the family portal or recorded from paper.
- **Groups and events**: classes with members and weekly series; camps, academies, clinics, tournaments, and socials with registrations, a waitlist, early-bird pricing, and their own sessions.
- **Money**: charges and payments (cash, transfer, card, e-wallet), oldest-first allocation, balances, monthly summaries, payment proofs to review, and CSV exports.
- **Sign-in**: Google creates the account; passkeys give one-tap sign-in afterwards. Parents and students without Google can make a passkey-only account from their invite, or while enrolling.
- **Family portal**: students and parents follow sessions and attendance, shared progress and coaches' comments, coaches, packages, credits, payments, announcements, and their enrollment requests (with the amount due once approved, and **Pay** to send proof of payment) under their academy's name and logo, on a phone or a laptop. Parents keep a child's health details, emergency contact, and pickup people up to date from the Profile.
- **Kids' safety**: medical notes, emergency contacts, and authorized pickup people with photos, kept current by parents; at check-in, coaches get a medical flag (tap to read) and a **Pickup** list with photos and tap-to-call, and Today counts the juniors with medical notes in the day's sessions.
- **Announcements**: owners and admins post news for everyone, one program's members, or one event's players, pinned, published now or scheduled, with an optional end; families see theirs on Home and in Announcements, staff on Today.
- **Family reminders**: students and parents turn on push notifications for each phone or computer in the portal (**Settings → Notifications**): sessions (1 hour, 2 hours, or 7pm the evening before), packages and renewals, enrollment and payments, coaches' comments and progress, and announcements, with quiet hours; iPhones get the Add to Home Screen steps first. Owners and admins get a push for each new enrollment request and payment proof.
- **Public pages**: `/about` (what CoachMan is and how to start), `/privacy`, and `/terms`, readable signed out, linked from sign-in, enrollment, academy pages, and Settings.
- **PWA**: installable, offline reads, offline-queued check-ins and notes that sync with idempotency keys, push reminders and a daily digest for staff, and push reminders for families.
- **Import**: bring clients over from a spreadsheet (CSV with column mapping, preview, and duplicate detection).

## Academies

### Roles

Every member of an academy has one staff role. What each role may do lives in one capability map, `src/shared/roles.ts`, shared by the Worker (which enforces it) and the app (which hides what a role can't use):

| Capability | Owner | Admin | Coach |
| --- | --- | --- | --- |
| Clients, progress, notes, schedule, sessions, check-in, group members, event rosters, credits | ✓ | ✓ | ✓ |
| `money`: prices, payments, charges, balances, revenue, selling and changing packages | ✓ | ✓ | |
| `catalog`: rates, package templates, programs (groups), events | ✓ | ✓ | |
| `settings`: academy settings, payment methods, venues, the rubric, consent forms | ✓ | ✓ | |
| `data`: CSV import and export, sample data, deleting clients | ✓ | ✓ | |
| `team`, `enrollment`, `familyAccess`, `announcements` | ✓ | ✓ | |
| `ownership`: delete the academy, transfer ownership | ✓ | | |

Coaches never receive money from the API: money-only routes answer 403, and every other `/api/v1` response is passed through a redactor that removes every `*Minor` amount (and empties Today's list of who owes). Coaches still check players in; pay-per-session and event charges happen at catalog prices, but setting a price (a session's price, a registration's price, "no charge") is for owners and admins. Better Auth's legacy `member` role counts as coach.

### Accounts and routing

Nobody gets an academy just by signing in. After sign-in:

- **Staff** (a member of at least one academy) land in the staff app. Staff of more than one academy switch between them in Settings or More.
- **Families** (a student or parent linked to a student) land in the family portal at `/my`. Someone who is both (a coach who is also a parent) gets **My family** in the staff app's Settings and More, and **Coach view** in the portal's header.
- **Everyone else** lands on `/welcome`: "Set up CoachMan for my coaching or academy" creates their own workspace and continues to onboarding; students and parents are pointed to their academy's invite link or page.

Signed out, a visit to exactly `/` opens `/about` (CoachMan's public home page, with **Sign in** and **Set up your academy**); every deeper link (`/clients`, `/my`, …), and the installed app, goes to `/sign-in?next=…` and comes back after signing in.

The account endpoints work without a workspace:

| Endpoint | Does |
| --- | --- |
| `GET /api/account` | Who is signed in, their staff academies (with role), their family links (with students), and the active academy |
| `POST /api/account/workspaces` | Creates the caller's own workspace, once; later calls return the same one |
| `POST /api/account/active-workspace` | Switches the academy `/api/v1` works in (membership required) |

`/api/v1` answers 403 `no_workspace` to a signed-in person who isn't staff anywhere, and the app sends them to `/welcome`. Academies are managed through these endpoints and `/api/v1`, so Better Auth's organization plugin endpoints (`/api/auth/organization/*`) answer 404.

### Academy profile

**Settings → Academy profile** (owners and admins) holds what families will see: the academy's name, its public address (`/a/<slug>`: 3 to 40 lowercase letters, numbers, and single hyphens; unique, so a taken address answers 409), logo, tagline, about, contact details, address and map link, social links, payment instructions with a QR code, policies, and two switches (show the academy page, take enrollment requests). A preview shows the logo, name, and tagline as invites and the portal show them. Everyone on the team can read the profile (`GET /api/v1/academy`); changing it takes `settings` (`PATCH /api/v1/academy`, `PUT`/`DELETE /api/v1/academy/logo` and `/academy/payment-qr`). The time zone, currency, and formats moved to **Regional settings**. A solo coach is a one-person academy: onboarding asks for an "academy name" and suggests their own name.

Logos, payment QR codes, and coach photos are public images, stored under `ws/<workspaceId>/public/` in R2 and served to anyone by `GET /api/public/files/<key>` (only that prefix; rate-limited; cacheable). Uploads are JPEG, PNG, or WebP up to 1.5 MB, checked by content type and file signature, and resized in the browser first.

### Team and invites

**Team** (in the nav for everyone) lists the members with their role, when they joined, their coach title, and how many students they coach. Owners and admins (`team`) also see waiting and recently expired invites, invite people, change roles, and remove people. Anything that makes, changes, or removes an owner, and transferring ownership, takes `ownership`, so only an owner can do it. The last owner can never be demoted or removed: the check runs inside the database update, so two owners demoting each other at the same moment still leave one.

Inviting a coach or an admin makes a single-use link, `${APP_URL}/join/<token>`, valid for seven days. There is no email: Team shows the link once (only its SHA-256 is stored) with Copy, Share, and a message ready to paste into Messenger, Viber, or a text. A new link for the same address replaces the old one; links can be withdrawn and sent again.

The person opens the link, signs in with Google (or a passkey they already have), and joins. The signed-in account's email must be the invited address (any letter case) and verified by Google; a different account is told so and offered "Use another account". Expired, used, and withdrawn links each get their own page; someone opening a link they already used is told they're on the team and can open the academy.

| Endpoint | Does |
| --- | --- |
| `GET /api/v1/team` | Members (everyone; colleagues' emails only for `team`) and invites (`team` only) |
| `POST /api/v1/team/invites` | `{ email, role: "admin" \| "coach" }` → `{ invite, link }` (`team`) |
| `DELETE /api/v1/team/invites/:id` | Withdraws an invite (`team`) |
| `PATCH /api/v1/team/members/:userId` | `{ role }` (`team`; owners only for anything owner) |
| `DELETE /api/v1/team/members/:userId` | Removes someone: their current students and upcoming sessions lose them as coach (`team`) |
| `POST /api/v1/team/transfer-ownership` | `{ userId }`: they become an owner, you an admin (`ownership`) |
| `GET /api/invites/:token` | Public preview: academy name and logo, role (staff) or student's first name and relation (family), and whether the link still works |
| `POST /api/invites/:token/accept` | Signed in: joins the academy (staff invites) or links the account to the student (family invites, see below) |

Invite tokens are 256-bit random values, so guessing one isn't practical; the limits make sure nobody tries. Lookups of tokens that don't exist are counted (20 per 10 minutes: per signed-in account when accepting, per connection for previews and passkey accounts), and once that's used up every lookup from there is refused for a while. Real links are counted per invite (60 previews a minute) and per invite and account (10 accepts a minute) instead of per IP address, so a mobile carrier that puts many families behind one address can't lock them out.

### Coach profiles

Every staff member has a coach profile (Settings → **My coach profile**): the name shown, title, about, photo, certifications, DUPR rating, specialties, languages, years coaching, and whether it may appear on the academy page. Owners and admins edit anyone's from Team. Coaches' names and photos appear on their notes, assessments, goals, students, sessions, programs, and events, including after they leave the team. Endpoints: `GET /api/v1/coaches` (the team as coach pickers need it), `GET`/`PATCH /api/v1/coaches/:userId` and `PUT`/`DELETE /api/v1/coaches/:userId/photo` (yourself, or anyone with `team`).

### Coach assignment

- **Students** have a primary coach and any number of assistant coaches, changed from the Coaches card on their profile by any coach (`PUT /api/v1/clients/:id/coaches`). Changes never overwrite: the old assignment ends today and a new one starts, so "Earlier coaches" shows who coached them and when. Whoever adds a student is their primary coach unless they pick someone else.
- **Sessions, weekly series, groups, and events** have a lead coach and assistants, picked in their create and edit sheets. A new session is led by whoever schedules it, unless its group or event names a lead. Weekly series copy their coaches into every session they add. Changing coaches with "this and following" changes the series and the sessions ahead; sessions already held keep the coaches who ran them. Changing a group's or event's coaches applies to sessions added afterwards.
- **Filters:** Clients has "My students"; Today and Schedule have "Mine / Everyone" (coaches start on Mine, owners and admins on Everyone; the choice is remembered on the device). A one-person academy doesn't see these.
- **Reminders** go to a session's lead and assistant coaches; a session with no coach on the team goes to the owners and admins. Owners and admins get the academy-wide daily digest; coaches get one about their own sessions and students.

### Coach comments

Notes on a student show who wrote them and when. They're for coaches only unless the author turns on **Share with student & parents**, which says plainly who will see the note (the family portal shows only shared notes). Only the author changes a note's words or sharing (the note is then marked edited); the author, an owner, or an admin may delete it. When a student's primary coach changes, the app offers to write a **handoff note**, which is always coaches only, whatever the request asks. The Progress tab's coaching timeline puts every coach's notes, assessments, and goals in one list, with a filter by coach. Assessments are shared with the family by default; a "Visible to student & parents" switch holds one back.

### Family access and invites

A student's profile has a **Family access** card (owners and admins, `familyAccess`): who is linked (name, parent or student, since when, how they sign in), waiting links, and two buttons, **Invite parent / guardian** and **Invite student (own login)**. Each makes a single-use link, `${APP_URL}/join/<token>`, valid for seven days and shown once (only its SHA-256 is stored), with Copy, Share, and a message ready to paste into Messenger, Viber, or a text. No email is sent. Links can be withdrawn, and anyone's access can be revoked; every invite, acceptance, grant, and revoke is written to the audit log.

The age rules (`checkFamilyAccess` in `src/shared/family.ts`) apply when a link is made and again when it's used:

| Student | Parent or guardian link | Student's own login |
| --- | --- | --- |
| Under 13 | ✓ | Refused: "Students under 13 don't get their own login" |
| 13 to 17 | ✓ | Only once a parent is linked ("A teen's own login needs a parent linked first") |
| 18 and over | Refused: adults sign in themselves | ✓ |
| No birth date, marked junior | ✓ | Refused until a birth date is added |
| No birth date, not junior | Refused (treated as an adult) | ✓ |

The card says why a button is unavailable. Parents' links don't replace each other (two parents can both be invited); a new own-login link withdraws the student's previous one. Revoking a minor's last parent also ends the teen's own login, and the confirmation says so.

Opening a family link shows the academy's name and logo, the student's first name, and the relation. Signed out, the person can **Continue with Google** (back to the link afterwards), **Create a passkey account** (no Google needed, see below), or sign in with a passkey they already have. Signed in (staff too: people can be both), **Accept invite** links the account and opens `/my`. Accepting re-checks the age rules; someone who already follows the student is told so and the link stays unused for the next person; used, expired, and withdrawn links answer 410 and say so.

A parent of a 13 to 17 year old can make the teen's own login link from the portal (**Settings → Your children's own logins**, same rules and link), see it waiting, withdraw it, and end the teen's login later. Parents can't revoke another parent; the academy can revoke anyone.

| Endpoint | Does |
| --- | --- |
| `GET /api/v1/clients/:id/family` | Linked accounts, waiting (and recently expired) links, and which invites the rules allow now (`familyAccess`) |
| `POST /api/v1/clients/:id/family/invites` | `{ relation: "guardian" \| "self" }` → `{ invite, link }`, or 409 with the rule that refused it |
| `DELETE /api/v1/clients/:id/family/invites/:inviteId` | Withdraws a link |
| `DELETE /api/v1/clients/:id/family/access/:accessId` | Revokes someone's access |

### The family portal

`/my` is a calmer, phone-first app under the academy's own logo and name (not recolored), with a floating tab bar on phones and the same places in the header on a laptop:

- **Home**: a greeting, and for each linked student the next session, credits left with their expiry, the balance (linking to Payments), their enrollment requests with where each stands (Requested, Waitlisted, Approved with what's due, Declined with the academy's reason, Cancelled; open ones can be cancelled), and **Renew for next month** when a monthly package ends this month; the latest comments coaches shared; the latest announcements that reach the family (pinned first, with **All announcements** opening `/my/announcements`); **Enroll**; and each academy's contact card.
- **Progress**: skill bars from shared assessments (with the previous score), the overall level, goals, the rating history, and the shared comments timeline with coach names and dates.
- **Schedule**: sessions ahead (the next one highlighted) and past ones with attendance, with venue, court, and lead coach.
- **Coaches**: the student's coaches with photo and title; bio, certifications, specialties, and languages only when the coach's profile is public.
- **Payments**: the balance (with **Pay**), **To pay** (what approved requests still owe, each with **Pay** and where its payment stands), packages with credits and expiry, the student's requests and renewal, the payment proofs sent and where each stands, the history of charges and payments, and **How to pay** with the academy's instructions (numbers to copy) and QR code. **Pay** (`/my/<student>/pay`) sends proof of a payment; see Payment proofs below.
- **Enroll** (`/my/enroll`, from Home, More, and the laptop header): the tiers of each listed academy the person's students train at, grouped by academy, each starting the enrollment wizard.
- **Profile**: basics (with the training shirt size), the health and emergency details, and, for juniors, the authorized pickup people with their photos. A parent of a minor edits all of it; an adult student edits their own medical note, emergency contact, and shirt size; a teen's own login reads it (see Kids' safety below).
- **Announcements** (`/my/announcements`, from Home and More): everything live that reaches the family's students, pinned first, then newest, with the academy's name when there are several.
- **Notifications** (`/my/notifications`, from Settings and More): turning reminders on for this device, what they get, and quiet hours; see Family reminders below. Home offers it once ("Get reminders on this phone").
- **Settings**: passkeys (add, remove; a passkey-only account keeps its last one), linking Google, teen logins for parents, notifications, installing the app (with iOS steps), signing out, and links to CoachMan's privacy policy and terms. **More** gathers Coaches, Profile, Announcements, Notifications, Settings, the academy, and Coach view for staff.

Several students, in one academy or several, switch from the student pages; the header follows the current student's academy. Money, dates, and times use each academy's currency, locale, and time zone. The portal only reads `/api/account` and `/api/portal` (families get 403 from `/api/v1`). Its pages persist offline like the staff app's, under keys that carry the person's id; the cache-owner check clears a previous person's data on a shared phone, and data of students someone is no longer linked to is dropped once the server says so.

`/api/portal` scopes every query to the caller's active links: unknown and unlinked ids answer 404 (never 403), signed out answers 401, and someone linked to nobody gets an empty home. Every answer is built by family-safe mappers (`src/worker/lib/portal-dto.ts`), never from a staff DTO: no coaches-only or handoff notes, unshared assessments, internal client notes, tags, or source, no lesson, attendance, registration, package, or payment notes, no other students (session titles never name other players), no coach emails, phones, or user ids, and nothing from another academy. A student's level is the latest shared assessment's.

| Endpoint | Does |
| --- | --- |
| `GET /api/portal/home` | Per student: next session, credits, balance, latest shared assessment; latest shared comments; academies; the latest 5 announcements that reach the family |
| `GET /api/portal/announcements` | Every live announcement that reaches the caller's students, pinned first, then newest, with the academies |
| `GET /api/portal/academies/:workspaceId` | The academy's profile: contact, address and map, socials, policies, payment instructions and QR |
| `GET /api/portal/students/:clientId` | Basics, health and emergency details, pickup people, what the caller may change (`editable`), who last changed the details (`safetyUpdate`: by you or by the academy), current coaches, programs, and (parents) the teen-login state |
| `PATCH /api/portal/students/:clientId/safety` | `{ medicalNotes?, emergencyName?, emergencyPhone?, guardianPhone?, guardianEmail?, shirtSize? }` within the caller's rights (403 `read_only` otherwise); answers the fresh student |
| `POST /api/portal/students/:clientId/pickups` | A parent adds a pickup person: multipart `data` (JSON `{ name, relationship?, phone?, notes? }`) and `photo`, or JSON alone |
| `PATCH /api/portal/students/:clientId/pickups/:pickupId` | Changes one (`removePhoto: true` drops the photo; a new `photo` replaces it) |
| `DELETE /api/portal/students/:clientId/pickups/:pickupId` | Removes one, with their photo |
| `GET /api/portal/students/:clientId/schedule?from&to` | Sessions with this student's attendance (default: 90 days back to 60 ahead; at most 400 days) |
| `GET /api/portal/students/:clientId/progress` | Skills, shared assessments, goals, ratings, shared comments |
| `GET /api/portal/students/:clientId/money` | Balance, packages, charges, payments (voided ones left out) |
| `POST /api/portal/students/:clientId/teen-invite` | A parent makes their 13 to 17 year old's own-login link |
| `DELETE /api/portal/students/:clientId/teen-invites/:inviteId` | A parent withdraws it |
| `DELETE /api/portal/students/:clientId/access/:accessId` | A parent ends their teen's own login (only `self` access) |
| `GET /api/portal/files/<key>` | Photos of the caller's own students, their academies' public images, and (looked up by the exact key) screenshots of their students' payment proofs and photos of their students' pickup people; nothing else |
| `GET /api/portal/enrollment-context?slug=` | The wizard's choices at a listed academy: the caller's own student record, their children there (with whether each may be enrolled), what's already signed, and open or approved requests |
| `GET /api/portal/enroll` | The Enroll page: each linked academy's page (listed ones) with its programs and tiers |
| `POST /api/portal/enrollments` | Sends a request from the wizard (201, or 200 for a retried send with the same `id`); 30 an hour per person |
| `POST /api/portal/enrollments/:id/cancel` | Withdraws a requested or waitlisted request (the sender, a parent, or the adult student) |
| `GET /api/portal/students/:clientId/enrollments` | The student's requests (with what's owed once approved) and their renewal offer |
| `POST /api/portal/students/:clientId/renew` | `{ id?, signatures? }`: next month, same tier, previous answers; allowed while enrollment is closed |
| `GET /api/portal/notifications` | The caller's family notification settings (`prefs`), how many devices get them, the time zone quiet hours use, whether Home's offer was dismissed, the Web Push key (null when push is off), and whether the caller is staff too |
| `PUT /api/portal/notifications` | `{ sessions, sessionLead: "1h" \| "2h" \| "evening", packages, enrollment, progress, announcements, quietStart, quietEnd }` (`HH:MM`, academy time; both null turns quiet hours off) |
| `POST /api/portal/notifications/devices` | `{ endpoint, keys: { p256dh, auth } }` (the browser's push subscription): this device gets the caller's family notifications |
| `DELETE /api/portal/notifications/devices` | `{ endpoint }`: it stops; answers `{ staff, family }`, what still uses the device |
| `GET /api/portal/notifications/device?endpoint=` | `{ staff, family }` for one device of the caller |
| `POST /api/portal/notifications/test` | A test notification to the caller's family devices (10 per 10 minutes) |
| `POST /api/portal/notifications/prompt-dismissed` | Home's "Get reminders on this phone" isn't offered again |

### Passkey-only accounts

Parents and students without Google can create an account with just their name, from a family invite or while enrolling: `POST /api/auth/passkey-account/start { name, inviteToken }` or `{ name, enrollment: { slug } }` (a Better Auth plugin endpoint; exactly one of the two) creates a user with a placeholder address, `u-<uuid>@passkey.coachman.invalid` (unverified, and never accepted by a staff invite), and signs them in; the page then adds the device's passkey and accepts the invite (or goes on with the enrollment wizard). An invite start is refused without a family invite that still works and is limited per invite; an enrollment start needs a listed academy that takes new students (404 `academy_not_found`, 409 `enrollment_closed`; unknown addresses count as misses per IP) and is limited to 5 an hour per academy and IP address and 100 an hour per academy. If the passkey isn't made (cancelled, or the device can't), the page calls `POST /api/auth/passkey-account/abandon`, which deletes the empty account, and says so. A placeholder account can't accept an invite or send an enrollment request without a passkey or Google, and the daily maintenance deletes placeholder accounts older than a day that have no passkey, no family link, no academy, and no enrollment request.

**Linking Google later:** portal Settings offers **Link Google** to passkey-only accounts (only to them: `/api/auth/link-social` answers 403 to everyone else). After Google's page, the account's placeholder address and name become the Google account's verified address and name. A Google account that already belongs to another CoachMan account is refused with a clear message.

**Recovery:** someone without Google who loses every passkey asks the academy for a fresh invite link, makes a new passkey account with it, and the academy revokes the old account's access from the Family access card. Linking Google, or adding a passkey on a second device, avoids this.

### Programs and package tiers

A **program** is a group (`training_group`) the academy publishes: besides its level, size, default venue, weekly series, and coaches it has `isPublic`, `publicDescription` (what families read; the plain description stays internal), `scheduleNote` (a label such as "Every Tue & Thu, 7–10pm" that replaces the weekly series' days and times on the page), `ageMin`/`ageMax`, and `sortOrder`. Edit them in the group sheet's **Academy page** section; the group's header and cards show a **Public** pill, and its Details tab lists the program's tiers (coaches see them without prices).

A **package template** is also a tier on the rates sheet: `programId`, an optional `coachUserId` (a coach-specific tier), `sessionsLabel` ("4–6 sessions"; `credits` is the most it covers), `validityMode` (`days` or `month_end`), `inclusions` (an ordered checklist), `audience` ("Who it's for"), `commitmentNote`, `includesUniform`, `asksSelfRating`, `isPublic`, `highlight` (the featured tier), and `sortOrder`. The package sheet edits them with a live preview of the card families see. A tier is on the public page when it's public, for sale, and in no program or in a public, active program. New packages and groups go to the end of the order.

**Packages & rates → Academy page** (`catalog`) shows whether the page is listed (with **Preview page**, **Printable rates**, and **Copy link**), then each program with its Public switch and order arrows, and its tiers with their Public switch, a featured star, order arrows, and edit. Money stays redacted for coaches as everywhere else: they read tiers (names, inclusions, schedule) without prices and get 403 on every catalog change.

**Month-end validity.** Selling (or, from WS4b, approving) a `month_end` package takes a `startMonth`, this month or next in the academy's time zone (this month by default); it expires on that month's last day, with no proration, whatever the sale date. The sell sheet offers the two months and shows "Pays for sessions from … Valid until …". The **credit rule** for every package: it pays for a session only when the session's local date is within [start, expiry], where the start is the first of `startMonth` for month-end packages and `purchasedOn` otherwise. So a package sold for next month never pays for a session this month: check-in uses another package, or the existing pay-per-session rules (the rate's charge, or nothing); picking it by hand answers 409 with the reason ("it starts on Dec 1, 2026"). The client's packages card says **Starts <date>** until then.

**Uniforms.** A package sold from a tier with `includesUniform` keeps that flag (`client_package.includes_uniform`). Staff record the size (when selling, or later) and **Uniform handed out** from the client's packages card (any staff member: it happens at the court); Today's **Needs attention** lists uniforms still to hand out for owners and admins.

**Self-ratings.** When a tier `asksSelfRating`, enrolling (WS4b) saves the player's own estimate to their rating history with source `self`. The staff app labels it **Self-rating**; the portal's headline rating prefers the latest coach or DUPR rating and shows the self-rating on its own line.

| Endpoint | Does |
| --- | --- |
| `POST /api/v1/groups/reorder` | `{ ids }`: programs' order on the page (`catalog`) |
| `POST /api/v1/packages/reorder` | `{ ids }`: tiers' order; answers the reordered list (`catalog`) |
| `POST /api/v1/clients/:id/packages` | Selling now also takes `startMonth` (month-end tiers) and `uniformSize` |
| `PATCH /api/v1/client-packages/:id/uniform` | `{ uniformSize?, issued? }` (any staff) |

### Consents

**Settings → Consent forms** (`settings`) holds the academy's documents: a kind (waiver, data privacy, parental consent, photo and video, other), a title, the text (plain text; a blank line starts a paragraph, and it's always shown as text, never as HTML), whether it's required, who it applies to (everyone, or students under 18 only), and whether it's active (a draft families don't see). **Start from a template** adds an activity waiver and release, a Data Privacy Act (RA 10173) consent, a parental consent for minors, or a photo and video consent, filled in with the academy's name, as drafts under a "starting point, not legal advice" note. Changing the text of a document someone signed starts a new version: earlier signatures stay with the version they signed (its text is kept in `consent_document_version`), and those students show as **Needs re-signing**. A document nobody signed can be deleted; a signed one can only be turned off.

Who may sign: for a student under 18 (or marked junior without a birth date) only a parent or guardian's signature counts, and "students under 18" documents apply only to them; adults sign for themselves. A teen with their own login sees the forms but can't sign them. Any staff member can record a form **signed on paper** (relation `staff`: "Signed on paper by <name>, recorded by <staff>"), which counts either way. A signature keeps the typed name, the relation, the version, the time, the IP address (`cf-connecting-ip`), and the device, and is written to the audit log.

The student's profile has a **Consents** card (signed with version, by whom, and when; missing; needs re-signing; and **Record paper signature**), and Clients has a **Missing consents** list. In the family portal, **Consents** (in More, the laptop header, and a prompt on Home when something is missing) shows the same per student; parents (and adult students) read a form, then sign it by typing their full name.

| Endpoint | Does |
| --- | --- |
| `GET`/`POST /api/v1/consent-documents` | The academy's documents with signature counts; create one (`settings`) |
| `POST /api/v1/consent-documents/templates` | `{ kind }`: a starter document, inactive (`settings`) |
| `PATCH`/`DELETE /api/v1/consent-documents/:id` | Edit (a signed text starts a new version) or delete an unsigned one (`settings`) |
| `GET /api/v1/clients/:id/consents` | The student's standing on each active document that applies |
| `POST /api/v1/clients/:id/consents/:documentId/paper` | `{ signerName, version }`: records a paper signature (any staff) |
| `GET /api/portal/students/:clientId/consents` | The forms with their text and standing, and whether the caller may sign |
| `POST /api/portal/students/:clientId/consents/:documentId/sign` | `{ signerName, version }`: a parent for a minor, the student as an adult; 403 otherwise, 409 if the form changed |
| `GET /api/public/academies/:slug/consents` | Texts of the active required documents (the enrollment wizard's consent step) |

### The academy page and rates sheet

`/a/<slug>` is the academy's public page, phone-first because links get shared on Messenger and Viber: the academy's logo, name, and tagline; the program on show as a pass (its days lit on a week strip, times, venue with directions, coaches, and next session; `?program=<id>` switches between several); its tiers as cards (price per head, sessions, validity with "Valid until the end of the month; best to enroll early in the month" for month-end tiers, the inclusions checklist, the uniform, who it's for, the commitment note, the featured tier in lime, and **Enroll**, or "Enrollment is closed for now" with ways to get in touch while the academy isn't taking new students); about; coaches with photo, title, and certifications; contact (tap to call, text, email, Messenger, the map, socials); policies; and **View printable rates**. An unlisted, legacy (`ws-…`), or unknown address shows "This academy page isn't available".

`/a/<slug>/rates` is the rates sheet, generated from the live catalog and laid out like a formal rate document: the letterhead (logo, name, tagline, contact), "Rates and packages" as of the current month, then for each program and tier the rates and schedule, validity, inclusions, and notes, in the academy's currency and locale. **Print or save as PDF** opens the browser's print dialog; the print styles drop the toolbar and app chrome, print on white with page margins for A4 or Letter, and keep each tier on one page.

Owners and admins preview the page while it's unlisted: **Settings → Academy profile → Preview public page** (or Packages → Academy page) opens `/a/<slug>?preview=1`, which reads `GET /api/v1/academy/public-preview` (`settings`) and says it's a preview; **Copy link** appears once the page is listed. Someone who only opened an academy's link doesn't get the service worker or a persistent-storage request.

| Endpoint | Does |
| --- | --- |
| `GET /api/public/academies/:slug` | A listed academy's page: profile, public programs (schedule, venue, coaches), public tiers with prices, public coach profiles, and the titles of active required consents. `Cache-Control: public, max-age=60`; 404 when unlisted, legacy, or unknown |
| `GET /api/v1/academy/public-preview` | The same for the staff member's own academy, listed or not, with `listed` and `publicUrl` (`settings`) |

Both are built field by field (`src/worker/lib/public-dto.ts`) from published rows only: no clients, notes, internal descriptions, payment instructions, staff emails, phones, or user ids (coaches are identified by their profile id), and no unpublished programs or tiers. `/api/public/*` and `/a/*` share one rate limit (300 requests a minute per IP address).

**Link previews.** Messenger, Viber, and Facebook read a shared link's HTML; they never run the app. `assets.run_worker_first` in `wrangler.jsonc` sends `/a/*` to the Worker (`src/worker/public-page.ts`), which fetches the app's `index.html` from the assets binding and uses `HTMLRewriter` to replace the title and description and add `og:title`, `og:description`, `og:image` (the cover or logo as an absolute `${APP_URL}/api/public/files/…` URL), `og:url`, and `twitter:card` tags, every value escaped (`src/worker/lib/page-meta.ts`). It also writes the page's data into a JSON block the app reads instead of fetching it again. Unknown and unlisted academies get CoachMan's own tags and the app, which shows the not-found page. The assets' `_headers` (security headers) still apply, local `vite dev` and `vite preview` work the same way, and the service worker leaves `/a/*` to the network.

### Enrollment

**The wizard** (`/a/<slug>/enroll?package=<tier>`) opens from a tier's **Enroll** button on the academy page or the portal's Enroll page. It's phone-first, one question per step, with the steps listed beside it on a laptop and "Step 2 of 6" on a phone; **Back** keeps every answer, and the draft is saved on the device as it's typed (per person and tier), so a reload or a trip through Google comes back to the same step. Signed out, the first step offers **Continue with Google** (back to the wizard), a passkey the person already has, or **Create a passkey account** (name only). Then:

1. **Who's training**: **Me** (18 and over), one of their children at this academy, or **My child** / **Add another child** (name and birth date; under 18). A teen with their own login is asked to get a parent or guardian to enroll them. New students are made when the request is sent, as `lead` clients with the sender's family access (`self` or `guardian`, checked by `checkFamilyAccess`); students already linked are reused. A program's ages outside the range only warn.
2. **Level and uniform** (when the tier asks): the 1.0 to 5.5 self-rating scale with a plain-language hint per level, or **Not sure**; the training shirt size (kids' and adults' sizes).
3. **Contact and safety**: a mobile number (and an email for passkey-only accounts), health notes, an emergency contact, and for juniors who else may pick them up (`authorized_pickup`).
4. **When**, by the tier's mode: month-end tiers pick this month or next (with the computed expiry and "best to enroll early in the month"), single-session tiers of a program (trials) pick an upcoming session with places left, and other tiers a start date (up to 90 days ahead).
5. **Consents**: the active required documents that apply (under-18 documents only for minors) and aren't signed in their current version yet. Each is read in a scrolling panel and ticked "I've read and agree"; one typed full name signs them (a parent for a minor, adults for themselves). Signatures are saved with the request, in the same batch.
6. **Check and send**: price, schedule, what's included, validity, and the answers. The confirmation says what happens next (the academy reviews it, then the family pays by its instructions) and opens the portal, where the request shows its status.

The server checks everything again: the academy must be listed, the tier public and for sale, and new students need **Take enrollment requests** on (409 `enrollment_closed`; students already training here can still enroll and renew); a teen's own login answers 403 `ask_guardian`, an under-18 "me" 403 `minor_self`, an adult "child" 403 `not_a_minor`; a session must be upcoming with room (409 `session_full`); the tier's questions must be answered; consents must match their current versions (409 `consents_required`, `consent_changed`); and the same student, tier, and period can't be asked for twice while open, or again once approved (409 `duplicate_request`, `already_enrolled`). Every request is written to the audit log.

**The inbox** (**Enrollments** in the rail and on More, owners and admins, capability `enrollment`; coaches get 403 and no entry) lists requests by status, newest first, with a badge counting those waiting. A request's page shows the student (new, with people already on the books who may be the same person, or existing), who sent it and how they're related, the tier and program, the month or session, the answers, pickups, the consents signed with it, room in the program (or on the session), and the payment (not charged yet, then the charge and what's paid). Its actions:

- **Approve** sells the tier through the same sale as Packages (price from the tier, `startMonth` and expiry by mode, the uniform size, the charge), adds the student to the program from the start of the period (month and date modes) or books the chosen session, makes the student active with their answers on file, saves the self-rating (source `self`; not again on renewals), and marks the request approved, all in one D1 batch whose first statement claims the request, so approving twice never sells twice. The month or session can be changed when the asked one passed or filled; a full program only warns, and a full session needs "Book one over the limit".
- **Waitlist**, with an optional note the family sees, to approve later.
- **Decline**, with the reason the family sees.
- For a new student: **This is <name> who already trains here** approves onto that existing record instead, after a confirmation that the sender will see that student's record in their portal. The request, its signatures, pickups, and the family's access move to the existing student, and the empty lead is deleted.

**Renewals.** When a student's month-end package ends this month and nothing covers next month, the portal shows **Renew for next month**: one tap sends a request for the same tier for next month with the previous answers (any form to sign again comes first). Renewals work while the academy isn't taking new students. Staff see **Not yet renewed** in the inbox (the student, the tier, who to message, and **Copy reminder message**, text ready to paste with the portal link). Today shows owners and admins "N enrollment requests to review", and in the month's last week "N students haven't renewed".

| Endpoint | Does |
| --- | --- |
| `GET /api/public/academies/:slug/programs/:programId/sessions?from&to` | A public program's upcoming sessions: date, time, venue, court, and places left, never who's coming (60 a minute per IP address, on top of the public limit) |
| `GET /api/v1/enrollments?status=` | Requests in a status (`requested` by default, or `all`), newest first, with counts per status (`enrollment`) |
| `GET /api/v1/enrollments/count` | Requests waiting (the badge) |
| `GET /api/v1/enrollments/renewals` | Not yet renewed, with the portal link for the reminder |
| `GET /api/v1/enrollments/:id` | A request with everything needed to decide it, and `payment` once approved |
| `POST /api/v1/enrollments/:id/approve` | `{ startMonth?, lessonId?, startDate?, linkClientId?, force? }`; approving again answers the approved request |
| `POST /api/v1/enrollments/:id/waitlist` | `{ note? }` |
| `POST /api/v1/enrollments/:id/decline` | `{ reason }` |

### Payment proofs

Payment happens outside CoachMan (GCash, a bank transfer, cash); the family sends proof and the academy confirms it.

**The family** opens **Pay** (`/my/<student>/pay`) from an approved request's **Pay** button (on Home and Payments), from **To pay**, from the balance on Payments, or from **Send a payment proof** under How to pay. The screen shows what's due (that request's charge, or the student's balance), the academy's payment instructions with a copy button for each account or mobile number in them (runs of 8 to 24 digits; anything less clear stays plain text), its QR code, and the ways it takes payments (the academy's own names for them, set in Settings: "GCash", say). Then the proof:

- **Online**: the screenshot (JPEG, PNG, or WebP; a picture over 1.5 MB, or in another format such as HEIC, is redrawn on the phone as a JPEG until it fits, so typical screenshots and photos just work), the amount (the amount due, editable), how it was paid (one of the academy's methods), the reference number (optional, encouraged: GCash and bank apps show one), the date paid (today in the academy's time zone), and a note.
- **Cash at the court** (when the academy takes cash): no screenshot; the academy confirms it when the money is handed over.

Sending makes a proof waiting for review (`payment_submission`, `pending`), linked to the request it pays when it came from one. Payments lists every proof with its screenshot: **Pending review** (the person who sent it can **Withdraw** it), **Confirmed** (with what the academy recorded, if that differs), **Not accepted** with the academy's reason and **Send a new proof** (a new proof, linked to the refused one), **Withdrawn**, or **Payment voided**. A request's card says **Unpaid**, **Proof pending**, **Partly paid**, or **Paid**, and the reason when a proof wasn't accepted.

**Owners and admins** review on **Money → Payments to review** (oldest first; a badge on Money counts what's waiting), on a request's **Payment** card in Enrollments, and on the student's **Money** tab. Each proof shows the student, who sent it, the amount, method, reference, date, note, the screenshot (tap to open it large, at actual size, or in full in a new tab), what the student owes, and the request it pays. A **Possible duplicate** warning lists any other proof or recorded payment of the academy with the same reference number (compared without spaces, dashes, or case) or the same student, amount, and date (withdrawn proofs, voided payments, and the proof being resent are left out).

- **Confirm** records a real payment through the money service (the amount, method, date, and reference as sent, each editable when the screenshot shows otherwise, and a note pointing at the proof plus an optional note for staff), so allocations and balances follow the usual oldest-first rule; the proof is marked confirmed with who and when. The proof is claimed in the same D1 batch as the payment, so confirming twice (even at once) never records twice.
- **Not accepted** takes a reason the family reads (common reasons are one tap away).
- Voiding a payment a proof recorded marks the proof **Payment voided** (never "Confirmed" without a live payment); staff can **Confirm again** (a new payment) or mark it not accepted.

Every step is in the audit log (`submit`, `withdraw`, `confirm`, `reject`, `void` on `payment_submission`, and the payment's own `create`).

**Access.** Reviewing takes `enrollment` and confirming also `money` (owners and admins have both; coaches get 403 on every proof route and never see the badge). Screenshots are private: R2 keys `ws/<academy>/clients/<student>/payments/<uuid>.<ext>`, served to staff through `/api/v1/files` only with `money` or `enrollment`, and to families through `/api/portal/files` only when a proof of one of their linked students has exactly that key (both parents of a student see it; another family, a guessed key, or the public file route get 404). The family's answers never carry who reviewed a proof or the payment's internal note. The server checks everything again: an amount above zero, one of the academy's methods, a real date no later than a day after the academy's today and no more than a year back, a reference of 3 to 64 characters, a screenshot by its bytes (not its declared type) of at most 1.5 MB unless it's cash, the request approved and the student's own, and at most 10 proofs waiting per student; sending is limited to 30 an hour per person.

| Endpoint | Does |
| --- | --- |
| `GET /api/portal/students/:clientId/payment-proofs` | The student's proofs, newest first |
| `POST /api/portal/students/:clientId/payment-proofs` | Multipart: `data` (JSON: `{ id?, amountMinor, method, reference?, paidOn, note?, enrollmentId?, resubmitOf? }`) and `proof` (the screenshot); or JSON alone for cash. 201, or 200 for a retried send with the same `id` |
| `POST /api/portal/students/:clientId/payment-proofs/:id/withdraw` | The sender withdraws a waiting proof (403 for anyone else linked; 409 once reviewed) |
| `GET /api/v1/payment-proofs?status=` | `pending` (default), `confirmed`, `rejected`, `withdrawn`, `voided`, or `all`, with counts per status (`enrollment`) |
| `GET /api/v1/payment-proofs/count` | Proofs waiting (the badge) |
| `GET /api/v1/payment-proofs/:id` | One proof with its duplicates, the request it pays, and the payment it recorded |
| `POST /api/v1/payment-proofs/:id/confirm` | `{ amountMinor?, method?, paidOn?, reference?, note? }`: records the payment (`enrollment` and `money`); confirming again answers the confirmed proof |
| `POST /api/v1/payment-proofs/:id/reject` | `{ reason }` |
| `GET /api/v1/clients/:id/payment-proofs` | A student's proofs (their Money tab) |

### Kids' safety

Parents keep a junior's health details and pickup people up to date from the family portal's **Profile**, and coaches see them where they need them: at check-in. Who may change what lives in `src/shared/safety.ts`, shared by the Worker (which enforces it) and the app:

| Who | Medical note | Emergency contact | Parent's phone and email | Shirt size | Pickup people |
| --- | --- | --- | --- | --- | --- |
| A parent or guardian of a minor | ✓ | ✓ | ✓ | ✓ | ✓ |
| An adult student, for themselves | ✓ | ✓ | | ✓ | |
| A teen's own login, or a parent of a student who has turned 18 | reads | reads | reads | reads | reads |
| Staff (any role) | ✓ (the client form, as before) | ✓ | ✓ | reads | ✓ |

Pickup people apply to minors (under 18 by birth date, or marked junior without one), up to 10 per student, each with a name, relationship, phone, notes for the coach, and an optional photo. The parent's email on file is write-only in the portal: one guardian email serves every parent of a student, so a parent can replace it but never reads it back (the portal only says whether one is on file).

**Staff** read "Health and emergency details · Updated by Pat Santos (parent or guardian) on Nov 5, 2026" in a student's Details (whoever changed them last: a parent, the student, or staff), and a **Pickup** card on juniors' profiles where any staff role adds, edits, and removes people. At check-in (Today's roster and the session page), a player with a medical note has a coral **Medical** pill (the note, the parent's and emergency contact's numbers with **Call** buttons, and the profile), and a junior has a **Pickup** pill with the count (photos, relationship, notes, **Call**). Today's **Needs attention** shows "N juniors with medical notes" for the sessions in view, opening every note.

**Photos** are private R2 objects, `ws/<academy>/clients/<student>/pickups/<uuid>.<ext>` (JPEG, PNG, or WebP by their bytes, 1.5 MB at most; the app squares and shrinks them on the phone first). Staff of any role read them through `/api/v1/files`; families through `/api/portal/files` only when a pickup person of one of their linked students has exactly that key (another family, or a guessed key in the right folder, gets 404). Replacing a photo, removing the person, or deleting the student deletes the image.

**Audit.** `update` on `client_safety` (`{ fields, by }`) and `create`, `update`, `delete` on `authorized_pickup` (`{ clientId, fields, photo?, by }`), with who and when: field names only, never the medical text or any other value. Family edits are limited to 120 an hour per person.

| Endpoint | Does |
| --- | --- |
| `GET /api/v1/clients/:id/pickups` | A student's pickup people (any staff role; also in the client detail as `pickups`, with `safetyUpdate`) |
| `POST /api/v1/clients/:id/pickups` | Multipart `data` (JSON `{ name, relationship?, phone?, notes? }`) and `photo`, or JSON alone |
| `PATCH /api/v1/clients/:id/pickups/:pickupId` | Changes one (`removePhoto: true` drops the photo; a new `photo` replaces it) |
| `DELETE /api/v1/clients/:id/pickups/:pickupId` | Removes one, with the photo |

Roster entries (Today and a session's detail) carry `safety`: whether the player is a junior, the medical note, the parent's and emergency contact's names and phones, and (juniors) the pickup people. The family's own endpoints are in the family portal table above.

### Announcements

Owners and admins (`announcements`) post news from **Announcements** (`/announcements`, with tabs for Drafts, Scheduled, Live, and Expired): a title; a plain-text message (a blank line starts a paragraph and web addresses become links; HTML is shown as text); who it's for (everyone, a program's current members, or an event's registered players); **Pin to the top**; and when it goes live (now, at a time within the next year, or kept as a draft), with an optional end. Each card can be edited, unpublished (back to drafts), or deleted. Every staff role reads the live ones, on a card on Today and on the page; coaches get 403 for everything else.

Families see a live announcement when it reaches one of their linked students at that academy: `all` reaches every student, `program` the group's current members, `event` the players registered for it (not cancelled). Pinned ones come first, then the newest. A scheduled one appears once its time passes and an ended one disappears, both by the clock.

**Push hook.** `announcementPublished(ctx, announcement)` in `src/worker/services/announcements.ts` runs once for each announcement when it goes live: at once for **Publish now** (after the response, through `waitUntil`), and from the 5-minute cron for scheduled ones. `announcement.notified_at` is claimed with a guarded update, so it never runs twice, even after unpublishing and publishing again. It sends the families it reaches (`familyRecipients`) a push with the title and the message's first line, opening `/my/announcements` (see Family reminders).

| Endpoint | Does |
| --- | --- |
| `GET /api/v1/announcements?status=` | `live` (the default; every role), or `draft`, `scheduled`, `expired`, `all` (`announcements`), with counts per state |
| `GET /api/v1/announcements/:id` | One announcement (`announcements`) |
| `POST /api/v1/announcements` | `{ title, body, audience: "all" \| "program" \| "event", audienceId?, pinned?, publish: "now" \| "schedule" \| "draft", publishAt?, expiresAt? }` |
| `PATCH /api/v1/announcements/:id` | The same body; publishing a live one again keeps its time |
| `POST /api/v1/announcements/:id/unpublish` | Back to drafts: families stop seeing it |
| `DELETE /api/v1/announcements/:id` | Deletes it |

### Family reminders

Students and parents get push notifications on the phones and computers they turn them on for, from the portal's **Notifications** (`/my/notifications`). There's no email or text message fallback in this release.

**This device.** **Turn on** asks the browser's permission and subscribes it; then **Send a test notification** and **Turn off**. The card says how many devices get the person's reminders. On an iPhone or iPad in Safari that hasn't installed CoachMan, it shows the Add to Home Screen steps first (push needs the Home Screen app and iOS 16.4 or later); inside an in-app browser (Messenger, Facebook), on an older iOS, with notifications blocked, or on a browser without push, it explains why instead. Home offers it once after a family's first sign-in ("Get reminders on this phone", or "computer"), with **Set up reminders** and **Not now**; it's never shown again once dismissed or once the settings page is opened, and not on a device that already gets them.

**What they get** (each on by default, per person):

| Category | When |
| --- | --- |
| Sessions | Before each session a student is on (bookings and program sessions alike, as the portal's schedule counts them), 1 hour or 2 hours before, or at 7pm the evening before (academy time); "Session cancelled" when a session they were reminded of, or one within a day, is cancelled |
| Packages & renewals | "Renew for next month" once, from five days before the month ends, when a month-end package ends this month and isn't renewed; "1 session left" once per package; a days-valid package ending within three days, once |
| Enrollment & payments | An enrollment request approved (with "You have an amount due" when something is owed), waitlisted, or declined (the push only says it was updated; the reason is in the app); a payment proof confirmed or not accepted (the reason only in the app); a payment recorded from their proof voided; a reminder 2 and 5 days after approval while something is owed, never while a proof waits for review, and never after it's paid |
| Coach comments & progress | A coach shares a comment (new, or a coaches-only one switched to shared) or a skills assessment; edits don't notify again, and coaches-only and handoff notes never do |
| Announcements | Each one that reaches the family's students, when it goes live |

Everyone linked to a student hears about them: parents and guardians, a teen's own login, and an adult student. Money (renewing, payment outcomes, amounts due) goes to the payers: parents and guardians, and an adult student, not a teen's own login (unless the teen sent the payment proof). Revoked links hear nothing.

**Quiet hours** default to 21:00 to 07:00 in the academy's time zone and can be changed or switched off. What arrives in quiet hours waits in a queue until they end; session reminders are planned around them (a 1 or 2 hour reminder that would land in quiet hours comes as they end when that still leaves half the lead time, otherwise just before they start the evening before), and a cancellation of a session before quiet hours end (or within two hours after) comes at once.

**Privacy.** Pushes show on lock screens, so they carry first names only, never amounts ("You have an amount due"), never medical notes, comment text, or a decline or rejection reason, and never another family's details. Each opens its place in the portal (`/my/<student>/schedule`, `…/payments`, `…/progress`, `…/pay?request=`, `/my/announcements`, or `/my`), focusing an open window of the same app; staff pushes open the staff app.

**Batching.** When one person has several students' news of the same kind at once, it's one push ("2 sessions tomorrow", "Payment updates"), not one per student.

**Staff alerts.** Owners and admins get a push for each new enrollment request (or renewal) and each new payment proof to review, unless they turn off **Enrollments & payments** in **Settings → Notifications** (on by default). Coaches never get them, and the person who sent it doesn't either.

**When they're sent.** Event notifications go out right after the response (`executionCtx.waitUntil`), never holding up the request. The 5-minute cron delivers the quiet-hours queue, session reminders (48 hours ahead), and payment reminders; the daily maintenance (03:15 UTC) runs the renewal, one-session-left, and package-ending sweeps and clears old queue and test-sink rows.

**Devices.** Staff devices stay in `push_subscription` (per academy) and family devices are in `family_push_subscription` (per person, no academy needed). One browser can be in both: a coach who is also a parent turns each on from its own settings, and turning one off keeps the browser's subscription for the other and says so. Events both sides could hear about (a session they coach and their child plays in) share one `notification_log` key, so they get one push. A device the push service reports gone (404 or 410) is removed from both, a device moves to whoever turns it on last on a shared phone, and signing out removes this device's subscriptions.

**Sending a test.** Turn reminders on for the device, then press **Send a test notification**: in the portal's **Notifications** (family devices; `POST /api/portal/notifications/test`) or in the staff app's **Settings → Notifications** (staff devices; `POST /api/v1/push/test`). Web Push needs the `VAPID_*` secrets (see Environment variables); without them the page says push isn't set up. In tests, the push sink records the push instead of sending it (see Testing).

| Endpoint | Does |
| --- | --- |
| `GET`/`PUT /api/v1/notification-prefs` | The staff person's settings, now with `enrollmentAlerts` (on by default; the app shows it to owners and admins) |
| `GET /api/v1/push/device?endpoint=` | `{ staff, family }` for one device of the caller |
| `DELETE /api/v1/push/subscriptions` | `{ endpoint }`: answers `{ staff, family }`, what still uses the device |
| `DELETE /api/account/push-device` | `{ endpoint }`: signing out forgets this device for both |

The family's own endpoints are in the family portal table above.

### Public pages

`/about` (CoachMan's public home page: what it is, who it's for, what it does, and how to start), `/privacy`, and `/terms` need no sign-in. The Worker serves them (`assets.run_worker_first`) as the app shell with each page's own title, description, and link-preview tags, and the contact address in a JSON block (`#cm-public-config`; also `GET /api/public/config`). They don't register the service worker or ask for storage, but an installed app's cached shell still opens them offline. They're linked from sign-in, `/welcome`, `/join`, onboarding, the enrollment wizard (its sign-in and consent steps), the footer of every academy page, and Settings and More in both apps.

**The owner must review the privacy policy and the terms before publishing Google sign-in for everyone.** They were written in plain language from what the code does (`src/app/features/public-info/privacy.tsx` and `terms.tsx`, each starting with a review note); they're not legal advice. Update their "Last updated" date (November 5, 2026) when the text changes. The contact address is `PUBLIC_CONTACT_EMAIL` (`privacy@coachman.cloud` by default; see Environment variables).

For Google's consent screen (the **Branding** page): home page `https://coachman.cloud/about`, privacy policy `https://coachman.cloud/privacy`, terms of service `https://coachman.cloud/terms`.
## Suggested next steps

The academy release (roles, team invites, coach profiles and assignments, the family portal, the public academy page, enrollment, payment proofs, consents, kids' safety info, announcements, and family reminders) is being built in workstreams; see `PRODUCT.md`. After it:

1. **Online payments**: PayMongo or Xendit for GCash and Maya in the Philippines, with receipts.
2. **Booking private lessons** from coach availability, with substitutes.
3. **SMS, WhatsApp, or Viber reminders** for families who don't install apps.
4. **Coach pay reports**: sessions coached and commission per coach.
5. **Auto-fill waitlists** when a spot opens, and rescheduling suggestions after rain-outs.
6. **Video notes**: attach short clips to assessments and goals.
7. **DUPR sync** for ratings, and round-robin or ladder generators for clinics.
8. **More sports**: tennis, padel, and badminton rubrics (the rubric is already pluggable).
9. **Session plans from progress gaps**: suggest drills from the weakest skills in a group.

## Architecture

| Layer | Choice |
| --- | --- |
| Hosting | One Cloudflare Worker serves the SPA (static assets) and the API under `/api/*` |
| API | Hono, Zod validation, typed DTOs shared with the app (`src/shared`) |
| Data | Cloudflare D1 (SQLite) with Drizzle; R2 for client photos, payment proof screenshots and pickup people's photos (private), and academy images (logos, payment QR codes, coach photos) |
| Auth | Better Auth: Google OAuth plus passkeys (WebAuthn); staff roles per academy, and a separate family portal |
| Jobs | Cron triggers: scheduled announcements going live, staff reminders and digests, and family reminders (the quiet-hours queue, sessions, payments) every 5 minutes; maintenance daily (including removing abandoned passkey-only accounts, and the families' renewal, one-session-left, and package-ending sweeps) |
| App | React 19, Vite, TanStack Router and Query, React Aria Components, Tailwind CSS 4 |
| Offline | Workbox service worker, IndexedDB-persisted query cache, paused mutations resume on reconnect |

Credits are never stored as a counter. Each package's remaining credits are derived from an append-only ledger, so every number can be traced back to the check-ins, returns, and adjustments behind it. Attendance changes run as one atomic D1 batch with a version guard, and every offline mutation carries an idempotency key, so a replay never uses a second credit.

```
src/worker   Hono app, auth, routes, services (credits, money, lessons, push), cron
src/shared   domain vocabulary, Zod schemas, DTO types, money/time helpers, rubrics
src/app      React PWA (routes, features, UI kit), src/sw service worker
migrations   D1 SQL migrations (drizzle-kit)
test/unit    Vitest unit tests for the pure domain logic
e2e          Playwright tests against the real Worker + D1
```

## Local development

Prerequisites: Node 22+ and npm.

```bash
npm install
cp .dev.vars.example .dev.vars        # then fill in the values (see below)
npm run vapid:generate                # optional: paste the output into .dev.vars for push reminders
npm run db:migrate:local
npm run dev                           # http://localhost:5173
```

For Google sign-in locally, create an OAuth client (Web application) in Google Cloud Console and add the redirect URI `http://localhost:5173/api/auth/callback/google`. Passkeys work on `localhost` out of the box.

To look around without Google, onboarding can add sample clients, packages, groups, an event, and today's sessions. Remove them later in **Settings → App & data**.

### Database migrations

Migrations live in `migrations/` and are generated from `src/worker/db/schema.ts` by drizzle-kit:

```bash
npx drizzle-kit generate --name <what-changed>   # writes migrations/NNNN_<name>.sql and meta/
npm run db:migrate:local                         # apply to the local D1 (Miniflare)
```

Wrangler asks before applying; in scripts and on Windows PowerShell set `CI=1` to accept (`$env:CI='1'; npx wrangler d1 migrations apply DB --local`). Read every generated file before applying it: new columns on existing tables must be nullable or have a default, so the SQL stays `ALTER TABLE … ADD` and never rebuilds a table. `0001_academy` adds the academy tables and columns and ends with a hand-written, idempotent backfill: each workspace's owner becomes the lead coach of its sessions, series, groups, and events and the primary coach of its clients, and every member gets a coach profile. `0002_coaching` adds who set each goal (`goal.created_by`, backfilled with the owner) and an academy profile row for every workspace. `0003_offerings` adds `client_package.includes_uniform`, the `consent_document_version` table (the text of every signed version), and an index on consent signatures. `0004_enrollment` adds an index on `enrollment_request.requested_by` (the portal's and the cleanup's lookups). `0005_payment_proofs` adds `payment_submission.resubmit_of` (the refused proof a new one resends), a unique index on `payment_submission.proof_key` (the family's file reads look a proof up by its key), and indexes on its `payment_id` and `enrollment_id`. `0006_essentials` adds `announcement.notified_at` (when the publish hook ran) with an index for the cron, `client.safety_updated_at`/`safety_updated_by`/`safety_updated_relation` (the "Updated by" line), and a unique index on `authorized_pickup.photo_key`; its backfill marks announcements already live as announced. `0007_family_reminders` adds the families' notification settings (`family_notification_pref`, one row per person), their devices (`family_push_subscription`, per person, unique by endpoint), the quiet-hours queue (`family_notification_queue`, unique per person, kind, and item, indexed by when it's due), the test push sink (`push_sink`; see Testing), `notification_pref.enrollment_alerts` (default on), and an index on `enrollment_request (status, decided_at)` for payment reminders. Remote databases use `npm run db:migrate:staging` and `npm run db:migrate:production`.

### Environment variables

| Name | Kind | Purpose |
| --- | --- | --- |
| `APP_ENV` | var | `development`, `staging`, or `production` |
| `APP_URL` | var | Public origin, e.g. `https://coachman.cloud` (auth callbacks, passkey origin) |
| `PASSKEY_RP_ID` / `PASSKEY_RP_NAME` | var | WebAuthn relying party (the bare domain, e.g. `coachman.cloud`) |
| `PUBLIC_CONTACT_EMAIL` | var | Where people write about privacy, their data, or the terms; shown on `/about`, `/privacy`, and `/terms` (`privacy@coachman.cloud` in every environment; after changing it, run `npm run cf-typegen`) |
| `BETTER_AUTH_SECRET` | secret | 32+ random characters for session signing |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret | Google OAuth client |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | secret | Web Push keys from `npm run vapid:generate`; push is off when unset |
| `E2E_AUTH_BYPASS` / `E2E_BYPASS_SECRET` | secret, test only | Playwright sign-in bypass (see Testing). Never set in production |

Vars live in `wrangler.jsonc` per environment; secrets go in `.dev.vars` locally and `wrangler secret put <NAME> --env <env>` remotely.

## Testing

```bash
npm run lint          # Biome
npm run typecheck     # tsc -b (app, service worker, worker, tooling)
npm run test:unit     # Vitest: credits, allocation, recurrence, money/time, bypass gate, roles, redaction, tokens, age rules, invites (staff and family), passkey-only accounts and their cleanup, Google linking, portal DTOs and scoping, team rules, coach changes, notes, reminders, month-end validity and credit eligibility, consent versions and signers, public DTOs, link-preview tags, the enrollment state machine, modes and periods, renewal eligibility, who may enroll whom, duplicates, capacity, the payment proof state machine, proof checks and duplicate warnings, who may read a proof, a request's payment state, numbers to copy, who may change health details and pickup people, changed fields, who may read a pickup photo, announcement states, audiences, ordering, publishing rules, and links in the text, family notifications (who hears what, staff alerts, quiet hours, lead times, the evening before, session reminder timing, cancellations, payment reminders, renewal, one-session-left, and package-ending sweeps, batching, payloads without amounts, reasons, or health details, and the push sink's production guard)
npm run test:e2e      # Playwright: API golden paths, roles and routing, team and invites, family invites and age rules, the family portal and what it never shows, passkey-only accounts, coaching, Today check-in/undo, offline sync, passkeys, programs and tiers, consents, the public academy page, enrollment (wizard, inbox, renewals, passkey enrollment, access and leaks), payment proofs (pay, review, not accepted and resend, withdraw, cash, duplicates, double confirm, voided payments, access and leaks), kids' safety (portal edits, the roster's flags, photos, rights, audit), announcements (audiences, scheduling through the cron, expiry, unpublish, roles), family reminders (decisions, proofs, comments, assessments, announcements, sessions through the cron, cancellations, quiet hours, categories off, staff and family at once, staff alerts by role, the Notifications page and iPhone steps), the public pages (signed out, routing, link previews, links, offline), axe
```

### The Playwright auth bypass

Google OAuth can't be automated, so E2E tests sign in through a test-only endpoint. It is guarded three ways:

1. It's never registered when `APP_ENV=production`.
2. It needs `E2E_AUTH_BYPASS=1` and an `E2E_BYPASS_SECRET` of at least 16 characters on the Worker.
3. Every request must send the header `x-e2e-bypass: <secret>`, compared in constant time. Otherwise `/api/test/*` answers 404.

Playwright reads these environment variables:

| Name | Purpose |
| --- | --- |
| `E2E_BYPASS_SECRET` | Must equal the Worker's secret (falls back to `.dev.vars` locally) |
| `E2E_BASE_URL` | Target URL; when unset, Playwright starts or reuses `npm run dev` |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Service token headers when staging sits behind Cloudflare Access |
| `PW_CHANNEL` | Use an installed browser (`msedge`, `chrome`) instead of downloading Chromium |

Each test signs in as a brand-new coach with its own workspace, so tests run in parallel and don't touch real data. Passkey tests use Chromium's virtual authenticator, so the target origin must match `APP_URL`.

Tests that need more than one person use personas, each in its own browser context (`e2e/support.ts`: the `personas` fixture, `addMember`, `linkFamily`, `signIn`, `watchErrors`, `visit`). Persona contexts block the service worker, so each one doesn't precache the whole app. `watchErrors` collects page errors, console errors, and failed requests; `visit` is `page.goto` that retries when the local server drops the page request, and `Api` (and `portalCall`) send a read once more when a reused keep-alive connection was reset before any answer (writes are never resent). The bypass endpoints behind them:

| Endpoint | Does |
| --- | --- |
| `POST /api/test/sign-in { email, name, persona? }` | `persona: "coach"` (default) makes sure the user is staff somewhere, creating their own workspace if they aren't; `"none"` signs in a bare account (or an existing member or family user as they are) |
| `POST /api/test/member { email, name, role }` | Adds a user (created if new) to the caller's workspace as `owner`, `admin`, or `coach`, with a coach profile |
| `POST /api/test/family { clientId, email, name, relation, force? }` | Links a user (created if new) to one of the caller's students as `self` or `guardian`; the portal's age rules apply unless `force` |
| `POST /api/test/seed`, `POST /api/test/reset` | Sample data in the caller's workspace; deletes the workspaces the caller owns |
| `POST /api/test/expire-invite { inviteId }` | Makes one of the caller's academy's invites expire now (they otherwise last seven days) |
| `POST /api/test/audit` | The caller's academy's audit log, newest first |
| `POST /api/test/user-exists { userId }` | Whether an account still exists (abandoned passkey-only accounts are deleted) |
| `POST /api/test/cleanup-accounts { userId, hours }` | Ages a passkey-only account by `hours`, then runs the daily cleanup of abandoned ones |
| `POST /api/test/run-announcements { id? }` | Runs the 5-minute cron's announcements step now; with `id` (one of the caller's academy's scheduled announcements), its time is moved to a moment ago first. Answers which of the caller's announcements it announced, and the target's `notifiedAt` |
| `GET /api/test/push-sink?userId=` | The pushes the sink recorded for a person (oldest first: `endpoint`, `surface`, `payload`), and what waits for them in the quiet-hours queue |
| `DELETE /api/test/push-sink?userId=` | Clears a person's recorded pushes |
| `POST /api/test/run-reminders { at?, steps? }` | Runs the 5-minute cron's reminder steps as of `at` (default now): `staff`, `queue`, `sessions`, `payments` (all unless `steps` picks some) |
| `POST /api/test/run-family-sweeps { at? }` | Runs the daily renewal, one-session-left, and package-ending sweeps as of `at` |

**The push sink.** Push services can't be reached from tests, so outside production, with the bypass on (the same check as `isBypassEnabled`), a push subscription whose endpoint starts with `https://push-sink.invalid/` is never sent over the network: the Worker stores the payload in `push_sink` instead, read and cleared through the endpoints above (the daily maintenance deletes rows older than a day). In production, or without the bypass, such an endpoint is refused when registered and never delivered or stored (`src/worker/lib/push-sink.ts`, unit-tested). Push works with the sink even without VAPID keys, so tests don't need them.

Family and portal specs (`family`, `portal`, `portal-leaks`, `passkey-account`) also use `inviteToken`, `bornYearsAgo`, `acceptInvite`, `portalCall`/`portalGet`, `auditLog`, `pngImage`, and `uploadPng` from `e2e/support.ts`, and block the service worker for every context they open: each context's precache burst can stall the local server for the other worker. `portal-leaks.spec.ts` seeds every kind of private detail with a unique marker and checks that no portal answer or page contains one. The passkey-only account spec uses Chromium's virtual authenticator and runs on desktop only.

For the fastest, most realistic local run, test the production build: `npm run build`, then start `npx vite preview --port 5173` with `X_LOCAL_OBSERVABILITY=false` in one terminal (PowerShell: `$env:X_LOCAL_OBSERVABILITY='false'; npx vite preview --port 5173`) and `npx playwright test` in another (it reuses whatever serves :5173). That variable turns off Miniflare's local trace store: because `observability` is enabled in `wrangler.jsonc`, local runs record every request in `.wrangler/state/v3/observability`, which never shrinks and, once large, stalls the local runtime for seconds under test load. Servers Playwright starts itself get it automatically. Before the first test, `e2e/global-setup.ts` warms a local server (one signed-in round of reads and writes and one load of the app shell), because a freshly started workerd answers its first bursts slowly enough to time out the first tests; it skips remote targets (`E2E_BASE_URL`). On machines with little free memory, add `--workers=1`: local workerd can drop requests under memory pressure.

The WS4a specs (`offerings`, `consents`, `public-page`) also use `listAcademy` (a unique public address, listed), `shiftMonth`/`lastDayOfMonth`, `toggle` (flips a React Aria switch, checkbox, or radio by its label, which works inside scrolling sheets), and `submitSheet` (saves a sheet and, like `visit`, presses again if the local server dropped the request).

The enrollment specs (`enrollment`, `enrollment-renewal`, `enrollment-access`, `enrollment-passkey`, and the enrollment part of `a11y`) share `e2e/enroll-support.ts`: `openEnrollment` (lists a seeded academy with enrollment open and returns its program, its Trial, Monthly, and Monthly plus tiers, and this and next month), `addConsents`, `publicSessions`, `newChildBody`/`answersFor`/`sendOk`/`sendRequest` (requests straight to the portal API), and the wizard steps as a person drives them (`chooseNewChild`, `pickLevel`, `fillContact`, `continueTo`). The passkey enrollment spec uses Chromium's virtual authenticator and runs on desktop only.

The payment proof specs (`payment-proofs`, `payment-proofs-access`, and the proofs part of `a11y`) share `e2e/proof-support.ts`: `approvedEnrollment` (an academy with payment instructions and its own method names, a parent whose new child's Monthly request was approved: ₱6,000 to pay), `sendProof`/`sendProofOk` (multipart with a screenshot, or JSON for cash, straight to the portal API), `screenshot()` (a small PNG), and `noisePng(width, height)` (random pixels that don't compress: a picture over 1.5 MB the app must shrink before sending).

The WS5a specs: `kids-safety` (a parent edits a junior's health details and adds a pickup person with a photo in the portal; staff read "Updated by", a coach reads the roster's Medical and Pickup sheets and Today's count; another family gets 404 for the student and the photo; a teen reads but can't edit; an adult keeps their own; the audit names fields, never the text), `announcements` (an admin composes for everyone, a program, an event, and later; each family sees only theirs; the scheduled one goes live through `/api/test/run-announcements`; pinned order, expiry, unpublish, delete, another academy; a coach reads and gets 403 for the rest), and `public-info` (`/about`, `/privacy`, `/terms` signed out, `/` → `/about`, deep links → `/sign-in?next=`, the HTML's tags, the links, and the pages opening offline from the installed app's cache, which runs with the service worker on desktop only).

The WS5b spec, `family-reminders`, uses `e2e/push-support.ts`: `sinkEndpoint` (a unique `push-sink.invalid` endpoint), `subscribeFamily`/`subscribeStaff` (register a device through the portal or staff API), `setFamilyPrefs` (`ALL_ON`, with quiet hours off unless a test sets them), `pushes` (polls the sink until a matching push arrives: event pushes go out after the response), `sinkOf`, `runReminders` (the cron's reminder steps as of a time), `settle` (waits out pushes that should not come), `userIdOf`, and `localParts` (a time in the academy's zone). The API scenarios run on desktop only; the Notifications page runs on both, with a stand-in push subscription on desktop (persona contexts block the service worker) and an iPhone user agent for the Add to Home Screen steps.

`npm run screenshots` captures desktop (1440) and phone (390) screenshots into `.impeccable/review/` using the same bypass.

## Deploying to Cloudflare

### Current deployment

| | Production | Staging |
| --- | --- | --- |
| URL | https://coachman.cloud (`www.coachman.cloud` redirects here) | https://coachman-staging.jerrosyap05.workers.dev |
| Worker | `coachman` (custom domain; `workers.dev` off) | `coachman-staging` |
| D1 | `coachman` (APAC) | `coachman-staging` (APAC) |
| R2 | `coachman-files` (APAC) | `coachman-files-staging` (APAC) |
| Secrets set | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_*`, `VAPID_*` | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_*`, `VAPID_*` |

Google sign-in uses the Google Cloud project **CoachMan** (`coachman-512116`) and its web OAuth client "CoachMan web". The client's redirect URIs cover production (`https://coachman.cloud/api/auth/callback/google`), staging, and `http://localhost:5173` (local `.dev.vars` holds the same client), and `coachman.cloud` is listed under **Authorized domains** on the Branding page. The consent screen is External but still in **Testing**, so only listed test users can sign in (currently the owner, jerrosyap05@gmail.com; up to 100). To let any coach sign in: first have the privacy policy and terms reviewed (see Public pages), then on the **Branding** page set the application home page to `https://coachman.cloud/about`, the privacy policy link to `https://coachman.cloud/privacy`, and the terms of service link to `https://coachman.cloud/terms`, and use **Publish app** on the **Audience** page. The basic scopes CoachMan asks for (email, profile, openid) don't need Google verification. Until the brand is verified, though, Google's account chooser names the domain (`coachman.cloud` in production, `jerrosyap05.workers.dev` on staging) instead of "CoachMan". Google never shows a client secret again after creation; to rotate it, add a new secret on the client's page, then `npx wrangler secret put GOOGLE_CLIENT_SECRET --env <env>`, update `.dev.vars`, and disable the old secret.

GitHub deploys are wired up: the repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are set. The token is the Cloudflare user token "CoachMan GitHub deploy", scoped to this account: Workers Scripts, D1, and Workers R2 Storage edit, plus Account Settings and Workers Tail read and User Details read. Pushing to `main` deploys staging; the staging smoke test stays skipped until `STAGING_URL` and the bypass secrets are set. Before running a production deploy from Actions, add **Zone → Workers Routes → Edit** for `coachman.cloud` to that token: wrangler re-sends production's custom domain on every deploy, and Cloudflare requires that permission to add or change a custom domain. Staging doesn't need it.

Production runs on the Workers custom domain `coachman.cloud`. It's declared in `wrangler.jsonc` (a `routes` entry with `"custom_domain": true`), so `wrangler deploy` attaches it and Cloudflare manages its DNS record and certificate. The domain is registered at Hostinger and points at Cloudflare's nameservers; its zone is in the same Cloudflare account. Production's `workers.dev` address and version preview URLs are off. The Worker only answers on the bare domain: `www.coachman.cloud` has a proxied DNS record and a Cloudflare redirect rule (**Rules → Redirect Rules**, template "Redirect from WWW to root": 301, path and query string kept) that sends visitors to `https://coachman.cloud`. Staging stays on its free `workers.dev` address.

Passkeys are bound to `PASSKEY_RP_ID`, so passkeys created on the old production address (`coachman.jerrosyap05.workers.dev`) don't work on `coachman.cloud`. Coaches sign in with Google once, then add a new passkey in **Settings → Sign-in & security**. Sessions, the installed app, and push reminders from the old address don't carry over either, so coaches also reinstall the app from `https://coachman.cloud` and turn reminders back on in **Settings → Notifications**. Their data is unaffected (same D1 database). The test bypass is off on both environments (`E2E_*` secrets aren't set, and production ignores them anyway).

To rotate the app's own secrets (session signing key and Web Push keys) for an environment: `node scripts/set-app-secrets.mjs <staging|production> <contact email>`. Rotating `BETTER_AUTH_SECRET` signs everyone out; rotating the VAPID keys means devices turn reminders back on.

### Setting up from scratch

One-time setup:

1. `npx wrangler login`
2. Create the databases and buckets, then paste each `database_id` into `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create coachman-staging
   npx wrangler d1 create coachman
   npx wrangler r2 bucket create coachman-files-staging
   npx wrangler r2 bucket create coachman-files
   ```
3. Choose the domains, then set `APP_URL` and `PASSKEY_RP_ID` for each environment in `wrangler.jsonc` and add a custom domain to each Worker (a `routes` entry with `"custom_domain": true`, as production has; the domain's zone must already be active in the same Cloudflare account). **Passkeys are bound to `PASSKEY_RP_ID`.** Use the final production domain from day one; moving domains later means coaches re-add passkeys (Google sign-in keeps working).
4. In Google Cloud Console, add `https://<domain>/api/auth/callback/google` for each environment.
5. Set secrets for each environment:
   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET --env production
   npx wrangler secret put GOOGLE_CLIENT_ID --env production
   npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
   npx wrangler secret put VAPID_PUBLIC_KEY --env production
   npx wrangler secret put VAPID_PRIVATE_KEY --env production
   npx wrangler secret put VAPID_SUBJECT --env production
   ```
   On staging only, also set `E2E_AUTH_BYPASS=1` and `E2E_BYPASS_SECRET` to run the smoke tests. Consider putting staging behind Cloudflare Access with a service token for CI.

Deploy by hand:

```bash
npx wrangler d1 migrations apply DB --remote --env staging
npm run deploy:staging            # or deploy:production
```

GitHub Actions: `ci.yml` runs lint, typecheck, unit tests, build, and Playwright on every PR. `deploy.yml` deploys `main` to staging (then smoke-tests it) and production on manual dispatch. It needs the repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts, D1, and R2 edit, plus Zone → Workers Routes → Edit on the production domain), `CLOUDFLARE_ACCOUNT_ID`, and for smoke tests `STAGING_E2E_BYPASS_SECRET`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, plus the variable `STAGING_URL`.

## Design

The product brief is in `PRODUCT.md` and the design system in `DESIGN.md`. The visual direction follows a reference the owner picked (Microsoft Dynamics CRM concept by Jack R. for RonDesignLab, Dribbble): a black command panel with lime highlights beside a soft gray canvas of rounded white cards. Text on pastel colors is always near-black for contrast.
