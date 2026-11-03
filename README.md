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
| Data | Cloudflare D1 (SQLite) with Drizzle; R2 for client photos |
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

Wrangler asks before applying; in scripts and on Windows PowerShell set `CI=1` to accept (`$env:CI='1'; npx wrangler d1 migrations apply DB --local`). Read every generated file before applying it: new columns on existing tables must be nullable or have a default, so the SQL stays `ALTER TABLE … ADD` and never rebuilds a table. `0001_academy` adds the academy tables and columns and ends with a hand-written, idempotent backfill: each workspace's owner becomes the lead coach of its sessions, series, groups, and events and the primary coach of its clients, and every member gets a coach profile. Remote databases use `npm run db:migrate:staging` and `npm run db:migrate:production`.

### Environment variables

| Name | Kind | Purpose |
| --- | --- | --- |
| `APP_ENV` | var | `development`, `staging`, or `production` |
| `APP_URL` | var | Public origin, e.g. `https://coachman.example` (auth callbacks, passkey origin) |
| `PASSKEY_RP_ID` / `PASSKEY_RP_NAME` | var | WebAuthn relying party (the bare domain, e.g. `coachman.example`) |
| `BETTER_AUTH_SECRET` | secret | 32+ random characters for session signing |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret | Google OAuth client |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | secret | Web Push keys from `npm run vapid:generate`; push is off when unset |
| `E2E_AUTH_BYPASS` / `E2E_BYPASS_SECRET` | secret, test only | Playwright sign-in bypass (see Testing). Never set in production |

Vars live in `wrangler.jsonc` per environment; secrets go in `.dev.vars` locally and `wrangler secret put <NAME> --env <env>` remotely.

## Testing

```bash
npm run lint          # Biome
npm run typecheck     # tsc -b (app, service worker, worker, tooling)
npm run test:unit     # Vitest: credits, allocation, recurrence, money/time, bypass gate, roles, redaction, tokens, age rules
npm run test:e2e      # Playwright: API golden paths, roles and routing, Today check-in/undo, offline sync, passkeys, axe
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

For the fastest, most realistic local run, test the production build: `npm run build`, then start `npx vite preview --port 5173` with `X_LOCAL_OBSERVABILITY=false` in one terminal (PowerShell: `$env:X_LOCAL_OBSERVABILITY='false'; npx vite preview --port 5173`) and `npx playwright test` in another (it reuses whatever serves :5173). That variable turns off Miniflare's local trace store: because `observability` is enabled in `wrangler.jsonc`, local runs record every request in `.wrangler/state/v3/observability`, which never shrinks and, once large, stalls the local runtime for seconds under test load. Servers Playwright starts itself get it automatically. On machines with little free memory, add `--workers=1`: local workerd can drop requests under memory pressure.

`npm run screenshots` captures desktop (1440) and phone (390) screenshots into `.impeccable/review/` using the same bypass.

## Deploying to Cloudflare

### Current deployment

| | Production | Staging |
| --- | --- | --- |
| URL | https://coachman.jerrosyap05.workers.dev | https://coachman-staging.jerrosyap05.workers.dev |
| Worker | `coachman` | `coachman-staging` |
| D1 | `coachman` (APAC) | `coachman-staging` (APAC) |
| R2 | `coachman-files` (APAC) | `coachman-files-staging` (APAC) |
| Secrets set | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_*`, `VAPID_*` | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_*`, `VAPID_*` |

Google sign-in uses the Google Cloud project **CoachMan** (`coachman-512116`) and its web OAuth client "CoachMan web". The client's redirect URIs cover production, staging, and `http://localhost:5173` (local `.dev.vars` holds the same client). The consent screen is External but still in **Testing**, so only listed test users can sign in (currently the owner, jerrosyap05@gmail.com; up to 100). To let any coach sign in, add a home page and privacy policy link on the Branding page, then use **Publish app** on the Audience page. The basic scopes CoachMan asks for (email, profile, openid) don't need Google verification. Until the brand is verified, though, Google's account chooser names the domain (`jerrosyap05.workers.dev`) instead of "CoachMan". Google never shows a client secret again after creation; to rotate it, add a new secret on the client's page, then `npx wrangler secret put GOOGLE_CLIENT_SECRET --env <env>`, update `.dev.vars`, and disable the old secret.

GitHub deploys are wired up: the repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are set. The token is the Cloudflare user token "CoachMan GitHub deploy", scoped to this account: Workers Scripts, D1, and Workers R2 Storage edit, plus Account Settings and Workers Tail read and User Details read. Pushing to `main` deploys staging; the staging smoke test stays skipped until `STAGING_URL` and the bypass secrets are set.

Both run on free `workers.dev` addresses. Passkeys are bound to `PASSKEY_RP_ID`, so moving to a custom domain later means updating `APP_URL` and `PASSKEY_RP_ID`, adding the new Google redirect URI, and coaches re-adding their passkeys (Google sign-in keeps working). The test bypass is off on both (`E2E_*` secrets aren't set, and production ignores them anyway).

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
3. Choose the domains, then set `APP_URL` and `PASSKEY_RP_ID` for each environment in `wrangler.jsonc` and add a custom domain to each Worker. **Passkeys are bound to `PASSKEY_RP_ID`.** Use the final production domain from day one; moving domains later means coaches re-add passkeys (Google sign-in keeps working).
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

GitHub Actions: `ci.yml` runs lint, typecheck, unit tests, build, and Playwright on every PR. `deploy.yml` deploys `main` to staging (then smoke-tests it) and production on manual dispatch. It needs the repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts, D1, and R2 edit), `CLOUDFLARE_ACCOUNT_ID`, and for smoke tests `STAGING_E2E_BYPASS_SECRET`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, plus the variable `STAGING_URL`.

## Design

The product brief is in `PRODUCT.md` and the design system in `DESIGN.md`. The visual direction follows a reference the owner picked (Microsoft Dynamics CRM concept by Jack R. for RonDesignLab, Dribbble): a black command panel with lime highlights beside a soft gray canvas of rounded white cards. Text on pastel colors is always near-black for contrast.
