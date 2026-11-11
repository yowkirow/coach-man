# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Installable single-page PWA built with Vite and React (TypeScript). The API is Hono on Cloudflare Workers, with Cloudflare D1 (SQLite, via Drizzle) for data and R2 for files. Better Auth handles Google sign-in, passkeys, and sign-in codes by email. The whole app is hosted on Cloudflare as one Worker that serves both the app and the API. The user chose Cloudflare and accepted the recommended setup.

## Users

CoachMan serves pickleball **academies**: a team of coaches under one owner, with the players they train and the parents of junior players. A solo coach is a one-person academy. The first academy is The Pickle Spot Academy.

- **Owners and admins** run the academy: the team, the rate card and packages, programs and events, money, enrollment, and academy settings. Mostly at a desk, on a laptop.
- **Front desk** staff handle the academy's day to day: payments, check-in, the schedule, enrollments, and family invites. They don't coach (of a student's progress, they see what the family sees), and don't change prices, settings, or the team.
- **Coaches** run sessions. On court, on a phone: checking players in, using package credits, jotting quick notes between and during sessions, often with poor reception. They see every academy student and their progress, but no money.
- **Students** (adults, and teens 13–17 once a parent is linked) and **parents** of junior players see their own training: sessions, progress, coaches' shared comments, and what they owe. Phone first.

## Product Purpose

CoachMan, short for "coach manager", is where an academy keeps everything about its coaching:

- students and their progress
- rates and packages
- programs (groups) and events such as summer camps and clinics
- schedule and attendance, which deduct package credits automatically
- payments and outstanding balances
- the family portal, where students and parents follow their own training and enroll

Success means an academy can run a full week of lessons, clinics, and camps without spreadsheets or paper, a coach can pick up any student's progress where another coach left off, and every credit and every peso, dollar, or other unit can be explained.

## Positioning

*Inferred from the brief; confirm.* CoachMan is coach-first, not facility- or court-booking-first. It is built around the on-court moment: check in, use a credit, add a note. That moment keeps working offline. Academies add structure around it (roles, programs, enrollment, a family portal) without slowing it down.

## Operating Context

- Outdoor courts in bright sun and indoor facilities with weak signal. Sessions run back to back.
- One-handed phone use between games; laptop sessions for admin.
- Lessons are private, semi-private, or group, plus clinics. Programs run a fixed weekly schedule at a venue. Packages hold a number of sessions and expire after a number of days or at the end of the month.
- Seasonal programs include summer camps, academies, clinics, tournaments, and socials.
- Payment happens outside the app (GCash, bank transfer, cash). Families upload a screenshot as proof and staff confirm it. Payment methods are configurable per academy.
- Families are reached on Messenger, Viber, or SMS, and by email for invites, enrollment, and payments: CoachMan emails invite links, and staff can share them too.

## Capabilities and Constraints

- **Roles:** owner, admin, front desk, and coach. One shared capability map (`src/shared/roles.ts`) decides what each may do; the API enforces it on every route and the app hides what a role can't use. Coaches see credits (they need them at check-in) but no prices, payments, charges, balances, or revenue. The front desk handles money, enrollments, and family access, never the rate card, settings, the team, data, or announcements, and doesn't coach: it's never anyone's coach, in coach pickers, or on the team page or public site.
- **Sign-in:** Google, passkey, or a code sent by email. Codes only go to addresses CoachMan already knows (an account's, or one an invite lets in), so staff with any email address can join through a staff invite, not only Gmail. Coaches set up an academy themselves or join through a staff invite. Families arrive through an invite link or the academy's public page; a family member who never uses Google can sign in with a code, or get a passkey-only account, which can link Google later. Nobody gets an academy just by signing in.
- **Tenancy:** each academy is a private workspace. Staff of more than one academy switch between them. The family portal has its own API that only ever returns the students a person is linked to.
- **Offline:** the app is installable. Today's schedule and client information can be read offline. Check-ins and notes queue offline and sync exactly once when back online.
- **In scope:**
  - clients, progress (skill rubric assessments, goals, rating history, notes), rates, packages with a credit ledger, programs and events with registrations and a waitlist, schedule and attendance with automatic credit deduction, payments and balances, the Today dashboard, push reminders, CSV import/export
  - staff roles and invites, coach profiles, primary and assistant coaches per student, and attributed coach comments with a share toggle
  - the family portal, a public academy page with a printable rates sheet, enrollment requests that staff approve, and manual payment proofs
  - consents and waivers (including Data Privacy Act RA 10173 and parental consent), medical and emergency info, authorized pickup people, announcements, and family reminders
  - transactional email through Cloudflare: invite links, sign-in codes, enrollment and payment updates to families, and new requests and proofs to staff, never with amounts or health details
- **Sport:** pickleball first. The model is sport-agnostic underneath, for other sports later.
- **No assumed market:** currency, timezone, locale, and payment-method names are per-academy settings.
- **Not in this release:** online checkout (PayMongo), booking private lessons from coach availability, coach pay reports, email or SMS reminders, calendar sync, video notes, round-robin generator, drill library.

## Brand Commitments

- Name: **CoachMan**, short for "coach manager".
- Pickleball is the launch sport; the name and product must still work when other sports are added.
- An academy brings its own name and logo to its family portal, and its public website wears its own identity: the club's colors, with CoachMan only as a small "Made with CoachMan" credit. The CoachMan app and portal themselves are never recolored.
- Visual register: **pinned by the user to a reference**: Dribbble shot "Microsoft Dynamics CRM – Lead Relationship Management Platform" by Jack R. for RonDesignLab (https://dribbble.com/shots/23069967). That means:
  - a black rounded panel holding an icon rail and a dark list column (KPI tiles, dark list cards, the selected card in lime)
  - a soft gray canvas with white rounded cards
  - large light-weight headings
  - lime circular action buttons, pill tabs, pastel status pills, a timeline, and lavender and lime "bento" cards

  This replaced two earlier attempts the user rejected: the themed "Court Lines" build, and a "clean and light" plan.

## Evidence on Hand

No logo, brand assets, customers, testimonials, or metrics beyond what an academy enters itself. The Pickle Spot Academy is the first academy to use CoachMan; that is a fact, not an endorsement. Future work must not invent claims. Demo data must be labeled synthetic and use neutral names.

## Product Principles

1. The on-court moment comes first: fast, one-handed, and it works without signal.
2. Credits and money are always explainable, through an append-only ledger and clear paid/unpaid states.
3. Each role sees what its work needs. Coaches see every student's progress and credits, never money; families see only their own students.
4. Privacy for minors by default. Parents always have access to their children's training; teens get their own login only when linked to a parent; children under 13 never have their own login. Coaches' comments stay among coaches unless a coach shares them.
5. The academy owns its data: import from spreadsheets, export everything, anytime.
6. Pickleball-native on the surface, sport-agnostic underneath.
