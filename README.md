# CoachMan

CoachMan (short for *coach manager*) is an installable web app for independent pickleball coaches: clients, progress, rates and packages, groups, events like summer camps and academies, the schedule, and the money. Each coach gets a private workspace. It works on court from a phone (even offline) and at a desk on a laptop.

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

## Suggested next steps

1. **Client portal and booking page**: clients see their credits and book open spots; coaches share a link.
2. **Online payments**: Stripe, or PayMongo/Xendit for GCash and Maya in the Philippines, with receipts.
3. **SMS, WhatsApp, or Viber reminders** for clients who don't install apps.
4. **Waivers and consent forms** for juniors and camps, signed on a phone.
5. **Academy mode**: several coaches per workspace with roles, a shared schedule, and commission or payroll reports.
6. **Auto-fill waitlists** when a spot opens, and rescheduling suggestions after rain-outs.
7. **Video notes**: attach short clips to assessments and goals.
8. **DUPR sync** for ratings, and round-robin or ladder generators for clinics.
9. **More sports**: tennis, padel, and badminton rubrics (the rubric is already pluggable).
10. **Session plans from progress gaps**: suggest drills from the weakest skills in a group.

## Architecture

| Layer | Choice |
| --- | --- |
| Hosting | One Cloudflare Worker serves the SPA (static assets) and the API under `/api/*` |
| API | Hono, Zod validation, typed DTOs shared with the app (`src/shared`) |
| Data | Cloudflare D1 (SQLite) with Drizzle; R2 for client photos |
| Auth | Better Auth: Google OAuth plus passkeys (WebAuthn); one workspace per coach |
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
npm run test:unit     # Vitest: credits, allocation, recurrence, money/time, bypass gate
npm run test:e2e      # Playwright: API golden paths, Today check-in/undo, offline sync, passkeys, axe
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

`npm run screenshots` captures desktop (1440) and phone (390) screenshots into `.impeccable/review/` using the same bypass.

## Deploying to Cloudflare

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
