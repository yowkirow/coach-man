# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Installable single-page PWA built with Vite and React (TypeScript). The API is Hono on Cloudflare Workers, with Cloudflare D1 (SQLite, via Drizzle) for data and R2 for files. Better Auth handles Google sign-in and passkeys. The whole app is hosted on Cloudflare as one Worker that serves both the app and the API. The user chose Cloudflare and accepted the recommended setup.

## Users

Independent pickleball coaches, each working in their own private workspace. They use CoachMan in two settings:

- **On court, on a phone:** checking players in, deducting package credits, and jotting quick notes between and during sessions. Reception is often poor.
- **At a desk, on a laptop:** scheduling, billing, packages, and running events like summer camps, academies, and clinics.

Clients (players and parents) do not sign in to v1.

## Product Purpose

CoachMan, short for "coach manager", is where a coach keeps everything about their coaching business:

- clients and their progress
- rates and packages
- groups
- events such as summer camps and academies
- schedule and attendance, which deduct package credits automatically
- payments and outstanding balances

Success means a coach can run a full week of lessons, clinics, and camps without spreadsheets or paper. Every credit and every peso, dollar, or other unit can be explained.

## Positioning

*Inferred from the brief; confirm.* CoachMan is coach-first, not facility- or court-booking-first. It is built around the on-court moment: check in, use a credit, add a note. That moment keeps working offline.

## Operating Context

- Outdoor courts in bright sun and indoor facilities with weak signal. Sessions run back to back.
- One-handed phone use between games; laptop sessions for admin.
- Lessons are private, semi-private, or group, plus clinics. Group classes recur weekly. Packages hold a number of sessions and expire after a validity period.
- Seasonal programs include summer camps, academies, clinics, tournaments, and socials.
- Payments are recorded by hand in whatever methods the coach accepts (configurable per workspace).

## Capabilities and Constraints

- **Sign-in:** coaches create accounts with Google, then add a passkey during onboarding. Passkey or Google works after that. Passkey-only sign-up is deferred until email verification exists.
- **Tenancy:** each coach has a private workspace. The data model already supports organizations, so multi-coach academies and a client portal can come later.
- **Offline:** the app is installable. Today's schedule and client information can be read offline. Check-ins and notes queue offline and sync exactly once when back online.
- **v1 features:**
  - clients
  - progress (skill rubric assessments, goals, rating history, notes)
  - rates
  - packages with a credit ledger
  - groups
  - events and programs with registrations and a waitlist
  - schedule and attendance with automatic credit deduction
  - payments and balances
  - Today dashboard
  - push reminders
  - CSV import/export
- **Sport:** pickleball first. The model is sport-agnostic underneath, for other sports later.
- **No assumed market:** currency, timezone, locale, and payment-method names are per-workspace settings.
- **Not in v1:** client portal, online payments, multi-coach academies, e-signed waivers, email/SMS reminders, calendar sync, video notes, round-robin generator, drill library, public event sign-up pages.

## Brand Commitments

- Name: **CoachMan**, short for "coach manager".
- Pickleball is the launch sport; the name and product must still work when other sports are added.
- Visual register: **pinned by the user to a reference**: Dribbble shot "Microsoft Dynamics CRM – Lead Relationship Management Platform" by Jack R. for RonDesignLab (https://dribbble.com/shots/23069967). That means:
  - a black rounded panel holding an icon rail and a dark list column (KPI tiles, dark list cards, the selected card in lime)
  - a soft gray canvas with white rounded cards
  - large light-weight headings
  - lime circular action buttons, pill tabs, pastel status pills, a timeline, and lavender and lime "bento" cards

  This replaced two earlier attempts the user rejected: the themed "Court Lines" build, and a "clean and light" plan.

## Evidence on Hand

None yet: no logo, brand assets, customers, testimonials, or metrics. Future work must not invent them. Demo data must be labeled synthetic.

## Product Principles

1. The on-court moment comes first: fast, one-handed, and it works without signal.
2. Credits and money are always explainable, through an append-only ledger and clear paid/unpaid states.
3. The coach owns their data: import from spreadsheets, export everything, anytime.
4. Pickleball-native on the surface, sport-agnostic underneath.
