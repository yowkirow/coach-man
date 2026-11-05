# CoachMan

CoachMan (short for *coach manager*) is an installable web app for pickleball academies and independent coaches: clients, progress, rates and packages, groups, events like summer camps and academies, the schedule, and the money. Each academy is a private workspace with its own team of owners, admins, and coaches; a solo coach is a one-person academy. Students and parents get their own family portal. It works on court from a phone (even offline) and at a desk on a laptop.

## What's in v1

- **Today**: the session on court now, one-tap check-in with undo, credits that count themselves down, and what needs attention (low credits, expiring packages, balances due, birthdays).
- **Schedule**: one-off and weekly recurring sessions (private, semi-private, group, clinic, event), edit "this" or "this and following", cancel with automatic credit returns, rain-outs for a whole day.
- **Clients**: profiles with contact, guardian and emergency details for juniors, groups, tags, photos, and a full activity timeline.
- **Progress**: a skill rubric per sport (pickleball built in), fixed-scale assessments, goals, DUPR/coach ratings, and notes.
- **Packages and rates**: a rate card, credit packages with validity, earliest-expiry-first usage, an auditable credit ledger, and manual adjustments.
- **Groups and events**: classes with members and weekly series; camps, academies, clinics, tournaments, and socials with registrations, a waitlist, early-bird pricing, and their own sessions.
- **Money**: charges and payments (cash, transfer, card, e-wallet), oldest-first allocation, balances, monthly summaries, and CSV exports.
- **Sign-in**: Google creates the account; passkeys give one-tap sign-in afterwards.
- **PWA**: installable, offline reads, offline-queued check-ins and notes that sync with idempotency keys, push reminders and a daily digest.
- **Import**: bring clients over from a spreadsheet (CSV with column mapping, preview, and duplicate detection).

## Academies

### Roles

Every member of an academy has one staff role. What each role may do lives in one capability map, `src/shared/roles.ts`, shared by the Worker (which enforces it) and the app (which hides what a role can't use):

| Capability | Owner | Admin | Coach |
| --- | --- | --- | --- |
| Clients, progress, notes, schedule, sessions, check-in, group members, event rosters, credits | ✓ | ✓ | ✓ |
| `money`: prices, payments, charges, balances, revenue, selling and changing packages | ✓ | ✓ | |
| `catalog`: rates, package templates, programs (groups), events | ✓ | ✓ | |
| `settings`: academy settings, payment methods, venues, the rubric | ✓ | ✓ | |
| `data`: CSV import and export, sample data, deleting clients | ✓ | ✓ | |
| `team`, `enrollment`, `familyAccess`, `announcements` | ✓ | ✓ | |
| `ownership`: delete the academy, transfer ownership | ✓ | | |

Coaches never receive money from the API: money-only routes answer 403, and every other `/api/v1` response is passed through a redactor that removes every `*Minor` amount (and empties Today's list of who owes). Coaches still check players in; pay-per-session and event charges happen at catalog prices, but setting a price (a session's price, a registration's price, "no charge") is for owners and admins. Better Auth's legacy `member` role counts as coach.

### Accounts and routing

Nobody gets an academy just by signing in. After sign-in:

- **Staff** (a member of at least one academy) land in the staff app. Staff of more than one academy switch between them in Settings or More.
- **Families** (a student or parent linked to a student) land in the family portal at `/my`.
- **Everyone else** lands on `/welcome`: "Set up CoachMan for my coaching or academy" creates their own workspace and continues to onboarding; students and parents are pointed to their academy's invite link or page.

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
| `GET /api/invites/:token` | Public preview: academy name and logo, role, and whether the link still works |
| `POST /api/invites/:token/accept` | Signed in: joins the academy (staff invites; family invites arrive with the portal) |

Both `/api/invites` routes are rate-limited per IP address.

### Coach profiles

Every staff member has a coach profile (Settings → **My coach profile**): the name shown, title, about, photo, certifications, DUPR rating, specialties, languages, years coaching, and whether it may appear on the academy page. Owners and admins edit anyone's from Team. Coaches' names and photos appear on their notes, assessments, goals, students, sessions, programs, and events, including after they leave the team. Endpoints: `GET /api/v1/coaches` (the team as coach pickers need it), `GET`/`PATCH /api/v1/coaches/:userId` and `PUT`/`DELETE /api/v1/coaches/:userId/photo` (yourself, or anyone with `team`).

### Coach assignment

- **Students** have a primary coach and any number of assistant coaches, changed from the Coaches card on their profile by any coach (`PUT /api/v1/clients/:id/coaches`). Changes never overwrite: the old assignment ends today and a new one starts, so "Earlier coaches" shows who coached them and when. Whoever adds a student is their primary coach unless they pick someone else.
- **Sessions, weekly series, groups, and events** have a lead coach and assistants, picked in their create and edit sheets. A new session is led by whoever schedules it, unless its group or event names a lead. Weekly series copy their coaches into every session they add. Changing coaches with "this and following" changes the series and the sessions ahead; sessions already held keep the coaches who ran them. Changing a group's or event's coaches applies to sessions added afterwards.
- **Filters:** Clients has "My students"; Today and Schedule have "Mine / Everyone" (coaches start on Mine, owners and admins on Everyone; the choice is remembered on the device). A one-person academy doesn't see these.
- **Reminders** go to a session's lead and assistant coaches; a session with no coach on the team goes to the owners and admins. Owners and admins get the academy-wide daily digest; coaches get one about their own sessions and students.

### Coach comments

Notes on a student show who wrote them and when. They're for coaches only unless the author turns on **Share with student & parents**, which says plainly who will see the note (the family portal shows only shared notes). Only the author changes a note's words or sharing (the note is then marked edited); the author, an owner, or an admin may delete it. When a student's primary coach changes, the app offers to write a **handoff note**, which is always coaches only, whatever the request asks. The Progress tab's coaching timeline puts every coach's notes, assessments, and goals in one list, with a filter by coach. Assessments are shared with the family by default; a "Visible to student & parents" switch holds one back.

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
| Data | Cloudflare D1 (SQLite) with Drizzle; R2 for client photos and academy images (logos, payment QR codes, coach photos) |
| Auth | Better Auth: Google OAuth plus passkeys (WebAuthn); staff roles per academy, and a separate family portal |
| Jobs | Cron triggers: reminders and digests every 5 minutes, maintenance daily |
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

Wrangler asks before applying; in scripts and on Windows PowerShell set `CI=1` to accept (`$env:CI='1'; npx wrangler d1 migrations apply DB --local`). Read every generated file before applying it: new columns on existing tables must be nullable or have a default, so the SQL stays `ALTER TABLE … ADD` and never rebuilds a table. `0001_academy` adds the academy tables and columns and ends with a hand-written, idempotent backfill: each workspace's owner becomes the lead coach of its sessions, series, groups, and events and the primary coach of its clients, and every member gets a coach profile. `0002_coaching` adds who set each goal (`goal.created_by`, backfilled with the owner) and an academy profile row for every workspace. Remote databases use `npm run db:migrate:staging` and `npm run db:migrate:production`.

### Environment variables

| Name | Kind | Purpose |
| --- | --- | --- |
| `APP_ENV` | var | `development`, `staging`, or `production` |
| `APP_URL` | var | Public origin, e.g. `https://coachman.cloud` (auth callbacks, passkey origin) |
| `PASSKEY_RP_ID` / `PASSKEY_RP_NAME` | var | WebAuthn relying party (the bare domain, e.g. `coachman.cloud`) |
| `BETTER_AUTH_SECRET` | secret | 32+ random characters for session signing |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret | Google OAuth client |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | secret | Web Push keys from `npm run vapid:generate`; push is off when unset |
| `E2E_AUTH_BYPASS` / `E2E_BYPASS_SECRET` | secret, test only | Playwright sign-in bypass (see Testing). Never set in production |

Vars live in `wrangler.jsonc` per environment; secrets go in `.dev.vars` locally and `wrangler secret put <NAME> --env <env>` remotely.

## Testing

```bash
npm run lint          # Biome
npm run typecheck     # tsc -b (app, service worker, worker, tooling)
npm run test:unit     # Vitest: credits, allocation, recurrence, money/time, bypass gate, roles, redaction, tokens, age rules, invites, team rules, coach changes, notes, reminders
npm run test:e2e      # Playwright: API golden paths, roles and routing, team and invites, coaching, Today check-in/undo, offline sync, passkeys, axe
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

Tests that need more than one person use personas, each in its own browser context (`e2e/support.ts`: the `personas` fixture, `addMember`, `linkFamily`, `signIn`, `watchErrors`, `visit`). Persona contexts block the service worker, so each one doesn't precache the whole app. `watchErrors` collects page errors, console errors, and failed requests; `visit` is `page.goto` that retries when the local server drops the page request. The bypass endpoints behind them:

| Endpoint | Does |
| --- | --- |
| `POST /api/test/sign-in { email, name, persona? }` | `persona: "coach"` (default) makes sure the user is staff somewhere, creating their own workspace if they aren't; `"none"` signs in a bare account (or an existing member or family user as they are) |
| `POST /api/test/member { email, name, role }` | Adds a user (created if new) to the caller's workspace as `owner`, `admin`, or `coach`, with a coach profile |
| `POST /api/test/family { clientId, email, name, relation, force? }` | Links a user (created if new) to one of the caller's students as `self` or `guardian`; the portal's age rules apply unless `force` |
| `POST /api/test/seed`, `POST /api/test/reset` | Sample data in the caller's workspace; deletes the workspaces the caller owns |
| `POST /api/test/expire-invite { inviteId }` | Makes one of the caller's academy's invites expire now (they otherwise last seven days) |

For the fastest, most realistic local run, test the production build: `npm run build`, then start `npx vite preview --port 5173` with `X_LOCAL_OBSERVABILITY=false` in one terminal (PowerShell: `$env:X_LOCAL_OBSERVABILITY='false'; npx vite preview --port 5173`) and `npx playwright test` in another (it reuses whatever serves :5173). That variable turns off Miniflare's local trace store: because `observability` is enabled in `wrangler.jsonc`, local runs record every request in `.wrangler/state/v3/observability`, which never shrinks and, once large, stalls the local runtime for seconds under test load. Servers Playwright starts itself get it automatically. Before the first test, `e2e/global-setup.ts` warms a local server (one signed-in round of reads and writes and one load of the app shell), because a freshly started workerd answers its first bursts slowly enough to time out the first tests; it skips remote targets (`E2E_BASE_URL`). On machines with little free memory, add `--workers=1`: local workerd can drop requests under memory pressure.

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

Google sign-in uses the Google Cloud project **CoachMan** (`coachman-512116`) and its web OAuth client "CoachMan web". The client's redirect URIs cover production (`https://coachman.cloud/api/auth/callback/google`), staging, and `http://localhost:5173` (local `.dev.vars` holds the same client), and `coachman.cloud` is listed under **Authorized domains** on the Branding page. The consent screen is External but still in **Testing**, so only listed test users can sign in (currently the owner, jerrosyap05@gmail.com; up to 100). To let any coach sign in, add a home page and privacy policy link on the Branding page, then use **Publish app** on the Audience page. The basic scopes CoachMan asks for (email, profile, openid) don't need Google verification. Until the brand is verified, though, Google's account chooser names the domain (`coachman.cloud` in production, `jerrosyap05.workers.dev` on staging) instead of "CoachMan". Google never shows a client secret again after creation; to rotate it, add a new secret on the client's page, then `npx wrangler secret put GOOGLE_CLIENT_SECRET --env <env>`, update `.dev.vars`, and disable the old secret.

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
